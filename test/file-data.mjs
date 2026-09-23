import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import JSONTag from '@muze-nl/jsontag'
import serialize from '@muze-nl/od-jsontag/src/serialize.mjs'
import { FileDataset, scanDataFile, hashFile, loadFileData } from '../src/file-data.mjs'
import { appendIntegrityRecord } from '../src/integrity.mjs'
import index from '../src/index.mjs'
import WorkerPool from '../src/workerPool.mjs'
import StoreRuntime from '../src/store-runtime.mjs'
import { makeServerFixture } from './durability-helpers.mjs'
import runCommand, { initialize, close } from '../src/command-worker-module.mjs'

function fixture(t, text = '{"items":[<object id="first">{"name":"first"},<object id="last">{"name":"last"}]}') {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'simplystore-files-'))
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
    const file = path.join(dir, 'data.jsontag')
    fs.writeFileSync(file, serialize(JSONTag.parse(text)))
    const source = scanDataFile(file)
    return { dir, file, source }
}

function open(t, sources, meta, immutable = true) {
    const dataset = new FileDataset(meta, immutable)
    t.after(() => dataset.close())
    dataset.open(sources)
    return dataset
}

test('file loading resolves unread IDs and sends metadata without dataset bytes', async t => {
    const { file, dir } = fixture(t)
    // Legacy missing/stale derived indexes must not override canonical bytes.
    fs.writeFileSync(path.join(dir, 'index.offset.json'), '{"0":[9,999999]}')
    fs.writeFileSync(path.join(dir, 'index.id.json'), '{"last":999}')
    const loaded = await loadFileData({ dataFile: file, commands: [] })
    assert.equal(loaded.data, undefined)
    assert.equal(loaded.meta.index.id.get('last'), 2)
    assert.deepEqual(structuredClone(loaded), loaded)
    const dataset = open(t, loaded.sources, loaded.meta)
    assert.equal(dataset.parser.meta.resultArray[2], undefined)
    assert.equal(dataset.parser.getLineProxy(2).name, 'last')
    assert.equal(dataset.root.items[1], dataset.parser.getLineProxy(2))
})

test('sparse file overlays retain unread records and allocate beyond the full base', t => {
    const { dir, source } = fixture(t)
    const patch = path.join(dir, 'data.patch.jsontag')
    const payload = '<object id="first">{"name":"changed"}'
    fs.writeFileSync(patch, `+1\n(${Buffer.byteLength(payload)})${payload}`)
    const dataset = open(t, [source, scanDataFile(patch)], {}, false)
    dataset.root.items.push({ name: 'new' })
    assert.deepEqual(dataset.root.items.map(item => item.name), [
        'changed', 'last', 'new'
    ])
    const output = path.join(dir, 'output.jsontag')
    fs.writeFileSync(output, serialize(dataset.root))
    const copy = open(t, [scanDataFile(output)])
    assert.deepEqual(copy.root.items.map(item => item.name), [
        'changed', 'last', 'new'
    ])
})

test('framing scan handles short reads, UTF-8 and payloads beyond its byte buffer', t => {
    const { file } = fixture(t, JSON.stringify({ text: '漢😀'.repeat(20000) }))
    const read = fs.readSync
    const mock = t.mock.method(fs, 'readSync', (fd, buffer, offset, length, position) => {
        return read(fd, buffer, offset, Math.min(length, 997), position)
    })
    const source = scanDataFile(file)
    assert.ok(mock.mock.callCount() > 100)
    assert.equal(source.digest, hashFile(file))
    const bytes = fs.readFileSync(file)
    assert.equal(source.digest, createHash('sha256').update(bytes).digest('hex'))
    const header = /^\((\d+)\)/.exec(bytes.toString('utf8', 0, 32))
    assert.deepEqual(source.offsets, {
        0: [header[0].length, header[0].length + Number(header[1])]
    })
})

for (const content of ['(9){}', '(x){}', '+x\n', '+1x\n', '(2){}x',
    '+4294967295\n', '(9007199254740999){}']) {
    test(`file framing rejects ${JSON.stringify(content)}`, t => {
        const { file } = fixture(t)
        fs.writeFileSync(file, content)
        assert.throws(() => scanDataFile(file), /Invalid OD-JSONTag/)
    })
}

test('sessions close all handles on failure and reject changed source identities', t => {
    const { source, file } = fixture(t)
    const dataset = new FileDataset()
    const handles = []
    const openSync = fs.openSync
    t.mock.method(fs, 'openSync', (...args) => {
        const fd = openSync(...args)
        handles.push(fd)
        return fd
    })
    assert.throws(() => dataset.open([
        source, { ...source, file: file + '.missing' }
    ]), /ENOENT/)
    for (const fd of handles) {
        assert.throws(() => fs.fstatSync(fd), /EBADF/)
    }
    fs.appendFileSync(file, '\n')
    assert.throws(() => new FileDataset().open([source]), /source changed/)
})

test('opening and partial reads never read the entire file through readFile', async t => {
    const { file } = fixture(t)
    t.mock.method(fs, 'readFileSync', () => {
        throw new Error('whole-file read is forbidden')
    })
    const loaded = await loadFileData({ dataFile: file, commands: [] })
    const dataset = open(t, loaded.sources, loaded.meta)
    assert.equal(dataset.root.items[1].name, 'last')
})

test('file loading checks full-file integrity before returning sources', async t => {
    const { dir, file } = fixture(t)
    const integrityFile = path.join(dir, 'integrity.jsontag')
    await appendIntegrityRecord(integrityFile, file, fs.readFileSync(file))
    const options = {
        dataFile: file, commands: [], integrityFile, integrityRequired: true
    }
    await loadFileData(options)
    const bytes = fs.readFileSync(file)
    fs.writeFileSync(file, bytes.toString().replace('last', 'lost'))
    await assert.rejects(loadFileData(options), /Integrity mismatch/)
})

test('persisted index loaders use the requested base and command names', t => {
    const { dir } = fixture(t)
    for (const suffix of ['', '.command']) {
        fs.writeFileSync(path.join(dir, `index.id${suffix}.json`), '{"id":2}')
        fs.writeFileSync(path.join(dir, `index.offset${suffix}.json`), '{"2":[1,4]}')
    }
    for (const command of [null, 'command']) {
        assert.deepEqual(index.load({ data: dir }, command), {
            id: { id: 2 }, offset: { 2: [1, 4] }
        })
    }
})

test('command ID lookups resolve unread objects and output only the changed file', async t => {
    const { dir, file } = fixture(t)
    const loaded = await loadFileData({ dataFile: file, commands: [] })
    const commandsFile = path.join(dir, 'commands.mjs')
    fs.writeFileSync(commandsFile, `export default {
        edit(data, command, unused, meta) {
            meta.index.id.get(command.target).deref().name = 'edited by ID'
        }
    }`)
    await initialize({
        ...loaded, datafile: file, commandsFile,
        indexFile: fileURLToPath(new URL('../src/index.mjs', import.meta.url))
    })
    t.after(close)
    const result = await runCommand('{"id":"edit","name":"edit","target":"last"}')
    assert.equal(result.data, undefined)
    assert.deepEqual(Object.keys(result.source.offsets), ['2'])
    const dataset = open(t, [...loaded.sources, result.source], result.meta)
    assert.equal(dataset.root.items[1].name, 'edited by ID')
    assert.equal(dataset.root.items[0].name, 'first')
})

async function poolFixture(t) {
    const { dir } = fixture(t)
    const workerFile = path.join(dir, 'worker.mjs')
    fs.writeFileSync(workerFile, `import {parentPort} from 'node:worker_threads'
        let version = 0
        parentPort.on('message', async task => {
            if (task.req?.crash) { throw new Error('query crashed') }
            if (task.name === 'init' || task.name === 'update') {
                await new Promise(resolve => setTimeout(resolve, 25))
                version = task.req.meta.version
            }
            parentPort.postMessage(version)
        })`)
    const pool = new WorkerPool(2, workerFile, {
        name: 'init', req: { sources: [], meta: { version: 0 } }
    })
    t.after(() => pool.close())
    return pool
}

test('updates finish before queries even during initialization and replacement', async t => {
    const pool = await poolFixture(t)
    pool.update({ name: 'update', req: { source: { file: 'a' }, meta: { version: 1 } } })
    pool.update({ name: 'update', req: { source: { file: 'b' }, meta: { version: 2 } } })
    const results = await Promise.all(Array.from({ length: 8 }, () => {
        return pool.run('query', {})
    }))
    assert.deepEqual(results, Array(8).fill(2))
    await assert.rejects(pool.run('query', { crash: true }), /query crashed/)
    const next = await Promise.all(Array.from({ length: 8 }, () => {
        return pool.run('query', {})
    }))
    assert.deepEqual(next, Array(8).fill(2))
    assert.equal(pool.initTask.req.sources.length, 2)
})

test('closing a pool awaits termination and rejects outstanding queries', async t => {
    const pool = await poolFixture(t)
    const pending = pool.run('query', {})
    const rejected = assert.rejects(pending, /pool closed/)
    await pool.close()
    await rejected
    assert.equal(pool.workers.size, 0)
    await assert.rejects(pool.run('query', {}), /pool closed/)
})

test('live runtime retains only files through commit, query and reopen', async t => {
    let runtime
    let reopened
    t.after(async () => {
        await reopened?.close()
        await runtime?.close()
    })
    const fixture = await makeServerFixture(t)
    const options = { ...fixture, maxWorkers: 2 }
    runtime = await StoreRuntime.open(options)
    assert.equal(runtime.data, undefined)
    assert.equal(runtime.sources.length, 1)
    const accepted = await runtime.acceptCommand(
        '{"id":"A","name":"addPerson","value":{"name":"A"}}'
    )
    assert.equal(accepted.code, 202)
    await runtime.runQueuedCommands()
    assert.equal(runtime.getCommandStatus('A').value.status, 'done')
    assert.equal(runtime.sources.length, 2)
    assert.ok(runtime.sources.every(source => typeof source.file === 'string'))
    const response = await runtime.runQuery({
        path: '/', body: 'data.persons.map(p => p.name)', jsontag: false
    })
    assert.deepEqual(JSON.parse(response.body), ['A'])
    const selected = await runtime.runQuery({
        path: '/',
        body: 'from(data.persons).where({name: "A"}).select({name: _})',
        jsontag: false
    })
    assert.deepEqual(JSON.parse(selected.body), [{name: 'A'}])
    const mutation = await runtime.runQuery({
        path: '/', body: 'data.persons.push({name: "forbidden"})',
        jsontag: false
    })
    assert.equal(mutation.code, 422)
    const definition = await runtime.runQuery({
        path: '/', body: 'Object.defineProperty(data.persons, "0", {value: null})',
        jsontag: false
    })
    assert.equal(definition.code, 422)
    await runtime.close()
    reopened = await StoreRuntime.open(options)
    assert.equal(reopened.sources.length, 2)
    const after = await reopened.runQuery({
        path: '/', body: 'data.persons.map(p => p.name)', jsontag: false
    })
    assert.deepEqual(JSON.parse(after.body), ['A'])
})

test('a failed worker update refuses further queries instead of serving stale data', async t => {
    const pool = await poolFixture(t)
    const failed = new Promise(resolve => pool.once('error', resolve))
    pool.update({ name: 'update', req: {
        source: {file: 'bad'}, meta: {version: 1}, crash: true
    } })
    const query = assert.rejects(pool.run('query', {}), /query crashed/)
    await failed
    await query
    await assert.rejects(pool.run('query', {}), /query crashed/)
})

test('premature EOF cannot turn an existing data file into an empty source', t => {
    const { file } = fixture(t)
    t.mock.method(fs, 'readSync', () => 0)
    assert.throws(() => scanDataFile(file), /unexpected EOF/)
    assert.throws(() => hashFile(file), /Unexpected EOF/)
})

test('ID precedence follows record order when a patch fills an earlier hole', async t => {
    const { file, dir } = fixture(t)
    const record = text => `(${Buffer.byteLength(text)})${text}`
    fs.writeFileSync(file,
        record('{"items":[~2,~5]}') + '\n+4\n' +
        record('<object id="duplicate">{"name":"higher"}')
    )
    fs.writeFileSync(path.join(dir, 'data.fill.jsontag'),
        '+2\n' + record('<object id="duplicate">{"name":"lower"}')
    )
    const loaded = await loadFileData({dataFile: file, commands: ['fill']})
    assert.equal(loaded.meta.index.id.get('duplicate'), 5)
})

test('a lazy read failure during a command is a storage failure', async t => {
    const { dir, file } = fixture(t)
    const loaded = await loadFileData({dataFile: file, commands: []})
    const commandsFile = path.join(dir, 'commands.mjs')
    fs.writeFileSync(commandsFile, `export default {
        read(data) {
            try { data.items[1].name } catch (error) {}
            data.changedAfterFailure = true
        }
    }`)
    await initialize({
        ...loaded, datafile: file, commandsFile,
        indexFile: fileURLToPath(new URL('../src/index.mjs', import.meta.url))
    })
    t.after(close)
    fs.truncateSync(file, 0)
    await assert.rejects(runCommand('{"id":"read","name":"read"}'), error => {
        return error.storageFailure === true
    })
    assert.equal(fs.existsSync(path.join(dir, 'data.read.jsontag')), false)
})

test('lazy query read failures stop mutation, while query-thrown flags do not', async t => {
    let runtime
    t.after(async () => runtime?.close())
    const fixture = await makeServerFixture(t, {
        initialData: '{"persons":[{"name":"unread"}]}'
    })
    runtime = await StoreRuntime.open({...fixture, maxWorkers: 1})
    const request = body => ({path: '/', body, jsontag: false})
    await runtime.runQuery(request('data.persons.length'))
    // Finish both initializations before altering a disposable source file.
    await runtime.runQuery(request('data.persons.length'), {slow: true})
    const spoofed = await runtime.runQuery(request(
        'throw {storageFailure: true}'
    ))
    assert.equal(spoofed.code, 422)
    assert.equal(runtime.storageFailed, false)
    fs.truncateSync(fixture.datafile, 0)
    const result = await runtime.runQuery(request(
        'try { data.persons[0].name } catch (error) {} "caught"'
    ))
    assert.equal(result.code, 500)
    assert.equal(runtime.storageFailed, true)
    const accepted = await runtime.acceptCommand(
        '{"id":"after-failure","name":"addPerson","value":{"name":"bad"}}'
    )
    assert.equal(accepted.code, 503)
})
