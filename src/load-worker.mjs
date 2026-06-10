import { parentPort } from 'node:worker_threads'
import JSONTag from '@muze-nl/jsontag'
import Parser from '@muze-nl/od-jsontag/src/parse.mjs'
import fs from 'fs'
import path from 'path'
import serialize from '@muze-nl/od-jsontag/src/serialize.mjs'

const parser = new Parser()
let index = {}

parentPort.on('message', async (files) => {
	let meta = {
		index: {
			id: new Map()
		}
	}

    index = await import(files.indexFile).then(mod => {
        return mod.default
    })
	const extension = files.dataFile.split('.').pop()
	const basefile = files.dataFile.substring(0, files.dataFile.length - (extension.length + 1)) //+1 for . character
	meta.data = path.dirname(basefile)
	let count = 0
	let data
	let jsontag
	let datafile = files.dataFile
	let commands = files.commands
	commands.push('done')
	// TODO
	// - only load index files
	// - for each command id
	// - load files as raw bytes
	// - index.id.*.jsontag and index.offset.*.jsontag to create proxies that will get the correct offset on access
	// - do the same for resultSet[0] - the dataspace root entity
	// don't parse entire files with od-jsontag
	// add version info in proxies with a symbol to get that information
	do {
		if (fs.existsSync(datafile)) {
			jsontag = fs.readFileSync(datafile)
			data = parser.parse(jsontag)
			count++
		}
		datafile = basefile + '.' + commands.shift() + '.' + extension
	} while(commands.length)
	if (files.schemaFile) {
		jsontag = fs.readFileSync(files.schemaFile, 'utf-8')
		meta.schema = JSONTag.parse(jsontag)
	}

	const sab = serialize(data, {meta})

	parentPort.postMessage({
		data: sab,
		meta
	})

})