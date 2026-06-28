import ivm from 'isolated-vm'
import { memoryUsage } from 'node:process'
import JSONTag from '@muze-nl/jsontag'
import {source, position} from '@muze-nl/od-jsontag/src/symbols.mjs'
import Parser from '@muze-nl/od-jsontag/src/parse.mjs'
import {_,from,not,anyOf,allOf,asc,desc,sum,count,avg,max,min,many,one,first,distinct} from '@muze-nl/jaqt'
import process from 'node:process'

let dataspace
let metaProxy = {
    index: {
    }
}
let queryViewState = null

const parser = new Parser()

const metaIdProxy = {
    get: (id) => {
        let index = parser.meta.index.id.get(id)
        if (index || index===0) {
            return parser.meta.resultArray[index]
        }
    },
    has: (id) => {
        return parser.meta.index.id.has(id)
    }
}

function decodeSlice(input, start, end) {
    let text = ''
    for (let i = start; i < end; i++) {
        text += String.fromCharCode(input[i])
    }
    return text
}

function parseLine(input, start, end) {
    const text = decodeSlice(input, start, end)
    const transformed = text.replace(/~(\d+)/g, (_, index) => JSON.stringify({ __ref: Number(index) }))
    return JSON.parse(transformed)
}

function materializeInto(value, target, view, cache) {
    if (value === null || typeof value !== 'object') {
        return value
    }
    if (value.__ref !== undefined) {
        return resolveRef(view, value.__ref, cache)
    }
    if (Array.isArray(value)) {
        const result = Array.isArray(target) ? target : []
        value.forEach((entry, index) => {
            if (result[index] === undefined) {
                result[index] = materializeInto(entry, undefined, view, cache)
            } else {
                result[index] = materializeInto(entry, result[index], view, cache)
            }
        })
        return result
    }
    const result = target && typeof target === 'object' && !Array.isArray(target) ? target : {}
    Object.keys(value).forEach((key) => {
        result[key] = materializeInto(value[key], result[key], view, cache)
    })
    return result
}

function resolveRef(view, index, cache) {
    if (cache.has(index)) {
        return cache.get(index)
    }
    const line = view.offsetIndex[index]
    if (!line || !view.input) {
        return null
    }
    const parsed = parseLine(view.input, line[0], line[1])
    const placeholder = Array.isArray(parsed) ? [] : {}
    cache.set(index, placeholder)
    return materializeInto(parsed, placeholder, view, cache)
}

function createLazyRoot(view) {
    const rootLine = view.offsetIndex[0]
    if (!rootLine || !view.input) {
        return null
    }
    const cache = new Map()
    return resolveRef(view, 0, cache)
}

function buildQueryView() {
    const resultArray = parser.meta.resultArray || []
    const offsetIndex = {}
    const idIndex = {}
    for (let index = 0; index < resultArray.length; index++) {
        const entry = resultArray[index]
        const pos = entry?.[position]
        if (pos && pos.input && typeof pos.start === 'number' && typeof pos.end === 'number') {
            offsetIndex[index] = [pos.start, pos.end]
        }
    }
    if (parser.meta.index?.id) {
        for (const [id, index] of parser.meta.index.id.entries()) {
            idIndex[id] = index
        }
    }
    return {
        input: resultArray[0]?.[position]?.input ?? null,
        offsetIndex,
        idIndex,
        rootIndex: 0
    }
}

function getQueryView() {
    if (!queryViewState) {
        queryViewState = buildQueryView()
    }
    return queryViewState
}

const tasks = {
    init: async (task) => {
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
        queryViewState = null
        for (let sab of task.req.body) { //body contains an array of sharedArrayBuffers with initial data and changes
            dataspace = parser.parse(sab)
        }
        metaProxy.index.id = metaIdProxy
        metaProxy.schema = parser.meta.schema
        //@TODO: add meta.index.references? and baseURL
        return true
    },
    update: async (task) => {
        if (task.req.meta.index) {
            parser.meta.index = task.req.meta.index
        }
        queryViewState = null
        dataspace = parser.parse(task.req.body) //update only has a single changeset
        return true
    },
    query: async (task) => {
        return runQuery(task.req.path, task.req, task.req.body, task.timeout)
    },
    memoryUsage: async () => {
        let result = memoryUsage()
        console.log('memory',result)
        return result
    }
}

export default tasks

export function runQuery(pointer, request, query, timeout=1000) {
    if (!pointer) { throw new Error('missing pointer parameter')}
    if (!request) { throw new Error('missing request parameter')}
    let response = {
        jsontag: request.jsontag
    }
    let [result,path] = getDataSpace(pointer, dataspace)
    const view = getQueryView()

    if (query) {
        // @todo add text search: https://github.com/nextapps-de/flexsearch
        const isolate = new ivm.Isolate({ memoryLimit: 128 })
        const context = isolate.createContextSync()
        const jail = context.global
        const root = createLazyRoot(view)
        const sandbox = {
            root,
            data: null,
            meta: {
                index: {
                    id: view.idIndex,
                    offset: view.offsetIndex
                },
                schema: metaProxy.schema
            },
            request: { jsontag: request.jsontag },
            _: _,
            from: typeof from === 'function' ? new ivm.Callback(from) : undefined,
            not: typeof not === 'function' ? new ivm.Callback(not) : undefined,
            anyOf: typeof anyOf === 'function' ? new ivm.Callback(anyOf) : undefined,
            allOf: typeof allOf === 'function' ? new ivm.Callback(allOf) : undefined,
            asc: typeof asc === 'function' ? new ivm.Callback(asc) : undefined,
            desc: typeof desc === 'function' ? new ivm.Callback(desc) : undefined,
            sum: typeof sum === 'function' ? new ivm.Callback(sum) : undefined,
            count: typeof count === 'function' ? new ivm.Callback(count) : undefined,
            avg: typeof avg === 'function' ? new ivm.Callback(avg) : undefined,
            max: typeof max === 'function' ? new ivm.Callback(max) : undefined,
            min: typeof min === 'function' ? new ivm.Callback(min) : undefined,
            many: typeof many === 'function' ? new ivm.Callback(many) : undefined,
            one: typeof one === 'function' ? new ivm.Callback(one) : undefined,
            first: typeof first === 'function' ? new ivm.Callback(first) : undefined,
            distinct: typeof distinct === 'function' ? new ivm.Callback(distinct) : undefined
        }
        Object.entries(sandbox).forEach(([key, value]) => {
            if (value instanceof ivm.Callback) {
                jail.setSync(key, value)
            } else if (value && typeof value === 'object') {
                jail.setSync(key, value, { copy: true })
            } else if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean' || value === null || value === undefined) {
                jail.setSync(key, value)
            }
        })
        try {
            const script = `
                (function () {
                    globalThis.data = globalThis.root;
                    return (${query});
                })()
            `
            const value = context.evalSync(script, { timeout, result: { copy: true } })
            result = value
            let used = Math.round(process.memoryUsage().heapUsed / 1024 / 1024);
            console.log(`(${used} MB)`);
        } catch(err) {
            console.log(err)
            response.code = 422;
            if (request.jsontag) {
                response.body = '<object class="Error">{"message":'+JSON.stringify(''+err)+',"code":422}'
            } else {
                response.body = JSON.stringify({message:err, code: 422})
            }
        } finally {
            isolate.dispose()
        }
    } else {
        result = linkReplacer(result, path+'/')
    }
    if (!response.code) {
        if (response.jsontag) {
            try {
                // JSONTag.stringify doesn't handle tagName/attributes well
                // with od-jsontag, since some entries in result haven't been parsed yet
                // only after parsing will these be available
                // so force parsing of all result - od-jsontag should have its own stringify
                parseAllObjects(result)
                response.body = JSONTag.stringify(result)
            } catch(err) {
                console.log(err)
                response.code = 500
                response.body = '<object class="Error">{"message":'+JSON.stringify(''+err)+',"code":500}'
            }
        } else {
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
        } else if (o && typeof o == 'object') {
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
    } else if (type === 'link') {
        // do nothing
    } else if (data && typeof data === 'object') {
        if (data[source]) {
            data = data[source]
        }
        data = JSONTag.clone(data?.[source] ?? data)
        Object.keys(data).forEach(key => {
            if (Array.isArray(data[key])) {
                data[key] = new JSONTag.Link(baseURL+key+'/')
            } else if (data[key] && typeof data[key] === 'object') {
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