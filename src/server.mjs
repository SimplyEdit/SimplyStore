import express from 'express'
import fs from 'fs'
import JSONTag from '@muze-nl/jsontag'
import WorkerPool from './workerPool.mjs'
import { Worker } from 'worker_threads'
import { fileURLToPath } from 'url'
import {appendFile} from './util.mjs'
import path from 'path'
import httpStatusCodes from './statusCodes.mjs'
import writeFileAtomic from 'write-file-atomic'

const server = express()
const __dirname = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
let jsontagBuffer = null
let meta = {}

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
    const commandWorker = options.commandWorker || __dirname+'/src/command-worker.mjs'
    const commandsFile  = options.commandsFile  || __dirname+'/src/commands.mjs'
    const commandLog    = options.commandLog    || './command-log.jsontag'
    const commandStatus = options.commandStatus || './command-status.jsontag'

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
        let data = await loadData()
	    jsontagBuffer = data.data
        meta = data.meta
	} catch(err) {
		console.error('ERROR: SimplyStore cannot load '+datafile, err)
		process.exit(1)
	}

    const queryWorkerInitTask = () => { 
        return {
        	name: 'init',
        	req: {
        		body: jsontagBuffer,
                meta
        	}
        }
    }

    let queryWorkerPool = new WorkerPool(maxWorkers, queryWorker, queryWorkerInitTask())

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


    let status = loadCommandStatus(commandStatus)

    function loadCommandStatus(commandStatusFile) {
        let status = new Map()
        if (fs.existsSync(commandStatusFile)) {
            let file = fs.readFileSync(commandStatusFile, 'utf-8')
            if (file) {
                let lines = file.split("\n").filter(Boolean) //filter clears empty lines
                for(let line of lines) {
                    let command = JSONTag.parse(line)
                    status.set(command.id, command.status)
                }
            }
        }
        return status
    }

    let commandQueue = []

    function loadCommandLog(commandLog) {
        if (!fs.existsSync(commandLog)) {
            return
        }
        let log = fs.readFileSync(commandLog)
        if (log) {
            let lines = log.split("\n")
            for(let line of lines) {
                let command = JSONTag.parse(line)
                let state = status.get(command.id)
                switch(state) {
                    case 'accepted': // enqueue
                        commandQueue.push(command)
                        break;
                    case 'done': // do nothing
                        break;
                    default: // error, do nothing
                        break;
                } 
            }
        }
    }

    loadCommandLog()
    let commandWorkerInstance

    async function runNextCommand() {
        let command = commandQueue.shift()
        if (command) {
            let start = (resolve, reject) => {
                if (!commandWorkerInstance) {
                    commandWorkerInstance = new Worker(commandWorker)
                }
                commandWorkerInstance.on('message', result => {
                    resolve(result)
                    runNextCommand()
                })
                commandWorkerInstance.on('error', error => {
                    reject(error)
                    runNextCommand()
                })
                commandWorkerInstance.postMessage(command)
            }
            start(
                // resolve()
                (data) => {
                    if (!data || data.error) {
                        console.error('ERROR: SimplyStore cannot run command ', command.id, err)
                        if (!data.error) {
                            status.set(command.id, 'failed')
                            throw new Error('Unexpected command failure')
                        } else {
                            status.set(command.id, data.error)
                            throw data.error
                        }
                    }
                    jsontagBuffer = data.data
                    meta = data.meta
                    status.set(command.id, 'done')
                    appendFile(commandStatus, JSONTag.stringify({command:command.id, status: 'done'}))
                    // restart query workers with new data
                    let oldPool = queryWorkerPool
                    queryWorkerPool = new WorkerPool(maxWorkers, queryWorker, queryWorkerInitTask())
                    setTimeout(() => {
                        oldPool.close()
                    }, 2000)
                }, 
                //reject()
                (error) => {
                    status.set(command.id, error)
                    appendFile(commandStatus, JSONTag.stringify({command:command.id, status: error}))
                }
            )
        } else {
            await commandWorkerInstance.terminate()
            commandWorkerInstance.unref() // @FIXME is this needed?
            commandWorkerInstance = null  // @FIXME or this?
        }
    }

    async function runCommand(command) {
        // append command to the queue
        commandQueue.push(command)

        // if there is no command worker running, start one with the first entry from the queue
        if (!commandWorkerInstance) {
            runNextCommand()
        }
        // return a promise that is resolved when that command is finished
        return new Promise(command.start)
    }

    server.post('/command', async (req, res) => {
        let commandId = checkCommand(req, res)
        if (!commandId) {
            return
        }
        let commandStr = req.body.toString()
        try {
            let request = {
                method: req.method,
                url: req.originalUrl,
                query: req.query
            }

            commandQueue.push({
                id:commandId,
                command:commandStr,
                request,
                meta,
                data:jsontagBuffer,
                commandsFile,
                datafile                
            })

            runNextCommand()
        } catch(err) {
            status.set(commandId, 'ERROR: '+err.message)
            await appendFile(commandStatus, JSONTag.stringify({command:commandId, status: 'ERROR: '+err.message}))
            console.error('ERROR: SimplyStore cannot run command ', commandId, err)
        }
    })

    function checkCommand(req, res) {
        let commandStr = req.body.toString() // raw body through express.raw()
        let command = JSONTag.parse(commandStr)
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
        } else if (!command.name) {
            error = {
                code: 422,
                message: "Command has no name"
            }
            sendResponse({code:422, body: JSON.stringify(error)}, res)
            return false      
        }
        appendFile(commandLog, JSONTag.stringify(command))
        status.set(command.id, 'accepted') // doesn't need to be saved to file
        sendResponse({code: 202, body: '"Accepted"'}, res)
        return command.id
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
