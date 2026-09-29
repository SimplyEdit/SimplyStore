import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { acquireOwnership } from '../src/store-ownership.mjs'
import { releaseOfflineLocks } from '../src/admin-recovery.mjs'
import { makeServerFixture } from './durability-helpers.mjs'

const ownershipModule = fileURLToPath(
    new URL('../src/store-ownership.mjs', import.meta.url)
)

// Hold ownership in a separate process, so it can be killed like a server.
function holdOwnership(t, directory, options = { purpose: 'runtime' }) {
    const script = `
        import { acquireOwnership } from ${JSON.stringify(ownershipModule)}
        try {
            await acquireOwnership(
                [${JSON.stringify(directory)}], ${JSON.stringify(options)}
            )
            process.stdout.write('owned\\n')
            setInterval(() => {}, 1000)
        }
        catch (error) {
            process.stdout.write('refused: ' + error.message + '\\n')
            process.exit(1)
        }
    `
    const child = spawn(process.execPath, ['--input-type=module', '-e', script])
    t.after(() => child.kill('SIGKILL'))
    let output = ''
    const settled = new Promise(resolve => {
        child.stdout.on('data', data => {
            output += data
            if (/owned|refused/.test(output)) {
                resolve(output.trim())
            }
        })
        child.on('exit', () => resolve(output.trim()))
    })
    return { child, settled }
}

async function killed(owner) {
    const exit = new Promise(resolve => owner.child.once('exit', resolve))
    owner.child.kill('SIGKILL')
    await exit
}

async function deadRuntimeLock(t, directory) {
    const owner = holdOwnership(t, directory)
    assert.equal(await owner.settled, 'owned')
    await killed(owner)
}

async function lockEntries(directory) {
    const entries = await fs.readdir(directory)
    return entries.filter(entry => entry.startsWith('.simplystore-lock'))
}

async function readOwner(directory) {
    return JSON.parse(await fs.readFile(
        path.join(directory, '.simplystore-lock', 'owner.json'), 'utf8'
    ))
}

test('a running owner is never taken over', async t => {
    const { dir } = await makeServerFixture(t)
    const owner = holdOwnership(t, dir)
    assert.equal(await owner.settled, 'owned')
    await assert.rejects(
        acquireOwnership([dir], { purpose: 'runtime' }), /Store is locked/
    )
    assert.equal((await readOwner(dir)).pid, owner.child.pid)
})

test('a killed runtime owner is taken over with an audit record', async t => {
    const { dir } = await makeServerFixture(t)
    const owner = holdOwnership(t, dir)
    assert.equal(await owner.settled, 'owned')
    const dead = await readOwner(dir)
    assert.equal(dead.liveness, 'socket')
    await killed(owner)

    const ownership = await acquireOwnership([dir], { purpose: 'runtime' })
    assert.equal((await readOwner(dir)).token, ownership.token)
    const audit = (await fs.readFile(
        path.join(dir, '.simplystore-takeovers.jsonl'), 'utf8'
    )).trim().split('\n').map(line => JSON.parse(line))
    assert.equal(audit.length, 1)
    assert.equal(audit[0].previous.token, dead.token)
    assert.equal(audit[0].previous.pid, dead.pid)
    assert.equal(audit[0].token, ownership.token)
    assert.equal(audit[0].proof, 'ECONNREFUSED')
    await ownership.release()
    assert.deepEqual(await lockEntries(dir), [])
})

test('locks without proof of a dead runtime owner are kept', async t => {
    const { dir } = await makeServerFixture(t)
    const lock = path.join(dir, '.simplystore-lock')

    const recovery = holdOwnership(t, dir, { purpose: 'recovery' })
    assert.equal(await recovery.settled, 'owned')
    await killed(recovery)
    await assert.rejects(
        acquireOwnership([dir], { purpose: 'runtime' }), /Store is locked/
    )

    await fs.rm(lock, { recursive: true })
    await fs.mkdir(lock)
    await fs.writeFile(path.join(lock, 'owner.json'), JSON.stringify({
        token: 'legacy', pid: 1, host: os.hostname(), purpose: 'runtime'
    }))
    await assert.rejects(
        acquireOwnership([dir], { purpose: 'runtime' }), /Store is locked/
    )

    await fs.rm(lock, { recursive: true })
    await deadRuntimeLock(t, dir)
    await fs.unlink(path.join(lock, 'owner.sock'))
    await assert.rejects(
        acquireOwnership([dir], { purpose: 'runtime' }), /Store is locked/
    )

    await fs.rm(lock, { recursive: true })
    await deadRuntimeLock(t, dir)
    await assert.rejects(
        acquireOwnership([dir], { purpose: 'recovery' }), /Store is locked/
    )
})

test('paths too long for a socket publish no liveness', async t => {
    const base = await fs.mkdtemp(path.join(os.tmpdir(), 'simplystore-long-'))
    t.after(() => fs.rm(base, { recursive: true, force: true }))
    const dir = path.join(base, 'x'.repeat(100))
    await fs.mkdir(dir)
    const owner = holdOwnership(t, dir)
    assert.equal(await owner.settled, 'owned')
    assert.equal((await readOwner(dir)).liveness, undefined)
    await killed(owner)
    await assert.rejects(
        acquireOwnership([dir], { purpose: 'runtime' }), /Store is locked/
    )
})

test('concurrent takeovers leave exactly one owner', async t => {
    const { dir } = await makeServerFixture(t)
    await deadRuntimeLock(t, dir)
    const contenders = Array.from({ length: 6 }, () => holdOwnership(t, dir))
    const results = await Promise.all(contenders.map(owner => owner.settled))
    assert.equal(results.filter(result => result === 'owned').length, 1,
        results.join('\n'))
    const winner = contenders[results.indexOf('owned')]
    assert.equal((await readOwner(dir)).pid, winner.child.pid)
    assert.deepEqual(await lockEntries(dir), ['.simplystore-lock'])
})

test('an interrupted takeover blocks until administrator release', async t => {
    const fixture = await makeServerFixture(t)
    const { dir } = fixture
    await deadRuntimeLock(t, dir)
    await fs.mkdir(path.join(dir, '.simplystore-lock.takeover'))
    await assert.rejects(
        acquireOwnership([dir], { purpose: 'runtime' }), /takeover/
    )
    const release = await releaseOfflineLocks(fixture, {
        operator: 'test administrator',
        reason: 'Owner killed during takeover test',
        confirmedStopped: true
    })
    await release.finish()
    assert.deepEqual(await lockEntries(dir), [])
    const ownership = await acquireOwnership([dir], { purpose: 'runtime' })
    await ownership.release()
})
