import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import test from 'node:test'
import {
	getCommandStatus,
	getOpenPort,
	makeServerFixture,
	postCommand,
	queryPersons,
	reconstructCommittedPersonNames,
	startServer,
	stopServer,
	waitForServer
} from './durability-helpers.mjs'

const acidCommands = `export default {
	addPerson: (dataspace, command) => {
		dataspace.persons.push(command.value)
	},
	addPersonThenThrow: (dataspace, command) => {
		dataspace.persons.push(command.value)
		throw new Error('command failed after mutation')
	},
	slowAddPerson: (dataspace, command) => {
		dataspace.persons.push(command.value)
		const end = Date.now() + (command.delay || 500)
		while (Date.now() < end) {}
	}
}
`

async function makeAcidFixture(t) {
	return makeServerFixture(t, {
		initialData: '{"persons":[{"name":"Initial"}]}',
		commandsSource: acidCommands
	})
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

async function postAndWait(port, command, expectedStatus = 'done') {
	const response = await postCommand(port, command)
	assert.equal(response.status, 202)
	return waitForCommandStatus(port, command.id, expectedStatus)
}

async function postCommandStatus(port, command, expectedHttpStatus = 200) {
	const response = await postCommand(port, command)
	assert.equal(response.status, expectedHttpStatus)
	return response.json()
}

async function queryResponse(port, body) {
	return fetch(`http://127.0.0.1:${port}/query/`, {
		method: 'POST',
		headers: {
			'content-type': 'text/plain'
		},
		body,
		signal: AbortSignal.timeout(5000)
	})
}

async function queryNames(port) {
	return (await queryPersons(port)).map(person => person.name)
}

test('atomicity: command mutation followed by failure does not become visible or committed', async t => {
	const fixture = await makeAcidFixture(t)
	const port = await getOpenPort()
	const server = startServer(t, fixture, {port})
	await waitForServer(server.child, server.getOutput, port)

	const failedStatus = await postAndWait(port, {
		id: 'atomic-failure',
		name: 'addPersonThenThrow',
		value: {name: 'Leaked'}
	}, 'failed')

	assert.equal(failedStatus.status, 'failed')
	assert.deepEqual(await queryNames(port), ['Initial'])
	assert.deepEqual(await reconstructCommittedPersonNames(fixture), ['Initial'])

	const changeset = path.join(fixture.dir, 'data.atomic-failure.jsontag')
	await assert.rejects(fs.access(changeset), /ENOENT/)
})

test('isolation: mutating data inside a JavaScript query does not affect later queries', async t => {
	const fixture = await makeAcidFixture(t)
	const port = await getOpenPort()
	const server = startServer(t, fixture, {port, maxWorkers: 1})
	await waitForServer(server.child, server.getOutput, port)

	const mutation = await queryResponse(port, 'data.persons.push({name: "Query Mutation"}); data.persons.map(person => person.name)')
	assert.equal(mutation.status, 422)
	assert.match(await mutation.text(), /dataspace is immutable/)

	assert.deepEqual(await queryNames(port), ['Initial'])
	assert.deepEqual(await reconstructCommittedPersonNames(fixture), ['Initial'])
})

test('consistency: query during an active command sees the previous committed state', async t => {
	const fixture = await makeAcidFixture(t)
	const port = await getOpenPort()
	const server = startServer(t, fixture, {port})
	await waitForServer(server.child, server.getOutput, port)

	const commandResponse = postCommand(port, {
		id: 'slow-command',
		name: 'slowAddPerson',
		value: {name: 'Committed Later'},
		delay: 750
	})

	await new Promise(resolve => setTimeout(resolve, 100))
	assert.deepEqual(await queryNames(port), ['Initial'])

	const response = await commandResponse
	assert.equal(response.status, 202)
	await waitForCommandStatus(port, 'slow-command', 'done')

	assert.deepEqual(await queryNames(port), ['Initial', 'Committed Later'])
	assert.deepEqual(await reconstructCommittedPersonNames(fixture), ['Initial', 'Committed Later'])
})

test('idempotency: duplicate command ID is acknowledged but not applied twice', async t => {
	const fixture = await makeAcidFixture(t)
	const port = await getOpenPort()
	const server = startServer(t, fixture, {port})
	await waitForServer(server.child, server.getOutput, port)

	await postAndWait(port, {
		id: 'duplicate-id',
		name: 'addPerson',
		value: {name: 'Once'}
	})

	const duplicate = await postCommand(port, {
		id: 'duplicate-id',
		name: 'addPerson',
		value: {name: 'Twice'}
	})
	assert.equal(duplicate.status, 200)
	assert.equal((await duplicate.json()).status, 'done')

	assert.deepEqual(await queryNames(port), ['Initial', 'Once'])
	assert.deepEqual(await reconstructCommittedPersonNames(fixture), ['Initial', 'Once'])

	await stopServer(server.child)
	const restarted = startServer(t, fixture, {port})
	await waitForServer(restarted.child, restarted.getOutput, port)
	assert.deepEqual(await queryNames(port), ['Initial', 'Once'])
})

test('idempotency: retry during active command reports current status and does not enqueue twice', async t => {
	const fixture = await makeAcidFixture(t)
	const port = await getOpenPort()
	const server = startServer(t, fixture, {port})
	await waitForServer(server.child, server.getOutput, port)

	const commandResponse = await postCommand(port, {
		id: 'active-retry',
		name: 'slowAddPerson',
		value: {name: 'Slow Once'},
		delay: 750
	})
	assert.equal(commandResponse.status, 202)

	await waitForCommandStatus(port, 'active-retry', 'active')
	const retryStatus = await postCommandStatus(port, {
		id: 'active-retry',
		name: 'addPerson',
		value: {name: 'Duplicate'}
	})
	assert.equal(retryStatus.command, 'active-retry')
	assert.equal(retryStatus.status, 'active')

	await waitForCommandStatus(port, 'active-retry', 'done')

	assert.deepEqual(await queryNames(port), ['Initial', 'Slow Once'])
	assert.deepEqual(await reconstructCommittedPersonNames(fixture), ['Initial', 'Slow Once'])
})
