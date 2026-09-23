import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import test from 'node:test'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'
import { initializeIntegrity } from '../src/initialize-integrity.mjs'
import { loadFileData, scanDataFile } from '../src/file-data.mjs'
import { inspectStore } from '../src/store-inspection.mjs'
import { acquireOwnership } from '../src/store-ownership.mjs'
import StoreRuntime from '../src/store-runtime.mjs'
import { getDefaultIntegrityFile, loadIntegrityManifest, verifyIntegrity }
    from '../src/integrity.mjs'
import { appendArtifactIntegrity } from '../src/index-files.mjs'
import idIndex, { prepareIdIndex } from '../src/index.id.mjs'
import offsetIndex from '../src/index.offset.mjs'
import runCommand, { initialize, close } from '../src/command-worker-module.mjs'
import { makeServerFixture } from './durability-helpers.mjs'

async function fixture(t) {
    const files = await makeServerFixture(t, {
        initialData: '{"persons":[<object id="first">{"name":"first"}]}'
    })
    files.integrityFile = getDefaultIntegrityFile(files.datafile)
    const bytes = await fs.readFile(files.datafile)
    await offsetIndex.writeSerialized(bytes, {data: files.dir})
    idIndex.write({data: files.dir}, prepareIdIndex(bytes).entries)
    await fs.unlink(files.integrityFile)
    return files
}

async function snapshot(files) {
    const entries = []
    for (const name of await fs.readdir(files.dir)) {
        if (name !== path.basename(files.integrityFile)) {
            entries.push([name, await fs.readFile(path.join(files.dir, name))])
        }
    }
    return entries
}

async function assertUnlocked(files) {
    const owner = await acquireOwnership([files.dir])
    await owner.release()
}

test('normal startup and loader require integrity even with old false options', async t => {
    const files = await fixture(t)
    const before = await snapshot(files)
    await assert.rejects(StoreRuntime.open({...files, integrity: false}),
        /Missing integrity manifest.*init-integrity/)
    await assert.rejects(loadFileData({dataFile: files.datafile, commands: [],
        integrityFile: null, integrityRequired: false}),
    /Missing integrity manifest/)
    const report = await inspectStore({...files, integrity: false})
    assert.equal(report.ready, false)
    assert.deepEqual(await snapshot(files), before)
    await assert.rejects(fs.access(files.integrityFile), /ENOENT/)
    await assertUnlocked(files)
})

test('initialization preserves commands and original bytes', async t => {
    let runtime
    t.after(async () => {
        await runtime?.close()
    })
    const files = await fixture(t)
    await initializeIntegrity(files)
    runtime = await StoreRuntime.open({...files, maxWorkers: 1})
    await runtime.acceptCommand(JSON.stringify({id: 'added', name: 'addPerson',
        value: {name: 'kept after restart'}}))
    await runtime.runQueuedCommands()
    assert.equal(runtime.getCommandStatus('added').value.status, 'done')
    await runtime.close()
    await fs.unlink(files.integrityFile)
    const before = await snapshot(files)
    const result = await initializeIntegrity(files)
    assert.equal(result.files, 6)
    assert.deepEqual(result.committed, ['added'])
    assert.deepEqual(await snapshot(files), before)
    const manifest = await loadIntegrityManifest(files.integrityFile)
    assert.equal(manifest.size, 6)
    for (const [name] of manifest) {
        const file = path.join(files.dir, name)
        assert.equal(verifyIntegrity(manifest, files.integrityFile,
            file, await fs.readFile(file), {required: true}), true)
    }
    runtime = await StoreRuntime.open({...files, maxWorkers: 1})
    const response = await runtime.runQuery({path: '/', jsontag: false,
        body: 'data.persons.map(person => person.name)'})
    assert.deepEqual(JSON.parse(response.body), ['first', 'kept after restart'])
})

test('initialization CLI supports a configured manifest path without importing hooks', async t => {
    const files = await fixture(t)
    const logdir = path.join(files.dir, 'logs')
    await fs.mkdir(logdir)
    files.integrityFile = path.join(logdir, 'checksums.jsontag')
    await fs.writeFile(files.commandsFile, 'throw new Error("must not import")')
    await fs.writeFile(files.indexFile, 'throw new Error("must not import")')
    const config = path.join(files.dir, 'store.json')
    await fs.writeFile(config, JSON.stringify(files))
    const script = fileURLToPath(new URL('../scripts/recover.mjs', import.meta.url))
    const result = await promisify(execFile)(process.execPath,
        [script, 'init-integrity', '--store', config])
    assert.equal(JSON.parse(result.stdout).integrityFile, files.integrityFile)
    assert.equal((await inspectStore(files)).ready, true)
    await assertUnlocked(files)
})

test('initialization never replaces an existing baseline, even after tampering', async t => {
    const files = await fixture(t)
    await initializeIntegrity(files)
    const before = await fs.readFile(files.integrityFile)
    await fs.appendFile(files.datafile, '\n')
    await assert.rejects(initializeIntegrity(files), /already exists/)
    assert.deepEqual(await fs.readFile(files.integrityFile), before)
    await assert.rejects(loadFileData({dataFile: files.datafile, commands: []}),
        /Integrity mismatch/)
    await assertUnlocked(files)
})

for (const [name, mutate] of [
    ['stale ID index', async files => {
        await fs.writeFile(path.join(files.dir, 'index.id.json'), '{}')
    }],
    ['stale offset index', async files => {
        await fs.writeFile(path.join(files.dir, 'index.offset.json'), '{}')
    }],
    ['invalid unread record body', async files => {
        const record = text => `(${Buffer.byteLength(text)})${text}\n`
        await fs.writeFile(files.datafile,
            record('{"persons":[~1]}') + record('<object id="first">{"x":}'))
        await fs.unlink(path.join(files.dir, 'index.offset.json'))
    }],
    ['duplicate IDs', async files => {
        const record = text => `(${Buffer.byteLength(text)})${text}\n`
        await fs.writeFile(files.datafile, record('{"persons":[~1,~2]}') +
            record('<object id="first">{}') + record('<object id="first">{}'))
        await fs.unlink(path.join(files.dir, 'index.offset.json'))
        await fs.unlink(path.join(files.dir, 'index.id.json'))
    }],
    ['pending history', async files => {
        await fs.writeFile(files.commandLog,
            '{"id":"pending","name":"addPerson"}\n')
        await fs.writeFile(files.commandStatus,
            '{"command":"pending","status":"accepted","code":202}\n')
    }],
    ['unexplained changeset', async files => {
        await fs.writeFile(path.join(files.dir, 'data.unknown.jsontag'), '')
    }]
]) {
    test(`initialization rejects ${name} without writing a baseline`, async t => {
        const files = await fixture(t)
        await mutate(files)
        const before = await snapshot(files)
        await assert.rejects(initializeIntegrity(files))
        assert.deepEqual(await snapshot(files), before)
        await assert.rejects(fs.access(files.integrityFile), /ENOENT/)
        await assertUnlocked(files)
    })
}

test('initialization respects ownership and detects changes during validation', async t => {
    const files = await fixture(t)
    const owner = await acquireOwnership([files.dir])
    await assert.rejects(initializeIntegrity(files), /locked/)
    await owner.release()
    const read = fs.readFile
    let changed = false
    t.mock.method(fs, 'readFile', async (...args) => {
        const result = await read(...args)
        if (!changed && args[0] === files.commandLog) {
            changed = true
            await fs.appendFile(files.datafile, '\n')
        }
        return result
    })
    await assert.rejects(initializeIntegrity(files), /changed during inspection/)
    await assert.rejects(fs.access(files.integrityFile), /ENOENT/)
    await assertUnlocked(files)
})

test('uncertain manifest publication retains ownership for inspection', async t => {
    const files = await fixture(t)
    const rename = fs.rename
    t.mock.method(fs, 'rename', async (...args) => {
        if (args[1] === files.integrityFile) {
            throw new Error('injected publication failure')
        }
        return rename(...args)
    })
    await assert.rejects(initializeIntegrity(files), error => {
        return error.storageFailure && /injected/.test(error.message)
    })
    await assert.rejects(acquireOwnership([files.dir]), /locked/)
})

test('artifact hashes share one durable append and synchronization', async t => {
    const files = await fixture(t)
    const source = scanDataFile(files.datafile)
    const open = fs.open
    let appends = 0
    let syncs = 0
    t.mock.method(fs, 'open', async (...args) => {
        const handle = await open(...args)
        if (args[0] === files.integrityFile && args[1] === 'a') {
            appends++
            const datasync = handle.datasync.bind(handle)
            handle.datasync = async () => {
                syncs++
                return datasync()
            }
        }
        return handle
    })
    await appendArtifactIntegrity(files.integrityFile, files.datafile,
        source.digest, {data: files.dir})
    assert.equal(appends, 1)
    assert.equal(syncs, 1)
    assert.equal((await loadIntegrityManifest(files.integrityFile)).size, 3)
})

test('a manifest synchronization failure prevents command success', async t => {
    const files = await fixture(t)
    await initializeIntegrity(files)
    const loaded = await loadFileData({dataFile: files.datafile, commands: []})
    t.after(close)
    await initialize({...loaded, ...files})
    const open = fs.open
    t.mock.method(fs, 'open', async (...args) => {
        const handle = await open(...args)
        if (args[0] === files.integrityFile && args[1] === 'a') {
            handle.datasync = async () => {
                throw new Error('injected manifest sync failure')
            }
        }
        return handle
    })
    await assert.rejects(runCommand(JSON.stringify({id: 'failed',
        name: 'addPerson', value: {name: 'uncommitted'}})), error => {
        return error.storageFailure && /manifest sync failure/.test(error.message)
    })
    assert.equal(await fs.readFile(files.commandStatus, 'utf8'), '')
})

test('initialization supports missing indexes and startup verifies their data', async t => {
    const files = await fixture(t)
    await fs.unlink(path.join(files.dir, 'index.id.json'))
    await fs.unlink(path.join(files.dir, 'index.offset.json'))
    const result = await initializeIntegrity(files)
    assert.equal(result.files, 1)
    const loaded = await loadFileData({dataFile: files.datafile, commands: []})
    assert.equal(loaded.meta.index.id.get('first'), 1)
    await fs.appendFile(files.datafile, '\n')
    await assert.rejects(loadFileData({dataFile: files.datafile, commands: [],
        rebuildIndexes: true, integrityRequired: false}), /Integrity mismatch/)
})
