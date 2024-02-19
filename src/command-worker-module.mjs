import JSONTag from '@muze-nl/jsontag'
import {source} from './symbols.mjs'
import fastParse from './fastParse.mjs'
import {stringToSAB,resultSetStringify} from './fastStringify.mjs'
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

export const metaIdProxy = {
    forEach: (callback) => {
        meta.index.id.forEach((ref,id) => {
            callback({
                deref: () => {
                    return resultSet[ref]
                }
            },id)
        })
    },
    set: (id,ref) => {
        //FICME: is this correct?
        meta.index.id.set(id, resultSet.length-1)
    },
    get: (id) => {
        let index = meta.index.id.get(id)
        if (index || index===0) {
            return {
                deref: () => {
                    return resultSet[index]
                }
            }
        }
    },
    has: (id) => {
        return meta.index.id.has(id)
    }
}

export const FastJSONTag = {
    getType: (obj) => JSONTag.getType(obj[source]),
    getAttribute: (obj, attr) => JSONTag.getAttribute(obj[source],attr),
    setAttribute: (obj, attr, value) => JSONTag.setAttribute(obj[source], attr, value),
    getAttributes: (obj) => JSONTag.getAttributes(obj[source]),
    getAttributeString: (obj) => JSONTag.getAttributesString(obj[source]),
    getTypeString: (obj) => JSONTag.getTypeString(obj[source])
}

export async function initialize(task) {
    resultSet = fastParse(task.data, task.meta, false) // false means mutable
    dataspace = resultSet[0]
    meta = task.meta
    metaProxy.index.id = metaIdProxy
    datafile = task.datafile
    commands = await import(task.commandsFile).then(mod => {
        return mod.default
    })
}

export default async function runCommand(commandStr, request) {
    let task = JSONTag.parse(commandStr, null, metaProxy)
    if (!task.id) { throw new Error('missing command id')}
    if (!task.name) { throw new Error('missing command name parameter')}
    let response = {
        jsontag: true
    }
    if (commands[task.name]) {
        try {
            commands[task.name](dataspace, task, request, metaProxy)
            FastJSONTag.setAttribute(dataspace, 'command', task.id)

            const strData = resultSetStringify(resultSet)
            const uint8sab = stringToSAB(strData)
            response.data = uint8sab
            response.meta = {
                index: {
                    id: meta.index.id
                }
            }

            await writeFileAtomic(datafile, uint8sab)
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

