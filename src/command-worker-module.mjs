import JSONTag from '@muze-nl/jsontag'
import {source, isChanged, getIndex} from './symbols.mjs'
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
        if (!meta.index.id.has(id)) {
            if (ref[getIndex]) {
                meta.index.id.set(id, ref[getIndex])
            } else {
                throw new Error('cannot set index.id for non-proxy')
            }
        } else {
            let line = meta.index.id.get(id)
            resultSet[line] = ref
        }
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
    getType: (obj) => JSONTag.getType(obj?.[source]),
    getAttribute: (obj, attr) => JSONTag.getAttribute(obj?.[source],attr),
    setAttribute: (obj, attr, value) => {
        if (!obj) return
        obj[isChanged] = true
        return JSONTag.setAttribute(obj[source], attr, value)
    },
    getAttributes: (obj) => JSONTag.getAttributes(obj?.[source]),
    getAttributeString: (obj) => JSONTag.getAttributesString(obj?.[source]),
    getTypeString: (obj) => JSONTag.getTypeString(obj?.[source])
}

export async function initialize(task) {
    resultSet = fastParse(task.data, task.meta, false) // false means mutable
    dataspace = resultSet[0]
    meta = task.meta
    metaProxy.index.id = metaIdProxy
    datafile = task.datafile
    commands = await import(task.commandsFile).then(mod => {
        console.log('commands loaded:',Object.keys(mod.default))
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
        let time = Date.now()
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
        let end = Date.now()
        console.log('task time',end-time)
    } else {
        console.error('Command not found', task.name)
        throw {
            code: 404,
            message: "Command "+task.name+" not found"
        }
    }
    return response
}

