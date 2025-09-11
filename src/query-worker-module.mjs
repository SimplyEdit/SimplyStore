import pointer from 'json-pointer'
import {VM} from 'vm2'
import { memoryUsage } from 'node:process'
import JSONTag from '@muze-nl/jsontag'
import * as odJSONTag from '@muze-nl/od-jsontag/src/jsontag.mjs'
import {source, isProxy, resultSet} from '@muze-nl/od-jsontag/src/symbols.mjs'
import parse from '@muze-nl/od-jsontag/src/parse.mjs'
import {_,from,not,anyOf,allOf,asc,desc,sum,count,avg,max,min,many,one,distinct} from '@muze-nl/jaqt'

let dataspace
let meta = {}
let metaProxy = {
    index: {
    }
}

function protect(target) {
    if (target[source]) {
        throw new Error('Data is immutable')
    }
}

const myJSONTag = {
    getAttribute: odJSONTag.getAttribute,
    getAttributes: odJSONTag.getAttributes,
    getType: odJSONTag.getType,
    getTypeString: odJSONTag.getTypeString,
    setAttribute: (target, name, value) => {
        protect(target)
        return odJSONTag.setAttribute(target, name, value)
    },
    setType: (target, type) => {
        protect(target)
        return odJSONTag.setType(target, type)
    },
    setAttributes: (target, attributes) => {
        protect(target)
        return odJSONTag.setAttributes(target, attributes)
    },
    addAttribute: (target, name, value) => {
        protect(target)
        return odJSONTag.addAttribute(target, name, value)
    },
    removeAttribute: (target, name) => {
        protect(target)
        return odJSONTag.removeAttribute(target, name)
    },
    getAttributesString: odJSONTag.getAttributesString,
    isNull: odJSONTag.isNull,
    clone: JSONTag.clone,
    Link: JSONTag.Link,
    Null: JSONTag.Null
}

const metaIdProxy = {
    get: (id) => {
        let index = meta.index.id.get(id)
        if (index || index===0) {
            return meta.resultArray[index]
        }
    },
    has: (id) => {
        return meta.index.id.has(id)
    }
}

const tasks = {
    init: async (task) => {
        if (task.req.access) {
            task.req.access = await import(task.req.access)
            task.req.access = task.req.access.default
            meta.access = task.req.access
        }
        if (task.req.meta.index) {
            meta.index = task.req.meta.index
        }
        if (task.req.meta.schema) {
            meta.schema = task.req.meta.schema
        }
        for (let sab of task.req.body) { //body contains an array of sharedArrayBuffers with initial data and changes
            dataspace = parse(sab, meta)
        }
        metaProxy.index.id = metaIdProxy
        metaProxy.schema = meta.schema
        //@TODO: add meta.index.references? and baseURL
        return true
    },
    update: async (task) => {
        if (task.req.meta.index) {
            meta.index = task.req.meta.index
        }
        dataspace = parse(task.req.body, meta) //update only has a single changeset
        return true
    },
    query: async (task) => {
        return runQuery(task.req.path, task.req, task.req.body)
    },
    memoryUsage: async () => {
        let result = memoryUsage()
        console.log('memory',result)
        return result
    }
}

export default tasks

export function runQuery(pointer, request, query) {
    if (!pointer) { throw new Error('missing pointer parameter')}
    if (!request) { throw new Error('missing request parameter')}
    let response = {
        jsontag: request.jsontag
    }
    let [result,path] = getDataSpace(pointer, dataspace)

    if (query) {
        // @todo add text search: https://github.com/nextapps-de/flexsearch
        // @todo replace VM with V8 isolate
        const vm = new VM({
            timeout: 1000,
            allowAsync: false,
            sandbox: {
                root: dataspace, //@TODO: if we don't pass the root, we can later shard
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
                distinct,
//                    console: connectConsole(res),
                JSONTag: myJSONTag,
                request
            },
            wasm: false
        })
        try {
            result = vm.run(query)
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
        let temp = o[source]
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
    return [result,path]
}

export function linkReplacer(data, baseURL) {
    let type = JSONTag.getType(data)
    let attributes = JSONTag.getAttributes(data)
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