import { spawn } from 'node:child_process'
import fs from 'node:fs/promises'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import JSONTag from '@muze-nl/jsontag'
import Parser from '@muze-nl/od-jsontag/src/parse.mjs'
import serialize from '@muze-nl/od-jsontag/src/serialize.mjs'
import { getChangesetPath } from '../src/recovery.mjs'

export const rootDir = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const serverModule = path.join(rootDir, 'src/server.mjs')

export async function getOpenPort() {
	const probe = net.createServer()
	await new Promise((resolve, reject) => {
		probe.once('error', reject)
		probe.listen(0, '127.0.0.1', resolve)
	})
	const port = probe.address().port
	await new Promise(resolve => probe.close(resolve))
	return port
}

export async function makeServerFixture(t, options = {}) {
	const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'simplystore-crash-'))
	t.after(() => fs.rm(dir, {recursive: true, force: true}))

	const datafile = path.join(dir, 'data.jsontag')
	const commandsFile = path.join(dir, 'commands.mjs')
	const indexFile = path.join(dir, 'index.mjs')
	const commandLog = path.join(dir, 'command-log.jsontag')
	const commandStatus = path.join(dir, 'command-status.jsontag')
	const runner = path.join(dir, 'run-server.mjs')

	await fs.writeFile(datafile, serialize(JSONTag.parse(options.initialData || '{"persons":[]}')))
	await fs.writeFile(commandsFile, options.commandsSource || `export default {
	addPerson: (dataspace, command) => {
		dataspace.persons.push(command.value)
	}
}
`)
	await fs.writeFile(indexFile, options.indexSource || 'export default { create() {}, update() {}, load() { return {} } }\n')
	await fs.writeFile(runner, `import SimplyStore from ${JSON.stringify(serverModule)}

const options = JSON.parse(process.env.SIMPLYSTORE_TEST_OPTIONS)
SimplyStore.run(options)
`)

	return {dir, datafile, commandsFile, indexFile, commandLog, commandStatus, runner}
}

export function startServer(t, fixture, options = {}) {
	const child = spawn(process.execPath, [fixture.runner], {
		cwd: fixture.dir,
		env: {
			...process.env,
			SIMPLYSTORE_ENV: options.runtimeEnvironment || 'production',
			SIMPLYSTORE_FAULT_POINT: options.faultPoint || '',
			SIMPLYSTORE_TEST_OPTIONS: JSON.stringify({
				port: options.port,
				datafile: fixture.datafile,
				commandsFile: fixture.commandsFile,
				indexFile: fixture.indexFile,
				commandLog: fixture.commandLog,
				commandStatus: fixture.commandStatus,
				wwwroot: path.join(rootDir, 'www'),
				maxWorkers: 1,
				maxCommandCrashAttempts: options.maxCommandCrashAttempts,
				commandTimeout: options.commandTimeout,
				loadTimeout: options.loadTimeout,
				loadWorker: options.loadWorker
			})
		},
		stdio: ['ignore', 'pipe', 'pipe']
	})

	let output = ''
	child.stdout.on('data', data => {
		output += data
	})
	child.stderr.on('data', data => {
		output += data
	})

	t.after(() => stopServer(child))

	return {child, getOutput: () => output}
}

export async function stopServer(child) {
	if (!child.killed && child.exitCode === null) {
		child.kill('SIGTERM')
	}
	await waitForExit(child, 5000)
}

export async function waitForServer(child, getOutput, port) {
	await new Promise((resolve, reject) => {
		const timeout = setTimeout(() => {
			child.off('exit', onExit)
			reject(new Error(`Server did not start on port ${port}:\n${getOutput()}`))
		}, 5000)
		const onExit = (code, signal) => {
			clearTimeout(timeout)
			reject(new Error(`Server exited before startup (${code || signal}):\n${getOutput()}`))
		}
		const checkReady = () => {
			if (getOutput().includes(`SimplyStore listening on port ${port}`)) {
				clearTimeout(timeout)
				child.off('exit', onExit)
				resolve()
				return
			}
			setTimeout(checkReady, 25)
		}
		child.once('exit', onExit)
		checkReady()
	})
}

export async function waitForExit(child, timeoutMs = 5000) {
	return new Promise((resolve, reject) => {
		if (child.exitCode !== null || child.signalCode) {
			resolve({code: child.exitCode, signal: child.signalCode})
			return
		}
		const timeout = setTimeout(() => {
			child.off('exit', onExit)
			reject(new Error(`Process did not exit within ${timeoutMs}ms`))
		}, timeoutMs)
		const onExit = (code, signal) => {
			clearTimeout(timeout)
			resolve({code, signal})
		}
		child.once('exit', onExit)
	})
}

export async function postCommand(port, command) {
	return fetch(`http://127.0.0.1:${port}/command`, {
		method: 'POST',
		headers: {
			accept: 'application/json',
			'content-type': 'application/jsontag'
		},
		body: JSONTag.stringify(command),
		signal: AbortSignal.timeout(5000)
	})
}

export async function queryPersons(port) {
	const response = await fetch(`http://127.0.0.1:${port}/query/`, {
		method: 'POST',
		headers: {
			'content-type': 'text/plain'
		},
		body: 'data.persons',
		signal: AbortSignal.timeout(5000)
	})
	if (!response.ok) {
		throw new Error(`Query failed with ${response.status}: ${await response.text()}`)
	}
	return JSONTag.parse(await response.text())
}

export async function getCommandStatus(port, commandId) {
	const response = await fetch(`http://127.0.0.1:${port}/command/${commandId}`, {
		headers: {
			accept: 'application/json'
		},
		signal: AbortSignal.timeout(5000)
	})
	if (!response.ok) {
		throw new Error(`Command status failed with ${response.status}: ${await response.text()}`)
	}
	return response.json()
}

async function readJsonTagLines(file) {
	let text
	try {
		text = await fs.readFile(file, 'utf8')
	} catch (error) {
		if (error.code === 'ENOENT') {
			return []
		}
		throw error
	}
	return text
		.split('\n')
		.filter(Boolean)
		.map(line => JSONTag.parse(line))
}

export async function readCommandStatusRecords(fixture) {
	return readJsonTagLines(fixture.commandStatus)
}

export async function readCommandLogRecords(fixture) {
	return readJsonTagLines(fixture.commandLog)
}

export async function reconstructCommittedDataset(fixture) {
	const statusRecords = await readCommandStatusRecords(fixture)
	const commandLogRecords = await readCommandLogRecords(fixture)
	const finalStatus = new Map()
	for (const record of statusRecords) {
		finalStatus.set(record.command, record.status)
	}

	const parser = new Parser()
	let data = parser.parse(await fs.readFile(fixture.datafile))
	const applied = new Set()
	for (const command of commandLogRecords) {
		if (applied.has(command.id) || finalStatus.get(command.id) !== 'done') {
			continue
		}
		data = parser.parse(await fs.readFile(getChangesetPath(fixture.datafile, command.id)))
		applied.add(command.id)
	}
	return data
}

export async function reconstructCommittedPersonNames(fixture) {
	const data = await reconstructCommittedDataset(fixture)
	return data.persons.map(person => person.name)
}
