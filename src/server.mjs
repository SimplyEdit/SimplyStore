import express from 'express'
import fs from 'fs'
import JSONTag from '@muze-nl/jsontag'
import { fileURLToPath } from 'url'
import path from 'path'
import commands from './commands.mjs'
import {appendFile} from './util.mjs'
import {Piscina} from 'piscina'

const __dirname = path.dirname(path.dirname(fileURLToPath(import.meta.url)))

const server    = express()

async function main(options) {
    if (!options) {
        options = {}
    }  
    const port          = options.port          || 3000
    const datafile      = options.datafile      || './data.jsontag'
    const wwwroot       = options.wwwroot       || __dirname+'/www'
    const commandLog    = options.commandlog    || './commandlog.jsontag'
    const queryWorker   = options.queryWorker   || __dirname+'/src/worker-query-init.mjs'
    const commandWorker = options.commandWorker || __dirname+'/src/worker-command-init.mjs'

    let jsontag         = fs.readFileSync(datafile, 'utf-8')

    function initWorkerPool(workerName, size=null) {
        let options = {
            filename: workerName,
            workerData: jsontag
        }
        if (size) {
            options.maxThreads = size
        }
        return new Piscina(options)
    }

    let queryWorkerpool = initWorkerPool(queryWorker)

//    const commandWorkerpool = initWorkerPool(commandWorker,1) // only one update worker so no changes can get lost

    server.get('/', (req,res) => {
        res.send('<h1>SimplyStore</h1>') //@TODO: implement something nice
    })

    server.use(express.static(wwwroot))

    // allow access to raw body, used to parse a query send as post body
    server.use(express.raw({
        type: (req) => true // parse body on all requests
    }))

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

    function sendResponse(response, res) {
        if (response.code) {
            res.status(response.code)
        }
        if (response.jsontag) {
            res.setHeader('content-type','application/jsontag')
        } else {
            res.setHeader('content-type','application/json')
        }
        res.send(response.body)+"\n"
    }

    function sendCommandResponse(result, req, res) {
        if (result.code) {
            res.status(result.code)
        }
        if (req.accepts('application/jsontag')) {
            res.setHeader('content-type','application/jsontag')
            res.send(JSONTag.stringify(result, null, 4)+"\n")
        } else {
            res.setHeader('content-type','application/json')
            res.send(JSON.stringify(result, null, 4)+"\n")
        }
    }

    server.get('/query/*', (req, res, next) => 
    {
        console.log('express query')
        let start = Date.now()

        if ( !accept(req,res,
            ['application/jsontag','application/json','text/html','text/javascript','image/*'], 
            function(req, res, accept) {
                switch(accept) {
                    case 'text/html':
                    case 'image/*':
                    case 'text/javascript':
                        handleWebRequest(req,res,options);
                        return false
                    break
                }
                return true
            }
        )) {
            // done
            return
        }
        let path = req.path.substr(6); // cut '/query'
        let request = {
            method: req.method,
            url: req.originalUrl,
            query: req.query,
            jsontag: req.accepts('application/jsontag')
        }
        queryWorkerpool.run({pointer:path, request})
        .then(response => {
            sendResponse(response, res)
            let end = Date.now()
            console.log(path, (end-start), process.memoryUsage())
        })
    })

    /**
     * handle queries, query is the post body
     */
    server.post('/query/*',  (req, res) => {
        let start = Date.now()
        if ( !accept(req,res,
            ['application/jsontag','application/json']) 
        ) {
            return
        }
        let query = req.body.toString() // raw body through express.raw()
        let path = req.path.substr(6); // cut '/query'
        let request = {
            method: req.method,
            url: req.originalUrl,
            query: req.query,
            jsontag: req.accepts('application/jsontag')
        }
        queryWorkerpool.run({pointer:path, request, query})
        .then(response => {
            sendResponse(response, res)
            let end = Date.now()
            console.log(path, (end-start), process.memoryUsage())
        })
    })

    let status = new Map()

    server.get('/command/:id', (req, res) => {
        //@TODO: find the status of command with :id
        //return that
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
                body: JSON.stringify({"code":404,"message":"Command not found"})
            }, res)
        }
    })

    server.post('/command', async (req, res) => {
        let start = Date.now()
        if ( !accept(req,res,
            ['application/jsontag','application/json']) 
        ) {
            return
        }
        let error, result

        let commandStr = req.body.toString() // raw body through express.raw()
        let command = JSONTag.parse(commandStr)
        if (!command.id) {
            error = {
                code: 422,
                message: "Command has no id"
            }
            sendCommandResponse(error, req, res)
            return
        } else if (status.has(command.id)) {
            result = "OK"
            sendCommandResponse(result, req, res)
            return
        } else if (!command.name || !commands[command.name]) {
            error = {
                code: 422,
                message: "Command has no name or is unknown"
            }
            sendCommandResponse(error, req, res)
            return            
        }
        await appendFile(commandLog, JSONTag.stringify(command))

        status.set(command.id, 'queued')
        console.log('command',command)

        result = "OK"
        sendCommandResponse(result, req, res)
        let request = {
            method: req.method,
            url: req.originalUrl,
            query: req.query,
            jsontag: req.accepts('application/jsontag')
        }

        commandWorkerpool
        .run({request, commandStr})
        .then(response => {
            //@TODO store response status, if response.code => error
            if (!response.code) {
                jsontag = response.body // global jsontag
                let dataspace = JSONTag.parse(jsontag)
                //@TODO: make sure queryWorkerpool is only replaced after
                //workers are initialized, to prevent hickups if initialization takes a long time
                let newQueryWorkerpool = initWorkerPool('./worker-query')
                queryWorkerpool.terminate() // gracefully
                queryWorkerpool = newQueryWorkerpool
                //@TODO: write dataspace to disk
                status.set(command.id, 'done')
                let end = Date.now()
                console.log(command.name, (end-start), process.memoryUsage())        
            }
        })
        .catch(err => {
            console.error(err)
            //@TODO: set status for this command to error with this err
            status.set(command.id, err)
        })

    })

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
            root: options.root || wwwroot
        }
        if (fs.existsSync(fileOptions.root+path)) {
            res.sendFile(path, fileOptions)
        } else {
            res.sendFile('/index.html', fileOptions)
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

    server.listen(port, () => {
        console.log('SimplyStore listening on port '+port)
    })

}

server.run = main
export default server