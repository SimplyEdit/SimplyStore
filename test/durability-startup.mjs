import tap from 'tap'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { Worker } from 'node:worker_threads'
import { fileURLToPath } from 'node:url'
import JSONTag from '@muze-nl/jsontag'
import Parser from '@muze-nl/od-jsontag/src/parse.mjs'
import serialize from '@muze-nl/od-jsontag/src/serialize.mjs'

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

	const result = await loadDataset({
		...fixture,
		commands: ['accepted-command']
	})
	const data = parseOd(result.data)

	t.same(data.persons, [], 'accepted-but-not-done changesets must not become visible after restart')
})

tap.test('done command with missing changeset refuses recovery instead of silently using base data', async t => {
	const fixture = await makeFixture(t)

	await t.rejects(
		loadDataset({
			...fixture,
			commands: ['done-command-with-missing-changeset']
		}),
		/missing changeset|inconsistent/i,
		'done status without its changeset should be an explicit recovery failure'
	)
})
