import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { FileParser, loadFileData } from '../src/file-data.mjs'
import { getIndex } from '@muze-nl/od-jsontag/src/symbols.mjs'
import idIndex, { prepareIdIndex } from '../src/index.id.mjs'
import offsetIndex from '../src/index.offset.mjs'
import runCommand, { initialize, close } from '../src/command-worker-module.mjs'
import StoreRuntime from '../src/store-runtime.mjs'
import { makeServerFixture } from './durability-helpers.mjs'

const tagModule = import.meta.resolve('@muze-nl/jsontag')
const defaultIndex = new URL('../src/index.mjs', import.meta.url)
const commandsSource = `import JSONTag from ${JSON.stringify(tagModule)}
export default {
    rename(data, command) {
        JSONTag.setAttribute(data.items[command.item || 0], 'id', command.value)
    },
    swap(data) {
        JSONTag.setAttribute(data.items[0], 'id', 'last')
        JSONTag.setAttribute(data.items[1], 'id', 'first')
    },
    duplicateBoth(data) {
        JSONTag.setAttribute(data.items[0], 'id', 'duplicate')
        JSONTag.setAttribute(data.items[1], 'id', 'duplicate')
    },
    edit(data) { data.items[0].name = 'edited' },
    noop() {}
}`

async function fixture(t, options = {}) {
    const files = await makeServerFixture(t, {
        initialData: '{"items":[<object id="first">{"name":"first"},' +
            '<object id="last">{"name":"last"}]}',
        commandsSource, ...options
    })
    if (!options.indexSource) {
        files.indexFile = fileURLToPath(defaultIndex)
    }
    const bytes = fs.readFileSync(files.datafile)
    idIndex.write({data: files.dir}, prepareIdIndex(bytes).entries)
    await offsetIndex.writeSerialized(bytes, {data: files.dir})
    return files
}

async function command(files, previous, task) {
    const loaded = await loadFileData({
        dataFile: files.datafile, commands: previous
    })
    await initialize({...loaded, ...files})
    try {
        return await runCommand(JSON.stringify(task))
    }
    finally {
        close()
    }
}

function storedIds(files, id) {
    return JSON.parse(fs.readFileSync(
        path.join(files.dir, `index.id.${id}.json`), 'utf8'))
}

test('same-record IDs, renames, removal and swaps agree after restart', async t => {
    const files = await fixture(t)
    const previous = []
    const steps = [
        [{id: 'edit', name: 'edit'}, {first: 1}, {first: 1, last: 2}],
        [{id: 'swap', name: 'swap'}, {last: 1, first: 2}, {last: 1, first: 2}],
        [{id: 'rename', name: 'rename', value: 'renamed'},
            {renamed: 1}, {first: 2, renamed: 1}],
        [{id: 'remove', name: 'rename', value: ''}, {}, {first: 2}]
    ]
    for (const [task, part, expected] of steps) {
        const result = await command(files, previous, task)
        previous.push(task.id)
        assert.deepEqual(storedIds(files, task.id), part)
        const reopened = await loadFileData({
            dataFile: files.datafile, commands: previous, validateIndexes: true
        })
        assert.deepEqual(result.meta.index.id,
            new Map(Object.entries(expected)))
        assert.deepEqual(reopened.meta.index.id, result.meta.index.id)
    }
})

test('IDs reflect mutations after the default update hook', async t => {
    const files = await fixture(t, {
        indexSource: `import base from ${JSON.stringify(defaultIndex.href)}
            import JSONTag from ${JSON.stringify(tagModule)}
            export default {
                update(data, meta, changes) {
                    base.update(data, meta, changes)
                    JSONTag.setAttribute(data.items[1], 'id', 'hook-renamed')
                    data.items.push(JSONTag.parse('<object id="added">{}'))
                }
            }`
    })
    const result = await command(files, [], {id: 'hook', name: 'edit'})
    assert.deepEqual(storedIds(files, 'hook'), {
        first: 1, 'hook-renamed': 2, added: 3
    })
    const reopened = await loadFileData({
        dataFile: files.datafile, commands: ['hook'], validateIndexes: true
    })
    assert.deepEqual(result.meta.index.id, reopened.meta.index.id)
})

test('custom finalization cannot leave a stale canonical ID index', async t => {
    const files = await fixture(t, {
        indexSource: `import fs from 'node:fs/promises'
            export default {
                update() {},
                async finalize(bytes, meta, uuid) {
                    await fs.writeFile(meta.data + '/index.id.' + uuid + '.json',
                        '{"stale":999}')
                }
            }`
    })
    await command(files, [], {id: 'custom', name: 'edit'})
    assert.deepEqual(storedIds(files, 'custom'), {first: 1})
})

test('no-op commands finalize an empty ID index', async t => {
    const files = await fixture(t)
    fs.writeFileSync(path.join(files.dir, 'index.id.noop.json'), '{"stale":1}')
    const result = await command(files, [], {id: 'noop', name: 'noop'})
    assert.deepEqual(storedIds(files, 'noop'), {})
    assert.deepEqual(result.meta.index.id, new Map([['first', 1], ['last', 2]]))
})

for (const task of [
    {id: 'duplicate', name: 'rename', item: 1, value: 'first'},
    {id: 'duplicate', name: 'duplicateBoth'}
]) {
    test(`duplicate IDs reject ${task.name} before data publication`, async t => {
        const files = await fixture(t)
        await assert.rejects(command(files, [], task), error => {
            assert.match(error.message, /Duplicate ID/)
            assert.notEqual(error.storageFailure, true)
            return true
        })
        assert.equal(fs.existsSync(path.join(files.dir,
            'data.duplicate.jsontag')), false)
        assert.equal(fs.existsSync(path.join(files.dir,
            'index.id.duplicate.json')), false)
    })
}

test('ID-index publication failure prevents command success', async t => {
    const files = await fixture(t)
    fs.mkdirSync(path.join(files.dir, 'index.id.blocked.json'))
    await assert.rejects(command(files, [], {id: 'blocked', name: 'edit'}),
        error => error.storageFailure === true)
})

test('live ID lookup, duplicate rejection and restart preserve the same map', async t => {
    let runtime
    t.after(async () => runtime?.close())
    const files = await fixture(t)
    runtime = await StoreRuntime.open({...files, maxWorkers: 1})
    await runtime.acceptCommand(JSON.stringify({
        id: 'rename', name: 'rename', value: 'renamed'
    }))
    await runtime.runQueuedCommands()
    assert.equal(runtime.getCommandStatus('rename').value.status, 'done')
    const query = {
        path: '/', jsontag: false,
        body: '[meta.index.id.has("first"), meta.index.id.get("renamed").name]'
    }
    const live = await runtime.runQuery(query)
    assert.deepEqual(JSON.parse(live.body), [false, 'first'])
    await runtime.acceptCommand(JSON.stringify({
        id: 'duplicate', name: 'rename', item: 1, value: 'renamed'
    }))
    await runtime.runQueuedCommands()
    assert.equal(runtime.getCommandStatus('duplicate').value.status, 'failed')
    assert.equal(runtime.storageFailed, false)
    assert.equal(fs.existsSync(path.join(files.dir,
        'data.duplicate.jsontag')), false)
    await runtime.close()
    runtime = await StoreRuntime.open({...files, maxWorkers: 1,
        validateIndexes: true})
    assert.deepEqual(JSON.parse((await runtime.runQuery(query)).body),
        [false, 'first'])
    await runtime.acceptCommand('{"id":"after","name":"edit"}')
    await runtime.runQueuedCommands()
    assert.equal(runtime.getCommandStatus('after').value.status, 'done')
})

test('runtime exposes explicit index validation and reconstruction', async t => {
    const files = await fixture(t)
    fs.writeFileSync(path.join(files.dir, 'index.id.json'), '{}')
    await assert.rejects(StoreRuntime.open({...files, maxWorkers: 1,
        validateIndexes: true}), /ID index does not match data/)
    const runtime = await StoreRuntime.open({...files, maxWorkers: 1,
        rebuildIndexes: true})
    try {
        assert.deepEqual(runtime.meta.index.id,
            new Map([['first', 1], ['last', 2]]))
    }
    finally {
        await runtime.close()
    }
    assert.equal(fs.readFileSync(path.join(files.dir, 'index.id.json'), 'utf8'),
        '{}')
})


test('ID-only edits do not parse untouched records during command preparation', async t => {
    const files = await fixture(t)
    const parsed = new Set()
    const firstParse = FileParser.prototype.firstParse
    t.mock.method(FileParser.prototype, 'firstParse', function (target) {
        parsed.add(target[getIndex])
        return firstParse.call(this, target)
    })
    const result = await command(files, [], {
        id: 'rename', name: 'rename', value: 'renamed'
    })
    assert.equal(result.meta.index.id.get('renamed'), 1)
    assert.equal(parsed.has(2), false)
})

for (const changeFile of [false, true]) {
    test(`finalizers must preserve serialization (change file: ${changeFile})`, async t => {
        const files = await fixture(t, {
            indexSource: `import fs from 'node:fs/promises'
                export default {
                    update() {},
                    async finalize(bytes, meta, uuid) {
                        bytes[bytes.indexOf('edited')] = 120
                        if (${changeFile}) {
                            await fs.writeFile(meta.data + '/data.' + uuid +
                                '.jsontag', bytes)
                        }
                    }
                }`
        })
        await assert.rejects(command(files, [], {id: 'tamper', name: 'edit'}),
            /Changeset changed during finalization/)
    })
}
