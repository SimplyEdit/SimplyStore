// Test-only I/O observation/injection. Loaded explicitly in disposable servers.
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import {threadId} from 'node:worker_threads'
import {syncBuiltinESMExports} from 'node:module'

const configFile = process.env.SIMPLYSTORE_BASELINE_IO
if (configFile) {
	const config = JSON.parse(fs.readFileSync(configFile, 'utf8'))
	const root = path.resolve(config.root)
	const raw = Object.fromEntries(['open', 'write', 'fsync', 'close', 'rename',
		'appendFileSync', 'readFileSync', 'existsSync', 'statSync', 'writeFileSync']
		.map(key => [key, fs[key].bind(fs)]))
	const open = fsp.open.bind(fsp)
	const handles = new Map()
	let injected = false
	const scoped = file => typeof file === 'string' &&
		(file === root || file.startsWith(root + path.sep))
	function record(op, file, extra = {}) {
		if (scoped(file)) raw.appendFileSync(config.trace,
			JSON.stringify({op, file, threadId, ...extra}) + '\n')
	}
	function snapshot(file) {
		return raw.statSync(file).isDirectory() ? {} : {bytes: raw.readFileSync(file).toString('base64')}
	}
	async function fault(op, file, content = '') {
		const rule = config.fault
		if (injected || !rule || rule.op !== op || !scoped(file) ||
			!path.basename(file).startsWith(rule.file) ||
			(rule.contains && !content.includes(rule.contains))) return false
		injected = true
		record('injected', file, {operation: op, action: rule.action})
		if (rule.action === 'pause') {
			const deadline = Date.now() + 15000
			while (!raw.existsSync(config.release)) {
				if (Date.now() > deadline) throw new Error('Baseline gate was not released')
				await new Promise(resolve => setTimeout(resolve, 5))
			}
		} else if (rule.action === 'short-write') {
			return true
		} else {
			throw Object.assign(new Error(`Injected ${rule.code || 'EIO'} at ${op}`), {code: rule.code || 'EIO'})
		}
		return false
	}

	fsp.open = async function(file, ...args) {
		const absolute = path.resolve(String(file))
		const existed = raw.existsSync(absolute)
		const handle = await open(file, ...args)
		if (!scoped(absolute)) return handle
		record('open', absolute, {existed, flags: args[0]})
		let content = ''
		for (const method of ['appendFile', 'datasync', 'sync', 'close']) {
			const original = handle[method].bind(handle)
			handle[method] = async (...params) => {
				if (method === 'appendFile') content = String(params[0])
				await fault(method, absolute, content)
				const result = await original(...params)
				record(method, absolute, method === 'datasync' || method === 'sync'
					? snapshot(absolute) : {})
				await fault(method + ':after', absolute, content)
				return result
			}
		}
		return handle
	}
	fs.open = function(file, ...args) {
		const callback = args.pop()
		const absolute = path.resolve(String(file))
		const existed = raw.existsSync(absolute)
		return raw.open(file, ...args, (error, fd) => {
			if (!error && scoped(absolute)) {
				handles.set(fd, absolute)
				record('open', absolute, {existed, flags: args[0]})
			}
			callback(error, fd)
		})
	}
	fs.write = function(fd, ...args) {
		const callback = args.pop()
		const file = handles.get(fd)
		void fault('write', file).then(short => {
			if (short) {
				// The fixture targets write-file-atomic's Uint8Array overload.
				if (!ArrayBuffer.isView(args[0]) || typeof args[2] !== 'number') {
					throw new Error('Unsupported short-write fixture')
				}
				args[2] = Math.max(1, Math.floor(args[2] / 2))
			}
			raw.write(fd, ...args, (error, bytes, buffer) => {
				if (!error) record('write', file, {bytesWritten: bytes})
				callback(error, bytes, buffer)
			})
		}).catch(callback)
	}
	fs.fsync = function(fd, callback) {
		const file = handles.get(fd)
		void fault('fsync', file).then(() => raw.fsync(fd, error => {
			if (!error && scoped(file)) record('sync', file, snapshot(file))
			callback(error)
		})).catch(callback)
	}
	fs.close = function(fd, callback) {
		const file = handles.get(fd)
		return raw.close(fd, error => {
			if (!error) {
				record('close', file)
				handles.delete(fd)
			}
			callback(error)
		})
	}
	fs.rename = function(from, to, callback) {
		const file = path.resolve(String(to))
		void fault('rename', file).then(() => raw.rename(from, to, error => {
			if (!error) record('rename', file, {from: path.resolve(String(from))})
			callback(error)
		})).catch(callback)
	}
	fs.writeFileSync = function(file, ...args) {
		const result = raw.writeFileSync(file, ...args)
		record('writeFileSync', path.resolve(String(file)))
		return result
	}
	syncBuiltinESMExports()
}
