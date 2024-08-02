import pointer from 'json-pointer'
import {VM} from 'vm2'
import { memoryUsage } from 'node:process'
import JSONTag from '@muze-nl/jsontag'
import {source, isProxy, resultSet} from '@muze-nl/od-jsontag/src/symbols.mjs'
import parse from '@muze-nl/od-jsontag/src/parse.mjs'
import {_,from,not,anyOf,allOf,asc,desc,sum,count,avg,max,min} from 'jaqt'

let resultArr = []
let dataspace
let meta = {}
let metaProxy = {
    index: {
    }
}

const metaIdProxy = {
    get: (id) => {
        let index = meta.index.id.get(id)
        if (index || index===0) {
            return resultArr[index]
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
        for (let sab of task.req.body) { //body contains an array of sharedArrayBuffers with initial data and changes
            dataspace = parse(sab, meta)
        }
        resultArr = meta.resultArray
        metaProxy.index.id = metaIdProxy
        //@TODO: add meta.index.references? and baseURL
        return true
    },
    update: async (task) => {
        if (task.req.meta.index) {
            meta.index = task.req.meta.index
        }
        dataspace = parse(task.req.body, meta) //update only has a single changeset
        resultArr = meta.resultArray
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