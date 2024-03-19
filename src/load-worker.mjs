import { parentPort } from 'node:worker_threads'
import JSONTag from '@muze-nl/jsontag'
import parse from '@muze-nl/od-jsontag/src/parse.mjs'
import fs from 'fs'
import serialize from '@muze-nl/od-jsontag/src/serialize.mjs'
import {source, resultSet} from '@muze-nl/od-jsontag/src/symbols.mjs'

parentPort.on('message', datafile => {
	const jsontag = fs.readFileSync(datafile)
	let meta = {
		index: {
			id: new Map()
		}
	}
	const data = parse(jsontag)
	const resultArr = data[resultSet]

	// od-jsontag/parse doesn't create meta.index.id, so do that here
	let length = resultArr.length
	for (let i=0; i<length; i++) {
		let id=JSONTag.getAttribute(resultArr[i][source],'id')
		if (id) {
			meta.index.id.set(id,i)
		}
	}

	const sab = serialize(data)

	parentPort.postMessage({
		data: sab,
		meta
	})
})