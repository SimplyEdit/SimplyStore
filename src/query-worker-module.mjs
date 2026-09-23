import {VM} from 'vm2'
import { memoryUsage } from 'node:process'
import JSONTag from '@muze-nl/jsontag'
import {source} from '@muze-nl/od-jsontag/src/symbols.mjs'
import { FileDataset, FileParser } from './file-data.mjs'
import {_,from,not,anyOf,allOf,asc,desc,sum,count,avg,max,min,many,one,first,distinct} from '@muze-nl/jaqt'
import process from 'node:process'

// vm2 protects array species before host calls. Give it the already-safe
// constructor descriptor on raw query arrays before the read-only proxy exists,
// so methods like map/filter need no temporary mutation through that proxy.
class QueryParser extends FileParser {
    getArrayProxy(array, parent) {
        Object.defineProperty(array, 'constructor', {
            value: undefined,
            writable: false,
            enumerable: false,
            configurable: false
        })
        return super.getArrayProxy(array, parent)
    }
}

let dataspace
let metaProxy = {
    index: {
    }
}

let dataset
let parser

const metaIdProxy = {
    get: (id) => {
        let index = parser.meta.index.id.get(id)
        if (index || index===0) {
            return parser.getLineProxy(index)
        }
    },
    has: (id) => {
        return parser.meta.index.id.has(id)
    }
}

const tasks = {
    init: async (task) => {
        if (dataset) {
            dataset.close()
        }
        dataset = new FileDataset(task.req.meta, true, QueryParser)
        parser = dataset.parser
        if (task.req.access) {
            task.req.access = await import(task.req.access)
            task.req.access = task.req.access.default
            parser.meta.access = task.req.access
        }
        if (task.req.meta.index) {
            parser.meta.index = task.req.meta.index
        }
        if (task.req.meta.schema) {
            parser.meta.schema = task.req.meta.schema
        }
        dataspace = dataset.open(task.req.sources)
        metaProxy.index.id = metaIdProxy
        metaProxy.schema = parser.meta.schema
        //@TODO: add meta.index.references? and baseURL
        return true
    },
    update: async (task) => {
        if (task.req.meta.index) {
            parser.meta.index = task.req.meta.index
        }
        dataspace = dataset.append(task.req.source)
        return true
    },
    query: async (task) => {
        let response
        try {
            response = runQuery(
                task.req.path, task.req, task.req.body, task.timeout
            )
        }
        catch (error) {
            if (!parser.readFailure) {
                throw error
            }
        }
        // Query code can catch errors or throw its own properties. Only the
        // parser's host-owned failure state identifies a storage problem.
        if (parser.readFailure) {
            const error = {code: 500, message: 'Unable to read committed data'}
            return {
                code: 500,
                storageFailure: true,
                body: task.req.jsontag
                    ? JSONTag.stringify(error)
                    : JSON.stringify(error)
            }
        }
        return response
    },
    memoryUsage: async () => {
        let result = memoryUsage()
        console.log('memory',result)
        return result
    }
}

export default tasks

export function runQuery(pointer, request, query, timeout=1000) {
    if (!pointer) {
 throw new Error('missing pointer parameter')
}
    if (!request) {
 throw new Error('missing request parameter')
}
    let response = {
        jsontag: request.jsontag
    }
    let [result,path] = getDataSpace(pointer, dataspace)

    if (query) {
        // @todo add text search: https://github.com/nextapps-de/flexsearch
        // @todo replace VM with V8 isolate
        const vm = new VM({
            timeout: timeout,
            allowAsync: false,
            sandbox: {
                root: dataspace,
                data: result,
                meta: metaProxy,
                _,
                from,
                not,
                anyOf,
                allOf,
                asc,
                desc,
                sum,
                count,
                avg,
                max,
                min,
                many,
                one,
                first,
                distinct,
//                    console: connectConsole(res),
                JSONTag,
                request
            },
            wasm: false
        })
        try {
            result = vm.run(query)
            let used = Math.round(process.memoryUsage().heapUsed / 1024 / 1024);
            console.log(`(${used} MB)`);
        }
 catch(err) {
            console.log(err)
            response.code = 422;
            if (request.jsontag) {
                response.body = '<object class="Error">{"message":'+JSON.stringify(''+err)+',"code":422}'
            }
 else {
                response.body = JSON.stringify({message:err, code: 422})
            }
        }
    }
 else {
        result = linkReplacer(result, path+'/')
    }
    if (!response.code) {
        if (response.jsontag) {
            try {
                // JSONTag.stringify doesn't handle tagName/attributes well
                // with od-jsontag until result entries have been parsed.
                // only after parsing will these be available
                // Force parsing before formatting the query response.
                parseAllObjects(result)
                response.body = JSONTag.stringify(result)
            }
 catch(err) {
                console.log(err)
                response.code = 500
                response.body = '<object class="Error">{"message":'+JSON.stringify(''+err)+',"code":500}'
            }
        }
 else {
            //@FIXME: replace recursive links
            response.body = JSON.stringify(result)
        }
    }
    return response
}

let seen = new WeakMap()
function parseAllObjects(o, reset=true) {
    if (reset) {
        seen = new WeakMap()
    }
    if (seen.has(o)) {
        return
    }
    if (o && typeof o == 'object') {
        seen.set(o, true)
        if (Array.isArray(o)) {
            for (let v of o) {
                if (v && typeof v == 'object') {
                    parseAllObjects(v, false)
                }
            }
        }
 else if (o && typeof o == 'object') {
            for (let k of Object.keys(o)) {
                if (o[k] && typeof o[k]=='object') {
                    parseAllObjects(o[k], false)
                }
            }
        }
    }
}

export function getDataSpace(path, dataspace) {
    if (path.substring(path.length-1)=='/') {
        path = path.substring(0, path.length-1)
    } 
    const pointer = path.split('/')
    let result = dataspace
    for (const part of pointer) {
        if (part && result) {
            result = result[part]
        }
    }
    if (result===undefined) {
        result = JSONTag.parse(`<object class="Error">{"message":"Path Not found", "code":404, "path":"${path}"}`)
    }
    return [result,path]
}

export function linkReplacer(data, baseURL) {
    let type = JSONTag.getType(data)
    if (Array.isArray(data)) {
        data = data.map((entry,index) => {
            return linkReplacer(data[index], baseURL+index+'/')
        })
    }
 else if (type === 'link') {
        // do nothing
    }
 else if (data && typeof data === 'object') {
        if (data[source]) {
            data = data[source]
        }
        data = JSONTag.clone(data?.[source] ?? data)
        Object.keys(data).forEach(key => {
            if (Array.isArray(data[key])) {
                data[key] = new JSONTag.Link(baseURL+key+'/')
            }
 else if (data[key] && typeof data[key] === 'object') {
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