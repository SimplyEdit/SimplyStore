import express from 'express'
import fs from 'fs'
import pointer from 'json-pointer'
import JSONTag from '@muze-nl/jsontag'
import {JSONPath} from 'jsonpath-plus'

const server    = express()
const port      = process.env.NODE_PORT || 3000;
const datafile  = process.env.DATAFILE || 'data.jsontag'
const dataspace = JSONTag.parse(fs.readFileSync(datafile)) //TODO: add error handling here?

// allow access to raw body, used to parse a query send as post body
server.use(express.raw({
	type: (req) => true // parse body on all requests
}))

server.get('/query/*', (req, res, next) => 
{
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
			result = JSONTag.parse('<object class="Error">{"message":'+JSON.stringify(err.message)+', "code":500}')
		}
	} else {
		result = dataspace
	}
	if (JSONTag.getAttribute(result, 'class')==='Error') {
		res.status(result.code)
	}
	if (req.accepts('application/jsontag')) {
		res.setHeader('content-type','application/jsontag+json')
		res.send(JSONTag.stringify(result, linkReplacer, 4)+"\n")
	} else {
		res.setHeader('content-type','application/json')
		res.send(JSON.stringify(result, null, 4)+"\n")
	}
})

/**
 * handle queries, query is the post body
 */
server.post('/query/*',  (req, res) => {
	function parseParams(paramsString) {
		let result = {}
		let lineRe = /^(.*)$/m
		let parseRe = /^\s*([a-z][a-z0-9_]*)?\s*(\{)?\s*$/i
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
			console.log(obType, object)
			JSONTag.setType(result, obType)
			JSONTag.setAttributes(result, JSONTag.getAttributes(object))
			Object.entries(paramsOb).forEach(([key,value]) =>{
				if (!value) {
					// @TODO: just set the entire value for now, should run linkReplacer here
					result[key] = object[key]
				} else {
					result[key] = filterProperties(value)(object[key])
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
			error = JSONTag.parse('<object class="Error">{"message":'+JSON.stringify(err.message)+', "code":500}')
		}
	} else {
		result = dataspace
	}

	if (result) {
		// do the query here
		let query = req.body.toString() // raw body through express.raw()
		let paramsRe = /\{\s*$/m;
		let params = ''
		let remainder
		let found = paramsRe.exec(query)
		if (found) {
			params = query.substring(found.index)
			query = query.substring(0, found.index)
		}
		if (params) {
			params = 'result '+params
		}
		[ params, remainder ] = parseParams(params)
		try {
			result = JSONPath({path:query, json:result, flatten: true})
			if (params) {
				console.log('query', query, 'params',params, 'remainder', remainder)
				if (Array.isArray(result)) {
					result = result.map((e) => {
						return filterProperties(params.result)(e)
					})
				} else if (typeof result === 'object') {
					result = filterProperties(params.result)(result)
				}
			}

		} catch(err) {
			error = JSONTag.parse('<object class="Error">{"message":'+JSON.stringify(err.message)+', "code":400}')
		}
	}

	if (error) {
		res.status(error.code)
		result = error
	}
	if (req.accepts('application/jsontag')) {
		res.setHeader('content-type','application/jsontag+json')
		res.send(JSONTag.stringify(result, null, 4)+"\n") //linkReplacer, 4)+"\n")
	} else {
		res.setHeader('content-type','application/json')
		res.send(JSON.stringify(result, null, 4)+"\n")
	}
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

function linkReplacer(key, value) 
{
	if (!Array.isArray(this) && typeof value === 'object' && !isString(value)) {
		return JSONTag.parse('<link>'+JSON.stringify(key+'/'))
	} else {
		return value;
	}
}

function isString(s)
{
	return typeof s === 'string' || s instanceof String
}
server.listen(port, () => 
{
	console.log('JSONTag REST server listening on port '+port)
})