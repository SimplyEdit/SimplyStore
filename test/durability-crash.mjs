import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import test from 'node:test'
import { faultPoint } from '../src/faults.mjs'
import { appendIntegrityRecord, getDefaultIntegrityFile, loadIntegrityManifest } from '../src/integrity.mjs'
import { getChangesetPath } from '../src/recovery.mjs'
import { assertRuntimeEnvironmentConfiguration, getRuntimeEnvironment } from '../src/runtime-environment.mjs'
import {
	unlockStoppedFixture,
	getCommandStatus,
	getOpenPort,
	makeServerFixture,
	postCommand,
	queryPersons,
	readCommandLogRecords,
	readCommandStatusRecords,
	reconstructCommittedPersonNames,
	startServer,
	stopServer,
	waitForExit,
	waitForServer
} from './durability-helpers.mjs'

async function postCommandExpectingCrash(port, command) {
	try {
		const response = await postCommand(port, command)
		assert.equal(response.status, 202)
	}
	catch (error) {
		assert.match(error.message, /fetch failed|terminated|socket|other side closed|aborted/i)
	}
}

async function postCommandStatus(port, command, expectedHttpStatus = 200) {
	const response = await postCommand(port, command)
	assert.equal(response.status, expectedHttpStatus)
	return response.json()
}

async function assertServerStateMatchesOracle(port, fixture, expectedNames) {
	const persons = await queryPersons(port)
	assert.deepEqual(persons.map(person => person.name), expectedNames)
	assert.deepEqual(await reconstructCommittedPersonNames(fixture), expectedNames)
}

async function waitForCommandStatus(port, commandId, expectedStatus) {
	const deadline = Date.now() + 5000
	let lastStatus
	while (Date.now() < deadline) {
		lastStatus = await getCommandStatus(port, commandId)
		if (lastStatus.status === expectedStatus) {
			return lastStatus
		}
		await new Promise(resolve => setTimeout(resolve, 25))
	}
	assert.fail(`Timed out waiting for ${commandId} to become ${expectedStatus}; latest status: ${JSON.stringify(lastStatus)}`)
}

test('runtime environment defaults to production and ignores production fault points', () => {
	assert.equal(getRuntimeEnvironment({}), 'production')
	assert.doesNotThrow(() => assertRuntimeEnvironmentConfiguration({}))
	assert.doesNotThrow(() => assertRuntimeEnvironmentConfiguration({
		SIMPLYSTORE_FAULT_POINT: 'before-command-done-status'
	}))
	assert.doesNotThrow(() => assertRuntimeEnvironmentConfiguration({
		SIMPLYSTORE_ENV: 'test',
		SIMPLYSTORE_FAULT_POINT: 'before-command-done-status'
	}))
	assert.throws(
		() => assertRuntimeEnvironmentConfiguration({SIMPLYSTORE_ENV: 'prod'}),
		/Invalid SIMPLYSTORE_ENV/
	)
})

test('fault points are inert outside test environment', async () => {
	assert.equal(await faultPoint('before-command-done-status', {
		SIMPLYSTORE_ENV: 'production',
		SIMPLYSTORE_FAULT_POINT: 'before-command-done-status'
	}), false)
	assert.equal(await faultPoint('before-command-done-status', {
		SIMPLYSTORE_ENV: 'development',
		SIMPLYSTORE_FAULT_POINT: 'before-command-done-status'
	}), false)
})

for (const faultPointName of [
	'after-command-log-before-accepted-status',
	'after-command-accepted-status-before-response',
	'after-active-status-before-command-worker',
	'before-command-changeset-write',
	'after-command-changeset-write',
	'before-command-done-status'
]) {
	test(`crash at ${faultPointName} preserves evidence and never automatically reruns`, async t => {
		const fixture=await makeServerFixture(t)
		const port=await getOpenPort()
		const first=startServer(t,fixture,{port,runtimeEnvironment:'test',faultPoint:faultPointName})
		await waitForServer(first.child,first.getOutput,port)
		await postCommandExpectingCrash(port,{id:'A',name:'addPerson',value:{name:'A'}})
		assert.equal((await waitForExit(first.child)).signal,'SIGKILL')
		const before=await fs.readFile(fixture.commandStatus)
		await unlockStoppedFixture(t,fixture)
		const second=startServer(t,fixture,{port})
		assert.equal((await waitForExit(second.child)).code,1)
		assert.match(second.getOutput(),/Administrative recovery required/)
		assert.deepEqual(await fs.readFile(fixture.commandStatus),before)
		assert.equal((await readCommandLogRecords(fixture))[0].id,'A')
	})
}

test('crash after done status but before query update recovers committed state without replay', async t => {
	const fixture = await makeServerFixture(t)
	const port = await getOpenPort()
	const command = {
		id: 'done-before-query-update',
		name: 'addPerson',
		value: {name: 'Committed'}
	}

	const first = startServer(t, fixture, {
		port,
		runtimeEnvironment: 'test',
		faultPoint: 'after-command-done-status-before-query-update'
	})
	await waitForServer(first.child, first.getOutput, port)
	await postCommandExpectingCrash(port, command)
	assert.equal((await waitForExit(first.child)).signal, 'SIGKILL')

	await unlockStoppedFixture(t,fixture)
	const statusAfterCrash = await readCommandStatusRecords(fixture)
	assert.equal(statusAfterCrash.at(-1).status, 'done')

	const second = startServer(t, fixture, {port})
	await waitForServer(second.child, second.getOutput, port)

	const retryStatus = await postCommandStatus(port, {
		id: command.id,
		name: 'addPerson',
		value: {name: 'Duplicate'}
	})
	assert.equal(retryStatus.command, command.id)
	assert.equal(retryStatus.status, 'done')

	await assertServerStateMatchesOracle(port, fixture, ['Committed'])
	assert.equal((await readCommandStatusRecords(fixture)).filter(record => record.status === 'active').length, 1)
	assert.equal((await getCommandStatus(port, command.id)).status, 'done')
})

test('crash ownership cannot be stolen automatically',async t=>{
	const fixture=await makeServerFixture(t),port=await getOpenPort()
	const first=startServer(t,fixture,{port,runtimeEnvironment:'test',faultPoint:'before-command-done-status'})
	await waitForServer(first.child,first.getOutput,port)
	await postCommandExpectingCrash(port,{id:'A',name:'addPerson',value:{name:'A'}})
	await waitForExit(first.child)
	const second=startServer(t,fixture,{port})
	assert.equal((await waitForExit(second.child)).code,1)
	assert.match(second.getOutput(),/Store is locked/)
	assert.equal((await readCommandStatusRecords(fixture)).filter(s=>s.status==='active').length,1)
})

test('hanging command times out unsafe and later accepted command commits', async t => {
	const fixture = await makeServerFixture(t, {
		commandsSource: `export default {
	hang: () => {
		while (true) {}
	},
	addPerson: (dataspace, command) => {
		dataspace.persons.push(command.value)
	}
}
`
	})
	const port = await getOpenPort()
	const running = startServer(t, fixture, {
		port,
		commandTimeout: 100
	})
	await waitForServer(running.child, running.getOutput, port)

	const timeoutResponse = await postCommand(port, {
		id: 'timeout-command',
		name: 'hang'
	})
	assert.equal(timeoutResponse.status, 202)

	const queuedResponse = await postCommand(port, {
		id: 'after-timeout',
		name: 'addPerson',
		value: {name: 'After Timeout'}
	})
	assert.equal(queuedResponse.status, 202)

	const timeoutStatus = await waitForCommandStatus(port, 'timeout-command', 'unsafe')
	assert.equal(timeoutStatus.code, 504)
	assert.equal(timeoutStatus.attempt, 1)
	assert.match(timeoutStatus.message, /command worker timed out after 100ms/)

	await waitForCommandStatus(port, 'after-timeout', 'done')

	const retryStatus = await postCommandStatus(port, {
		id: 'timeout-command',
		name: 'addPerson',
		value: {name: 'Retry'}
	})
	assert.equal(retryStatus.command, 'timeout-command')
	assert.equal(retryStatus.status, 'unsafe')
	assert.equal(retryStatus.attempt, 1)

	await assertServerStateMatchesOracle(port, fixture, ['After Timeout'])

	const statusRecords = await readCommandStatusRecords(fixture)
	assert.deepEqual(
		statusRecords
			.filter(record => record.command === 'timeout-command')
			.map(record => record.status),
		['accepted', 'active', 'unsafe']
	)
})

test('hanging load worker fails startup explicitly', async t => {
	const fixture = await makeServerFixture(t)
	const loadWorker = path.join(fixture.dir, 'hang-load-worker.mjs')
	await fs.writeFile(loadWorker, `import { parentPort } from 'node:worker_threads'

parentPort.on('message', () => {
	while (true) {}
})
`)
	const port = await getOpenPort()
	const running = startServer(t, fixture, {
		port,
		loadWorker,
		loadTimeout: 100
	})

	const exit = await waitForExit(running.child)
	assert.equal(exit.code, 1)
	assert.match(running.getOutput(), /load worker timed out after 100ms/)
	assert.doesNotMatch(running.getOutput(), /SimplyStore listening/)
})

test('integrity-enabled command writes changeset digest before done status', async t => {
	const fixture = await makeServerFixture(t)
	const port = await getOpenPort()
	const integrityFile = getDefaultIntegrityFile(fixture.datafile)
	await appendIntegrityRecord(integrityFile, fixture.datafile, await fs.readFile(fixture.datafile))

	const running = startServer(t, fixture, {
		port,
		integrityFile
	})
	await waitForServer(running.child, running.getOutput, port)

	const commandId = 'integrity-command'
	const response = await postCommand(port, {
		id: commandId,
		name: 'addPerson',
		value: {name: 'Ada'}
	})
	assert.equal(response.status, 202)
	await waitForCommandStatus(port, commandId, 'done')

	const changesetPath = getChangesetPath(fixture.datafile, commandId)
	const manifest = await loadIntegrityManifest(integrityFile)
	assert.ok(manifest.has(path.basename(changesetPath)))

	await stopServer(running.child)

	const original = await fs.readFile(changesetPath, 'utf8')
	await fs.writeFile(changesetPath, original.replace('Ada', 'Eve'))

	const restarted = startServer(t, fixture, {
		port,
		integrityFile
	})
	const exit = await waitForExit(restarted.child)
	assert.equal(exit.code, 1)
	assert.match(restarted.getOutput(), /Integrity mismatch/)
})

test('normal restart preserves committed state according to reconstruction oracle', async t => {
	const fixture = await makeServerFixture(t)
	const port = await getOpenPort()
	const first = startServer(t, fixture, {port})
	await waitForServer(first.child, first.getOutput, port)

	const response = await postCommand(port, {
		id: 'normal-command',
		name: 'addPerson',
		value: {name: 'Normal'}
	})
	assert.equal(response.status, 202)
	await waitForCommandStatus(port, 'normal-command', 'done')

	const changeset = path.join(fixture.dir, 'data.normal-command.jsontag')
	await assert.doesNotReject(fs.access(changeset))
	await assertServerStateMatchesOracle(port, fixture, ['Normal'])

	await stopServer(first.child)
	const second = startServer(t, fixture, {port})
	await waitForServer(second.child, second.getOutput, port)

	await assertServerStateMatchesOracle(port, fixture, ['Normal'])
})
