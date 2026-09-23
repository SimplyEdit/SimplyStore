import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import test from 'node:test'
import { setImmediate as nextTurn } from 'node:timers/promises'
import JSONTag from '@muze-nl/jsontag'
import StoreRuntime from '../src/store-runtime.mjs'
import { appendFile } from '../src/util.mjs'
import {
    getCommandStatus,
    getOpenPort,
    makeServerFixture,
    postCommand,
    queryPersons,
    startServer,
    waitForExit,
    waitForServer
} from './durability-helpers.mjs'

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
                sources: [{file: fixture.datafile}],
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

    assert.equal(opened.runtime.sources.length, 1)
    assert.equal(opened.runtime.meta.parts, 1)
    assert.equal(opened.pools.length, 2)
    assert.equal(opened.ownershipReleased(), false)

    await opened.runtime.runQuery({ method: 'GET' })
    await opened.runtime.runQuery({ method: 'POST' })
    await opened.runtime.runQuery({ method: 'GET' }, { slow: true })
    await opened.runtime.runQuery({ method: 'POST' }, { slow: true })
    const normalOptions = opened.pools[0].runs.map(run => run.options)
    const slowOptions = opened.pools[1].runs.map(run => run.options)
    assert.deepEqual(normalOptions, [
        { timeout: 1000 },
        { timeout: 1000 }
    ])
    assert.deepEqual(slowOptions, [
        { timeout: 10000 },
        { timeout: 10000 }
    ])

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
                    source: { file: `data.${parsed.id}.jsontag` },
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

test('runtime does not require a storage failure observer', async t => {
    const opened = await openRuntime(t, {
        async executeWorker() {
            return {
                storageFailure: true,
                message: 'uncertain write'
            }
        }
    })

    await opened.runtime.acceptCommand(command('A'))
    await opened.runtime.runQueuedCommands()

    assert.equal(opened.runtime.storageFailed, true)
    await opened.runtime.close()
})

test('overlapping closes wait for the active command and cleanup', async t => {
    const started = Promise.withResolvers()
    const result = Promise.withResolvers()
    const opened = await openRuntime(t, {
        executeWorker() {
            started.resolve()
            return result.promise
        }
    })
    await opened.runtime.acceptCommand(command('A'))
    opened.runtime.runQueuedCommands()
    await started.promise

    let completed = 0
    const closures = [opened.runtime.close(), opened.runtime.close()]
        .map(async closing => {
            await closing
            completed++
        })
    try {
        await nextTurn()
        assert.equal(completed, 0)
        assert.equal(opened.ownershipReleased(), false)
        const refused = await opened.runtime.acceptCommand(command('B'))
        assert.equal(refused.code, 503)
    }
    finally {
        result.resolve({})
        await Promise.all(closures)
    }
    assert.equal(completed, 2)
    assert.equal(opened.runtime.getCommandStatus('A').value.status, 'done')
    assert.equal(opened.ownershipReleased(), true)
    assert.equal(opened.events.filter(event => {
        return event === 'ownership released'
    }).length, 1)
    await opened.runtime.close()
})

test('overlapping and repeated closes share cleanup failure', async t => {
    const releasing = Promise.withResolvers()
    const released = Promise.withResolvers()
    const failure = new Error('ownership release failed')
    let releases = 0
    const opened = await openRuntime(t, {
        async acquireOwnership() {
            return {
                release() {
                    releases++
                    releasing.resolve()
                    return released.promise
                }
            }
        }
    })
    const results = Promise.allSettled([
        opened.runtime.close(),
        opened.runtime.close()
    ])
    await releasing.promise
    released.reject(failure)
    for (const result of await results) {
        assert.equal(result.status, 'rejected')
        assert.equal(result.reason, failure)
    }
    await assert.rejects(opened.runtime.close(), failure)
    assert.equal(releases, 1)
})

for (const boundary of [
    'after-command-log-before-accepted-status',
    'after-command-accepted-status-before-response'
]) {
    test(`acceptance refuses success after storage failure at ${boundary}`,
        async t => {
            const failure = new Error('concurrent command persistence failed')
            const opened = await openRuntime(t, {
                async faultPoint(name) {
                    if (name === boundary) {
                        opened.runtime.failStorage(failure)
                    }
                }
            })
            await assert.rejects(
                opened.runtime.acceptCommand(command('A')),
                /Store failed during acceptance/
            )
            assert.equal(opened.runtime.commandQueue.length, 0)
            const refused = await opened.runtime.acceptCommand(command('B'))
            assert.equal(refused.code, 503)
            const records = readRecords(
                await fs.readFile(opened.fixture.commandLog, 'utf8')
            )
            assert.deepEqual(records.map(record => record.id), ['A'])
            await assert.rejects(opened.runtime.close())
            assert.equal(opened.ownershipReleased(), false)
        })
}

test('known ID-only retries return status but new commands need a name',
    async t => {
        let executions = 0
        const opened = await openRuntime(t, {
            async executeWorker() {
                executions++
                return {}
            }
        })
        await opened.runtime.acceptCommand(command('A'))
        const retry = await opened.runtime.acceptCommand('{"id":"A"}')
        assert.equal(retry.code, 200)
        assert.equal(retry.value.status, 'accepted')
        await opened.runtime.runQueuedCommands()
        const completed = await opened.runtime.acceptCommand('{"id":"A"}')
        assert.equal(completed.code, 200)
        assert.equal(completed.value.status, 'done')
        const invalid = await opened.runtime.acceptCommand('{"id":"B"}')
        assert.equal(invalid.code, 422)
        await opened.runtime.runQueuedCommands()
        assert.equal(executions, 1)
        const records = readRecords(
            await fs.readFile(opened.fixture.commandLog, 'utf8')
        )
        assert.deepEqual(records.map(record => record.id), ['A'])
        await opened.runtime.close()
    })

test('both shutdown signals wait for a command and leave a restartable store',
    { timeout: 15000 }, async t => {
        const fixture = await makeServerFixture(t, {
            commandsSource: `import fs from 'node:fs'
export default {
    addPerson(data, command) {
        const pause = new Int32Array(new SharedArrayBuffer(4))
        while (!fs.existsSync(command.releaseFile)) {
            Atomics.wait(pause, 0, 0, 10)
        }
        data.persons.push(command.value)
    }
}
`
        })
        const releaseFile = path.join(fixture.dir, 'release-command')
        await fs.appendFile(fixture.runner, `
process.on('SIGTERM', () => console.log('observed SIGTERM'))
process.on('SIGINT', () => console.log('observed SIGINT'))
`)
        const port = await getOpenPort()
        const running = startServer(t, fixture, { port })
        await waitForServer(running.child, running.getOutput, port)
        const response = await postCommand(port, {
            id: 'A',
            name: 'addPerson',
            value: { name: 'A' },
            releaseFile
        })
        assert.equal(response.status, 202)
        await waitUntil(async () => {
            const status = await getCommandStatus(port, 'A')
            return status.status === 'active'
        })

        try {
            for (const signal of ['SIGTERM', 'SIGINT']) {
                running.child.kill(signal)
                await waitUntil(() => {
                    return running.getOutput().includes(`observed ${signal}`)
                })
            }
            assert.equal(running.child.exitCode, null)
        }
        finally {
            await fs.writeFile(releaseFile, '')
        }
        const exit = await waitForExit(running.child)
        assert.equal(exit.code, 0)
        const records = readRecords(
            await fs.readFile(fixture.commandStatus, 'utf8')
        )
        assert.equal(records.at(-1).status, 'done')
        await assert.rejects(
            fs.stat(path.join(fixture.dir, '.simplystore-lock')),
            { code: 'ENOENT' }
        )
        const restarted = startServer(t, fixture, { port })
        await waitForServer(restarted.child, restarted.getOutput, port)
        const persons = await queryPersons(port)
        assert.deepEqual(persons.map(person => person.name), ['A'])
    })

async function waitUntil(predicate) {
    const deadline = Date.now() + 5000
    while (!await predicate()) {
        assert.ok(Date.now() < deadline, 'Timed out waiting for test event')
        await new Promise(resolve => setTimeout(resolve, 10))
    }
}
