import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import test from 'node:test'
import JSONTag from '@muze-nl/jsontag'
import StoreRuntime from '../src/store-runtime.mjs'
import { appendFile } from '../src/util.mjs'
import { makeServerFixture } from './durability-helpers.mjs'

function command(id, name = 'addPerson') {
    return JSONTag.stringify({
        id,
        name,
        value: { name: id }
    })
}

function readRecords(text) {
    return text
        .split('\n')
        .filter(Boolean)
        .map(line => JSONTag.parse(line))
}

async function openRuntime(t, overrides = {}) {
    const fixture = await makeServerFixture(t)
    const events = []
    const pools = []
    let ownershipReleased = false
    const mechanisms = {
        async acquireOwnership() {
            events.push('ownership acquired')
            return {
                async release() {
                    ownershipReleased = true
                    events.push('ownership released')
                }
            }
        },
        createWorkerPool() {
            const pool = {
                runs: [],
                updates: [],
                close() {
                    events.push('query pool closed')
                },
                run(name, request, options) {
                    this.runs.push({ name, request, options })
                    return Promise.resolve({ body: '{}' })
                },
                update(task) {
                    this.updates.push(task)
                    events.push('query data published')
                }
            }
            pools.push(pool)
            return pool
        },
        async runWorker() {
            events.push('committed data loaded')
            return {
                data: new Uint8Array([1]),
                meta: {
                    index: { id: new Map() },
                    parts: 1
                }
            }
        },
        ...overrides
    }
    const runtime = await StoreRuntime.open(
        {
            datafile: fixture.datafile,
            commandsFile: fixture.commandsFile,
            indexFile: fixture.indexFile,
            commandLog: fixture.commandLog,
            commandStatus: fixture.commandStatus,
            maxWorkers: 1
        },
        mechanisms
    )
    return {
        events,
        fixture,
        mechanisms,
        ownershipReleased: () => ownershipReleased,
        pools,
        runtime
    }
}

test('runtime opens committed state and closes its owned resources', async t => {
    const opened = await openRuntime(t)

    assert.equal(opened.runtime.data.length, 1)
    assert.equal(opened.runtime.meta.parts, 1)
    assert.equal(opened.pools.length, 2)
    assert.equal(opened.ownershipReleased(), false)

    await opened.runtime.runQuery({ method: 'GET' })
    await opened.runtime.runQuery({ method: 'POST' }, { slow: true })
    assert.deepEqual(opened.pools[0].runs[0].options, { timeout: 1000 })
    assert.deepEqual(opened.pools[1].runs[0].options, {
        slowTimeout: 10000
    })

    await opened.runtime.close()

    assert.equal(opened.ownershipReleased(), true)
    assert.deepEqual(opened.events.slice(-3), [
        'query pool closed',
        'query pool closed',
        'ownership released'
    ])
})

test('runtime persists one accepted command and recognizes its duplicate',
    async t => {
        const opened = await openRuntime(t, {
            async executeWorker() {
                return {}
            }
        })

        const accepted = await opened.runtime.acceptCommand(command('A'))
        const duplicate = await opened.runtime.acceptCommand(command('A'))

        assert.equal(accepted.code, 202)
        assert.equal(accepted.value.status, 'accepted')
        assert.equal(duplicate.code, 200)
        assert.equal(duplicate.value.status, 'accepted')
        assert.equal(opened.runtime.commandQueue.length, 1)

        const records = readRecords(
            await fs.readFile(opened.fixture.commandLog, 'utf8')
        )
        assert.deepEqual(records.map(record => record.id), ['A'])

        await opened.runtime.runQueuedCommands()
        await opened.runtime.close()
    })

test('runtime keeps concurrent acceptance and execution in command-log order',
    async t => {
        const starts = []
        let fixture
        const opened = await openRuntime(t, {
            async appendFile(file, record) {
                if (
                    fixture &&
                    file === fixture.commandLog &&
                    record.includes('"id":"A"')
                ) {
                    await new Promise(resolve => setTimeout(resolve, 30))
                }
                await appendFile(file, record)
            },
            async executeWorker(filename, task) {
                const parsed = JSONTag.parse(task.command)
                starts.push(parsed.id)
                return {
                    data: new Uint8Array([starts.length + 1]),
                    meta: { parts: starts.length + 1 }
                }
            }
        })
        fixture = opened.fixture

        await Promise.all([
            opened.runtime.acceptCommand(command('A')),
            opened.runtime.acceptCommand(command('B'))
        ])
        await opened.runtime.runQueuedCommands()

        const records = readRecords(
            await fs.readFile(opened.fixture.commandLog, 'utf8')
        )
        assert.deepEqual(records.map(record => record.id), ['A', 'B'])
        assert.deepEqual(starts, ['A', 'B'])
        assert.equal(opened.runtime.getCommandStatus('A').value.status, 'done')
        assert.equal(opened.runtime.getCommandStatus('B').value.status, 'done')
        assert.equal(opened.pools[0].updates.length, 2)
        assert.equal(opened.pools[1].updates.length, 2)

        await opened.runtime.close()
    })

test('runtime records command failure without publishing query data',
    async t => {
        const opened = await openRuntime(t, {
            async executeWorker() {
                return {
                    status: 'failed',
                    code: 422,
                    message: 'Command rejected'
                }
            }
        })

        await opened.runtime.acceptCommand(command('A'))
        await opened.runtime.runQueuedCommands()

        const status = opened.runtime.getCommandStatus('A').value
        assert.equal(status.status, 'failed')
        assert.equal(status.message, 'Command rejected')
        assert.equal(opened.pools[0].updates.length, 0)
        assert.equal(opened.pools[1].updates.length, 0)

        await opened.runtime.close()
    })

test('runtime stops mutation after uncertain worker persistence', async t => {
    const failures = []
    const opened = await openRuntime(t, {
        async executeWorker() {
            return {
                storageFailure: true,
                message: 'uncertain write'
            }
        },
        onStorageFailure(error) {
            failures.push(error.message)
        }
    })

    await opened.runtime.acceptCommand(command('A'))
    await opened.runtime.runQueuedCommands()
    const refused = await opened.runtime.acceptCommand(command('B'))

    assert.equal(opened.runtime.storageFailed, true)
    assert.deepEqual(failures, ['uncertain write'])
    assert.equal(refused.code, 503)
    assert.equal(opened.ownershipReleased(), false)

    await opened.runtime.close()
    assert.equal(opened.ownershipReleased(), false)
})
