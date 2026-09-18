import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import {fileURLToPath} from 'node:url'
import JSONTag from '@muze-nl/jsontag'
import Parser from '@muze-nl/od-jsontag'
import serialize from '@muze-nl/od-jsontag/src/serialize.mjs'
import runCommand, {initialize} from '../src/command-worker-module.mjs'

const baseIndex = new URL('../src/index.mjs', import.meta.url)

async function fixture(t, indexSource) {
	const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'simplystore-command-offset-'))
	t.after(() => fs.rm(dir, {recursive: true, force: true}))
	const commandsFile = path.join(dir, 'commands.mjs')
	await fs.writeFile(commandsFile, `export default {
	edit(data, command) { data.items[command.item || 0].name = command.value },
	add(data, command) { data.items.push(command.value) },
	noop() {}
}`)
	let indexFile = fileURLToPath(baseIndex)
	if (indexSource) {
		indexFile = path.join(dir, 'index.mjs')
		await fs.writeFile(indexFile, indexSource)
	}
	const base = serialize(JSONTag.parse('{"items":[{"name":"first"},{"name":"untouched"}]}'))
	const task = {
		data: [base], datafile: path.join(dir, 'data.jsontag'), commandsFile, indexFile,
		meta: {data: dir, parts: 0, index: {id: new Map()}, resultArray: []}
	}
	await initialize(task)
	return {dir, base, task}
}

async function verifyOffsets(dir, id) {
	const bytes = await fs.readFile(path.join(dir, `data.${id}.jsontag`))
	const stored = JSON.parse(await fs.readFile(path.join(dir, `index.offset.${id}.json`), 'utf8'))
	const expected = {}
	// Independent oracle: read record lengths and skips directly from disk bytes.
	let cursor = 0, record = 0
	while (cursor < bytes.length) {
		const header = bytes.subarray(cursor, cursor + 32).toString('ascii')
		const skip = /^\+(\d+)/.exec(header)
		if (skip) {
			record += Number(skip[1])
			cursor += skip[0].length
		} else {
			const length = /^\((\d+)\)/.exec(header)
			assert.ok(length, `record ${record} has valid framing`)
			const start = cursor + length[0].length
			cursor = start + Number(length[1])
			assert.ok(cursor <= bytes.length)
			expected[record++] = [start, cursor]
		}
		if (cursor < bytes.length) assert.equal(bytes[cursor++], 10)
	}
	assert.deepEqual(stored, expected)
	return {bytes, offsets: stored}
}

function replay(base, ...changesets) {
	const parser = new Parser('')
	let data = parser.parse(base)
	for (const bytes of changesets) data = parser.parse(bytes)
	return data
}

test('command edit indexes only its changed record using changeset UTF-8 offsets', async t => {
	const {dir, base} = await fixture(t)
	const value = 'caf\u00e9 \u6f22\u5b57 \ud83d\ude00 with a longer name'
	await runCommand(JSONTag.stringify({id: 'edit', name: 'edit', value}))
	const {bytes, offsets} = await verifyOffsets(dir, 'edit')
	assert.deepEqual(Object.keys(offsets), ['1'])
	assert.match(bytes.toString('utf8'), /^\+1\n/)
	assert.equal(JSON.parse(bytes.subarray(...offsets[1]).toString('utf8')).name, value)
	assert.equal(replay(base, bytes).items[0].name, value)
})

test('command addition indexes new entities and preserves interior skip numbers', async t => {
	const {dir, base} = await fixture(t)
	await runCommand(JSONTag.stringify({id: 'add', name: 'add', value: {name: 'new entity'}}))
	const {bytes, offsets} = await verifyOffsets(dir, 'add')
	assert.deepEqual(Object.keys(offsets), ['0', '3'])
	assert.match(bytes.toString('utf8'), /\n\+2\n/)
	assert.equal(JSON.parse(bytes.subarray(...offsets[3]).toString('utf8')).name, 'new entity')
	assert.deepEqual(replay(base, bytes).items.map(e => e.name), ['first', 'untouched', 'new entity'])
})

test('command offsets include mutations and new records introduced by the index hook', async t => {
	const {dir, base} = await fixture(t, `import index from ${JSON.stringify(baseIndex.href)}
export default {
	update(data, meta, changes) {
		index.update(data, meta, changes)
		data.items[1].name = 'x'
		data.items.push({name: 'derived by index'})
	}
}`)
	await runCommand(JSONTag.stringify({id: 'hook', name: 'edit', value: 'longer command value'}))
	const {bytes, offsets} = await verifyOffsets(dir, 'hook')
	assert.deepEqual(Object.keys(offsets), ['0', '1', '2', '3'])
	assert.deepEqual(replay(base, bytes).items.map(e => e.name), ['longer command value', 'x', 'derived by index'])
})

test('successive command indexes are relative to their own changeset files', async t => {
	const {dir, base, task} = await fixture(t)
	await runCommand(JSONTag.stringify({id: 'first', name: 'edit', value: 'longer first value'}))
	const first = await verifyOffsets(dir, 'first')
	await initialize({...task, data: [base, first.bytes], meta: {data: dir, parts: 1, index: {id: new Map()}, resultArray: []}})
	await runCommand(JSONTag.stringify({id: 'second', name: 'edit', item: 1, value: 'x'}))
	const second = await verifyOffsets(dir, 'second')
	assert.deepEqual(Object.keys(second.offsets), ['2'])
	assert.match(second.bytes.toString('utf8'), /^\+2\n/)
	assert.deepEqual(replay(base, first.bytes, second.bytes).items.map(e => e.name), ['longer first value', 'x'])
	assert.deepEqual((await verifyOffsets(dir, 'first')).offsets, first.offsets)
})

test('no-op commands replace any stale sidecar with an empty offset index', async t => {
	const {dir} = await fixture(t)
	await fs.writeFile(path.join(dir, 'index.offset.noop.json'), '{"99":[0,100]}')
	await runCommand('{"id":"noop","name":"noop"}')
	const {bytes, offsets} = await verifyOffsets(dir, 'noop')
	assert.equal(bytes.length, 0)
	assert.deepEqual(offsets, {})
})

test('failure to write final offsets rejects the command before success', async t => {
	const {dir} = await fixture(t, 'export default {update() {}}')
	await fs.mkdir(path.join(dir, 'index.offset.blocked.json'))
	await assert.rejects(runCommand('{"id":"blocked","name":"edit","value":"changed"}'), /EISDIR|EEXIST|ENOTEMPTY/)
})

test('commands await custom finalization that delegates to the default index', async t => {
	const {dir} = await fixture(t, `import index from ${JSON.stringify(baseIndex.href)}
import fs from 'node:fs/promises'
import {setTimeout} from 'node:timers/promises'
export default {
	marker: 'custom receiver',
	update(data) { data.items[1].name = 'index mutation' },
	async finalize(serialized, meta, uuid) {
		await setTimeout(20)
		if (!(serialized instanceof Uint8Array) || uuid !== 'custom') throw new Error('wrong finalizer arguments')
		await index.finalize(serialized, meta, uuid)
		await fs.writeFile(meta.data + '/finalized.json', JSON.stringify({marker: this.marker, uuid}))
	}
}`)
	await runCommand('{"id":"custom","name":"edit","value":"command mutation"}')
	const {offsets} = await verifyOffsets(dir, 'custom')
	assert.deepEqual(Object.keys(offsets), ['1', '2'])
	assert.deepEqual(JSON.parse(await fs.readFile(path.join(dir, 'finalized.json'), 'utf8')), {marker: 'custom receiver', uuid: 'custom'})
})

test('custom finalization can replace the default without an unconditional offset write', async t => {
	const {dir} = await fixture(t, `import fs from 'node:fs/promises'
export default {
	update() {},
	async finalize(serialized, meta, uuid) {
		await fs.writeFile(meta.data + '/custom.' + uuid, serialized)
	}
}`)
	await runCommand('{"id":"replacement","name":"edit","value":"changed"}')
	assert.deepEqual(await fs.readFile(path.join(dir, 'custom.replacement')), await fs.readFile(path.join(dir, 'data.replacement.jsontag')))
	await assert.rejects(fs.access(path.join(dir, 'index.offset.replacement.json')), /ENOENT/)
})

test('custom finalization rejection propagates from the command worker', async t => {
	const {dir} = await fixture(t, 'export default {update() {}, async finalize() { throw new Error("custom finalization failed") }}')
	await assert.rejects(runCommand('{"id":"rejected","name":"edit","value":"changed"}'), /custom finalization failed/)
	await assert.rejects(fs.access(path.join(dir, 'index.offset.rejected.json')), /ENOENT/)
})
