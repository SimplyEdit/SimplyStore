import pointer from 'json-pointer'
import JSONTag from '@muze-nl/jsontag'
import commands from './commands.mjs'

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
        if (index) {
            return resultSet[index]
        }
    },
    has: (id) => {
        return meta.index.id.has(id)
    }
}

const FastJSONTag = {
    getType: (obj) => JSONTag.getType(obj[source]),
    getAttribute: (obj, attr) => JSONTag.getAttribute(obj[source],attr),
    getAttributes: (obj) => JSONTag.getAttributes(obj[source]),
    getAttributeString: (obj) => JSONTag.getAttributesString(obj[source]),
    getTypeString: (obj) => JSONTag.getTypeString(obj[source])
}

export function initialize(task) {
    resultSet = fastParse(task.data)
    dataspace = resultSet[0]
    meta = task.meta
    metaProxy.index.id = metaIdProxy    
}

export default function runCommand(task) {
    if (!task.name) { throw new Error('missing command name parameter')}
    if (!task.request) { throw new Error('missing request parameter')}
    let response = {
        jsontag: true
    }
    if (commands[task.name]) {
        try {
            initialize(task)
            //@TODO: dataspace is immutable, so use produce here
            //need a version that is aware of the valueProxy stuff
            commands[task.name](dataspace, task, metaProxy)
            response.body = JSONTag.stringify(dataspace) //@TODO: this is inefficient, patch would be better
        } catch(err) {
            console.log(err)
            response.code = 422;
            response.body = '<object class="Error">{"message":'+JSON.stringify(''+err)+',"code":422}'
        }
    } else {
        response.code = 404
        response.body = '<object class="Error">{"message":"Command '+command.name+' not found","code":404}'
    }
    return response
}

