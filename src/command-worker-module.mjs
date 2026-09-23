import JSONTag from '@muze-nl/jsontag'
import {
    getIndex,
    isChanged
} from '@muze-nl/od-jsontag/src/symbols.mjs'
import { FileDataset, loadDataSource } from './file-data.mjs'
import { serializeChunks } from '@muze-nl/od-jsontag/src/serialize.mjs'
import { publishFile as writeFileAtomic, storageError } from './storage.mjs'
import { faultPoint } from './faults.mjs'
import { appendArtifactIntegrity } from './index-files.mjs'
import { getDefaultIntegrityFile, digestBuffer } from './integrity.mjs'
import { finalizeIndex } from './index.mjs'
import { markIdChanges, prepareIdIndex } from './index.id.mjs'

let commands = {}
let index = {}
let dataset
let parser
let dataspace
let datafile, basefile, extension, integrityFile
let committedIds = new Map()
let meta = {}
let metaProxy = {
    index: {}
}

export const metaIdProxy = {
    forEach: callback => {
        parser.meta.index.id.forEach((ref, id) => {
            callback(
                {
                    deref: () => {
                        return parser.getLineProxy(ref)
                    }
                },
                id
            )
        })
    },
    set: (id, ref) => {
        if (!parser.meta.index.id.has(id)) {
            if (ref[getIndex]) {
                parser.meta.index.id.set(id, ref[getIndex])
            }
            else {
                throw new Error('cannot set index.id for non-proxy')
            }
        }
        else {
            let line = parser.meta.index.id.get(id)
            parser.meta.resultArray[line] = ref
        }
    },
    get: id => {
        let index = parser.meta.index.id.get(id)
        if (index || index === 0) {
            return {
                deref: () => {
                    return parser.getLineProxy(index)
                }
            }
        }
    },
    has: id => {
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
    close()
    try {
        committedIds = new Map(task.meta.index.id)
        dataset = new FileDataset(task.meta, false)
        parser = dataset.parser
        dataspace = dataset.open(task.sources)
        meta = parser.meta
        metaProxy.index.id = metaIdProxy
        if (meta.schema) {
            metaProxy.schema = meta.schema
        }
        datafile = task.datafile
        integrityFile = task.deferIntegrityPublication ? null :
            task.integrityFile || getDefaultIntegrityFile(datafile)
        extension = datafile.split('.').pop()
        // Include the dot before the extension.
        basefile = datafile.substring(
            0, datafile.length - (extension.length + 1)
        )
        commands = await import(task.commandsFile).then(mod => {
            return mod.default
        })
        index = await import(task.indexFile).then(mod => {
            return mod.default
        })
    }
    catch (error) {
        close()
        throw error
    }
}

export default async function runCommand(commandStr) {
    let response = {
        jsontag: true
    }
    let publishing = false
    try {
        let task = JSONTag.parse(commandStr, null, metaReadProxy)
        if (!task.id) {
            throw new Error('missing command id')
        }
        if (!task.name) {
            throw new Error('missing command name parameter')
        }
        if (commands[task.name]) {
            let time = Date.now()
            await commands[task.name](dataspace, task, undefined, metaProxy)
            if (parser.readFailure) {
                throw parser.readFailure
            }
            // TODO: if command/task makes no changes, skip updating
            // data.jsontag and writing it.

            markIdChanges(meta, committedIds)
            const changes = meta.resultArray.filter(e => e[isChanged])
            //FIXME: new entities should also report isChanged = true
            if (changes.length) {
                changes.uuid = task.id
                await index.update(dataspace, meta, changes)
            }
            if (parser.readFailure) {
                throw parser.readFailure
            }
            markIdChanges(meta, committedIds)
            // Serialize only changes.
            const serialized = Buffer.concat([
                ...serializeChunks(dataspace, { meta, changes: true })
            ])
            const prepared = prepareIdIndex(serialized, committedIds)
            const expectedDigest = digestBuffer(serialized)
            // TODO: write data every x commands or x minutes,
            // in a separate thread?

            let newfilename = basefile + '.' + task.id + '.' + extension
            publishing = true
            await faultPoint('before-command-changeset-write')
            await writeFileAtomic(newfilename, serialized)
            // Final bytes include new records and mutations made by the custom
            // index hook.
            await finalizeIndex(index, serialized, meta, task.id, prepared)
            response.source = loadDataSource(newfilename, meta, task.id)
            if (response.source.digest !== expectedDigest ||
                digestBuffer(serialized) !== expectedDigest) {
                throw new Error('Changeset changed during finalization')
            }
            response.meta = { index: { id: prepared.ids } }
            if (integrityFile) {
                await appendArtifactIntegrity(integrityFile, newfilename,
                    expectedDigest, meta, task.id)
            }
            await faultPoint('after-command-changeset-write')
            meta.parts++
            response.meta.parts = meta.parts
            let end = Date.now()
            console.log('task time', end - time)
        }
        else {
            console.error('Command not found', task.name)
            throw {
                code: 404,
                message: 'Command ' + task.name + ' not found'
            }
        }
    }
    catch (err) {
        console.error('task error', err)
        if (parser.readFailure) {
            throw parser.readFailure
        }
        throw publishing ? storageError(err) : err
    }
    return response
}

export function close() {
    if (dataset) {
        dataset.close()
        dataset = undefined
        parser = undefined
        dataspace = undefined
        meta = {}
        committedIds = new Map()
    }
}
