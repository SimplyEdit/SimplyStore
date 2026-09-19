import test from 'node:test'
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import Parser from '@muze-nl/od-jsontag'

const run = promisify(execFile)
const converter = fileURLToPath(new URL('../scripts/convert.mjs', import.meta.url))
const baseIndex = new URL('../src/index.mjs', import.meta.url).href

async function fixture(t) {
	const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'simplystore-convert-'))
	t.after(() => fs.rm(dir, {recursive: true, force: true}))
	const input = path.join(dir, 'input.jsontag')
	const output = path.join(dir, 'data.jsontag')
	await fs.writeFile(input, '{"items":[<object id="/first">{"name":"first"},<object id="/second">{"name":"a long original name"}]}')
	return {dir, input, output}
}

async function convert({input, output}, indexFile) {
	await run(process.execPath, [converter, input, output, ...indexFile ? [indexFile] : []], {timeout: 10000})
}

async function verifyOffsets({dir, output}) {
	const bytes = await fs.readFile(output)
	const offsets = JSON.parse(await fs.readFile(path.join(dir, 'index.offset.json'), 'utf8'))
	const payloads = []
	let cursor = 0
	// Derive byte ranges directly from disk framing, independently of Parser.meta.
	while (cursor < bytes.length) {
		const match = /^\((\d+)\)/.exec(bytes.subarray(cursor, cursor + 32).toString('ascii'))
		assert.ok(match, `record ${payloads.length} has a length prefix`)
		const start = cursor + match[0].length
		const end = start + Number(match[1])
		assert.ok(end <= bytes.length, 'record ends within the file')
		assert.deepEqual(offsets[payloads.length], [start, end], `record ${payloads.length} byte range`)
		payloads.push(bytes.subarray(...offsets[payloads.length]).toString('utf8'))
		cursor = end
		if (cursor < bytes.length) {
			assert.equal(bytes[cursor], 10, 'records separated by a newline')
			cursor++
		}
	}
	assert.equal(Object.keys(offsets).length, payloads.length, 'no missing or extra offsets')
	return {payloads, data: new Parser('').parse(bytes.toString('utf8'))}
}

test('default conversion offsets match every final record', async t => {
	const files = await fixture(t)
	await convert(files)
	const {payloads, data} = await verifyOffsets(files)
	assert.equal(payloads.length, 3)
	assert.equal(data.items[1].name, 'a long original name')
	const ids = JSON.parse(await fs.readFile(path.join(files.dir, 'index.id.json'), 'utf8'))
	assert.match(payloads[ids['/first']], /id="\/first"/)
	assert.match(payloads[ids['/second']], /id="\/second"/)
})

test('conversion finalizes offsets after custom indexing changes record sizes and adds records', async t => {
	const files = await fixture(t)
	const indexFile = path.join(files.dir, 'index.mjs')
	await fs.writeFile(indexFile, `import index from ${JSON.stringify(baseIndex)}
export default {
	create(data, meta) {
		index.create(data, meta)
		data.items[0].name = 'caf\\u00e9 \\u6f22\\u5b57 \\ud83d\\ude00 with a much longer derived name'
		Object.defineProperty(data.items[0], 'derived', {value: [data.items[1]], enumerable: false, configurable: true, writable: true})
		data.items[1].name = 'x'
		data.items.push({name: 'new derived record'})
	}
}
`)
	await convert(files, indexFile)
	const {payloads, data} = await verifyOffsets(files)
	assert.equal(payloads.length, 4)
	assert.equal(data.items[0].name, 'caf\u00e9 \u6f22\u5b57 \ud83d\ude00 with a much longer derived name')
	assert.equal(data.items[0].derived[0].name, 'x')
	assert.equal(Object.getOwnPropertyDescriptor(data.items[0], 'derived').enumerable, false)
	assert.equal(data.items[2].name, 'new derived record')
	assert.match(payloads[3], /new derived record/)
})

test('conversion replaces stale offsets even when the custom hook writes no index', async t => {
	const files = await fixture(t)
	const indexFile = path.join(files.dir, 'index.mjs')
	await fs.writeFile(indexFile, 'export default Object.freeze({ create(data) { data.items[0].name = "changed" } })\n')
	await fs.writeFile(path.join(files.dir, 'index.offset.json'), '{"0":[0,1],"99":[2,3]}')
	await convert(files, indexFile)
	const {payloads, data} = await verifyOffsets(files)
	assert.equal(payloads.length, 3)
	assert.equal(data.items[0].name, 'changed')
})

test('conversion awaits custom finalization with the original receiver and final bytes', async t => {
	const files = await fixture(t)
	const indexFile = path.join(files.dir, 'index.mjs')
	await fs.writeFile(indexFile, `import index from ${JSON.stringify(baseIndex)}
import fs from 'node:fs/promises'
import {setTimeout} from 'node:timers/promises'
export default {
	marker: 'custom receiver',
	create(data) { data.items[0].name = 'final value' },
	async finalize(serialized, meta, uuid) {
		await setTimeout(20)
		if (uuid !== null || typeof serialized !== 'string' || !serialized.includes('final value')) throw new Error('wrong finalizer arguments')
		await index.finalize(serialized, meta, uuid)
		await fs.writeFile(meta.data + '/finalized.json', JSON.stringify({marker: this.marker, uuid}))
	}
}
`)
	await convert(files, indexFile)
	await verifyOffsets(files)
	assert.deepEqual(JSON.parse(await fs.readFile(path.join(files.dir, 'finalized.json'), 'utf8')), {marker: 'custom receiver', uuid: null})
})

test('conversion propagates rejection from custom finalization', async t => {
	const files = await fixture(t)
	const indexFile = path.join(files.dir, 'index.mjs')
	await fs.writeFile(indexFile, 'export default {create() {}, async finalize() { throw new Error("custom finalization failed") }}\n')
	await assert.rejects(convert(files, indexFile), /custom finalization failed/)
	await assert.rejects(fs.access(path.join(files.dir, 'index.offset.json')), /ENOENT/)
})

test('conversion initializes existing-format logs and optional base integrity without overwriting a store',async t=>{
	const files=await fixture(t)
	await run(process.execPath,[converter,files.input,files.output,'--integrity'],{timeout:10000})
	const {loadIntegrityManifest,verifyIntegrity}=await import('../src/integrity.mjs')
	const integrity=path.join(files.dir,'data.integrity.jsontag')
	assert.equal(verifyIntegrity(await loadIntegrityManifest(integrity),integrity,files.output,await fs.readFile(files.output),{required:true}),true)
	assert.equal(await fs.readFile(path.join(files.dir,'command-log.jsontag'),'utf8'),'')
	assert.equal(await fs.readFile(path.join(files.dir,'command-status.jsontag'),'utf8'),'')
	const before=await fs.readFile(files.output)
	await assert.rejects(convert(files),/existing store is not overwritten/)
	assert.deepEqual(await fs.readFile(files.output),before)
})
