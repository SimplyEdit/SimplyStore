import JSONTag from '@muze-nl/jsontag'
import {source, isChanged, getIndex, resultSet} from '@muze-nl/od-jsontag/src/symbols.mjs'
import parse from '@muze-nl/od-jsontag/src/parse.mjs'
import serialize, {stringify} from '@muze-nl/od-jsontag/src/serialize.mjs'
import * as FastJSONTag from '@muze-nl/od-jsontag/src/jsontag.mjs'
import writeFileAtomic from 'write-file-atomic'
import {_,from,not,anyOf,allOf,asc,desc,sum,count,avg,max,min} from 'jaqt'

let commands = {}
let resultArr = []
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
                    return resultArr[ref]
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
            resultArr[line] = ref
        }
    },
    get: (id) => {
        let index = meta.index.id.get(id)
        if (index || index===0) {
            return {
                deref: () => {
                    return resultArr[index]
                }
            }
        }
    },
    has: (id) => {
        return meta.index.id.has(id)
    }
}

export async function initialize(task) {
    dataspace = parse(task.data, task.meta, false) // false means mutable
    resultArr = dataspace[resultSet]
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
        //TODO: if command/task makes no changes, skip updating data.jsontag and writing it, skip response.data
        FastJSONTag.setAttribute(dataspace, 'command', task.id)

        const uint8sab = serialize(dataspace)
        response.data = uint8sab
        response.meta = {
            index: {
                id: meta.index.id
            }
        }
        //TODO: write data every x commands or x minutes, in seperate thread
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