import JSONTag from '@muze-nl/jsontag'
import serialize, { stringify } from '@muze-nl/od-jsontag/src/serialize.mjs'
import fs from 'node:fs'

if (process.argv.length<=3) {
	console.log('usage: node ./convert.mjs {inputfile} {outputfile}')
	process.exit()
}

// parse command line
let inputFile = process.argv[2]
let outputFile = process.argv[3]

// load file
let input = fs.readFileSync(inputFile, 'utf-8')

// parse jsontag
let data = JSONTag.parse(input)

// write resultset to output
let strData = stringify(serialize(data))

fs.writeFileSync(outputFile, strData)

console.log('Converted data written to ',outputFile)
