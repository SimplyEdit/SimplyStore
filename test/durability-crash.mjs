import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import test from 'node:test'
import { faultPoint } from '../src/faults.mjs'
import { assertRuntimeEnvironmentConfiguration, getRuntimeEnvironment } from '../src/runtime-environment.mjs'
import {
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
	} catch (error) {
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

test('crash after command log but before accepted status is not committed', async t => {
	const fixture = await makeServerFixture(t)
	const port = await getOpenPort()
	const command = {
		id: 'crash-after-log',
		name: 'addPerson',
		value: {name: 'After Log'}
	}

	const first = startServer(t, fixture, {
		port,
		runtimeEnvironment: 'test',
		faultPoint: 'after-command-log-before-accepted-status'
	})
	await waitForServer(first.child, first.getOutput, port)
	await postCommandExpectingCrash(port, command)
	assert.equal((await waitForExit(first.child)).signal, 'SIGKILL')

	const second = startServer(t, fixture, {port})
	await waitForServer(second.child, second.getOutput, port)

	await assertServerStateMatchesOracle(port, fixture, [])
	assert.deepEqual(await readCommandStatusRecords(fixture), [])
	assert.equal((await readCommandLogRecords(fixture)).length, 1)
})

test('duplicate command log records do not replay an accepted command twice', async t => {
	const fixture = await makeServerFixture(t)
	const port = await getOpenPort()
	const command = {
		id: 'duplicate-log-command',
		name: 'addPerson',
		value: {name: 'Once'}
	}

	const first = startServer(t, fixture, {
		port,
		runtimeEnvironment: 'test',
		faultPoint: 'after-command-log-before-accepted-status'
	})
	await waitForServer(first.child, first.getOutput, port)
	await postCommandExpectingCrash(port, command)
	assert.equal((await waitForExit(first.child)).signal, 'SIGKILL')

	const second = startServer(t, fixture, {
		port,
		runtimeEnvironment: 'test',
		faultPoint: 'after-command-accepted-status-before-response'
	})
	await waitForServer(second.child, second.getOutput, port)
	await postCommandExpectingCrash(port, command)
	assert.equal((await waitForExit(second.child)).signal, 'SIGKILL')

	const third = startServer(t, fixture, {port})
	await waitForServer(third.child, third.getOutput, port)

	await assertServerStateMatchesOracle(port, fixture, ['Once'])
	assert.equal((await readCommandLogRecords(fixture)).length, 2)
	assert.equal((await readCommandStatusRecords(fixture)).filter(record => record.status === 'done').length, 1)
})

test('accepted command crash boundaries replay to one committed state', async t => {
	const replayFaultPoints = [
		'after-command-accepted-status-before-response',
		'after-active-status-before-command-worker',
		'before-command-changeset-write',
		'after-command-changeset-write',
		'before-command-done-status'
	]

	for (const faultPointName of replayFaultPoints) {
		await t.test(faultPointName, async t => {
			const fixture = await makeServerFixture(t)
			const port = await getOpenPort()
			const command = {
				id: faultPointName,
				name: 'addPerson',
				value: {name: faultPointName}
			}

			const first = startServer(t, fixture, {
				port,
				runtimeEnvironment: 'test',
				faultPoint: faultPointName
			})
			await waitForServer(first.child, first.getOutput, port)
			await postCommandExpectingCrash(port, command)
			assert.equal((await waitForExit(first.child)).signal, 'SIGKILL')

			const second = startServer(t, fixture, {port})
			await waitForServer(second.child, second.getOutput, port)

			const retryStatus = await postCommandStatus(port, {
				id: command.id,
				name: 'addPerson',
				value: {name: `${faultPointName} duplicate`}
			})
			assert.equal(retryStatus.command, command.id)
			assert.equal(retryStatus.status, 'done')

			await assertServerStateMatchesOracle(port, fixture, [faultPointName])
			assert.equal((await getCommandStatus(port, command.id)).status, 'done')
		})
	}
})

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

test('repeated active command crashes are marked unsafe instead of replaying forever', async t => {
	const fixture = await makeServerFixture(t)
	const port = await getOpenPort()
	const commandId = 'poison-command'
	const crashOptions = {
		port,
		runtimeEnvironment: 'test',
		faultPoint: 'before-command-done-status',
		maxCommandCrashAttempts: 2
	}

	const first = startServer(t, fixture, crashOptions)
	await waitForServer(first.child, first.getOutput, port)
	await postCommandExpectingCrash(port, {
		id: commandId,
		name: 'addPerson',
		value: {name: 'Poison'}
	})

	assert.equal((await waitForExit(first.child)).signal, 'SIGKILL')

	const second = startServer(t, fixture, crashOptions)
	assert.equal((await waitForExit(second.child)).signal, 'SIGKILL')

	const third = startServer(t, fixture, {
		port,
		maxCommandCrashAttempts: 2
	})
	await waitForServer(third.child, third.getOutput, port)

	const commandStatus = await getCommandStatus(port, commandId)
	assert.equal(commandStatus.status, 'unsafe')
	assert.equal(commandStatus.attempt, 2)

	const retryStatus = await postCommandStatus(port, {
		id: commandId,
		name: 'addPerson',
		value: {name: 'Retry'}
	})
	assert.equal(retryStatus.command, commandId)
	assert.equal(retryStatus.status, 'unsafe')
	assert.equal(retryStatus.attempt, 2)

	await assertServerStateMatchesOracle(port, fixture, [])

	const statusFile = await fs.readFile(fixture.commandStatus, 'utf8')
	assert.match(statusFile, /"status":"active","attempt":1/)
	assert.match(statusFile, /"status":"active","attempt":2/)
	assert.match(statusFile, /"status":"unsafe"/)
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
