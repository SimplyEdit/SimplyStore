import express from 'express'
import fs from 'fs'
import JSONTag from '@muze-nl/jsontag'
import WorkerPool from './workerPool.mjs'
import { Worker } from 'worker_threads'
import { fileURLToPath } from 'url'
import {appendFile} from './util.mjs'
import path from 'path'
import httpStatusCodes from './statusCodes.mjs'
import process from 'node:process'

const server = express()
const __dirname = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
let jsontagBuffers = null
let meta = {}

async function main(options) {
    if (!options) {
        options = {}
    }  
    const port          = options.port          || 3000
    const datafile      = options.datafile      || './data.od-jsontag'
    const schemaFile    = options.schemaFile    || null 
    const wwwroot       = options.wwwroot       || __dirname+'/www'
    const maxWorkers    = options.maxWorkers    || 8
    const queryWorker   = options.queryWorker   || __dirname+'/src/query-worker.mjs'
    const loadWorker    = options.loadWorker    || __dirname+'/src/load-worker.mjs'
    const commandWorker = options.commandWorker || __dirname+'/src/command-worker.mjs'
    const commandsFile  = options.commandsFile  || __dirname+'/src/commands.mjs'
    const commandLog    = options.commandLog    || './command-log.jsontag'
    const commandStatus = options.commandStatus || './command-status.jsontag'
    const access        = options.access        || null

    server.use(express.static(wwwroot))

    // allow access to raw body, used to parse a query send as post body
    server.use(express.raw({
        type: () => true, // parse body on all requests
        limit: '50MB'
    }))

    let status = loadCommandStatus(commandStatus)
    let commandQueue = loadCommandLog(status, commandLog)

    try {
        let data = await loadData(Array.from(status.keys())) // command id's (keys) are used to generate filenames of changes
        jsontagBuffers = [data.data]
        meta = data.meta
    } catch(err) {
        console.error('ERROR: SimplyStore cannot load '+datafile, err)
        process.exit(1)
    }

    const queryWorkerInitTask = () => { 
        return {
            name: 'init',
            req: {
                body: jsontagBuffers,
                meta,
                access
            }
        }
    }

    let queryWorkerPool = new WorkerPool(maxWorkers, queryWorker, queryWorkerInitTask())
    let commandWorkerInstance

    server.get('/query/*', handleGetQuery)
    server.post('/query/*', handlePostQuery)
    server.post('/command', handlePostCommand)
    server.get('/command/:id', handleGetCommand)

    try {
        await fetch(`http://localhost:${port}`, {
            signal: AbortSignal.timeout(2000)
        })
        console.error(`Port ${port} is already occupied, aborting.`)
        process.exit()
    } catch(err) {
        server.listen(port, () => {
            console.log('SimplyStore listening on port '+port)
            let used = Math.round(process.memoryUsage().rss / 1024 / 1024);
            console.log(`(${used} MB)`);
        })
    }

    /* ------ */

    function loadCommandStatus(commandStatusFile) {
        let status = new Map()
        if (fs.existsSync(commandStatusFile)) {
            let file = fs.readFileSync(commandStatusFile, 'utf-8')
            if (file) {
                let lines = file.split("\n").filter(Boolean) //filter clears empty lines
                for(let line of lines) {
                    let command = JSONTag.parse(line)
                    status.set(command.command, command)
                }
            } else {
                console.error('Could not open command status',commandStatusFile)
            }
        } else {
            console.log('no command status', commandStatusFile)
        }
        return status
    }

    function loadCommandLog(status, commandLog) {
        let commands = []
        if (!fs.existsSync(commandLog)) {
            return commands
        }
        let log = fs.readFileSync(commandLog, 'utf-8')
        if (log) {
            let lines = log.split("\n").filter(Boolean)
            for(let line of lines) {
                let command = JSONTag.parse(line)
                let state = status.get(command.id)
                switch(state) {
                    case 'accepted': // enqueue
                        commands.push(command)
                        break;
                    case 'done': // do nothing
                        break;
                    default: // error, do nothing
                        break;
                } 
            }
        }
        return commands
    }

    function loadData(commands) {
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
            worker.postMessage({dataFile:datafile,schemaFile,commands})
        })
    }

    async function handleGetQuery(req, res) {
        let start = Date.now()
        if ( !accept(req,res,
            ['application/jsontag','application/json','text/html','text/javascript','image/*'], 
            function(req, res, accept) {
                let result = true
                switch(accept) {
                    case 'text/html':
                    case 'image/*':
                    case 'text/javascript':
                        handleWebRequest(req,res,{root:wwwroot});
                        result = false
                    break
                }
                return result
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
    }

    async function handlePostQuery(req,res) {
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
    }

    async function handlePostCommand(req, res) {
        let commandId = checkCommand(req, res)
        if (!commandId) {
            return
        }
        try {
            let commandStr = req.body.toString()
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
                data:jsontagBuffers,
                commandsFile,
                datafile                
            })

            runNextCommand()
        } catch(err) {
            let s = {code:err.code||500, status:'failed', message:err.message, details:err.details}
            status.set(commandId, s)
            appendFile(commandStatus, JSONTag.stringify(Object.assign({command:commandId}, s)))
            console.error('ERROR: SimplyStore cannot run command ', commandId, err)
        }
    }

    function handleGetCommand(req, res) {
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
                body: JSON.stringify({code: 404, message: "Command not found", details: req.params.id})
            }, res)
        }
    }

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
                    let s
                    if (!data || (data.code>=300 && data.code<=499)) {
                        console.error('ERROR: SimplyStore cannot run command ', command.id, data)
                        if (!data?.code) {
                            s = {code: 500, status: "failed"}
                        } else {
                            s = {code: data.code, status: "failed", message: data.message, details: data.details}
                        }
                        status.set(command.id, s)
                    } else {
                        s = {code: 200, status: "done"}
                        status.set(command.id, s)
                        if (data.data) { // data has changed, commands may do other things instead of changing data
                            jsontagBuffers.push(data.data) // push changeset to jsontagBuffers so that new query workers get all changes from scratch
                            Object.assign(meta, data.meta)
                            queryWorkerPool.update({
                                name: 'update',
                                req: {
                                    body: jsontagBuffers[jsontagBuffers.length-1], // only add the last change, update tasks for earlier changes have already been sent
                                    meta
                                }
                            })
                        }
                    }
                    appendFile(commandStatus, JSONTag.stringify(Object.assign({command:command.id}, s)))
                }, 
                //reject()
                (error) => {
                    console.error(error)
                    let s = {status: "failed", code: error.code, message: error.message, details: error.details}
                    status.set(command.id, s)
                    appendFile(commandStatus, JSONTag.stringify(Object.assign({command:command.id}, s)))
                }
            )
        } else {
            // this code can never be triggered from the post(/command/) route, since it always adds a command to the queue
            // so you can only get here from commandWorkerInstance.on() route
            // which means that the commandWorkerInstance has finished running the previous command
            await commandWorkerInstance.terminate()
            commandWorkerInstance.unref() // @FIXME is this needed?
            commandWorkerInstance = null  // @FIXME or this?
        }
    }

    function checkCommand(req, res) {
        let error, command, commandOK
        let commandStr = req.body.toString() // raw body through express.raw()
        try {
            command = JSONTag.parse(commandStr)

            commandOK = {
                command: command?.id,
                code: 202,
                status: 'accepted'
            }
        } catch(err) {
            error = {
                code: 400,
                message: "Bad request",
                details: err
            }
            sendResponse({code: 400, body: JSON.stringify(error)}, res)
            return false
        }
        if (!command || !command.id) {
            error = {
                code: 422,
                message: "Command has no id",
                details: command
            }
            sendResponse({code: 422, body: JSON.stringify(error)}, res)
            return false
        } else if (status.has(command.id)) {
            sendResponse({body: JSON.stringify(commandOK)}, res)
            return false
        } else if (!command.name) {
            error = {
                code: 422,
                message: "Command has no name",
                details: command
            }
            sendResponse({code:422, body: JSON.stringify(error)}, res)
            return false      
        }
        appendFile(commandLog, JSONTag.stringify(command))
        appendFile(commandStatus, JSONTag.stringify(commandOK))
        status.set(command.id, commandOK) 
        sendResponse({code: 202, body: JSON.stringify(commandOK)}, res)
        return command.id
    }

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
    path = path.replace(/[^a-z0-9_.\-/]*/gi, '') // whitelist acceptable file paths
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
