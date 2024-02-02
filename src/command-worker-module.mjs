import pointer from 'json-pointer'
import JSONTag from '@muze-nl/jsontag'
import {source} from '../src/symbols.mjs'
import fastParse from '../src/fastParse.mjs'
import fastStringify, {stringToSAB,resultSetStringify} from '../src/fastStringify.mjs'
import writeFileAtomic from 'write-file-atomic'

let commands = {}
let resultSet = []
let dataspace
let datafile
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
    setAttribute: (obj, attr, value) => JSONTag.setAttribute(obj[source], attr, value),
    getAttributes: (obj) => JSONTag.getAttributes(obj[source]),
    getAttributeString: (obj) => JSONTag.getAttributesString(obj[source]),
    getTypeString: (obj) => JSONTag.getTypeString(obj[source])
}

export async function initialize(task) {
    resultSet = fastParse(task.data)
    dataspace = resultSet[0]
    meta = task.meta
    metaProxy.index.id = metaIdProxy
    datafile = task.datafile
    commands = await import(task.commandsFile).then(mod => {
        return mod.default
    })
}

export default async function runCommand(task, request) {
    if (!task.id) { throw new Error('missing command id')}
    if (!task.name) { throw new Error('missing command name parameter')}
    let response = {
        jsontag: true
    }
    if (commands[task.name]) {
        try {
            commands[task.name](dataspace, task, request, metaProxy)
            console.log('dataspace',dataspace,dataspace.people)
            FastJSONTag.setAttribute(dataspace, 'command', task.id)
            //@TODO: fastStringify should return sharedarraybuffer           
            const strData = resultSetStringify(resultSet)
            console.log('string result', strData)
            const uint8sab = stringToSAB(strData)
            response.data = uint8sab
            response.meta = meta

//            console.log('writing file', datafile)
            await writeFileAtomic(datafile, uint8sab)
            console.log('data written to ', datafile)
        } catch(err) {
            console.error('error',err)
            response.code = 422;
            response.body = '<object class="Error">{"message":'+JSON.stringify(''+err)+',"code":422}'
        }
    } else {
        console.error('Command not found', task.name, commands)
        response.code = 404
        response.body = '<object class="Error">{"message":"Command '+task.name+' not found","code":404}'
    }
    return response
}

