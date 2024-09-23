import { parentPort } from 'node:worker_threads'
import JSONTag from '@muze-nl/jsontag'
import parse from '@muze-nl/od-jsontag/src/parse.mjs'
import fs from 'fs'
import serialize from '@muze-nl/od-jsontag/src/serialize.mjs'

parentPort.on('message', (files) => {
	let meta = {
		index: {
			id: new Map()
		}
	}

	let count = 0
	let basefile = files.dataFile
	let data
	let jsontag
	let tempMeta = {}
	let datafile = files.dataFile
	do {
		jsontag = fs.readFileSync(datafile)
		data = parse(jsontag, tempMeta) // tempMeta is needed to combine the resultArray, using meta conflicts with meta.index.id
		count++
		datafile = basefile + '.' + count
	} while(fs.existsSync(datafile))
	meta.parts = count
	if (files.schemaFile) {
		jsontag = fs.readFileSync(files.schemaFile, 'utf-8')
		meta.schema = JSONTag.parse(jsontag, null, tempMeta)
	}

	const sab = serialize(data, {meta})

	parentPort.postMessage({
		data: sab,
		meta
	})

})