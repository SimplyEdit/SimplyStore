import { setImmediate } from 'node:timers'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import express from 'express'
import httpStatusCodes from './statusCodes.mjs'
import StoreRuntime from './store-runtime.mjs'

const rootDirectory = path.dirname(
    path.dirname(fileURLToPath(import.meta.url))
)

export function createServer() {
    const server = express()
    server.run = options => run(server, options)
    return server
}

async function run(server, options = {}) {
    if (!options) {
        options = {}
    }
    const port = options.port || 3000
    const wwwroot = options.wwwroot || rootDirectory + '/www'
    const runtime = await StoreRuntime.open(options, {
        onStorageFailure(error) {
            console.error(
                'Storage outcome uncertain; stopping mutation. ' +
                'Administrator recovery required:',
                error
            )
            setImmediate(() => process.exit(1))
        }
    })

    configureRoutes(server, runtime, wwwroot)
    const listener = server.listen(port, () => {
        console.log('SimplyStore listening on port ' + port)
    })
    listener.on('error', error => {
        runtime.failStorage(error)
    })

    async function shutdown() {
        listener.close()
        try {
            await runtime.close()
            process.exit(runtime.storageFailed ? 1 : 0)
        }
        catch (error) {
            runtime.failStorage(error)
        }
    }

    process.once('SIGTERM', shutdown)
    process.once('SIGINT', shutdown)
}

function configureRoutes(server, runtime, wwwroot) {
    server.get('/', (request, response) => {
        serveHomepage(response, wwwroot)
    })

    server.use(
        express.raw({
            type: () => true,
            limit: '50MB'
        })
    )

    server.get('/query/', (request, response) => {
        return handleGetQuery(request, response, runtime, wwwroot)
    })
    server.get('/query/*remainder', (request, response) => {
        return handleGetQuery(request, response, runtime, wwwroot)
    })
    server.get('/slowquery/', (request, response) => {
        return handleGetQuery(request, response, runtime, wwwroot, true)
    })
    server.get('/slowquery/*remainder', (request, response) => {
        return handleGetQuery(request, response, runtime, wwwroot, true)
    })
    server.post('/query/', (request, response) => {
        return handlePostQuery(request, response, runtime)
    })
    server.post('/query/*remainder', (request, response) => {
        return handlePostQuery(request, response, runtime)
    })
    server.post('/slowquery/', (request, response) => {
        return handlePostQuery(request, response, runtime, true)
    })
    server.post('/slowquery/*remainder', (request, response) => {
        return handlePostQuery(request, response, runtime, true)
    })
    server.post('/command', (request, response) => {
        return handlePostCommand(request, response, runtime)
    })
    server.get('/command/:id', (request, response) => {
        return handleGetCommand(request, response, runtime)
    })

    server.use(express.static(wwwroot))
}

function serveHomepage(response, wwwroot) {
    response.setHeader('content-type', 'text/html')
    response.send(fs.readFileSync(wwwroot + '/home.html'))
}

async function handleGetQuery(
    request,
    response,
    runtime,
    wwwroot,
    slow = false
) {
    const start = Date.now()
    const accepted = acceptsResponseType(
        request,
        response,
        [
            'application/jsontag',
            'application/json',
            'text/html',
            'text/javascript',
            'image/*'
        ],
        (request, response, type) => {
            if (
                type === 'text/html' ||
                type === 'image/*' ||
                type === 'text/javascript'
            ) {
                handleWebRequest(request, response, { root: wwwroot })
                return false
            }
            return true
        }
    )
    if (!accepted) {
        return
    }

    const queryRequest = createQueryRequest(request)
    console.log('query', queryRequest.path)
    try {
        const result = await runtime.runQuery(queryRequest, { slow })
        sendResponse(result, response)
    }
    catch (error) {
        sendError(error, response)
    }
    logQueryDuration(queryRequest.path, start)
}

async function handlePostQuery(
    request,
    response,
    runtime,
    slow = false
) {
    const start = Date.now()
    if (
        !acceptsResponseType(
            request,
            response,
            ['application/jsontag', 'application/json']
        )
    ) {
        sendError(
            {
                code: 406,
                message: 'Not Acceptable',
                accept: ['application/json', 'application/jsontag']
            },
            response
        )
        return
    }

    const queryRequest = createQueryRequest(
        request,
        request.body.toString()
    )
    try {
        const result = await runtime.runQuery(queryRequest, { slow })
        sendResponse(result, response)
    }
    catch (error) {
        sendError(error, response)
    }
    logQueryDuration(queryRequest.path, start)
}

function createQueryRequest(request, body) {
    const queryRequest = {
        method: request.method,
        url: request.originalUrl,
        query: request.query,
        path: request.params.remainder?.join('/') || '/'
    }
    if (body !== undefined) {
        queryRequest.body = body
    }
    if (acceptsResponseType(request, null, ['application/jsontag'])) {
        queryRequest.jsontag = true
    }
    return queryRequest
}

function logQueryDuration(queryPath, start) {
    const duration = Date.now() - start
    console.log(queryPath, duration, process.memoryUsage())
}

async function handlePostCommand(request, response, runtime) {
    try {
        const result = await runtime.acceptCommand(request.body.toString())
        sendJsonResult(result, response)
        if (result.accepted) {
            void runtime.runQueuedCommands()
        }
    }
    catch (error) {
        if (!response.headersSent) {
            sendJsonResult(
                {
                    code: 500,
                    value: { message: 'Storage outcome uncertain' }
                },
                response
            )
        }
        runtime.failStorage(error)
    }
}

function handleGetCommand(request, response, runtime) {
    const result = runtime.getCommandStatus(request.params.id)
    sendJsonResult(result, response)
}

function sendJsonResult(result, response) {
    sendResponse(
        {
            code: result.code,
            jsontag: false,
            body: JSON.stringify(result.value)
        },
        response
    )
}

function sendResponse(result, response) {
    if (result.code && httpStatusCodes[result.code]) {
        response.status(result.code)
    }
    if (result.jsontag) {
        response.setHeader('content-type', 'application/jsontag')
    }
    else {
        response.setHeader('content-type', 'application/json')
    }
    response.send(result.body) + '\n'
}

function sendError(error, response) {
    console.error(error)
    if (error.code && httpStatusCodes[error.code]) {
        response.status(error.code)
    }
    else {
        response.status(500)
    }
    response.setHeader('content-type', 'application/json')
    response.send(JSON.stringify(error))
}

function acceptsResponseType(request, response, mimetypes, handler) {
    const accepted = request.accepts(mimetypes)
    if (!accepted) {
        if (response) {
            response.status(406)
            response.send('<h1>406 Unacceptable</h1>\n')
        }
        return false
    }
    if (typeof handler === 'function') {
        return handler(request, response, accepted)
    }
    return true
}

function handleWebRequest(request, response, options) {
    let requestPath = request.path
    requestPath = requestPath.replace(/[^a-z0-9_.\-/]*/gi, '')
    requestPath = requestPath.replace(/\.+/g, '.')
    if (!requestPath) {
        requestPath = '/'
    }
    if (requestPath.substring(requestPath.length - 1) === '/') {
        requestPath += 'index.html'
    }
    const fileOptions = {
        root: options.root
    }
    if (fs.existsSync(fileOptions.root + requestPath)) {
        response.sendFile(requestPath, fileOptions)
    }
    else {
        response.sendFile('/index.html', fileOptions)
    }
}

const server = createServer()
export default server
