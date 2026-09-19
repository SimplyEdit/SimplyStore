import { Buffer } from 'node:buffer'
import process from 'node:process'
import JSONTag from '@muze-nl/jsontag'
import serialize, { stringify } from '@muze-nl/od-jsontag/src/serialize.mjs'
import Parser from '@muze-nl/od-jsontag'
import { finalizeIndex } from '../src/index.mjs'
import fs from 'node:fs'
import path from 'node:path'
import { publishFile, syncFile } from '../src/storage.mjs'
import { acquireOwnership } from '../src/store-ownership.mjs'
import {
	appendIntegrityRecord,
	getDefaultIntegrityFile
} from '../src/integrity.mjs'

const __dirname = import.meta.dirname

const integrity = process.argv.includes('--integrity')
const args = process.argv.slice(2).filter(value => value !== '--integrity')
if (args.length < 2) {
	console.log(
		'usage: node ./convert.mjs {inputfile} {outputfile} {indexlib?} {schema?} [--integrity]'
	)
	process.exit()
}

// parse command line
let inputFile = args[0]
let outputFile = args[1]
let indexFile = args[2]
if (indexFile && indexFile[0] != '/') {
	indexFile = process.cwd() + '/' + indexFile
}
else if (!indexFile) {
	indexFile = __dirname + '/../src/index.mjs'
}
let schemaFile = args[3]
if (schemaFile && schemaFile[0] != '/') {
	schemaFile = process.cwd() + '/' + schemaFile
}

async function main() {
	const directory = path.resolve(path.dirname(outputFile))
	const logs = ['command-log.jsontag', 'command-status.jsontag'].map(name =>
		path.join(directory, name)
	)
	const ownership = await acquireOwnership([directory])
	if (
		[outputFile, ...logs, getDefaultIntegrityFile(outputFile)].some(file =>
			fs.existsSync(file)
		)
	) {
		await ownership.release()
		throw new Error(
			'Conversion requires new output files; existing store is not overwritten'
		)
	}
	// now create indexes
	console.log('Using index library:', indexFile)

	const index = await import(indexFile).then(mod => {
		return mod.default
	})

	let schema = {}
	if (schemaFile) {
		schema = JSONTag.parse(fs.readFileSync(schemaFile, 'utf-8'))
	}

	// load file
	let input = fs.readFileSync(inputFile, 'utf-8')

	// parse jsontag
	let data = JSONTag.parse(input)

	console.log('input data parsed')
	// write resultset to output
	let strData = stringify(serialize(data))

	console.log('od-jsontag created')

	// indexes need the position data which is only available after
	// parsing the od-jsontag data
	const parser = new Parser('', false) // allow mutations
	const odData = parser.parse(strData)

	let meta = {
		index: {
			id: new Map()
		},
		schema,
		resultArray: parser.meta.resultArray,
		data: path.dirname(outputFile)
	}
	for (const ob of meta.resultArray) {
		meta.index.id.set(JSONTag.getAttribute(ob, 'id'), ob)
	}

	await index.create(odData, meta)
	console.log('Indexes created')

	strData = stringify(serialize(odData))

	await publishFile(outputFile, strData)
	// Custom indexes may change record sizes or add records after initial
	// parsing.
	await finalizeIndex(index, strData, meta)
	if (integrity) {
		await appendIntegrityRecord(
			getDefaultIntegrityFile(outputFile),
			outputFile,
			Buffer.from(strData)
		)
	}
	for (const file of logs) {
		await publishFile(file, '')
	}
	for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
		if (entry.isFile()) {
			await syncFile(path.join(directory, entry.name))
		}
	}
	await ownership.release()
	console.log('Converted data written to ', outputFile)
}

main()
