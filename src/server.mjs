import express from 'express'
import fs from 'fs'
import pointer from 'json-pointer'
import JSONTag from '@muze-nl/jsontag'
import {JSONPath} from 'jsonpath-plus'
import {VM} from 'vm2'
import {_,from,not,anyOf,allOf} from 'array-where-select'
import { fileURLToPath } from 'url'
import path from 'path'
import produce from './produce.mjs'
import commands from './commands.mjs'

const __dirname = path.dirname(path.dirname(fileURLToPath(import.meta.url)))

const server    = express()

function deepFreeze(obj) {
		Object.freeze(obj)
		Object.keys(obj).forEach(prop => {
				if (typeof obj[prop] === 'object' && !Object.isFrozen(obj[prop])) {
						deepFreeze(obj[prop])
				}
		})
		return obj
}

function isString(s)
{
    return typeof s === 'string' || s instanceof String
}

function joinArgs(args) {
    return args = args.map(arg => {
        if (isString(arg)) {
            return arg
        } else {
            return JSONTag.stringify(arg)
        }
    }).join(' ')
}

function connectConsole(res) {
    return {
        log: function(...args) {
            res.append('X-Console-Log', joinArgs(args))
        },
        warning: function(...args) {
            res.append('X-Console-Warning', joinArgs(args))
        },
        error: function(...args) {
            res.append('X-Console-Error', joinArgs(args))            
        }
    }
}

async function main(options) {
    if (!options) {
        options = {}
    }  
    const port     = options.port || 3000
    const datafile = options.datafile || 'data.jsontag'
    const wwwroot  = options.wwwroot || __dirname+'/www'
    let meta       = options.meta || {}
    let dataspace  = options.dataspace || null

    const originalJSON = JSON
    JSON = JSONTag // monkeypatching

    if (!dataspace) {
        console.log('loading data...')
        let file = fs.readFileSync(datafile)
        try {
            dataspace = JSONTag.parse(file.toString(), null, meta)
        } catch(e) {
            console.error(e)
            process.exit()
        }
    }
    deepFreeze(dataspace)
    console.log('Frozen?', Object.isFrozen(dataspace))

    let used = Math.round(process.memoryUsage().heapUsed / 1024 / 1024);
    console.log(`data loaded (${used} MB)`);

    server.get('/', (req,res) => {
        res.send('<h1>SimplyStore</h1>') //TODO: implement something nice
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

    function getDataSpace(req, res, dataspace) {
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
        return [result,path]
    }
    
    server.get('/query/*', (req, res, next) => 
    {
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

        let [result,path] = getDataSpace(req, res, dataspace)
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
        if ( !accept(req,res,
            ['application/jsontag','application/json']) 
        ) {
            return
        }
        let error
        let [result,path] = getDataSpace(req, res, dataspace)
        if (result) {
            // do the query here
            let query = req.body.toString() // raw body through express.raw()
            // @todo add text search: https://github.com/nextapps-de/flexsearch
            // @todo add tree walk map/reduce/find/filter style functions
            // @todo add arc tree dive function?
            const vm = new VM({
//                timeout: 1000,
                allowAsync: false,
                sandbox: {
                    root: dataspace,
                    data: result,
                    meta: meta,
                    _: _,
                    from: from,
                    not: not,
                    anyOf: anyOf,
                    allOf: allOf,
                    console: connectConsole(res),
                    JSONTag: JSONTag,
                    request: {
                        method: req.method,
                        url: req.originalUrl,
                        query: req.query
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


    server.post('/command', (req, res) => {
        console.log('command')
        let start = Date.now()
        if ( !accept(req,res,
            ['application/jsontag','application/json']) 
        ) {
            return
        }
        let error, result

        let command = JSONTag.parse(req.body.toString()) // raw body through express.raw()
        
        if (command && command.name && commands[command.name]) {
            console.log(command.name)
            try {
                let commandFn = dataspace => {
                    return commands[command.name](dataspace, command)
                }
                dataspace = produce(dataspace, commandFn)
                console.log('command done')
            } catch(err) {
                console.log('Error')
                console.error(err)
                error = JSONTag.parse('<object class="Error">{"message":'+err.message+',"code":422}')
            }
        } else {
            error = JSONTag.parse('<object class="Error">{"message":"Command '+command.name+' not found","code":404}')
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
        console.log(command.name, (end-start), process.memoryUsage())        
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