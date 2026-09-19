import {setImmediate} from 'node:timers'
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
import { nextActiveCommandStatus } from './recovery.mjs'
import {serialWriter, syncFile} from './storage.mjs'
import {inspectStore, storePaths, mutableDirectories, validCommandId} from './store-inspection.mjs'
import {acquireOwnership} from './store-ownership.mjs'
import {executeWorker} from './execute-worker.mjs'
import { assertRuntimeEnvironmentConfiguration } from './runtime-environment.mjs'
import { faultPoint } from './faults.mjs'
import { getDefaultIntegrityFile } from './integrity.mjs'

const server = express()
const __dirname = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const defaultCommandTimeout = 30000
const defaultLoadTimeout = 30000
let jsontagBuffers = null
let meta = {}

class WorkerTimeoutError extends Error {
    constructor(workerKind, timeout) {
        super(`${workerKind} timed out after ${timeout}ms`)
        this.name = 'WorkerTimeoutError'
        this.code = 504
        this.timeout = timeout
        this.workerKind = workerKind
    }
}

function normalizeWorkerTimeout(name, value, defaultValue) {
    if (value === 0 || value === false || value === null || value === Infinity) {
        return 0
    }
    const timeout = value ?? defaultValue
    if (!Number.isFinite(timeout) || timeout < 0) {
        throw new Error(`${name} must be a non-negative finite number, 0, false, null, or Infinity`)
    }
    return timeout
}

async function main(options) {
    assertRuntimeEnvironmentConfiguration()
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
    const indexFile     = options.indexFile     || __dirname+'/src/index.mjs'
    const commandLog    = options.commandLog    || './command-log.jsontag'
    const commandStatus = options.commandStatus || './command-status.jsontag'
    const integrityFile = options.integrityFile || getDefaultIntegrityFile(datafile)
    const integrityEnabled = Boolean(options.integrity || options.integrityFile || fs.existsSync(integrityFile))
    const access        = options.access        || null
    const timeout       = options.timeout       || 1000
    const slowTimeout   = options.slowTimeout   || 10000
    const commandTimeout = normalizeWorkerTimeout('commandTimeout', options.commandTimeout, defaultCommandTimeout)
    const loadTimeout    = normalizeWorkerTimeout('loadTimeout', options.loadTimeout, defaultLoadTimeout)

    server.get('/', serveHomepage)

    // allow access to raw body, used to parse a query send as post body
    server.use(express.raw({
        type: () => true, // parse body on all requests
        limit: '50MB'
    }))

    const config = storePaths({...options, datafile, commandLog, commandStatus, integrity: integrityEnabled,
        ...(integrityEnabled ? {integrityFile} : {})})
    const ownership = await acquireOwnership(mutableDirectories(config))
    let inspection
    try {
        inspection = await inspectStore(config)
        if (!inspection.ready) {
            throw new Error('Administrative recovery required: ' +
            [...inspection.errors, ...inspection.commands.filter(c => c.problem).map(c => c.problem),
                ...inspection.commands.filter(c => c.status === 'accepted' || c.status === 'active').map(c => `${c.id}: ${c.status}; administrator assessment required`),
                ...inspection.commands.filter(c => c.present && c.status !== 'done').map(c => `${c.id}: uncommitted dataset`)].join('; '))
        }
        for (const [file, digest] of Object.entries(inspection.files)) {
            if (digest !== null) {
                await syncFile(file)
            }
        }
        const data = await loadData(inspection.committed)
        jsontagBuffers = [data.data]
        meta = data.meta
    }
    catch (error) {
        await ownership.release()
        throw error
    }
    const status = new Map(inspection.commands.map(c => [c.id, c.history.at(-1)]))
    const commandQueue = []
    const acceptSerial = serialWriter()
    let storageFailed = false, closing = false
    let runner = Promise.resolve()
    function failStorage(error) {
        if (storageFailed) {
            return
        }
        storageFailed = true
        console.error('Storage outcome uncertain; stopping mutation. Administrator recovery required:', error)
        // Retain ownership evidence; a process exit must never imply a rollback.
        setImmediate(() => process.exit(1))
    }

    const queryWorkerInitTask = () => {
        return {
            name: 'init',
            req: {
                body: jsontagBuffers,
                meta,
                access
            },
            timeout
        }
    }

    const slowQueryWorkerInitTask = () => {
        let result = queryWorkerInitTask()
        result.timeout = slowTimeout
        return result
    }

    let queryWorkerPool = new WorkerPool(maxWorkers, queryWorker, queryWorkerInitTask())
    let slowQueryWorkerPool = new WorkerPool(1, queryWorker, slowQueryWorkerInitTask())
    let commandRunnerActive = false

    server.get('/query/', (req,next) => handleGetQuery(req,next))
    server.get('/query/*remainder', (req,next) => handleGetQuery(req,next))
    server.get('/slowquery/', (req,next) => handleSlowGetQuery(req,next))
    server.get('/slowquery/*remainder', (req,next) => handleSlowGetQuery(req,next))
    server.post('/query/', (req,next) => handlePostQuery(req,next))
    server.post('/query/*remainder', (req,next) => handlePostQuery(req,next))
    server.post('/slowquery/', (req,next) => handleSlowPostQuery(req,next))
    server.post('/slowquery/*remainder', (req,next) => handleSlowPostQuery(req,next))
    server.post('/command', (req,next) => handlePostCommand(req,next))
    server.get('/command/:id', (req,next) => handleGetCommand(req,next))

    server.use(express.static(wwwroot))

    const listener = server.listen(port, () => {
        console.log('SimplyStore listening on port '+port)
    })
    listener.on('error', error => {
        failStorage(error)
    })
    async function shutdown() {
        if (closing) {
            return
        }
        closing = true
        listener.close()
        try {
            await acceptSerial(async () => {

            })
            await runner
            queryWorkerPool.close(); slowQueryWorkerPool.close()
            if (!storageFailed) {
                await ownership.release()
            }
            process.exit(storageFailed ? 1 : 0)
        }
        catch (error) {
            failStorage(error)
        }
    }
    process.once('SIGTERM', shutdown)
    process.once('SIGINT', shutdown)

    /* ------ */

    function serveHomepage(req, res) {
        res.setHeader('content-type', 'text/html');
        res.send(fs.readFileSync(wwwroot+'/home.html'))
    }

    function loadData(commands) {
        return new Promise((resolve,reject) => {
            let worker = new Worker(loadWorker)
            let settled = false
            let timeoutId
            const finish = async (settle, value) => {
                if (settled) {
                    return
                }
                settled = true
                if (timeoutId) {
                    clearTimeout(timeoutId)
                }
                await worker.terminate()
                settle(value)
            }
            if (loadTimeout) {
                timeoutId = setTimeout(() => {
                    const error = new WorkerTimeoutError('load worker', loadTimeout)
                    void finish(reject, error)
                }, loadTimeout)
            }
            worker.on('message', result => {
                void finish(resolve, result)
            })
            worker.on('error', error => {
                void finish(reject, error)
            })
            try {
                worker.postMessage({
                    dataFile:datafile,
                    indexFile,
                    schemaFile,
                    commands,
                    integrityFile: integrityEnabled ? integrityFile : null,
                    integrityRequired: integrityEnabled
                })
            }
            catch (error) {
                void finish(reject, error)
            }
        })
    }

    async function handleGetQuery(req, res, pool=null) {
        let start = Date.now()
        if (!pool) {
            pool = queryWorkerPool
        }
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
        let path = req.params.remainder?.join('/') || '/'
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
            let result = await pool.run('query', request, { timeout })
            sendResponse(result, res)
        }
        catch(error) {
            sendError(error, res)
        }
        let end = Date.now()
        console.log(path, (end-start), process.memoryUsage())
    }

    async function handleSlowGetQuery(req, res) {
        return handleGetQuery(req, res, slowQueryWorkerPool)
    }

    async function handlePostQuery(req,res,pool=null, slowTimeout=null) {
        if (!pool) {
            pool = queryWorkerPool
        }
        if (!slowTimeout) {
            slowTimeout = timeout
        }
        let start = Date.now()
        if ( !accept(req,res,
            ['application/jsontag','application/json'])
        ) {
            sendError({code:406, message:'Not Acceptable',accept:['application/json','application/jsontag']},res)
            return
        }
        let path = req.params.remainder?.join('/') || '/'
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
            let result = await pool.run('query', request, {slowTimeout})
            sendResponse(result, res)
        }
        catch(error) {
            sendError(error, res)
        }
        let end = Date.now()
        console.log(path, (end-start), process.memoryUsage())
        //        queryWorkerPool.memoryUsage()
    }

    async function handleSlowPostQuery(req, res) {
        return handlePostQuery(req, res, slowQueryWorkerPool, slowTimeout)
    }

    async function handlePostCommand(req, res) {
        if (storageFailed || closing) {
            return sendResponse({code:503, body: JSON.stringify({message:'Store is unavailable'})}, res)
        }
        try {
            await acceptSerial(async () => {
                if (storageFailed) {
                    throw new Error('Store is unavailable')
                }
                if (closing) {
                    return sendResponse({code:503,body:JSON.stringify({message:'Store is closing'})},res)
                }
                const accepted = await checkCommand(req, res)
                if (!accepted) {
                    return
                }
                if (storageFailed) {
                    throw new Error('Store failed during acceptance')
                }
                commandQueue.push({id: accepted.id, command: accepted.line})
                sendResponse({code:202, body:JSON.stringify(status.get(accepted.id))}, res)
            })
            void drainCommandQueue()
        }
        catch (error) {
            if (!res.headersSent) {
                sendResponse({code:500, body:JSON.stringify({message:'Storage outcome uncertain'})}, res)
            }
            failStorage(error)
        }
    }

    function handleGetCommand(req, res) {
        if (status.has(req.params.id)) {
            let result = status.get(req.params.id)
            sendResponse({
                jsontag: false,
                body: JSON.stringify(result)
            },res)
        }
        else {
            sendResponse({
                code: 404,
                jsontag: false,
                body: JSON.stringify({code: 404, message: "Command not found", details: req.params.id})
            }, res)
        }
    }

    function drainCommandQueue() {
        if (commandRunnerActive || storageFailed) {
            return runner
        }
        commandRunnerActive = true
        runner = (async () => {
            try {
                while (commandQueue.length && !storageFailed) {
                    const command = commandQueue.shift()
                    console.log('starting command', command.id)
                    const active = nextActiveCommandStatus(command.id, status.get(command.id))
                    await appendFile(commandStatus, JSONTag.stringify(active))
                    if (storageFailed) {
                        throw new Error('Store failed before execution')
                    }
                    status.set(command.id, active)
                    await faultPoint('after-active-status-before-command-worker')
                    const result = await executeWorker(commandWorker, {...command,
                        meta, data: jsontagBuffers, commandsFile, indexFile, datafile,
                        integrityFile: integrityEnabled ? integrityFile : null,
                        integrityRequired: integrityEnabled}, commandTimeout)
                    if (storageFailed) {
                        throw new Error('Store failed during execution')
                    }
                    if (result?.storageFailure) {
                        throw new Error(result.message || 'Worker persistence failure')
                    }
                    if (!result || result.status === 'failed' || result.status === 'unsafe' || result.code >= 300) {
                        const terminal = {command: command.id, status: result?.status === 'unsafe' ? 'unsafe' : 'failed',
                            code: result?.code || 500, message: result?.message || 'Command failed', attempt: active.attempt}
                        await appendFile(commandStatus, JSONTag.stringify(terminal))
                        status.set(command.id, terminal)
                        continue
                    }
                    for (const file of config.requiredFiles) {
                        await syncFile(file)
                    }
                    await faultPoint('before-command-done-status')
                    const done = {command: command.id, code:200, status:'done'}
                    await appendFile(commandStatus, JSONTag.stringify(done))
                    await faultPoint('after-command-done-status-before-query-update')
                    status.set(command.id, done)
                    if (result.data) {
                        jsontagBuffers.push(result.data)
                        Object.assign(meta, result.meta)
                        const task = {name:'update', req:{body:result.data, meta}}
                        queryWorkerPool.update(task); slowQueryWorkerPool.update(task)
                    }
                }
            }
            catch (error) {
                failStorage(error)
            }
            finally {
                commandRunnerActive = false
            }
        })()
        return runner
    }

    async function checkCommand(req, res) {
        let error, command, commandOK
        let commandStr = req.body.toString() // raw body through express.raw()
        try {
            command = JSONTag.parse(commandStr)

            commandOK = {
                command: command?.id,
                code: 202,
                status: 'accepted'
            }
        }
        catch(err) {
            error = {
                code: 400,
                message: "Bad request",
                details: err.message
            }
            console.error('Error: ',err)
            sendResponse({code: 400, body: JSON.stringify(error)}, res)
            return false
        }
        if (!command || !validCommandId(command.id)) {
            error = {
                code: 422,
                message: "Command has no id",
                details: command
            }
            sendResponse({code: 422, body: JSON.stringify(error)}, res)
            return false
        }
        else if (status.has(command.id)) {
            const currentStatus = Object.assign({command: command.id}, status.get(command.id))
            sendResponse({body: JSON.stringify(currentStatus)}, res)
            return false
        }
        else if (!command.name) {
            error = {
                code: 422,
                message: "Command has no name",
                details: command
            }
            sendResponse({code:422, body: JSON.stringify(error)}, res)
            return false
        }
        const line = JSONTag.stringify(command)
        await appendFile(commandLog, line)
        await faultPoint('after-command-log-before-accepted-status')
        await appendFile(commandStatus, JSONTag.stringify(commandOK))
        status.set(command.id, commandOK)
        await faultPoint('after-command-accepted-status-before-response')
        return {id:command.id, line}
    }
}

function sendResponse(response, res) {
    if (response.code && httpStatusCodes[response.code]) {
        res.status(response.code)
    }
    if (response.jsontag) {
        res.setHeader('content-type','application/jsontag')
    }
    else {
        res.setHeader('content-type','application/json')
    }
    res.send(response.body)+"\n"
}

function sendError(error, res) {
    console.error(error)
    if (error.code && httpStatusCodes[error.code]) {
        res.status(error.code)
    }
    else {
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

function handleWebRequest(req,res,options) {
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
    }
    else {
        res.sendFile('/index.html', fileOptions)
    }
}
