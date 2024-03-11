import JSONTag from '@muze-nl/jsontag'
import fastParse from './fastParse.mjs'
import {source, isProxy} from './symbols.mjs'
import {_,from,not,anyOf,allOf,asc,desc,sum,count,avg,max,min} from 'jaqt'
import pointer from 'json-pointer'
import {VM} from 'vm2'
import { memoryUsage } from 'node:process'

let resultSet = []
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
            return resultSet[index]
        }
    },
    has: (id) => {
        return meta.index.id.has(id)
    }
}

const FastJSONTag = {
    getType: (obj) => JSONTag.getType(obj?.[source]),
    getAttribute: (obj, attr) => JSONTag.getAttribute(obj?.[source],attr),
    getAttributes: (obj) => JSONTag.getAttributes(obj?.[source]),
    getAttributeString: (obj) => JSONTag.getAttributesString(obj?.[source]),
    getTypeString: (obj) => JSONTag.getTypeString(obj?.[source])
}

const tasks = {
	init: async (task) => {
		resultSet = fastParse(task.req.body)
		dataspace = resultSet[0]
        meta = task.req.meta
        metaProxy.index.id = metaIdProxy
        //@TODO: add references and baseURL
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
                JSONTag: FastJSONTag,
                request
            },
            wasm: false
        })
        try {
            result = deProxy(vm.run(query))
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
        data = JSONTag.clone(data)
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

let seen = new WeakMap()
function deProxy(o) {
    if (!o) {
        return o
    }
    if (typeof o !== 'object') {
        return o
    }
    if (seen.has(o)) {
        return seen.get(o)
    }
    let result
    if (Array.isArray(o)) {
        result = o.map(deProxy)
    } else if (JSONTag.isNull(o)) {
        return o
    } else if (JSONTag.getType(o)==='object' && o[source]) {
        result = JSONTag.clone(o[source])
        seen.set(o, result)
        Object.entries(o[source]).forEach(([i,v]) => {
            result[i] = deProxy(v)
        })
    } else {
        seen.set(o, o)
        result = o
    }
    return result
}
