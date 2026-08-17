import { parentPort } from 'node:worker_threads'
import JSONTag from '@muze-nl/jsontag'
import Parser from '@muze-nl/od-jsontag/src/parse.mjs'
import fs from 'fs'
import path from 'path'
import serialize from '@muze-nl/od-jsontag/src/serialize.mjs'
import { assertChangesetExists, assertOdJsonTagFraming } from './recovery.mjs'

const parser = new Parser()

parentPort.on('message', async (files) => {
	let meta = {
		index: {
			id: new Map()
		}
	}

    await import(files.indexFile)
	const extension = files.dataFile.split('.').pop()
	const basefile = files.dataFile.substring(0, files.dataFile.length - (extension.length + 1)) //+1 for . character
	meta.data = path.dirname(basefile)
	let data
	let jsontag
	// TODO
	// - only load index files
	// - for each command id
	// - load files as raw bytes
	// - index.id.*.jsontag and index.offset.*.jsontag to create proxies that will get the correct offset on access
	// - do the same for resultSet[0] - the dataspace root entity
	// don't parse entire files with od-jsontag
	// add version info in proxies with a symbol to get that information
	if (fs.existsSync(files.dataFile)) {
		jsontag = fs.readFileSync(files.dataFile)
		assertOdJsonTagFraming(jsontag, files.dataFile, 'base OD-JSONTag data')
		data = parser.parse(jsontag)
	}
	for (let command of files.commands) {
		const changesetFile = assertChangesetExists(files.dataFile, command)
		jsontag = fs.readFileSync(changesetFile)
		assertOdJsonTagFraming(jsontag, changesetFile, 'changeset OD-JSONTag data')
		data = parser.parse(jsontag)
	}
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
