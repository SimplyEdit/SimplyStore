import express from 'express'
import fs from 'fs'
import pointer from 'json-pointer'
import JSONTag from '@muze-nl/jsontag'
import {JSONPath} from 'jsonpath-plus'
import jsonExt from '@discoveryjs/json-ext'
const {parseChunked} = jsonExt
import TripleStore from './triplestore.mjs'
import {VM} from 'vm2'

const server    = express()
const port      = process.env.NODE_PORT || 3000;

const datafile  = process.env.DATAFILE || 'data.jsontag'
const stream    = fs.createReadStream(datafile)

async function main() {

	const originalJSON = JSON
	JSON = JSONTag // monkeypatching

	console.log('loading data...')
	let dataspace = await parseChunked(stream)
	console.log('indexing data...')
	let tripleStore = new TripleStore(dataspace)

	let used = Math.round(process.memoryUsage().heapUsed / 1024 / 1024);
	console.log(`data loaded (${used} MB)`);

	// allow access to raw body, used to parse a query send as post body
	server.use(express.raw({
		type: (req) => true // parse body on all requests
	}))

	server.get('/query/*', (req, res, next) => 
	{
		let start = Date.now()
		let accept = req.accepts(['application/jsontag','application/json','text/html','text/javascript','image/*'])
		if (!accept) {
			res.status(406)
			res.send("<h1>406 Unacceptable</h1>\n")
			return
		}
		switch(accept) {
			case 'text/html':
			case 'image/*':
			case 'text/javascript':
				handleWebRequest(req,res);
				return 
			break
		}

		let path = req.path.substr(6); // cut '/query'
		if (!path) {
			path = '';
		}
		if (path.substring(path.length-1)==='/') {
			//jsonpointer doesn't allow a trailing '/'
			path = path.substring(0, path.length-1)
		}
		let result
		if (path) {
			//jsonpointer doesn't allow an empty pointer
			try {
				if (pointer.has(dataspace, path)) {
					result = pointer.get(dataspace, path)
				} else {
					result = JSONTag.parse('<object class="Error">{"message":"Not found", "code":404}')
				}
			} catch(err) {
				result = JSONTag.parse('<object class="Error">{"message":'+originalJSON.stringify(err.message)+', "code":500}')
			}
		} else {
			result = dataspace
		}
		if (JSONTag.getAttribute(result, 'class')==='Error') {
			res.status(result.code)
		}
		result = linkReplacer(result, path+'/')
		if (req.accepts('application/jsontag')) {
			res.setHeader('content-type','application/jsontag+json')
			res.send(JSONTag.stringify(result, null, 4)+"\n")
		} else {
			res.setHeader('content-type','application/json')
			res.send(originalJSON.stringify(result, null, 4)+"\n")
		}
		let end = Date.now()
		console.log(path, (end-start))
	})

	/**
	 * handle queries, query is the post body
	 */
	server.post('/query/*',  (req, res) => {
		let start = Date.now()
		function parseParams(paramsString) {
			let result = {}
			let lineRe = /^(.*)$/m
			let parseRe = /^\s*([a-z].*?)?\s*(\{)?\s*$/i
			let line = lineRe.exec(paramsString).pop()
			let full, prop, recurse
			do {
				paramsString = paramsString.substring(line.length+1)
				let parsed = parseRe.exec(line)
				if (parsed) {
					[full,prop,recurse] = parsed
				}
				if (recurse) {
					[ result[prop], paramsString ] = parseParams(paramsString)
				} else if (prop) {
					result[prop] = ''
				} else if (/\}/.exec(line)) {
					return [ result, paramsString ]
				}
				line = lineRe.exec(paramsString).pop()
			} while(line)
			return [ result, '' ]
		}

		function filterProperties(paramsOb) {
			return function(object) {
				let result = {}
				let obType = JSONTag.getType(object)
				JSONTag.setType(result, obType)
				JSONTag.setAttributes(result, JSONTag.getAttributes(object))
				Object.entries(paramsOb).forEach(([key,value]) =>{
					let alias, queryResult
					[alias,key] = key.split(':',2).map(p => p.trim())
					if (!key) {
						key = alias
					}
					if (key[0]==='$') {
						queryResult = JSONPath({path:key, json:object, flatten: true})
					} else {
						queryResult = object[key]
					}
					if (!value) {
						// @TODO: just set the entire value for now, should run linkReplacer here
						// this is better solved after forcing all objects to have an id attribute with a unique id
						result[alias] = queryResult
					} else {
						result[alias] = filterProperties(value)(queryResult)
					}
				})
				return result;
			}
		}

		let accept = req.accepts(['application/jsontag','application/json','text/html','text/javascript','image/*'])
		if (!accept) {
			res.status(406)
			res.send("<h1>406 Unacceptable</h1>\n")
			return
		}
		let path = req.path.substring(6); // cut '/query'
		if (!path) {
			path = '';
		}
		if (path.substring(path.length-1)==='/') {
			//jsonpointer doesn't allow a trailing '/'
			path = path.substring(0, path.length-1)
		}
		let error,result
		if (path) {
			//jsonpointer doesn't allow an empty pointer
			try {
				if (pointer.has(dataspace, path)) {
					result = pointer.get(dataspace, path)
				} else {
					error = JSONTag.parse('<object class="Error">{"message":"Not found", "code":404}')
				}
			} catch(err) {
				error = JSONTag.parse('<object class="Error">{"message":'+originalJSON.stringify(err.message)+', "code":500}')
			}
		} else {
			result = dataspace
		}

		if (result) {
			// do the query here
			let query = req.body.toString() // raw body through express.raw()
			console.log(query)
			// @todo add text search: https://github.com/nextapps-de/flexsearch
			// @todo add tree walk map/reduce/find/filter style functions
			// @todo add arc tree dive function?
			const vm = new VM({
//				timeout: 1000,
				allowAsync: false,
				sandbox: {
					query: function(params) {
						return tripleStore.query(params)
					}
				},
				wasm: false
			})
			vm.freeze(result, 'data') // adds immutable result dataspace to sandbox as data
			try {
				result = vm.run(query)
				let used = Math.round(process.memoryUsage().heapUsed / 1024 / 1024);
				console.log(`(${used} MB)`);
			} catch(err) {
				console.log(err)
				error = JSONTag.parse('<object class="Error">{"message":'+originalJSON.stringify(''+err)+',"code":422}')
			}
		}

		if (error) {
			res.status(error.code)
			result = error
		}
		if (req.accepts('application/jsontag')) {
			res.setHeader('content-type','application/jsontag+json')
			res.send(JSONTag.stringify(result, null, 4)+"\n")
		} else {
			res.setHeader('content-type','application/json')
			res.send(originalJSON.stringify(result, null, 4)+"\n")
		}
		let end = Date.now()
		console.log(path, (end-start))
	})

	server.get('/', (req,res) => {
		res.send('<h1>JSONTag REST+ server</h1>')
	})

	function handleWebRequest(req,res) 
	{
		let path = req.path;
		path = path.replace(/[^a-z0-9_\.\-\/]*/gi, '') // whitelist acceptable file paths
		path = path.replace(/\.+/g, '.') // blacklist '..'
		if (!path) {
			path = '/'
		}
		if (path.substring(path.length-1)==='/') {
			path += 'index.html'
		}
		const options = {
			root: process.cwd()+'/www'
		}
		if (fs.existsSync(options.root+path)) {
			res.sendFile(path, options)
		} else {
			res.sendFile('/index.html', options)
		}
	}

	function linkReplacer(data, baseURL) {
		if (Array.isArray(data)) {
			data = data.map((entry,index) => {
				return linkReplacer(data[index], baseURL+index+'/')
			})
		} else if (typeof data === 'object') {
			data = Object.assign({}, data); // create shallow copy
			Object.keys(data).forEach(key => {
				if (typeof data[key] === 'object') {
					data[key] = new JSONTag.Link(baseURL+key+'/')
				}
			})
		}
		return data
	}

	function isString(s)
	{
		return typeof s === 'string' || s instanceof String
	}
	server.listen(port, () => 
	{
		console.log('JSONTag REST server listening on port '+port)
	})

}

main()