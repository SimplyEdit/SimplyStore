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
	waitForServer
} from './durability-helpers.mjs'

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

async function queryNames(port) {
	return (await queryPersons(port)).map(person => person.name)
}

const baseCommands = `export default {
	addPerson: (dataspace, command) => {
		dataspace.persons.push(command.value)
	}
}
`

test('handler lifecycle: index update failure prevents command commit', async t => {
	const fixture = await makeServerFixture(t, {
		initialData: '{"persons":[{"name":"Initial"}]}',
		commandsSource: baseCommands,
		indexSource: `export default {
	create() {},
	update() {
		throw new Error('index update failed')
	},
	load() { return {} }
}
`
	})
	const port = await getOpenPort()
	const server = startServer(t, fixture, {port})
	await waitForServer(server.child, server.getOutput, port)

	const status = await postAndWait(port, {
		id: 'index-fails',
		name: 'addPerson',
		value: {name: 'Should Not Commit'}
	}, 'failed')

	assert.equal(status.status, 'failed')
	assert.match(status.message, /index update failed/)
	assert.deepEqual(await queryNames(port), ['Initial'])
	assert.deepEqual(await reconstructCommittedPersonNames(fixture), ['Initial'])
	await assert.rejects(fs.access(path.join(fixture.dir, 'data.index-fails.jsontag')), /ENOENT/)
})

test('handler lifecycle: derived index file can remain after failed command', async t => {
	const fixture = await makeServerFixture(t, {
		initialData: '{"persons":[{"name":"Initial"}]}',
		commandsSource: baseCommands,
		indexSource: `import fs from 'node:fs'

export default {
	create() {},
	update(dataspace, meta, changes) {
		fs.writeFileSync(meta.data + '/derived-before-failure.' + changes.uuid + '.txt', 'written')
		throw new Error('derived index failed after write')
	},
	load() { return {} }
}
`
	})
	const port = await getOpenPort()
	const server = startServer(t, fixture, {port})
	await waitForServer(server.child, server.getOutput, port)

	const status = await postAndWait(port, {
		id: 'index-writes-then-fails',
		name: 'addPerson',
		value: {name: 'Should Not Commit'}
	}, 'failed')

	assert.equal(status.status, 'failed')
	assert.match(status.message, /derived index failed after write/)
	assert.deepEqual(await queryNames(port), ['Initial'])
	assert.deepEqual(await reconstructCommittedPersonNames(fixture), ['Initial'])
	await assert.doesNotReject(fs.access(path.join(fixture.dir, 'derived-before-failure.index-writes-then-fails.txt')))
	await assert.rejects(fs.access(path.join(fixture.dir, 'data.index-writes-then-fails.jsontag')), /ENOENT/)
})

test('handler lifecycle: current index update can mutate canonical state before commit', async t => {
	const fixture = await makeServerFixture(t, {
		initialData: '{"persons":[{"name":"Initial"}]}',
		commandsSource: baseCommands,
		indexSource: `export default {
	create() {},
	update(dataspace) {
		dataspace.persons.push({name: 'Indexer Mutation'})
	},
	load() { return {} }
}
`
	})
	const port = await getOpenPort()
	const server = startServer(t, fixture, {port})
	await waitForServer(server.child, server.getOutput, port)

	await postAndWait(port, {
		id: 'index-mutates',
		name: 'addPerson',
		value: {name: 'Command Mutation'}
	})

	assert.deepEqual(await queryNames(port), ['Initial', 'Command Mutation', 'Indexer Mutation'])
	assert.deepEqual(await reconstructCommittedPersonNames(fixture), ['Initial', 'Command Mutation', 'Indexer Mutation'])
})
