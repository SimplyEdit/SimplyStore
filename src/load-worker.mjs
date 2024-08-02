import { parentPort } from 'node:worker_threads'
import parse from '@muze-nl/od-jsontag/src/parse.mjs'
import fs from 'fs'
import serialize from '@muze-nl/od-jsontag/src/serialize.mjs'

parentPort.on('message', datafile => {
	let meta = {
		index: {
			id: new Map()
		}
	}

	let count = 0
	let basefile = datafile
	let data 
	let jsontag
	let tempMeta = {}

	do {
		jsontag = fs.readFileSync(datafile)
		data = parse(jsontag, tempMeta) // tempMeta is needed to combine the resultArray, using meta conflicts with meta.index.id
		count++
		datafile = basefile + '.' + count
	} while(fs.existsSync(datafile))
	meta.parts = count

	const sab = serialize(data, {meta})

	parentPort.postMessage({
		data: sab,
		meta
	})

})