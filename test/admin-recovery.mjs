import { FileDataset } from '../src/file-data.mjs'
import { Buffer } from 'node:buffer'
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import JSONTag from '@muze-nl/jsontag'
import { makeServerFixture } from './durability-helpers.mjs'
import {
    planRecovery,
    applyRecovery,
    backupStore,
    restoreBackup,
    verifyCandidate
} from '../src/admin-recovery.mjs'
import { inspectStore } from '../src/store-inspection.mjs'
import { acquireOwnership } from '../src/store-ownership.mjs'

async function setup(t, entries) {
    const store = await makeServerFixture(t)
    const outputs = await fs.mkdtemp(
        path.join(os.tmpdir(), 'simplystore-admin-output-')
    )
    t.after(() => fs.rm(outputs, { recursive: true, force: true }))
    await fs.writeFile(
        store.commandLog,
        entries
            .map(([id]) =>
                JSONTag.stringify({
                    id,
                    name: 'addPerson',
                    value: { name: id }
                })
            )
            .join('\n') + '\n'
    )
    const statuses = []
    for (const [id, status] of entries) {
        statuses.push({ command: id, status: 'accepted', code: 202 })
        if (status !== 'accepted') {
            statuses.push({ command: id, status, code: 200 })
        }
    }
    const statusLines = statuses.map(status => JSONTag.stringify(status))
    await fs.writeFile(store.commandStatus, statusLines.join('\n') + '\n')
    return { store, outputs }
}
async function runRecovery(store, outputs, plan) {
    return applyRecovery(plan, {
        to: path.join(outputs, 'recovered'),
        auditDir: path.join(outputs, 'audit'),
        approveRerun: plan.rerun,
        operator: 'test admin',
        reason: 'Verified complete log and command inputs; side effects assessed'
    })
}
test('administrator recovers trailing missing/waiting commands in log order on a copy', async t => {
    const { store, outputs } = await setup(t, [
        ['A', 'done'],
        ['B', 'accepted']
    ])
    const before = await fs.readFile(store.commandStatus)
    const plan = await planRecovery(store, { quiescent: true })
    assert.equal(plan.actionable, true)
    assert.deepEqual(plan.rerun, ['A', 'B'])
    assert.deepEqual(
        structuredClone(plan),
        plan,
        'Recovery plans remain plain cloneable data'
    )
    const result = await runRecovery(store, outputs, plan)
    const actual = await inspectStore(result.config)
    assert.equal(actual.ready, true)
    assert.deepEqual(
        structuredClone(actual.commands),
        actual.commands,
        'Inspection does not expose JAQT proxies'
    )
    assert.deepEqual(
        personNames(actual),
        ['A', 'B']
    )
    assert.deepEqual(await fs.readFile(store.commandStatus), before)
    assert.ok(
        (await fs.readFile(result.config.commandStatus))
            .subarray(0, before.length)
            .equals(before)
    )
    assert.deepEqual(
        (await fs.readFile(result.config.commandLog)).toString(),
        (await fs.readFile(store.commandLog)).toString()
    )
})
for (const state of ['accepted', 'done', 'unsafe']) {
    test(`later ${state} dataset blocks rerun, including zero-byte no-op`, async t => {
        const { store } = await setup(t, [
            ['A', 'done'],
            ['B', state]
        ])
        await fs.writeFile(path.join(store.dir, 'data.B.jsontag'), '')
        const plan = await planRecovery(store, { quiescent: true })
        assert.equal(plan.actionable, false)
        assert.ok(plan.blocks.some(s => s.includes('later accepted datasets')))
    })
}
test('new later file makes an approved plan stale before executing a handler', async t => {
    const { store, outputs } = await setup(t, [
        ['A', 'done'],
        ['B', 'accepted']
    ])
    const plan = await planRecovery(store, { quiescent: true })
    await fs.writeFile(path.join(store.dir, 'data.B.jsontag'), '')
    await assert.rejects(
        runRecovery(store, outputs, plan),
        /Stale recovery plan/
    )
    await assert.rejects(fs.access(path.join(outputs, 'recovered')), /ENOENT/)
})
test('changed code and missing explicit approval reject apply', async t => {
    const { store, outputs } = await setup(t, [['A', 'accepted']])
    const plan = await planRecovery(store, { quiescent: true })
    await assert.rejects(
        applyRecovery(plan, {
            to: path.join(outputs, 'x'),
            auditDir: path.join(outputs, 'y'),
            operator: 'admin',
            reason: 'test'
        }),
        /approval/
    )
    await fs.appendFile(store.commandsFile, '\n// changed\n')
    await assert.rejects(
        runRecovery(store, outputs, plan),
        /Stale recovery plan/
    )
})
test('cooperative ownership excludes competing writer and path aliases', async t => {
    const { store, outputs } = await setup(t, [])
    const owner = await acquireOwnership([store.dir])
    try {
        await fs.symlink(store.dir, path.join(outputs, 'alias'))
        await assert.rejects(
            acquireOwnership([path.join(outputs, 'alias')]),
            /locked/
        )
    }
    finally {
        await owner.release()
    }
})
test('backup and restore validate saved bytes without executing commands', async t => {
    const { store, outputs } = await setup(t, [['A', 'done']])
    const result = await runRecovery(
        store,
        outputs,
        await planRecovery(store, { quiescent: true })
    )
    const backup = path.join(outputs, 'backup')
    await backupStore(result.config, { to: backup, quiescent: true })
    const restored = await restoreBackup(backup, {
        to: path.join(outputs, 'restored'),
        auditDir: path.join(outputs, 'restore-audit'),
        source: store,
        sourceQuiescent: true
    })
    assert.deepEqual(
        personNames(await inspectStore(restored.config)),
        ['A']
    )
    assert.deepEqual(restored.missingFromBackup, [])
    const saved = JSON.parse(
        await fs.readFile(path.join(backup, 'complete.json'), 'utf8')
    )
    await fs.appendFile(saved.config.commandLog, ' ')
    await assert.rejects(
        restoreBackup(backup, {
            to: path.join(outputs, 'bad'),
            auditDir: path.join(outputs, 'bad-audit')
        }),
        /Backup contents/
    )
})

test('read-only inspection never imports handlers and rejects conflicting done order', async t => {
    const { store } = await setup(t, [
        ['A', 'accepted'],
        ['B', 'accepted']
    ])
    await fs.writeFile(
        store.commandsFile,
        "throw new Error('must not be imported')"
    )
    const before = await fs.readFile(store.commandStatus)
    const plan = await planRecovery(store, { quiescent: true })
    assert.equal(plan.actionable, true)
    assert.deepEqual(await fs.readFile(store.commandStatus), before)
    await fs.appendFile(
        store.commandStatus,
        [
            { command: 'B', status: 'done' },
            { command: 'A', status: 'done' }
        ]
            .map(JSON.stringify)
            .join('\n') + '\n'
    )
    assert.ok(
        (await planRecovery(store, { quiescent: true })).blocks.some(s =>
            s.includes('differs from command-log order')
        )
    )
})
test('historical status order never makes a later log dataset eligible for bypass', async t => {
    const { store } = await setup(t, [
        ['A', 'accepted'],
        ['B', 'accepted'],
        ['C', 'accepted']
    ])
    await fs.writeFile(
        store.commandStatus,
        [
            { command: 'C', status: 'accepted' },
            { command: 'B', status: 'accepted' },
            { command: 'A', status: 'accepted' }
        ]
            .map(JSON.stringify)
            .join('\n') + '\n'
    )
    await fs.writeFile(path.join(store.dir, 'data.C.jsontag'), '')
    const plan = await planRecovery(store, { quiescent: true })
    assert.ok(
        plan.blocks.some(s => s.includes('B: later accepted datasets exist: C'))
    )
})
test('interrupted recovery preserves completed attempts and blocks an unfinished candidate', async t => {
    const { store, outputs } = await setup(t, [
        ['A', 'accepted'],
        ['B', 'accepted']
    ])
    const witness = path.join(outputs, 'effects')
    await fs.writeFile(
        store.commandsFile,
        `import fs from 'node:fs';export default {addPerson(data,c){fs.appendFileSync(${JSON.stringify(witness)},c.id+'\\n');if(c.id==='B')throw new Error('external effect already happened');data.persons.push(c.value)}}`
    )
    const plan = await planRecovery(store, { quiescent: true })
    await assert.rejects(
        runRecovery(store, outputs, plan),
        /uncertain or failed/
    )
    const authorization = JSON.parse(
        (
            await fs.readFile(
                path.join(outputs, 'audit', 'attempts.jsonl'),
                'utf8'
            )
        ).split('\n')[0]
    )
    const partial = await inspectStore(authorization.config)
    assert.equal(partial.ready, false)
    assert.deepEqual(partial.committed, ['A'])
    assert.equal(partial.commands.find(c => c.id === 'B').status, 'active')
    assert.equal(await fs.readFile(witness, 'utf8'), 'A\nB\n')
    await assert.rejects(
        acquireOwnership([path.dirname(authorization.config.datafile)]),
        /locked/
    )
    await assert.rejects(
        fs.access(path.join(outputs, 'audit', 'complete.json')),
        /ENOENT/
    )
    const preview = await planRecovery(
        {
            ...authorization.config,
            commandsFile: store.commandsFile,
            indexFile: store.indexFile
        },
        { quiescent: true }
    )
    assert.deepEqual(
        preview.rerun,
        ['B'],
        'completed A is reconstructed, never selected for re-execution'
    )
})
test('retained digest mismatch stops recovery before replacing integrity or appending done', async t => {
    const { store, outputs } = await setup(t, [['A', 'done']])
    const { appendIntegrityRecord } = await import('../src/integrity.mjs')
    const integrity = path.join(store.dir, 'data.integrity.jsontag')
    await appendIntegrityRecord(
        integrity,
        store.datafile,
        await fs.readFile(store.datafile)
    )
    await appendIntegrityRecord(
        integrity,
        path.join(store.dir, 'data.A.jsontag'),
        Buffer.from('different historical bytes')
    )
    store.integrityFile = integrity
    const plan = await planRecovery(store, { quiescent: true })
    await assert.rejects(
        runRecovery(store, outputs, plan),
        /Integrity mismatch/
    )
    const authorization = JSON.parse(
        (
            await fs.readFile(
                path.join(outputs, 'audit', 'attempts.jsonl'),
                'utf8'
            )
        ).split('\n')[0]
    )
    assert.deepEqual(
        await fs.readFile(authorization.config.integrityFile),
        await fs.readFile(integrity)
    )
    const statuses = (
        await fs.readFile(authorization.config.commandStatus, 'utf8')
    )
        .trim()
        .split('\n')
        .map(JSONTag.parse)
    assert.equal(statuses.at(-1).status, 'active')
})
test('malformed tails and overlapping paths cannot be accepted as valid stores', async t => {
    const { store } = await setup(t, [['A', 'accepted']])
    await fs.appendFile(store.commandLog, '{"id":"unfinished"')
    assert.equal(
        (await planRecovery(store, { quiescent: true })).actionable,
        false
    )
    assert.ok(
        (
            await inspectStore({ ...store, commandStatus: store.commandLog })
        ).errors.some(e => e.includes('paths overlap'))
    )
})

test('approved recovery resumes from completed candidate prefix without repeating external effects', async t => {
    const { store, outputs } = await setup(t, [
        ['A', 'accepted'],
        ['B', 'accepted']
    ])
    const witness = path.join(outputs, 'idempotent-effects')
    await fs.writeFile(
        store.commandsFile,
        `import fs from 'node:fs';export default {addPerson(data,c){
        const previous=fs.existsSync(${JSON.stringify(witness)})?fs.readFileSync(${JSON.stringify(witness)},'utf8'):'';
        if(!previous.split('\\n').includes(c.id)){
            fs.appendFileSync(${JSON.stringify(witness)},c.id+'\\n');
            if(c.id==='B')throw new Error('connection lost after effect');
        }
        data.persons.push(c.value)
    }}`
    )
    await assert.rejects(
        runRecovery(
            store,
            outputs,
            await planRecovery(store, { quiescent: true })
        ),
        /uncertain or failed/
    )
    const authorization = JSON.parse(
        (
            await fs.readFile(
                path.join(outputs, 'audit', 'attempts.jsonl'),
                'utf8'
            )
        ).split('\n')[0]
    )
    const partial = {
        ...authorization.config,
        commandsFile: store.commandsFile,
        indexFile: store.indexFile
    }
    const plan = await planRecovery(partial, { quiescent: true })
    assert.deepEqual(plan.rerun, ['B'])
    const { releaseOfflineLocks } = await import('../src/admin-recovery.mjs')
    const release = await releaseOfflineLocks(partial, {
        operator: 'test admin',
        reason: 'Inspected retained recovery audit; idempotent B can retry',
        confirmedStopped: true
    })
    await fs.writeFile(
        path.join(outputs, 'unlock-evidence.json'),
        JSON.stringify(release)
    )
    await release.finish()
    const retry = path.join(outputs, 'retry')
    await fs.mkdir(retry)
    const result = await runRecovery(partial, retry, plan)
    assert.deepEqual(
        personNames(await inspectStore(result.config)),
        ['A', 'B']
    )
    assert.equal(await fs.readFile(witness, 'utf8'), 'A\nB\n')
})
test('finishing an interrupted completion report reconstructs data without executing again', async t => {
    const { store, outputs } = await setup(t, [['A', 'accepted']])
    const result = await runRecovery(
        store,
        outputs,
        await planRecovery(store, { quiescent: true })
    )
    const audit = path.join(outputs, 'audit')
    // Fixture models the boundary after done, before completion report/lock
    // release.
    await fs.unlink(path.join(audit, 'complete.json'))
    await acquireOwnership([path.dirname(result.config.datafile)], {
        purpose: 'recovery',
        auditDir: audit
    })
    const { finishRecovery, releaseOfflineLocks } = await import(
        '../src/admin-recovery.mjs'
    )
    await assert.rejects(
        releaseOfflineLocks(result.config, {
            operator: 'admin',
            reason: 'test',
            confirmedStopped: true
        }),
        /requires finish/
    )
    const before = await fs.readFile(result.config.commandStatus)
    const finished = await finishRecovery(audit, {
        operator: 'admin',
        reason: 'All authorized commands already committed',
        confirmedStopped: true
    })
    assert.deepEqual(await fs.readFile(result.config.commandStatus), before)
    assert.deepEqual(finished.committed, ['A'])
    const owner = await acquireOwnership([path.dirname(result.config.datafile)])
    await owner.release()
})
test('multi-directory integrity paths and file permissions survive backup and restore', async t => {
    const { store, outputs } = await setup(t, [])
    const logdir = path.join(store.dir, 'logs')
    await fs.mkdir(logdir)
    store.commandLog = path.join(logdir, 'commands.jsontag')
    store.commandStatus = path.join(logdir, 'status.jsontag')
    await fs.writeFile(store.commandLog, '')
    await fs.writeFile(store.commandStatus, '')
    store.integrityFile = path.join(logdir, 'integrity.jsontag')
    const { appendIntegrityRecord } = await import('../src/integrity.mjs')
    await appendIntegrityRecord(
        store.integrityFile,
        store.datafile,
        await fs.readFile(store.datafile)
    )
    await fs.chmod(store.datafile, 0o600)
    const backup = path.join(outputs, 'backup')
    await backupStore(store, { to: backup, quiescent: true })
    const restored = await restoreBackup(backup, {
        to: path.join(outputs, 'restored'),
        auditDir: path.join(outputs, 'audit')
    })
    assert.equal((await inspectStore(restored.config)).ready, true)
    assert.equal((await fs.stat(restored.config.datafile)).mode & 0o777, 0o600)
    assert.deepEqual(
        await fs.readFile(restored.config.integrityFile),
        await fs.readFile(store.integrityFile)
    )
})

test('backup excludes unrelated secrets while retaining declared custom artifacts', async t => {
    const { store, outputs } = await setup(t, [])
    await fs.writeFile(
        path.join(store.dir, '.env'),
        'private application secret'
    )
    const required = path.join(store.dir, 'derived-custom.txt')
    await fs.writeFile(required, 'required output')
    const report = await backupStore(
        { ...store, requiredFiles: [required] },
        { to: path.join(outputs, 'backup'), quiescent: true }
    )
    assert.equal(
        Object.keys(report.files).some(file => path.basename(file) === '.env'),
        false
    )
    assert.equal(
        await fs.readFile(report.config.requiredFiles[0], 'utf8'),
        'required output'
    )
})

test('a backup remains restorable after transfer to a different directory', async t => {
    const { store, outputs } = await setup(t, [])
    const old = path.join(outputs, 'old-backup')
    await backupStore(store, { to: old, quiescent: true })
    const moved = path.join(outputs, 'transferred-backup')
    await fs.rename(old, moved)
    const result = await restoreBackup(moved, {
        to: path.join(outputs, 'restored'),
        auditDir: path.join(outputs, 'restore-audit')
    })
    assert.equal((await inspectStore(result.config)).ready, true)
})

test('promotion verification rejects code changed after completed recovery', async t => {
    const { store, outputs } = await setup(t, [['A', 'accepted']])
    const result = await runRecovery(
        store,
        outputs,
        await planRecovery(store, { quiescent: true })
    )
    assert.equal((await verifyCandidate(result)).ready, true)
    await fs.appendFile(store.commandsFile, '\n// altered after recovery\n')
    await assert.rejects(verifyCandidate(result), /Selected code changed/)
})

test('verified A prefix permits only missing B, waiting C and missing D in log order', async t => {
    const { store, outputs } = await setup(t, [
        ['A', 'accepted'],
        ['B', 'accepted'],
        ['C', 'accepted'],
        ['D', 'accepted']
    ])
    const complete = await runRecovery(
        store,
        outputs,
        await planRecovery(store, { quiescent: true })
    )
    const source = {
        ...complete.config,
        commandsFile: store.commandsFile,
        indexFile: store.indexFile
    }
    for (const id of ['B', 'C', 'D']) {
        await fs.unlink(
            path.join(path.dirname(source.datafile), `data.${id}.jsontag`)
        )
    }
    await fs.appendFile(
        source.commandStatus,
        JSONTag.stringify({ command: 'C', status: 'accepted', code: 202 }) +
            '\n'
    )
    const prefix = await fs.readFile(
        path.join(path.dirname(source.datafile), 'data.A.jsontag')
    )
    const plan = await planRecovery(source, { quiescent: true })
    assert.equal(plan.actionable, true)
    assert.deepEqual(plan.committed, ['A'])
    assert.deepEqual(plan.rerun, ['B', 'C', 'D'])
    const next = path.join(outputs, 'next')
    await fs.mkdir(next)
    const result = await runRecovery(source, next, plan)
    assert.deepEqual(
        personNames(await inspectStore(result.config)),
        ['A', 'B', 'C', 'D']
    )
    assert.deepEqual(
        await fs.readFile(
            path.join(path.dirname(result.config.datafile), 'data.A.jsontag')
        ),
        prefix
    )
})

test('restore reports accepted commands absent from an older backup', async t => {
    const { store, outputs } = await setup(t, [])
    const backup = path.join(outputs, 'old-backup')
    await backupStore(store, { to: backup, quiescent: true })
    await fs.appendFile(
        store.commandLog,
        JSONTag.stringify({
            id: 'later',
            name: 'addPerson',
            value: { name: 'later' }
        }) + '\n'
    )
    await fs.appendFile(
        store.commandStatus,
        JSONTag.stringify({ command: 'later', status: 'accepted', code: 202 }) +
            '\n'
    )
    const result = await restoreBackup(backup, {
        to: path.join(outputs, 'rollback'),
        auditDir: path.join(outputs, 'audit'),
        source: store,
        sourceQuiescent: true
    })
    assert.equal(result.sameBase, true)
    assert.deepEqual(result.missingFromBackup, ['later'])
    assert.deepEqual(result.committed, [])
})

test('identical historical duplicate retains first log position; conflicting duplicate blocks', async t => {
    const { store } = await setup(t, [
        ['A', 'accepted'],
        ['B', 'accepted']
    ])
    await fs.appendFile(
        store.commandLog,
        JSONTag.stringify({
            id: 'A',
            name: 'addPerson',
            value: { name: 'A' }
        }) + '\n'
    )
    const plan = await planRecovery(store, { quiescent: true })
    assert.equal(plan.actionable, true)
    assert.deepEqual(plan.rerun, ['A', 'B'])
    await fs.appendFile(
        store.commandLog,
        JSONTag.stringify({
            id: 'A',
            name: 'addPerson',
            value: { name: 'different' }
        }) + '\n'
    )
    assert.ok(
        (await planRecovery(store, { quiescent: true })).blocks.some(s =>
            s.includes('Conflicting command ID A')
        )
    )
})

test('backup coverage distinguishes changed history and data from missing source data', async t => {
    const { store, outputs } = await setup(t, [['A', 'accepted']])
    const plan = await planRecovery(store, { quiescent: true })
    const recovered = await runRecovery(store, outputs, plan)
    const source = recovered.config
    const backup = path.join(outputs, 'coverage-backup')
    await backupStore(source, { to: backup, quiescent: true })

    const changeset = path.join(path.dirname(source.datafile), 'data.A.jsontag')
    const original = new Map()
    for (const file of [
        source.datafile,
        source.commandLog,
        source.commandStatus,
        changeset
    ]) {
        original.set(file, await fs.readFile(file))
    }
    const differentCommand = JSONTag.stringify({
        id: 'A',
        name: 'addPerson',
        value: { name: 'changed' }
    })
    const failedStatus = JSONTag.stringify({
        command: 'A',
        status: 'failed',
        code: 500
    })
    const cases = [
        { name: 'same', missing: [], sameBase: true },
        {
            name: 'command',
            file: source.commandLog,
            bytes: differentCommand + '\n',
            missing: ['A'],
            sameBase: true
        },
        {
            name: 'status',
            file: source.commandStatus,
            bytes: original.get(source.commandStatus) + failedStatus + '\n',
            missing: ['A'],
            sameBase: true
        },
        {
            name: 'data',
            file: changeset,
            bytes: original.get(changeset) + ' ',
            missing: ['A'],
            sameBase: true
        },
        {
            name: 'base',
            file: source.datafile,
            bytes: original.get(source.datafile) + ' ',
            missing: ['A'],
            sameBase: false
        },
        { name: 'missing', file: changeset, missing: [], sameBase: true }
    ]
    for (const scenario of cases) {
        for (const [file, bytes] of original) {
            await fs.writeFile(file, bytes)
        }
        if (scenario.file) {
            if (scenario.bytes === undefined) {
                await fs.unlink(scenario.file)
            }
            else {
                await fs.writeFile(scenario.file, scenario.bytes)
            }
        }
        const result = await restoreBackup(backup, {
            to: path.join(outputs, scenario.name),
            auditDir: path.join(outputs, scenario.name + '-audit'),
            source,
            sourceQuiescent: true
        })
        assert.deepEqual(
            result.missingFromBackup,
            scenario.missing,
            scenario.name
        )
        assert.equal(result.sameBase, scenario.sameBase, scenario.name)
        assert.deepEqual(
            structuredClone(result),
            result,
            'Restore reports remain plain cloneable data'
        )
    }
})

function personNames(inspection) {
    const dataset = new FileDataset()
    try {
        return dataset.open(inspection.sources).persons.map(p => p.name)
    }
    finally {
        dataset.close()
    }
}
