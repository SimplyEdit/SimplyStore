import { parentPort } from 'node:worker_threads'
import JSONTag from '@muze-nl/jsontag'
import fastParse from './fastParse.mjs'
import fs from 'fs'
import {resultSetStringify,stringToSAB} from './fastStringify.mjs'
import {source} from '../src/symbols.mjs'

parentPort.on('message', datafile => {
	const jsontag = fs.readFileSync(datafile)
	let meta = {
		index: {
			id: new Map()
		}
	}
	const data = fastParse(jsontag)

	// fastParse doesn't create meta.index.id, so do that here
	let length = data.length
	for (let i=0; i<length; i++) {
		let id=JSONTag.getAttribute(data[i][source],'id')
		if (id) {
			meta.index.id.set(id,i)
		}
	}

	const strData = resultSetStringify(data)
	const sab = stringToSAB(strData)

	parentPort.postMessage({
		data: sab,
		meta
	})
})