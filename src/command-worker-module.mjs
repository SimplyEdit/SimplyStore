import JSONTag from '@muze-nl/jsontag'
import {getIndex, resultSet} from '@muze-nl/od-jsontag/src/symbols.mjs'
import parse from '@muze-nl/od-jsontag/src/parse.mjs'
import serialize from '@muze-nl/od-jsontag/src/serialize.mjs'
import writeFileAtomic from 'write-file-atomic'

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

const metaReadProxy = {
    foreach: metaProxy.forEach,
    get: metaProxy.get,
    has: metaProxy.has,
    set: meta.set
}

export async function initialize(task) {
    for(let jsontag of task.data) {
        dataspace = parse(jsontag, task.meta, false) // false means mutable
    }
    resultArr = dataspace[resultSet]
    meta = task.meta
    metaProxy.index.id = metaIdProxy
    if (meta.schema) {
        metaProxy.schema = meta.schema
    }
    datafile = task.datafile
    commands = await import(task.commandsFile).then(mod => {
        return mod.default
    })
}

export default async function runCommand(commandStr, request) {
    let response = {
        jsontag: true
    }
    try {
        let task = JSONTag.parse(commandStr, null, metaReadProxy)
        if (!task.id) { throw new Error('missing command id')}
        if (!task.name) { throw new Error('missing command name parameter')}
        if (commands[task.name]) {
            let time = Date.now()
            commands[task.name](dataspace, task, request, metaProxy)
            //TODO: if command/task makes no changes, skip updating data.jsontag and writing it, skip response.data
            JSONTag.setAttribute(dataspace, 'command', task.id)
        
            const uint8sab = serialize(dataspace, {meta, changes: true}) // serialize only changes
            response.data = uint8sab
            response.meta = {
                index: {
                    id: meta.index.id
                }
            }
            //TODO: write data every x commands or x minutes, in seperate thread

            let newfilename = datafile + (meta.parts ? '.'+meta.parts : '')
            await writeFileAtomic(newfilename, uint8sab)
            meta.parts++
            response.meta.parts = meta.parts
            let end = Date.now()
            console.log('task time',end-time)
        } else {
            console.error('Command not found', task.name)
            throw {
                code: 404,
                message: "Command "+task.name+" not found"
            }
        }
    } catch(err) {
        console.error('task error', err)
        throw err
    }
    return response
}