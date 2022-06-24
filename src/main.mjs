import express from 'express'
import fs from 'fs'
import pointer from 'json-pointer'
import JSONTag from '@muze-nl/jsontag'

const server    = express()
const port      = process.env.NODE_PORT || 3000;
const datafile  = process.env.DATAFILE || 'data.jsontag'
const dataspace = JSONTag.parse(fs.readFileSync(datafile)) //TODO: add error handling here

server.all('*', (req, res, next) => 
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

	let path = req.path;
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