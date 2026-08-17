import tap from 'tap'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { Worker } from 'node:worker_threads'
import { fileURLToPath } from 'node:url'
import JSONTag from '@muze-nl/jsontag'
import Parser from '@muze-nl/od-jsontag/src/parse.mjs'
import serialize from '@muze-nl/od-jsontag/src/serialize.mjs'
import { getCommittedCommandIds, loadCommandLog, loadCommandStatus } from '../src/recovery.mjs'

const rootDir = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const loadWorker = path.join(rootDir, 'src/load-worker.mjs')

function parseOd(buffer) {
	const parser = new Parser()
	return parser.parse(buffer)
}

async function makeFixture(t) {
	const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'simplystore-durability-'))
	t.teardown(() => fs.rm(dir, {recursive: true, force: true}))

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

tap.test('accepted command changeset is not treated as committed state on startup', async t => {
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

	t.same(data.persons, [], 'accepted-but-not-done changesets must not become visible after restart')
})

tap.test('done command with missing changeset refuses recovery instead of silently using base data', async t => {
	const fixture = await makeFixture(t)
	const status = new Map([
		['done-command-with-missing-changeset', {command: 'done-command-with-missing-changeset', code: 200, status: 'done'}]
	])

	await t.rejects(
		loadDataset({
			...fixture,
			commands: getCommittedCommandIds(status)
		}),
		/missing changeset|inconsistent/i,
		'done status without its changeset should be an explicit recovery failure'
	)
})

tap.test('durable status file selects only done command changesets for startup', async t => {
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

	t.same(data.persons.map(person => person.name), ['Done'])
})

tap.test('durable command log replays only accepted commands', async t => {
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

	t.equal(commands.length, 1)
	t.equal(commands[0].id, 'accepted-command')
	t.match(commands[0], taskDefaults)
	t.equal(JSONTag.parse(commands[0].command).name, 'addPerson')
})
