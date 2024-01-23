import { parentPort } from 'node:worker_threads'
import JSONTag from '@muze-nl/jsontag'
import fs from 'fs'
import stringify from './fastStringify.mjs'

parentPort.on('message', datafile => {
//	console.log('loading jsontag hier')
	const jsontag = fs.readFileSync(datafile, 'utf-8')
	let meta = {}
	const data = JSONTag.parse(jsontag, meta)
	const encoder = new TextEncoder()
	let strData = stringify(data)
	let buffer = encoder.encode(strData)

	const sab = new SharedArrayBuffer(buffer.length)
	let uint8sab = new Uint8Array(sab)
	uint8sab.set(buffer,0)
	parentPort.postMessage(uint8sab)
})