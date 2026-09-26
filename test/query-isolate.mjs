import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import test from 'node:test'
import JSONTag from '@muze-nl/jsontag'
import StoreRuntime from '../src/store-runtime.mjs'
import { QueryView } from '../src/query-view.mjs'
import WorkerPool from '../src/workerPool.mjs'
import { makeServerFixture } from './durability-helpers.mjs'

async function open(t, options = {}) {
    let runtime
    t.after(() => runtime?.close())
    const fixture = await makeServerFixture(t, {
        initialData: '{"persons":[' +
            '<object id="alice">{"name":"Padmé 𠮷", "gender":"private",' +
            '"age":32,"existenceOnly":"private","url":<url>"https://example.test/a"},' +
            '<object id="bob">{"name":"Bob","gender":"private","age":20}' +
            '],"hidden":{"secret":"do not expose"}}'
    })
    const access = path.join(fixture.dir, 'access.mjs')
    await fs.writeFile(access, `
        import { basename } from 'node:path'
        export default function access(object, property, method) {
            if (property === 'existenceOnly') {
                return method === 'has'
            }
            return property !== basename('/hidden/gender') &&
                property !== 'hidden' &&
                !(property === 'age' && method === 'has')
        }
    `)
    const { schema = '{"version":42,"nested":{"value":"ok"}}', ...limits } =
        options
    const schemaFile = path.join(fixture.dir, 'schema.jsontag')
    await fs.writeFile(schemaFile, schema)
    runtime = await StoreRuntime.open({
        ...fixture, access, schemaFile, maxWorkers: 1, ...limits
    })
    async function response(body, extra = {}) {
        return runtime.runQuery({ path: '/', body, jsontag: false, ...extra })
    }
    async function query(body, extra) {
        const result = await response(body, extra)
        assert.equal(result.code, undefined, result.body)
        return JSON.parse(result.body)
    }
    return { runtime, fixture, query, response }
}

test('isolated queries retain helpers, ID identity, tags and path browsing',
    async t => {
        const { query, response } = await open(t)
        assert.deepEqual(await query(`from(data.persons)
            .where({age: value => value > 25}).select({name: _})`),
        [{ name: 'Padmé 𠮷' }])
        assert.equal(await query('data.persons[0] === meta.index.id.get("alice")'),
            true)
        assert.equal(await query('meta.index.id.has("absent")'), false)
        assert.equal(await query('meta.index.id.has({})'), false)
        assert.deepEqual(await query('[meta.schema.version,meta.schema.nested.value]'),
            [42, 'ok'])
        assert.deepEqual(await query('data.persons.map(x => x.name)'),
            ['Padmé 𠮷', 'Bob'])
        assert.equal(await query('String(data.persons[0].url)'),
            'https://example.test/a')
        const tagged = await response('data.persons[0]', {jsontag: true})
        assert.equal(tagged.code, undefined, tagged.body)
        const person = JSONTag.parse(tagged.body)
        assert.equal(JSONTag.getAttribute(person, 'id'), 'alice')
        assert.equal(person.name, 'Padmé 𠮷')
        assert.equal(person.gender, undefined)
        const format = await response(
            'request.jsontag=false;request.body="";data.persons[0]',
            {jsontag: true}
        )
        assert.equal(format.jsontag, true)
        assert.match(format.body, /^<object id="alice">/)
        const json = await query('request.jsontag=true;data.persons[0]')
        assert.equal(json.name, 'Padmé 𠮷')
        const browse = await response(undefined, {
            path: '/persons/', jsontag: true
        })
        assert.equal(browse.code, undefined, browse.body)
        assert.equal(JSONTag.parse(browse.body)[0].name, 'Padmé 𠮷')
        const root = await response(undefined, {jsontag: true})
        assert.equal(JSONTag.getType(JSONTag.parse(root.body).persons), 'link')
    })

test('host grants protect reads, reflection and parser internals', async t => {
    const { query, response } = await open(t)
    assert.deepEqual(await query(`(()=>{
        const p=data.persons[0];
        return {
            keys: Object.keys(p),
            hidden: 'gender' in p,
            descriptor: Object.getOwnPropertyDescriptor(p,'gender'),
            values: {...p},
            symbols: Object.getOwnPropertySymbols(p).map(x=>x.description),
            rootKeys: Reflect.ownKeys(root).filter(x=>typeof x==='string')
        };
    })()`), {
        keys: ['name', 'age', 'url'], hidden: false,
        values: {name: 'Padmé 𠮷', age: 32, url: 'https://example.test/a'},
        symbols: ['@attributes'], rootKeys: ['persons']
    })
    for (const body of [
        'data.persons[0].name="changed"',
        'delete data.persons[0].name',
        'Object.defineProperty(data.persons[0],"name",{value:"changed"})',
        'Object.setPrototypeOf(data.persons[0],{})',
        'data.persons.push({name:"changed"})',
        'JSONTag.setAttribute(data.persons[0],"id","changed")'
    ]) {
        const result = await response(body)
        assert.equal(result.code, 422, body)
    }
    assert.equal(await query('data.persons[0].name'), 'Padmé 𠮷')
    assert.equal(await query('"age" in data.persons[0]'), false)
    assert.equal(await query('data.persons[0].age'), 32)
    assert.deepEqual(await query(`[
        'existenceOnly' in data.persons[0], data.persons[0].existenceOnly
    ]`), [true, null])
})

test('queries have no Node or import capabilities, including generated imports',
    async t => {
        const { query, response } = await open(t)
        assert.deepEqual(await query(`[
            typeof process,typeof require,typeof fetch,typeof Buffer,
            typeof WebAssembly,typeof SharedArrayBuffer,
            Function('return typeof process')()
        ]`), Array(7).fill('undefined'))
        const staticImport = await response('import fs from "node:fs"')
        assert.equal(staticImport.code, 422)
        assert.equal(await query(`globalThis.importError='pending';
            import('node:fs').catch(e=>importError=e.message);
            ({toJSON(){return importError}})`), 'Not supported')
        assert.equal(await query(`globalThis.importError='pending';
            Function('return import("node:fs")')()
                .catch(e=>importError=e.message);
            ({toJSON(){return importError}})`), 'Not supported')
        assert.equal((await response('Promise.resolve(42)')).code, 422)
        for (const body of ['throw null', 'throw "message"', 'throw {}']) {
            assert.equal((await response(body)).code, 422)
        }
    })

test('fresh isolates prevent globals and prototypes leaking between queries',
    async t => {
        const { query } = await open(t)
        assert.equal(await query(`globalThis.leak=123;
            Array.prototype.leak=456; 1`), 1)
        assert.deepEqual(await query('[typeof leak,typeof [].leak]'),
            ['undefined', 'undefined'])
        // A hostile inherited toJSON must never see/mutate the private record
        // reference used by the bridge's identity cache.
        assert.equal(await query(`let captures=0;
            Array.prototype.toJSON=function(){captures++;return []};
            data.persons[0].name; captures`), 0)
        assert.equal(await query(`Array.prototype.includes=()=>true;
            Object.prototype.gender='fake'; data.persons[0].gender`), 'fake')
        assert.equal(await query('"gender" in data.persons[0]'), false)
        assert.equal(await query(`Object.prototype.reference=[0,'hidden'];
            Object.prototype.tagged='<object>{"secret":"fake"}';
            data.persons[0].name`), 'Padmé 𠮷')
    })

test('execution and serialization timeouts leave later queries usable',
    async t => {
        const { query, response } = await open(t, {timeout: 80})
        for (const body of [
            'while(true){}',
            '({toJSON(){while(true){}}})',
            '({get value(){while(true){}}})'
        ]) {
            const start = performance.now()
            const result = await response(body)
            assert.equal(result.code, 422, result.body)
            assert.match(result.body, /timed out/)
            assert.ok(performance.now() - start < 2000)
            assert.equal(await query('1+2'), 3)
        }
    })

test('UTF-8 result limits cover JSON, JSONTag and hostile serialization',
    async t => {
        const { query, response } = await open(t, {maxQueryResultBytes: 1024})
        assert.equal((await query('"𠮷".repeat(200)')).length, 400)
        for (const body of [
            '"x".repeat(1100)',
            '"𠮷".repeat(300)',
            'String.prototype.charCodeAt=()=>0;"𠮷".repeat(300)',
            'JSON.stringify=()=>"";"x".repeat(1100)'
        ]) {
            for (const jsontag of [false, true]) {
                const result = await response(body, {jsontag})
                assert.equal(result.code, 422, result.body)
                assert.match(result.body, /size limit/)
            }
        }
        const error = await response('throw new Error("x".repeat(10000))')
        assert.ok(Buffer.byteLength(error.body) <= 1024)
    })

test('isolate memory exhaustion does not poison the next query', async t => {
    const { query, response } = await open(t, {
        queryMemoryLimit: 8, timeout: 2000
    })
    const result = await response(`const values=[];
        while(true){values.push(new Array(100000).fill(42))}`)
    assert.equal(result.code, 422, result.body)
    assert.match(result.body, /memory|disposed|allocation/i)
    assert.equal(await query('42'), 42)
})

test('query limit configuration rejects disabled or invalid bounds', async t => {
    const fixture = await makeServerFixture(t)
    for (const [key, value] of [
        ['timeout', 0], ['slowTimeout', Infinity], ['queryMemoryLimit', 1],
        ['queryMemoryLimit', 1.5], ['maxQueryResultBytes', 0]
    ]) {
        await assert.rejects(StoreRuntime.open({...fixture, [key]: value}),
            new RegExp(key))
    }
})

test('outer query deadline replaces a stuck worker at the committed head',
    async t => {
        const fixture = await makeServerFixture(t)
        const worker = path.join(fixture.dir, 'stuck-worker.mjs')
        await fs.writeFile(worker, `
            import {parentPort} from 'node:worker_threads';
            let count=0;
            parentPort.on('message',task=>{
                if(task.name==='init'){count=task.req.sources.length}
                if(task.name==='update'){count++}
                if(task.req?.stuck){while(true){}}
                parentPort.postMessage(count);
            });
        `)
        const pool = new WorkerPool(1, worker, {
            name: 'init', req: {sources: [{}], meta: {}}
        })
        t.after(() => pool.close())
        assert.equal(await pool.run('query', {}, {timeout: 50}), 1)
        const failed = assert.rejects(
            pool.run('query', {stuck: true}, {timeout: 50}), /timed out/
        )
        pool.update({name: 'update', req: {source: {}, meta: {}}})
        await failed
        assert.equal(await pool.run('query', {}, {timeout: 50}), 2)
    })

// Shared and cyclic references, as produced by <link> in a schema file.
const graphSchema = '{"types":{' +
    '"Node":<object id="/schema/types/Node/">{"label":"node",' +
    '"children":[<link>"/schema/types/Node/"],' +
    '"title":<object id="/schema/properties/title/">{"type":"string"}},' +
    '"Leaf":<object id="/schema/types/Leaf/">{' +
    '"title":<link>"/schema/properties/title/"}},' +
    '"contexts":{"a":{"root":<link>"/schema/types/Node/"},' +
    '"b":{"root":<link>"/schema/types/Node/"}}}'

test('schema objects keep identity across paths, links and cycles',
    async t => {
        const { query, response } = await open(t, {schema: graphSchema})
        assert.equal(await query(
            'meta.schema.types.Node.title === meta.schema.types.Leaf.title'
        ), true)
        assert.equal(await query(
            'meta.schema.types.Node.children[0] === meta.schema.types.Node'
        ), true)
        assert.equal(await query(
            'meta.schema.contexts.a.root === meta.schema.contexts.b.root'
        ), true)
        const host = JSONTag.parse(graphSchema)
        assert.deepEqual(
            await query('Reflect.ownKeys(meta.schema.types.Node).map(String)'),
            Reflect.ownKeys(host.types.Node).map(String)
        )
        assert.deepEqual(await query('meta.schema.types.Leaf'),
            {title: {type: 'string'}})
        const tagged = await response('meta.schema', {jsontag: true})
        assert.equal(tagged.code, undefined, tagged.body)
        assert.equal(tagged.body, JSONTag.stringify(host))
        const start = performance.now()
        const cyclic = await response('meta.schema', {jsontag: false})
        assert.equal(cyclic.code, 422, cyclic.body)
        assert.match(cyclic.body, /circular/i)
        assert.ok(performance.now() - start < 2000)
    })

test('widely shared schema objects serialize as links within the timeout',
    async t => {
        // Each level links twice to the next: 26 objects, 2^25 paths.
        const levels = 25
        let schema = '<object id="/schema/' + levels + '/">{"value":"end"}'
        for (let level = levels - 1; level >= 0; level--) {
            const next = '<link>"/schema/' + (level + 1) + '/"'
            schema = '<object id="/schema/' + level + '/">{' +
                '"left":' + schema + ',"right":' + next + '}'
        }
        const { response } = await open(t, {schema})
        const start = performance.now()
        const result = await response('meta.schema', {jsontag: true})
        assert.equal(result.code, undefined, result.body)
        assert.equal(result.body, JSONTag.stringify(JSONTag.parse(schema)))
        assert.ok(performance.now() - start < 1000)
    })

test('schema handles are stable across views and separately parsed schemas',
    () => {
        const references = schema => {
            const view = new QueryView({ parser: { meta: { schema } } }, 1024)
            return [
                schema,
                schema.types.Node.title,
                schema.types.Leaf.title,
                schema.contexts.b.root
            ].map(value => view.describe(value, []).reference)
        }
        const schema = JSONTag.parse(graphSchema)
        const first = references(schema)
        assert.deepEqual(first[0], ['schema', 0])
        assert.deepEqual(first[1], first[2])
        assert.deepEqual(references(schema), first)
        assert.deepEqual(references(JSONTag.parse(graphSchema)), first)
    })

test('shared data without ids links by record in JSONTag responses',
    async t => {
        const shared = { value: 1 }
        const initialValue = {
            a: shared, b: shared, list: [shared, shared], alone: { value: 2 },
            named: JSONTag.parse('<object id="~1">{"value":3}')
        }
        initialValue.also = initialValue.named
        const fixture = await makeServerFixture(t, { initialValue })
        const runtime = await StoreRuntime.open({ ...fixture, maxWorkers: 1 })
        t.after(() => runtime.close())
        const response = body => {
            return runtime.runQuery({ path: '/', body, jsontag: true })
        }
        const result = await response('data')
        assert.equal(result.code, undefined, result.body)
        const data = JSONTag.parse(result.body)
        assert.equal(data.a, data.b)
        assert.equal(data.list[0], data.a)
        assert.equal(data.also, data.named)
        const id = JSONTag.getAttribute(data.a, 'id')
        assert.match(id, /^~\d+$/)
        assert.notEqual(id, '~1')
        assert.equal(JSONTag.getAttribute(data.alone, 'id'), undefined)
        assert.equal((await response('data')).body, result.body)
        const hidden = await runtime.runQuery({
            path: '/', jsontag: false,
            body: '[JSONTag.getAttribute(data.a, "id") ?? null]'
        })
        assert.deepEqual(JSON.parse(hidden.body), [null])
        const built = await response(
            'const y = {}; ({m: y, n: y, a: data.a, b: data.b})'
        )
        assert.equal(built.code, undefined, built.body)
        const copy = JSONTag.parse(built.body)
        assert.equal(copy.m, copy.n)
        assert.equal(copy.a, copy.b)
        assert.equal(JSONTag.getAttribute(copy.m, 'id'), '~query-1')
        assert.equal(JSONTag.getAttribute(copy.a, 'id'), id)
    })

test('tagged scalars keep identity within a query only', async t => {
    const { query } = await open(t)
    assert.equal(await query(
        'data.persons[0].url === data.persons[0].url'
    ), true)
    assert.equal(await query(`const url = data.persons[0].url
        url.extra = 1
        data.persons[0].url.extra`), 1)
    assert.equal(await query('data.persons[0].url.extra ?? null'), null)
})
