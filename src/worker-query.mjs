import JSONTag from "@muze-nl/jsontag"
import pointer from 'json-pointer'
import {_,from,not,anyOf,allOf} from 'array-where-select'
import {deepFreeze} from './util.mjs'
import {VM} from 'vm2'

let dataspace, meta = {};

export function setDataspace(d, m) {
    dataspace = d
    if(m) {
        meta = m
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
            result = JSONTag.parse('<object class="Error">{"message":'+originalJSON.stringify(err.message)+', "code":500}')
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

//@TODO: emit console events that server.mjs picks up
function connectConsole(res) {
    return {
        log: function(...args) {
//            res.append('X-Console-Log', joinArgs(args))
        },
        warning: function(...args) {
//            res.append('X-Console-Warning', joinArgs(args))
        },
        error: function(...args) {
//            res.append('X-Console-Error', joinArgs(args))            
        }
    }
}

export async function initialize(jsontag) {
//    console.log('hier dan')
    if (!jsontag) { throw new Error('missing jsontag parameter')}
//    console.log('starting initialize')
	dataspace = jsontag
//    console.log('so far')
    deepFreeze(dataspace)
//    console.log('initialized query worker thread')
    return true
}

export function runQuery({pointer, request, query}) {
    if (!pointer) { throw new Error('missing pointer parameter')}
    if (!request) { throw new Error('missing request parameter')}
	console.log('query',pointer)
	let response = {
        jsontag: request.jsontag
    }
    let [result,path] = getDataSpace(pointer, dataspace)

    if (query) {
        // @todo add text search: https://github.com/nextapps-de/flexsearch
        // @todo add tree walk map/reduce/find/filter style functions
        // @todo add arc tree dive function?
        // @todo replace VM with V8 isolate
        const vm = new VM({
            timeout: 1000,
            allowAsync: false,
            sandbox: {
                root: dataspace, //@TODO: if we don't pass the root, we can later shard
                data: result,
                meta: meta,
                _: _,
                from: from,
                not: not,
                anyOf: anyOf,
                allOf: allOf,
//                    console: connectConsole(res),
                JSONTag: JSONTag,
                request: request
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
            	response.body = '<object class="Error">{"message":'+originalJSON.stringify(''+err)+',"code":422}'
            } else {
            	response.body = JSON.stringify({message:err, code: 422})
            }
        }
    } else {
        result = linkReplacer(result, path+'/')
    }
    if (!response.code) {
        if (response.jsontag) {
        	response.body = JSONTag.stringify(result)
        } else {
        	response.body = JSON.stringify(result)
        }
    }
    return response
}