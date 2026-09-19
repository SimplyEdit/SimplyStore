import assert from 'node:assert/strict'
import test from 'node:test'
import fs from 'node:fs/promises'
import path from 'node:path'
import {Buffer} from 'node:buffer'
import JSONTag from '@muze-nl/jsontag'
import {getChangesetPath, loadCommandLog, loadCommandStatus} from '../src/recovery.mjs'
import {getOpenPort, waitForServer, waitForExit, queryPersons, readCommandLogRecords,
	readCommandStatusRecords, reconstructCommittedPersonNames} from './durability-helpers.mjs'
import {fixture, rows, submit, completion, eventually, launch, crash, copyImage,
	loseUnpublishedName, requirement} from './power-loss-helpers.mjs'

async function ready(t, store, options = {}) {
	const port = await getOpenPort()
	const server = await launch(t, store, port, options)
	await waitForServer(server.child, server.getOutput, port)
	return {...server, port}
}

async function commit(store, server, id = 'A', value = id) {
	const result = await submit(store, server.port, {id, name: 'addPerson', value: {name: value}})
	assert.equal(result.http, 202)
	assert.equal((await completion(store, server.port, id)).status, 'done')
}

async function restartedFailure(t, image) {
	const server = await launch(t, image, await getOpenPort())
	const exit = await waitForExit(server.child)
	assert.notEqual(exit.code, 0)
	assert.doesNotMatch(server.getOutput(), /SimplyStore listening/)
	return server.getOutput()
}

async function expectedNames(store) {
	// Fixture oracle uses only externally observed completions and original inputs.
	const journal = await rows(store.journal)
	const issued = new Map(journal.filter(e => e.event === 'issued').map(e => [e.command.id, e.command]))
	return journal.filter(e => e.event === 'completion' && e.body.status === 'done')
		.map(e => issued.get(e.id).value.name)
}

test('PL01 control: trace observes actual file syncs before completed state survives restart', async t => {
	const store = await fixture(t)
	// Existing log names let this control isolate synchronized contents.
	await fs.writeFile(store.commandLog, '')
	await fs.writeFile(store.commandStatus, '')
	const server = await ready(t, store)
	await commit(store, server)
	const trace = await rows(store.trace)
	assert.ok(trace.some(e => e.op === 'datasync' && e.file === store.commandLog))
	assert.ok(trace.some(e => e.op === 'datasync' && e.file === store.commandStatus))
	const changeset = getChangesetPath(store.datafile, 'A')
	const rename = trace.findIndex(e => e.op === 'rename' && e.file === changeset)
	assert.ok(rename > 0)
	assert.ok(trace.slice(0, rename).some(e => e.op === 'sync' && e.file === trace[rename].from))
	assert.ok(trace[rename].threadId > 0, 'preload also instruments command worker threads')
	await crash(server.child)
	const image = await copyImage(t, store)
	const restarted = await ready(t, image)
	assert.deepEqual((await queryPersons(restarted.port)).map(p => p.name), await expectedNames(store))
	assert.deepEqual(await reconstructCommittedPersonNames(image), await expectedNames(store))
})

test('PL02 new status filename can be lost after externally observed done', async t => {
	const store = await fixture(t)
	const server = await ready(t, store)
	await commit(store, server)
	await crash(server.child)
	const expected = await expectedNames(store)
	assert.deepEqual(expected, ['A'])
	const originalStatus = await fs.readFile(store.commandStatus)
	const image = await copyImage(t, store)
	await loseUnpublishedName(store, image, store.commandStatus)
	const restarted = await ready(t, image)
	const actual = (await queryPersons(restarted.port)).map(p => p.name)
	assert.deepEqual(await fs.readFile(store.commandStatus), originalStatus, 'original evidence is preserved')
	await requirement(t, 'P2', actual, expected, 'completed command must not silently disappear with its status filename')
})

test('PL03 new command-log filename can be lost after observed acceptance', async t => {
	const store = await fixture(t, {commandsSource: 'export default { hang() { while (true) {} } }'})
	const server = await ready(t, store)
	assert.equal((await submit(store, server.port, {id: 'waiting', name: 'hang'})).http, 202)
	await eventually(async () => (await rows(store.trace)).some(e => e.file === store.commandStatus &&
		e.op === 'datasync' && Buffer.from(e.bytes, 'base64').toString().includes('active')), 'active is synced')
	await crash(server.child)
	const image = await copyImage(t, store)
	await loseUnpublishedName(store, image, store.commandLog)
	const restarted = await ready(t, image)
	assert.deepEqual(await queryPersons(restarted.port), [])
	const status = loadCommandStatus(image.commandStatus)
	const queued = loadCommandLog(status, image.commandLog)
	const witness = (await rows(store.journal)).filter(e => e.event === 'response' && e.http === 202).map(e => e.id)
	assert.deepEqual(witness, ['waiting'])
	await requirement(t, 'P1', queued.map(c => c.id), witness, 'accepted execution inputs must remain recoverable')
})

test('PL04 unpersisted changeset rename causes explicit failure after observed done', async t => {
	const store = await fixture(t)
	const server = await ready(t, store)
	await commit(store, server)
	await crash(server.child)
	const image = await copyImage(t, store)
	const lost = await loseUnpublishedName(store, image, getChangesetPath(store.datafile, 'A'))
	assert.equal(lost, true, 'baseline changeset publication lacks a directory barrier')
	assert.match(await restartedFailure(t, image), /Missing changeset|missing changeset/)
	assert.deepEqual(await expectedNames(store), ['A'])
	await requirement(t, 'P2', lost, false, 'completed changeset filename must survive the supported cut')
})

test('PL05 default index sidecars are currently rebuildable at startup', async t => {
	const store = await fixture(t, {indexSource: `export {default} from ${JSON.stringify(new URL('../src/index.mjs', import.meta.url).href)}`})
	const server = await ready(t, store)
	await commit(store, server)
	await crash(server.child)
	const image = await copyImage(t, store)
	const sidecars = (await fs.readdir(image.dir)).filter(name => /^index\.(id|offset).*\.json$/.test(name))
	assert.ok(sidecars.length >= 2)
	for (const name of sidecars) await fs.rm(path.join(image.dir, name))
	const restarted = await ready(t, image)
	assert.deepEqual((await queryPersons(restarted.port)).map(p => p.name), await expectedNames(store))
})

test('PL06 adversarial torn status tail fails explicitly and preserves the original', async t => {
	const store = await fixture(t)
	const server = await ready(t, store)
	await commit(store, server)
	await crash(server.child)
	const original = await fs.readFile(store.commandStatus)
	const image = await copyImage(t, store)
	// Corruption fixture, NOT an allowed loss of previously synced bytes.
	await fs.appendFile(image.commandStatus, '{"command":"next","status":')
	assert.match(await restartedFailure(t, image), /Invalid command status record/)
	assert.deepEqual(await fs.readFile(store.commandStatus), original)
})

for (const [label, fault] of [
	['PL07 changeset fsync error', {op: 'fsync', file: 'data.A.jsontag.', action: 'error'}],
	['PL08 changeset rename error', {op: 'rename', file: 'data.A.jsontag', action: 'error'}],
	['PL09 changeset write ENOSPC', {op: 'write', file: 'data.A.jsontag.', action: 'error', code: 'ENOSPC'}]
]) {
	test(`${label} prevents command completion`, async t => {
		const store = await fixture(t)
		const server = await ready(t, store, {fault})
		assert.equal((await submit(store, server.port, {id: 'A', name: 'addPerson', value: {name: 'A'}})).http, 202)
		assert.equal((await completion(store, server.port, 'A')).status, 'failed')
		assert.ok((await rows(store.trace)).some(e => e.op === 'injected' && e.operation === fault.op))
		assert.deepEqual(await queryPersons(server.port), [])
		assert.ok(!(await readCommandStatusRecords(store)).some(e => e.status === 'done'))
	})
}

test('PL10 a successful short changeset write can still be acknowledged as done', async t => {
	const store = await fixture(t)
	const server = await ready(t, store, {fault: {op: 'write', file: 'data.A.jsontag.', action: 'short-write'}})
	await commit(store, server)
	assert.ok((await rows(store.trace)).some(e => e.op === 'injected' && e.action === 'short-write'))
	assert.deepEqual((await queryPersons(server.port)).map(p => p.name), ['A'], 'live workers receive intact memory bytes')
	await crash(server.child)
	const image = await copyImage(t, store)
	assert.match(await restartedFailure(t, image), /truncated|record length|record payload/i)
	await requirement(t, 'P3', (await expectedNames(store)).length, 0, 'a partial changeset write must not be acknowledged as complete')
})

test('PL11 done-status datasync failure exits with an uncertain on-disk outcome', async t => {
	const store = await fixture(t)
	const server = await ready(t, store, {fault: {op: 'datasync', file: 'command-status.jsontag', contains: '"status":"done"', action: 'error'}})
	assert.equal((await submit(store, server.port, {id: 'A', name: 'addPerson', value: {name: 'A'}})).http, 202)
	const exit = await waitForExit(server.child)
	assert.notEqual(exit.code, 0)
	assert.match(server.getOutput(), /Injected EIO/)
	const trace = await rows(store.trace)
	const injection = trace.findIndex(e => e.op === 'injected')
	assert.ok(injection >= 0)
	assert.ok(!trace.slice(injection + 1).some(e => e.file === store.commandStatus && e.op === 'datasync'))
	assert.deepEqual(await expectedNames(store), [])
	// The written done bytes may nevertheless exist. Failure is not proof of rollback.
	assert.ok((await readCommandStatusRecords(store)).some(e => e.status === 'done'))
})

test('PL12 loss before done sync causes automatic replay of an external effect', async t => {
	const store = await fixture(t)
	const effects = path.join(store.audit, 'effects.jsonl')
	await fs.writeFile(effects, '')
	await fs.writeFile(store.commandsFile, `import fs from 'node:fs'
export default { addPerson(data, command) {
	fs.appendFileSync(${JSON.stringify(effects)}, JSON.stringify(command.id) + '\\n')
	data.persons.push(command.value)
} }`)
	// Persisted initial names are part of the fixture's starting state.
	await fs.writeFile(store.commandStatus, '')
	const server = await ready(t, store, {fault: {op: 'datasync', file: 'command-status.jsontag', contains: '"status":"done"', action: 'pause'}})
	assert.equal((await submit(store, server.port, {id: 'A', name: 'addPerson', value: {name: 'A'}})).http, 202)
	await eventually(async () => (await rows(store.trace)).some(e => e.op === 'injected'), 'pause before done sync')
	await crash(server.child)
	const trace = await rows(store.trace)
	const stable = trace.findLast(e => e.file === store.commandStatus && e.op === 'datasync')
	assert.ok(stable)
	assert.doesNotMatch(Buffer.from(stable.bytes, 'base64').toString(), /"status":"done"/)
	const image = await copyImage(t, store)
	await fs.writeFile(image.commandStatus, Buffer.from(stable.bytes, 'base64'))
	await loseUnpublishedName(store, image, getChangesetPath(store.datafile, 'A'))
	assert.deepEqual(await rows(effects), ['A'])
	const restarted = await ready(t, image)
	assert.equal((await completion(image, restarted.port, 'A')).status, 'done')
	assert.deepEqual((await queryPersons(restarted.port)).map(p => p.name), ['A'])
	await requirement(t, 'P7', await rows(effects), ['A'], 'uncertain execution needs administrator approval before repeating external effects')
})

test('PL13 recovery queue ignores later accepted datasets (policy fixture)', async t => {
	const store = await fixture(t)
	const server = await ready(t, store)
	await commit(store, server, 'C')
	await crash(server.child)
	const image = await copyImage(t, store)
	const commands = [{id: 'B', name: 'addPerson', value: {name: 'B'}}, {id: 'C', name: 'addPerson', value: {name: 'C'}}]
	await fs.writeFile(image.commandLog, commands.map(c => JSONTag.stringify(c)).join('\n') + '\n')
	// Synthetic administrative input: do not claim this is an observed power-cut image.
	for (const laterStatus of ['accepted', 'done']) {
		const status = new Map([['B', {status: 'accepted'}], ['C', {status: laterStatus}]])
		assert.ok((await fs.stat(getChangesetPath(image.datafile, 'C'))).isFile())
		const queued = loadCommandLog(status, image.commandLog)
		await requirement(t, 'P6', queued.some(c => c.id === 'B'), false,
			`block B when later C has a dataset and status ${laterStatus}`)
	}
})

test('PL14 complete command body survives JSONTag logging and queue reconstruction', async t => {
	const store = await fixture(t)
	const command = {id: 'tagged', name: 'addPerson', value: {name: 'caf\u00e9 \u6f22\u5b57'},
		when: new Date('2026-09-19T10:00:00.000Z'), nested: {zero: 0, flag: false, values: [null, 'x']}}
	const server = await ready(t, store)
	assert.equal((await submit(store, server.port, command)).http, 202)
	assert.equal((await completion(store, server.port, command.id)).status, 'done')
	await crash(server.child)
	const queued = loadCommandLog(new Map([[command.id, {status: 'accepted'}]]), store.commandLog)
	assert.equal(queued.length, 1)
	assert.equal(JSONTag.stringify(JSONTag.parse(queued[0].command)), JSONTag.stringify(command))
})

test('PL15 configured worker can use request inputs that are absent from the log', async t => {
	const store = await fixture(t, {commandsSource: 'export default { addPerson(data, command, request) { data.persons.push({name: request.query.name}) } }'})
	const worker = path.join(store.dir, 'request-worker.mjs')
	await fs.writeFile(worker, `import {parentPort} from 'node:worker_threads'
import runCommand, {initialize} from ${JSON.stringify(new URL('../src/command-worker-module.mjs', import.meta.url).href)}
parentPort.on('message', async task => {
	await initialize(task)
	parentPort.postMessage(await runCommand(task.command, task.request))
})`)
	const server = await ready(t, store, {server: {commandWorker: worker}})
	assert.equal((await submit(store, server.port, {id: 'request', name: 'addPerson'}, '?name=from-request')).http, 202)
	assert.equal((await completion(store, server.port, 'request')).status, 'done')
	assert.deepEqual((await queryPersons(server.port)).map(p => p.name), ['from-request'])
	await crash(server.child)
	const [queued] = loadCommandLog(new Map([['request', {status: 'accepted'}]]), store.commandLog)
	assert.equal((await rows(store.journal)).find(e => e.event === 'issued').query, '?name=from-request')
	await requirement(t, 'P8', queued.request?.query?.name, 'from-request', 'recovery must retain the request input used by the configured worker')
})

test('PL16 concurrent acceptance can reorder waiting commands on restart', async t => {
	const store = await fixture(t, {commandsSource: `export default {
	block() { while (true) {} },
	addPerson(data, command) { data.persons.push(command.value) }
}`})
	const server = await ready(t, store, {fault: {op: 'datasync:after', file: 'command-log.jsontag', contains: '"id":"A"', action: 'pause'},
		server: {maxCommandCrashAttempts: 1}})
	assert.equal((await submit(store, server.port, {id: 'block', name: 'block'})).http, 202)
	const a = submit(store, server.port, {id: 'A', name: 'addPerson', value: {name: 'A'}})
	await eventually(async () => (await rows(store.trace)).some(e => e.op === 'injected'), 'A log completion gate')
	assert.equal((await submit(store, server.port, {id: 'B', name: 'addPerson', value: {name: 'B'}})).http, 202)
	await fs.writeFile(store.release, '')
	assert.equal((await a).http, 202)
	const accepted = (await rows(store.journal)).filter(e => e.event === 'response' && e.id !== 'block').map(e => e.id)
	assert.deepEqual(accepted, ['B', 'A'], 'external observer records acceptance independently')
	assert.deepEqual((await readCommandLogRecords(store)).map(c => c.id), ['block', 'A', 'B'])
	assert.deepEqual((await readCommandStatusRecords(store)).filter(c => c.status === 'accepted' && c.command !== 'block').map(c => c.command), accepted)
	await crash(server.child)
	const image = await copyImage(t, store)
	const restarted = await ready(t, image, {server: {maxCommandCrashAttempts: 1}})
	assert.equal((await completion(image, restarted.port, 'B')).status, 'done')
	assert.equal((await completion(image, restarted.port, 'A')).status, 'done')
	const actual = (await queryPersons(restarted.port)).map(p => p.name)
	await requirement(t, 'P4/P6', actual, accepted, 'restart must preserve established waiting-queue order')
})

test('PL17 failed startup reclassifies active work before discovering missing committed data', async t => {
	const store = await fixture(t)
	await fs.writeFile(store.commandStatus, [
		{command: 'A', status: 'active', attempt: 1},
		{command: 'C', status: 'done', code: 200}
	].map(c => JSONTag.stringify(c)).join('\n') + '\n')
	const before = await fs.readFile(store.commandStatus, 'utf8')
	assert.match(await restartedFailure(t, store), /Missing changeset|missing changeset/)
	assert.ok((await fs.readFile(store.commandStatus, 'utf8')).startsWith(before), 'original records remain as an append-only prefix')
	await requirement(t, 'P7', loadCommandStatus(store.commandStatus).get('A').status, 'active',
		'uncertain active work must not become replayable before administrator review')
})

for (const [id, file, op] of [
	['PL18', 'command-log.jsontag', 'datasync'],
	['PL19', 'command-status.jsontag', 'datasync'],
	['PL20', 'command-log.jsontag', 'close:after']
]) {
	test(`${id} ${file} ${op} failure prevents acceptance`, async t => {
		const store = await fixture(t)
		const server = await ready(t, store, {fault: {op, file, action: 'error'}})
		const response = await submit(store, server.port, {id: 'A', name: 'addPerson', value: {name: 'A'}})
		assert.equal(response.http, 500)
		assert.ok((await rows(store.trace)).some(e => e.op === 'injected' && e.operation === op))
		assert.deepEqual(await queryPersons(server.port), [])
		assert.ok(!(await rows(store.journal)).some(e => e.event === 'response' && e.http === 202))
	})
}

test('PL21 model control: an explicit directory sync prevents modeled filename loss', async t => {
	const store = await fixture(t, {indexSource: `import fs from 'node:fs/promises'
import index from ${JSON.stringify(new URL('../src/index.mjs', import.meta.url).href)}
export default { update() {}, async finalize(bytes, meta, id) {
	await index.finalize(bytes, meta, id)
	const directory = await fs.open(meta.data, 'r')
	try { await directory.sync() } finally { await directory.close() }
} }`})
	const server = await ready(t, store)
	await commit(store, server)
	await crash(server.child)
	const image = await copyImage(t, store)
	assert.equal(await loseUnpublishedName(store, image, getChangesetPath(store.datafile, 'A')), false)
	assert.equal(await loseUnpublishedName(store, image, store.commandStatus), false)
	const restarted = await ready(t, image)
	assert.deepEqual((await queryPersons(restarted.port)).map(p => p.name), await expectedNames(store))
})
