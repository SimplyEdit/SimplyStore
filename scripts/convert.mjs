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
let indexFile = process.argv[4] || __dirname+'/../src/index.mjs'

async function main() {
	// load file
	let input = fs.readFileSync(inputFile, 'utf-8')

	// parse jsontag
	let data = JSONTag.parse(input)

	// write resultset to output
	let strData = stringify(serialize(data))
	fs.writeFileSync(outputFile, strData)
	console.log('Converted data written to ',outputFile)

	// now create indexes
	console.log('Using index library:', indexFile)
	const index = await import(indexFile).then(mod => {
	    return mod.default
	})

	// indexes need the position data which is only available after
	// parsing the od-jsontag data
	const parser = new Parser()
	const odData = parser.parse(strData)

	let meta = {
		index: {
			id: new Map()
		},
		resultArray: parser.meta.resultArray,
		data: path.dirname(outputFile)
	}
	for (const ob of meta.resultArray) {
		meta.index.id.set(JSONTag.getAttribute(ob, 'id'), ob)
	}

	index.create(odData, meta)
	console.log('Indexes created')
}

main()