import assert from 'node:assert/strict'
import { Buffer } from 'node:buffer'
import test from 'node:test'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { Worker } from 'node:worker_threads'
import { fileURLToPath } from 'node:url'
import JSONTag from '@muze-nl/jsontag'
import Parser from '@muze-nl/od-jsontag/src/parse.mjs'
import serialize from '@muze-nl/od-jsontag/src/serialize.mjs'
import {
	activeCommandStatus,
	getCommittedCommandIds,
	getChangesetPath,
	assertOdJsonTagFraming,
	loadCommandLog,
	loadCommandStatus,
	pendingCommandStatus,
	recoverActiveCommands,
	RecoveryIntegrityError,
	unsafeCommandStatus
} from '../src/recovery.mjs'

const rootDir = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const loadWorker = path.join(rootDir, 'src/load-worker.mjs')

function parseOd(buffer) {
	const parser = new Parser()
	return parser.parse(buffer)
}

async function makeFixture(t) {
	const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'simplystore-durability-'))
	t.after(() => fs.rm(dir, {recursive: true, force: true}))

	const dataFile = path.join(dir, 'data.jsontag')
	const indexFile = path.join(dir, 'index.mjs')
	const base = serialize(JSONTag.parse('{"persons":[]}'))

	await fs.writeFile(dataFile, base)
	await fs.writeFile(indexFile, 'export default { create() {}, update() {}, load() { return {} } }\n')

	return {dir, dataFile, indexFile}
}

async function writeJsonTagLines(file, records) {
	await fs.writeFile(file, records.map(record => JSONTag.stringify(record)).join('\n') + '\n')
}

async function writeChangeset(dataFile, commandId, change) {
	const parser = new Parser()
	parser.immutable = false
	const base = await fs.readFile(dataFile)
	const data = parser.parse(base)
	change(data)

	const extension = dataFile.split('.').pop()
	const basefile = dataFile.substring(0, dataFile.length - (extension.length + 1))
	await fs.writeFile(`${basefile}.${commandId}.${extension}`, serialize(data, {
		meta: parser.meta,
		changes: true
	}))
}

function loadDataset({dataFile, indexFile, commands}) {
	return new Promise((resolve, reject) => {
		const worker = new Worker(loadWorker)
		worker.on('message', result => {
			worker.terminate()
			resolve(result)
		})
		worker.on('error', error => {
			worker.terminate()
			reject(error)
		})
		worker.postMessage({
			dataFile,
			indexFile,
			schemaFile: null,
			commands: [...commands]
		})
	})
}

test('accepted command changeset is not treated as committed state on startup', async t => {
	const fixture = await makeFixture(t)
	await writeChangeset(fixture.dataFile, 'accepted-command', data => {
		data.persons.push({name: 'Ada'})
	})

	const status = new Map([
		['accepted-command', {command: 'accepted-command', code: 202, status: 'accepted'}]
	])
	const result = await loadDataset({
		...fixture,
		commands: getCommittedCommandIds(status)
	})
	const data = parseOd(result.data)

	assert.equal(data.persons.length, 0, 'accepted-but-not-done changesets must not become visible after restart')
})

test('done command with missing changeset refuses recovery instead of silently using base data', async t => {
	const fixture = await makeFixture(t)
	const status = new Map([
		['done-command-with-missing-changeset', {command: 'done-command-with-missing-changeset', code: 200, status: 'done'}]
	])

	await assert.rejects(
		loadDataset({
			...fixture,
			commands: getCommittedCommandIds(status)
		}),
		/missing changeset|inconsistent/i,
		'done status without its changeset should be an explicit recovery failure'
	)
})

test('malformed base OD-JSONTag file refuses recovery', async t => {
	const fixture = await makeFixture(t)
	await fs.writeFile(fixture.dataFile, '{"persons":[]}')

	await assert.rejects(
		loadDataset({
			...fixture,
			commands: []
		}),
		/base OD-JSONTag data|expected record length/i
	)
})

test('malformed committed changeset refuses recovery', async t => {
	const fixture = await makeFixture(t)
	const status = new Map([
		['malformed-changeset', {command: 'malformed-changeset', code: 200, status: 'done'}]
	])
	await fs.writeFile(getChangesetPath(fixture.dataFile, 'malformed-changeset'), '{"persons":[{"name":"Bad"}]}')

	await assert.rejects(
		loadDataset({
			...fixture,
			commands: getCommittedCommandIds(status)
		}),
		/changeset OD-JSONTag data|expected record length/i
	)
})

test('truncated committed changeset payload refuses recovery before lazy parsing can hide it', async t => {
	const fixture = await makeFixture(t)
	const commandId = 'truncated-changeset'
	const status = new Map([
		[commandId, {command: commandId, code: 200, status: 'done'}]
	])
	await writeChangeset(fixture.dataFile, commandId, data => {
		data.persons.push({name: 'Truncated'})
	})
	const changesetPath = getChangesetPath(fixture.dataFile, commandId)
	const changeset = await fs.readFile(changesetPath)
	await fs.writeFile(changesetPath, changeset.subarray(0, changeset.length - 3))

	await assert.rejects(
		loadDataset({
			...fixture,
			commands: getCommittedCommandIds(status)
		}),
		/truncated record payload|changeset OD-JSONTag data/i
	)
})

test('malformed uncommitted changeset is ignored during committed startup reconstruction', async t => {
	const fixture = await makeFixture(t)
	await fs.writeFile(getChangesetPath(fixture.dataFile, 'accepted-command'), '{"persons":[{"name":"Ignored"}]}')
	const status = new Map([
		['accepted-command', {command: 'accepted-command', code: 202, status: 'accepted'}]
	])

	const result = await loadDataset({
		...fixture,
		commands: getCommittedCommandIds(status)
	})
	const data = parseOd(result.data)

	assert.equal(data.persons.length, 0)
})

test('durable status file selects only done command changesets for startup', async t => {
	const fixture = await makeFixture(t)
	const statusFile = path.join(fixture.dir, 'command-status.jsontag')

	await writeChangeset(fixture.dataFile, 'accepted-command', data => {
		data.persons.push({name: 'Accepted'})
	})
	await writeChangeset(fixture.dataFile, 'done-command', data => {
		data.persons.push({name: 'Done'})
	})

	await writeJsonTagLines(statusFile, [
		{command: 'accepted-command', code: 202, status: 'accepted'},
		{command: 'done-command', code: 202, status: 'accepted'},
		{command: 'done-command', code: 200, status: 'done'},
		{command: 'failed-command', code: 202, status: 'accepted'},
		{command: 'failed-command', code: 500, status: 'failed'}
	])

	const status = loadCommandStatus(statusFile)
	const result = await loadDataset({
		...fixture,
		commands: getCommittedCommandIds(status)
	})
	const data = parseOd(result.data)

	assert.deepEqual(data.persons.map(person => person.name), ['Done'])
})

test('durable command log replays only accepted commands', async t => {
	const fixture = await makeFixture(t)
	const statusFile = path.join(fixture.dir, 'command-status.jsontag')
	const commandLog = path.join(fixture.dir, 'command-log.jsontag')

	await writeJsonTagLines(statusFile, [
		{command: 'accepted-command', code: 202, status: 'accepted'},
		{command: 'done-command', code: 200, status: 'done'},
		{command: 'failed-command', code: 500, status: 'failed'}
	])
	await writeJsonTagLines(commandLog, [
		{id: 'accepted-command', name: 'addPerson', value: {name: 'Accepted'}},
		{id: 'done-command', name: 'addPerson', value: {name: 'Done'}},
		{id: 'failed-command', name: 'addPerson', value: {name: 'Failed'}}
	])

	const taskDefaults = {
		meta: {source: 'test-meta'},
		data: ['test-data'],
		commandsFile: '/commands.mjs',
		indexFile: '/index.mjs',
		datafile: fixture.dataFile
	}
	const status = loadCommandStatus(statusFile)
	const commands = loadCommandLog(status, commandLog, taskDefaults)

	assert.equal(commands.length, 1)
	assert.equal(commands[0].id, 'accepted-command')
	assert.deepEqual(commands[0], {
		...taskDefaults,
		id: 'accepted-command',
		command: JSONTag.stringify({id: 'accepted-command', name: 'addPerson', value: {name: 'Accepted'}}),
		request: null
	})
	assert.equal(JSONTag.parse(commands[0].command).name, 'addPerson')
})

test('active command below crash threshold is accepted for replay on startup', async t => {
	const fixture = await makeFixture(t)
	const statusFile = path.join(fixture.dir, 'command-status.jsontag')
	const commandLog = path.join(fixture.dir, 'command-log.jsontag')

	await writeJsonTagLines(statusFile, [
		{command: 'crashed-command', code: 102, status: activeCommandStatus, attempt: 1}
	])
	await writeJsonTagLines(commandLog, [
		{id: 'crashed-command', name: 'addPerson', value: {name: 'Retry'}}
	])

	const status = loadCommandStatus(statusFile)
	await recoverActiveCommands(status, statusFile, {maxCrashAttempts: 2})
	const commands = loadCommandLog(status, commandLog)

	assert.equal(status.get('crashed-command').status, pendingCommandStatus)
	assert.equal(commands.length, 1)
	assert.equal(commands[0].id, 'crashed-command')
	assert.match(await fs.readFile(statusFile, 'utf8'), /"status":"accepted"/)
})

test('active command at crash threshold is marked unsafe and not replayed', async t => {
	const fixture = await makeFixture(t)
	const statusFile = path.join(fixture.dir, 'command-status.jsontag')
	const commandLog = path.join(fixture.dir, 'command-log.jsontag')

	await writeJsonTagLines(statusFile, [
		{command: 'poison-command', code: 102, status: activeCommandStatus, attempt: 2}
	])
	await writeJsonTagLines(commandLog, [
		{id: 'poison-command', name: 'addPerson', value: {name: 'Unsafe'}}
	])

	const status = loadCommandStatus(statusFile)
	await recoverActiveCommands(status, statusFile, {maxCrashAttempts: 2})
	const commands = loadCommandLog(status, commandLog)

	assert.equal(status.get('poison-command').status, unsafeCommandStatus)
	assert.equal(commands.length, 0)
	assert.match(await fs.readFile(statusFile, 'utf8'), /"status":"unsafe"/)
})

test('malformed durable status record refuses recovery with explicit integrity error', async t => {
	const fixture = await makeFixture(t)
	const statusFile = path.join(fixture.dir, 'command-status.jsontag')
	await fs.writeFile(statusFile, '{"command":"truncated"\n')

	let error
	try {
		loadCommandStatus(statusFile)
	} catch (caught) {
		error = caught
	}

	assert.ok(error instanceof RecoveryIntegrityError)
	assert.equal(error.file, statusFile)
	assert.equal(error.lineNumber, 1)
	assert.equal(error.recordKind, 'command status')
	assert.match(error.message, /Invalid command status record/)
})

test('structurally invalid durable status record refuses recovery', async t => {
	const fixture = await makeFixture(t)
	const statusFile = path.join(fixture.dir, 'command-status.jsontag')
	await writeJsonTagLines(statusFile, [
		{code: 202, status: 'accepted'}
	])

	let error
	try {
		loadCommandStatus(statusFile)
	} catch (caught) {
		error = caught
	}

	assert.ok(error instanceof RecoveryIntegrityError)
	assert.equal(error.file, statusFile)
	assert.equal(error.lineNumber, 1)
	assert.equal(error.recordKind, 'command status')
	assert.match(error.message, /missing string field "command"/)
})

test('malformed durable command log record refuses recovery with explicit integrity error', async t => {
	const fixture = await makeFixture(t)
	const commandLog = path.join(fixture.dir, 'command-log.jsontag')
	const status = new Map()
	await fs.writeFile(commandLog, '{"id":"truncated"\n')

	let error
	try {
		loadCommandLog(status, commandLog)
	} catch (caught) {
		error = caught
	}

	assert.ok(error instanceof RecoveryIntegrityError)
	assert.equal(error.file, commandLog)
	assert.equal(error.lineNumber, 1)
	assert.equal(error.recordKind, 'command log')
	assert.match(error.message, /Invalid command log record/)
})

test('structurally invalid durable command log record refuses recovery', async t => {
	const fixture = await makeFixture(t)
	const commandLog = path.join(fixture.dir, 'command-log.jsontag')
	const status = new Map()
	await writeJsonTagLines(commandLog, [
		{name: 'addPerson', value: {name: 'No id'}}
	])

	let error
	try {
		loadCommandLog(status, commandLog)
	} catch (caught) {
		error = caught
	}

	assert.ok(error instanceof RecoveryIntegrityError)
	assert.equal(error.file, commandLog)
	assert.equal(error.lineNumber, 1)
	assert.equal(error.recordKind, 'command log')
	assert.match(error.message, /missing string field "id"/)
})

test('OD-JSONTag framing validation catches truncated lazy records', () => {
	const buffer = Buffer.from('(16){"persons":[~1]}\n(14){"name":"Ada"', 'utf8')

	let error
	try {
		assertOdJsonTagFraming(buffer, 'data.truncated.jsontag', 'changeset OD-JSONTag data')
	} catch (caught) {
		error = caught
	}

	assert.ok(error instanceof RecoveryIntegrityError)
	assert.equal(error.file, 'data.truncated.jsontag')
	assert.equal(error.recordKind, 'changeset OD-JSONTag data')
	assert.match(error.message, /truncated record payload/)
})

test('OD-JSONTag framing validation accepts changeset skip records', () => {
	const buffer = Buffer.from('(18){"persons":[~1-2]}\n+1\n(15){"name":"Once"}', 'utf8')

	assert.doesNotThrow(() => {
		assertOdJsonTagFraming(buffer, 'data.patch.jsontag', 'changeset OD-JSONTag data')
	})
})
