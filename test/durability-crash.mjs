import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import fs from 'node:fs/promises'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import JSONTag from '@muze-nl/jsontag'
import serialize from '@muze-nl/od-jsontag/src/serialize.mjs'
import { assertRuntimeEnvironmentConfiguration, getRuntimeEnvironment } from '../src/runtime-environment.mjs'

const rootDir = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const serverModule = path.join(rootDir, 'src/server.mjs')

async function getOpenPort() {
	const probe = net.createServer()
	await new Promise((resolve, reject) => {
		probe.once('error', reject)
		probe.listen(0, '127.0.0.1', resolve)
	})
	const port = probe.address().port
	await new Promise(resolve => probe.close(resolve))
	return port
}

async function makeServerFixture(t) {
	const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'simplystore-crash-'))
	t.after(() => fs.rm(dir, {recursive: true, force: true}))

	const datafile = path.join(dir, 'data.jsontag')
	const commandsFile = path.join(dir, 'commands.mjs')
	const indexFile = path.join(dir, 'index.mjs')
	const commandLog = path.join(dir, 'command-log.jsontag')
	const commandStatus = path.join(dir, 'command-status.jsontag')
	const runner = path.join(dir, 'run-server.mjs')

	await fs.writeFile(datafile, serialize(JSONTag.parse('{"persons":[]}')))
	await fs.writeFile(commandsFile, `export default {
	addPerson: (dataspace, command) => {
		dataspace.persons.push(command.value)
	}
}
`)
	await fs.writeFile(indexFile, 'export default { create() {}, update() {}, load() { return {} } }\n')
	await fs.writeFile(runner, `import SimplyStore from ${JSON.stringify(serverModule)}

const options = JSON.parse(process.env.SIMPLYSTORE_TEST_OPTIONS)
SimplyStore.run(options)
`)

	return {dir, datafile, commandsFile, indexFile, commandLog, commandStatus, runner}
}

function startServer(t, fixture, options = {}) {
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
				maxWorkers: 1
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

	const stop = () => {
		if (!child.killed && child.exitCode === null) {
			child.kill('SIGTERM')
		}
	}
	t.after(stop)

	return {child, getOutput: () => output}
}

async function waitForServer(child, getOutput, port) {
	await new Promise((resolve, reject) => {
		const timeout = setTimeout(() => {
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

async function waitForExit(child) {
	return new Promise(resolve => {
		if (child.exitCode !== null || child.signalCode) {
			resolve({code: child.exitCode, signal: child.signalCode})
			return
		}
		child.once('exit', (code, signal) => resolve({code, signal}))
	})
}

async function postCommand(port, command) {
	return fetch(`http://127.0.0.1:${port}/command`, {
		method: 'POST',
		headers: {
			accept: 'application/json',
			'content-type': 'application/jsontag'
		},
		body: JSONTag.stringify(command)
	})
}

async function queryPersons(port) {
	const response = await fetch(`http://127.0.0.1:${port}/query/`, {
		method: 'POST',
		headers: {
			'content-type': 'text/plain'
		},
		body: 'data.persons'
	})
	if (!response.ok) {
		throw new Error(`Query failed with ${response.status}: ${await response.text()}`)
	}
	return JSONTag.parse(await response.text())
}

test('runtime environment defaults to production and rejects production fault points', () => {
	assert.equal(getRuntimeEnvironment({}), 'production')
	assert.throws(
		() => assertRuntimeEnvironmentConfiguration({SIMPLYSTORE_FAULT_POINT: 'before-command-done-status'}),
		/SIMPLYSTORE_FAULT_POINT is only allowed/
	)
	assert.doesNotThrow(() => assertRuntimeEnvironmentConfiguration({
		SIMPLYSTORE_ENV: 'test',
		SIMPLYSTORE_FAULT_POINT: 'before-command-done-status'
	}))
})

test('crash before done status replays accepted command on restart', async t => {
	const fixture = await makeServerFixture(t)
	const port = await getOpenPort()
	const first = startServer(t, fixture, {
		port,
		runtimeEnvironment: 'test',
		faultPoint: 'before-command-done-status'
	})
	await waitForServer(first.child, first.getOutput, port)

	try {
		const response = await postCommand(port, {
			id: 'crash-before-done',
			name: 'addPerson',
			value: {name: 'Ada'}
		})
		assert.equal(response.status, 202)
	} catch (error) {
		assert.match(error.message, /fetch failed|terminated|socket|other side closed/i)
	}

	const crash = await waitForExit(first.child)
	assert.equal(crash.signal, 'SIGKILL')

	const changeset = path.join(fixture.dir, 'data.crash-before-done.jsontag')
	await assert.doesNotReject(fs.access(changeset), 'command worker wrote a changeset before the injected crash')

	const second = startServer(t, fixture, {port})
	await waitForServer(second.child, second.getOutput, port)

	const persons = await queryPersons(port)
	assert.deepEqual(persons.map(person => person.name), ['Ada'])

	const statusFile = await fs.readFile(fixture.commandStatus, 'utf8')
	assert.match(statusFile, /"status":"done"/)
})
