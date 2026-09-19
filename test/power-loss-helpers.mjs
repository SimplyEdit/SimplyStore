import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import {spawn} from 'node:child_process'
import {fileURLToPath} from 'node:url'
import JSONTag from '@muze-nl/jsontag'
import {makeServerFixture, rootDir, stopServer, waitForExit, getCommandStatus} from './durability-helpers.mjs'

export async function fixture(t, options = {}) {
	const store = await makeServerFixture(t, options)
	const audit = await fs.mkdtemp(path.join(os.tmpdir(), 'simplystore-observer-'))
	t.after(() => fs.rm(audit, {recursive: true, force: true}))
	const trace = path.join(audit, 'io.jsonl')
	const journal = path.join(audit, 'client.jsonl')
	const release = path.join(audit, 'release')
	await fs.writeFile(trace, '')
	await fs.writeFile(journal, '')
	return {...store, audit, trace, journal, release}
}

export async function rows(file) {
	return (await fs.readFile(file, 'utf8')).split('\n').filter(Boolean).map(line => JSON.parse(line))
}

export async function observe(store, event) {
	await fs.appendFile(store.journal, JSON.stringify(event) + '\n')
}

export async function submit(store, port, command, query = '') {
	await observe(store, {event: 'issued', command, query})
	const response = await fetch(`http://127.0.0.1:${port}/command${query}`, {
		method: 'POST', headers: {accept: 'application/json', 'content-type': 'application/jsontag'},
		body: JSONTag.stringify(command), signal: AbortSignal.timeout(5000)
	})
	const text = await response.text()
	let body
	try { body = JSON.parse(text) } catch { body = {raw: text} }
	await observe(store, {event: 'response', id: command.id, http: response.status, body})
	return {http: response.status, body}
}

export async function eventually(fn, description, timeout = 6000) {
	const end = Date.now() + timeout
	while (Date.now() < end) {
		const result = await fn()
		if (result) { return result }
		await new Promise(resolve => setTimeout(resolve, 10))
	}
	assert.fail(`Timed out: ${description}`)
}

export async function completion(store, port, id) {
	const result = await eventually(async () => {
		const status = await getCommandStatus(port, id)
		return ['done', 'failed', 'unsafe'].includes(status.status) && status
	}, `completion of ${id}`)
	await observe(store, {event: 'completion', id, body: result})
	return result
}

export async function launch(t, store, port, options = {}) {
	const config = path.join(store.audit, `config-${Math.random().toString(16).slice(2)}.json`)
	await fs.writeFile(config, JSON.stringify({root: store.dir, trace: store.trace,
		release: store.release, fault: options.fault}))
	const child = spawn(process.execPath, ['--import', fileURLToPath(new URL('./power-loss-preload.mjs', import.meta.url)), store.runner], {
		cwd: store.dir,
		env: {...process.env, SIMPLYSTORE_ENV: 'test', SIMPLYSTORE_FAULT_POINT: '',
			SIMPLYSTORE_BASELINE_IO: config,
			SIMPLYSTORE_TEST_OPTIONS: JSON.stringify({
				port, datafile: store.datafile, commandsFile: store.commandsFile,
				indexFile: store.indexFile, commandLog: store.commandLog,
				commandStatus: store.commandStatus, wwwroot: path.join(rootDir, 'www'),
				maxWorkers: 1, commandTimeout: 10000, ...options.server
			})},
		stdio: ['ignore', 'pipe', 'pipe']
	})
	let output = ''
	child.stdout.on('data', data => { output += data })
	child.stderr.on('data', data => { output += data })
	t.after(() => stopServer(child))
	return {child, getOutput: () => output}
}

export async function crash(child) {
	child.kill('SIGKILL')
	const exit = await waitForExit(child)
	assert.equal(exit.signal, 'SIGKILL')
}

export async function copyImage(t, store) {
	const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'simplystore-crash-image-'))
	t.after(() => fs.rm(dir, {recursive: true, force: true}))
	await fs.cp(store.dir, dir, {recursive: true})
	const image = {...store, dir}
	for (const key of ['datafile', 'commandsFile', 'indexFile', 'commandLog', 'commandStatus', 'runner']) {
		image[key] = path.join(dir, path.basename(store[key]))
	}
	return image
}

export async function loseUnpublishedName(store, image, original) {
	const trace = await rows(store.trace)
	const publication = trace.findLastIndex(e => e.file === original &&
		(e.op === 'rename' || (e.op === 'open' && !e.existed)))
	assert.ok(publication >= 0, `trace contains publication of ${original}`)
	const durable = trace.slice(publication + 1).some(e =>
		e.file === path.dirname(original) && e.op === 'sync')
	if (!durable) { await fs.rm(path.join(image.dir, path.basename(original))) }
	return !durable
}

export async function requirement(t, id, actual, expected, message) {
	await t.test(`${id}: ${message}`, {
		todo: process.env.SIMPLYSTORE_BASELINE_STRICT === '1' ? false : 'Known baseline violation; run test:power-loss:strict'
	}, () => assert.deepEqual(actual, expected, message))
}
