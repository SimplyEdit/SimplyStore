import express from 'express'
import fs from 'fs'
import pointer from 'json-pointer'
import JSONTag from '@muze-nl/jsontag'
import {JSONPath} from 'jsonpath-plus'
import TripleStore from './triplestore.mjs'
import {VM} from 'vm2'
import _ from 'array-where-select'

const server    = express()
const port      = process.env.NODE_PORT || 3000;

const datafile  = process.env.DATAFILE || 'data.jsontag'

server.use(express.static(process.cwd()+'/www'))

function deepFreeze(obj) {
  Object.freeze(obj)
  Object.keys(obj).forEach(prop => {
    if (typeof obj[prop] === 'object' && !Object.isFrozen(obj[prop])) {
      deepFreeze(obj[prop])
    }
  })
  return obj
}

function createReference(meta, obj, prop, value) {
	if (!meta.references) {
		meta.references = new Map()
	}
	if (!meta.references.has(value)) {
		meta.references.set(value, {})
	}
	let refs = meta.references.get(value)
	if (!refs[prop]) {
		refs[prop] = []
	}
	refs[prop].push(obj)
}

let seenRefs = new WeakMap()
function indexReferences(obj, meta) {
	if (seenRefs.has(obj)) {
		//console.log('seen', obj)
		return
	}
	seenRefs.set(obj, true)
	Object.entries(obj).forEach(([prop,val]) => {
		if (Array.isArray(val)) {
			val.forEach(val => {
				if (val && typeof val == 'object') {
					createReference(meta, obj, prop, val)
					indexReferences(val, meta)
				}
			})
		} else if (JSONTag.getType(val) == 'object') {
			createReference(meta, obj, prop, val)
			indexReferences(val, meta)
		} else {
//			console.log('prop', prop, 'skipped '+val)
		}
	})
}

async function main() {

	const originalJSON = JSON
	JSON = JSONTag // monkeypatching

	console.log('loading data...')
	let file = fs.readFileSync(datafile)
	let dataspace;
	let meta = {
		references: new WeakMap()
	}
	try {
		dataspace = JSONTag.parse(file.toString(), null, meta)
		deepFreeze(dataspace)
	} catch(e) {
		console.error(e)
		process.exit()
	}

	console.log('indexing data...')
	indexReferences(dataspace, meta)

	console.log('creating triplestore...')
	let tripleStore;
	try {
		tripleStore = new TripleStore(dataspace)
	} catch(e) {
		console.error(e)
		process.exit()
	}
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
		console.log(path, (end-start), process.memoryUsage())
	})

	/**
	 * handle queries, query is the post body
	 */
	server.post('/query/*',  (req, res) => {
		let start = Date.now()

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
					root: dataspace,
					data: result,
					meta: meta,
					_: _,
					query: function(params) {
						return tripleStore.query(params)
					}
				},
				wasm: false
			})
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
		console.log(path, (end-start), process.memoryUsage())
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
		let type = JSONTag.getType(data)
		let attributes = JSONTag.getAttributes(data)
		if (Array.isArray(data)) {
			data = data.map((entry,index) => {
				return linkReplacer(data[index], baseURL+index+'/')
			})
		} else if (type === 'link') {
			// do nothing
		} else if (data && typeof data === 'object') {
			data = JSONTag.clone(data)
			Object.keys(data).forEach(key => {
				if (Array.isArray(data[key])) {
					data[key] = new JSONTag.Link(baseURL+key+'/')
				} else if (typeof data[key] === 'object') {
					if (JSONTag.getType(data[key])!=='link') {
						let id=JSONTag.getAttribute(data[key], 'id')
						if (!id) {
							id = baseURL+key+'/'
						}
						data[key] = new JSONTag.Link(id)
					}
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