import JSONTag from '@muze-nl/jsontag'
import serialize, { stringify } from '@muze-nl/od-jsontag/src/serialize.mjs'
import Parser from '@muze-nl/od-jsontag'
import fs from 'node:fs'
import path from 'node:path'

const __dirname = import.meta.dirname;

if (process.argv.length<=3) {
	console.log('usage: node ./convert.mjs {inputfile} {outputfile} {indexlib?}')
	process.exit()
}

// parse command line
let inputFile = process.argv[2]
let outputFile = process.argv[3]
let indexFile = process.argv[4]
if (indexFile && indexFile[0]!='/') {
	indexFile = process.cwd()+'/'+indexFile
} else if (!indexFile) {
	indexFile = __dirname+'/../src/index.mjs'
}
let schemaFile = process.argv[5]
if (schemaFile && schemaFile[0]!='/') {
	schemaFile = process.cwd()+'/'+schemaFile
}

async function main() {
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
	const parser = new Parser('',false) // allow mutations
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

	index.create(odData, meta)
	console.log('Indexes created')

	strData = stringify(serialize(odData))

	fs.writeFileSync(outputFile, strData)
	console.log('Converted data written to ',outputFile)
}

main()