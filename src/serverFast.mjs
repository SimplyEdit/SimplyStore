import express from 'express'
import fs from 'fs'
import JSONTag from '@muze-nl/jsontag'
import WorkerPool from './workerPool.mjs'
import { Worker } from 'worker_threads'
import { fileURLToPath } from 'url'
import {appendFile} from './util.mjs'
import path from 'path'
import httpStatusCodes from './statusCodes.mjs'

const server = express()
const __dirname = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
let jsontagBuffer = null

async function main(options) {
    if (!options) {
        options = {}
    }  
    const port          = options.port          || 3000
    const datafile      = options.datafile      || './data.jsontag'
    const wwwroot       = options.wwwroot       || __dirname+'/www'
    const maxWorkers    = options.maxWorkers    || 8
    const queryWorker   = options.queryWorker   || __dirname+'/src/query-worker.mjs'
    const loadWorker    = options.loadWorker    || __dirname+'/src/load-worker.mjs'

	server.use(express.static(wwwroot))

	// allow access to raw body, used to parse a query send as post body
    server.use(express.raw({
        type: (req) => true // parse body on all requests
    }))

    function loadData() {
    	return new Promise((resolve,reject) => {
	    	let worker = new Worker(loadWorker)
	    	worker.on('message', result => {
	    		resolve(result)
	    		worker.terminate()
	    	})
	    	worker.on('error', error => {
	    		reject(error)
	    		worker.terminate()
	    	})
	    	worker.postMessage(datafile)
	    })
    }
    try {
	    jsontagBuffer = await loadData()
//        fs.writeFileSync('./dump.txt', Buffer.from(jsontagBuffer))
	} catch(err) {
		console.error('ERROR: SimplyStore cannot load '+datafile, err)
		process.exit(1)
	}

    const queryWorkerInitTask = {
    	name: 'init',
    	req: {
    		body: jsontagBuffer
    	}
    }

    let queryWorkerPool = new WorkerPool(maxWorkers, queryWorker, queryWorkerInitTask)

    server.get('/query/*', async (req, res, next) => 
    {
        let start = Date.now()
        if ( !accept(req,res,
            ['application/jsontag','application/json','text/html','text/javascript','image/*'], 
            function(req, res, accept) {
                switch(accept) {
                    case 'text/html':
                    case 'image/*':
                    case 'text/javascript':
                        handleWebRequest(req,res,{root:wwwroot});
                        return false
                    break
                }
                return true
            }
        )) {
            // done
            return
        }
        let path = req.path.substr(6) // cut '/query'
        console.log('query',path)
        let request = {
        	method: req.method,
        	url: req.originalUrl,
        	query: req.query,
        	path: path
        }
        if (accept(req,res,['application/jsontag'])) {
            request.jsontag = true
        }
        try {
        	let result = await queryWorkerPool.run('query', request)
        	sendResponse(result, res)
        } catch(error) {
        	sendError(error, res)
        }
        let end = Date.now()
        console.log(path, (end-start), process.memoryUsage())
    })

    server.post('/query/*', async (req,res) => {
        let start = Date.now()
        if ( !accept(req,res,
            ['application/jsontag','application/json']) 
        ) {
            sendError({code:406, message:'Not Acceptable',accept:['application/json','application/jsontag']},res)
            return
        }
        let path = req.path.substr(6) // cut '/query'
        let request = {
        	method: req.method,
        	url: req.originalUrl,
        	query: req.query,
        	path: path,
        	body: req.body.toString()
        }
        if (accept(req,res,['application/jsontag'])) {
            request.jsontag = true
        }
        try {
        	let result = await queryWorkerPool.run('query', request)
        	sendResponse(result, res)
        } catch(error) {
        	sendError(error, res)
        }
        let end = Date.now()
        console.log(path, (end-start), process.memoryUsage())
//        queryWorkerPool.memoryUsage()
    })

    let status = new Map()

    server.post('/command', async (req, res) => {
        function runCommand(name,data) {
            return new Promise((resolve,reject) => {
                let worker = new Worker(commandWorker)
                worker.on('message', result => {
                    resolve(result)
                    worker.terminate()
                })
                worker.on('error', error => {
                    reject(error)
                    worker.terminate()
                })
                worker.postMessage({
                    name,
                    req,
                    data: jsontagBuffer
                })
            })
        }

        let command = checkCommand(req, res)
        if (!command) {
            return
        }
        try {
            await appendFile(commandLog, JSONTag.stringify(command))
            status.set(command.id, 'queued')
            result = 'OK'
            sendResponse({body: JSON.stringify(result)}, res)

            jsontagBuffer = await runCommand(command, jsontagBuffer)
            status.set(command.id, 'done')
            //@TODO: re-init query workers
            // updateQueryWorkers()
        } catch(err) {
            status.set(command.id, err)
            console.error('ERROR: SimplyStore cannot run command ', command.id, err)
            process.exit(1)
        }
    })

    function checkCommand(req, res) {
        let commandStr = req.body.toString() // raw body through express.raw()
        let command = JSONTag.parse(commandStr)
        console.log('command',command)
        if (!command || !command.id) {
            error = {
                code: 422,
                message: "Command has no id"
            }
            sendResponse({code: 422, body: JSON.stringify(error)}, res)
            return false
        } else if (status.has(command.id)) {
            result = "OK"
            sendResponse({body: JSON.stringify(result)}, res)
            return false
        } else if (!command.name || !commands[command.name]) {
            error = {
                code: 422,
                message: "Command has no name or is unknown"
            }
            sendResponse({code:422, body: JSON.stringify(error)}, res)
            return false      
        }
        return command
    }

    server.get('/command/:id', (req, res) => {
        if (status.has(req.params.id)) {
            let result = status.get(req.params.id)
            sendResponse({
                jsontag: false,
                body: JSON.stringify(result)
            },res)
        } else {
            sendResponse({
                code: 404,
                jsontag: false,
                body: JSON.stringify({code: 404, message: "Command not found"})
            }, res)
        }
    })

    server.listen(port, () => {
        console.log('SimplyStore listening on port '+port)
        let used = Math.round(process.memoryUsage().rss / 1024 / 1024);
        console.log(`(${used} MB)`);
    })
}

function sendResponse(response, res) {
    if (response.code && httpStatusCodes[response.code]) {
        res.status(response.code)
    }
    if (response.jsontag) {
        res.setHeader('content-type','application/jsontag')
    } else {
        res.setHeader('content-type','application/json')
    }
    res.send(response.body)+"\n"
}

function sendError(error, res) {
    console.error(error)
    if (error.code && httpStatusCodes[error.code]) {
        res.status(error.code)
    } else {
        res.status(500)
    }
    res.setHeader('content-type','application/json')
    res.send(JSON.stringify(error))
}

server.run = main
export default server

function accept(req, res, mimetypes, handler) {
    let accept = req.accepts(mimetypes)
    if (!accept) {
        res.status(406)
        res.send("<h1>406 Unacceptable</h1>\n")
        return false
    }
    if (typeof handler === 'function') {
        return handler(req, res, accept)
    }
    return true
}

function handleWebRequest(req,res,options)
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
    const fileOptions = {
        root: options.root
    }
    if (fs.existsSync(fileOptions.root+path)) {
        res.sendFile(path, fileOptions)
    } else {
        res.sendFile('/index.html', fileOptions)
    }
}
