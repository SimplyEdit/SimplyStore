import JSONTag from '@muze-nl/jsontag'
import {getIndex, resultSet} from '@muze-nl/od-jsontag/src/symbols.mjs'
import Parser from '@muze-nl/od-jsontag/src/parse.mjs'
import serialize from '@muze-nl/od-jsontag/src/serialize.mjs'
import writeFileAtomic from 'write-file-atomic'

let commands = {}
let resultArr = []
let dataspace
let datafile, basefile, extension
let meta = {}
let metaProxy = {
    index: {
    }
}
const parser = new Parser()
parser.immutable = false

export const metaIdProxy = {
    forEach: (callback) => {
        parser.meta.index.id.forEach((ref,id) => {
            callback({
                deref: () => {
                    return resultArr[ref]
                }
            },id)
        })
    },
    set: (id,ref) => {
        if (!parser.meta.index.id.has(id)) {
            if (ref[getIndex]) {
                parser.meta.index.id.set(id, ref[getIndex])
            } else {
                throw new Error('cannot set index.id for non-proxy')
            }
        } else {
            let line = parser.meta.index.id.get(id)
            resultArr[line] = ref
        }
    },
    get: (id) => {
        let index = parser.meta.index.id.get(id)
        if (index || index===0) {
            return {
                deref: () => {
                    return resultArr[index]
                }
            }
        }
    },
    has: (id) => {
        return parser.meta.index.id.has(id)
    }
}

const metaReadProxy = {
    foreach: metaProxy.forEach,
    get: metaProxy.get,
    has: metaProxy.has,
    set: meta.set
}

export async function initialize(task) {
    if (task.meta) {
        parser.meta = task.meta
    }
    for(let jsontag of task.data) {
        dataspace = parser.parse(jsontag)
    }
    resultArr = dataspace[resultSet]
    meta = task.meta
    metaProxy.index.id = metaIdProxy
    if (meta.schema) {
        metaProxy.schema = meta.schema
    }
    datafile = task.datafile
    extension = datafile.split('.').pop()
    basefile = datafile.substring(0, datafile.length - (extension.length + 1)) //+1 for . character
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
        
            const uint8sab = serialize(dataspace, {meta, changes: true}) // serialize only changes
            response.data = uint8sab
            response.meta = {
                index: {
                    id: meta.index.id
                }
            }
            //TODO: write data every x commands or x minutes, in seperate thread?

            let newfilename = basefile + '.' + task.id + '.' + extension
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