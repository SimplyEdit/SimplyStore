import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { performance } from 'node:perf_hooks'
import { fileURLToPath } from 'node:url'
import StoreRuntime from '../src/store-runtime.mjs'
import { hashFile } from '../src/file-data.mjs'
import { appendArtifactIntegrity } from '../src/index-files.mjs'
import { getDefaultIntegrityFile } from '../src/integrity.mjs'

const argumentsByName = Object.fromEntries(process.argv.slice(2).map(value => {
    return value.replace(/^--/, '').split('=')
}))
const records = Number(argumentsByName.records || 1000)
const versions = Number(argumentsByName.versions || 20)
if (!Number.isSafeInteger(records) || records < 1 ||
    !Number.isSafeInteger(versions) || versions < 1) {
    throw new Error('records and versions must be positive integers')
}

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), 'simplystore-history-bench-')
)
const datafile = path.join(directory, 'data.jsontag')
const commandLog = path.join(directory, 'command-log.jsontag')
const commandStatus = path.join(directory, 'command-status.jsontag')
const commandsFile = path.join(directory, 'commands.mjs')
const indexFile = path.join(root, 'src/index.mjs')
let runtime

function descriptorCount() {
    try {
        return fs.readdirSync('/proc/self/fd').length
    }
    catch {
        return null
    }
}

try {
    const handle = fs.openSync(datafile, 'w')
    const offsets = {}
    const ids = {}
    let fileOffset = 0
    const writeRecord = (record, text, id) => {
        const prefix = `(${Buffer.byteLength(text)})`
        const bytes = Buffer.from(`${prefix}${text}\n`)
        offsets[record] = [
            fileOffset + prefix.length, fileOffset + bytes.length - 1
        ]
        if (id) {
            ids[id] = record
        }
        let offset = 0
        while (offset < bytes.length) {
            offset += fs.writeSync(
                handle, bytes, offset, bytes.length - offset
            )
        }
        fileOffset += bytes.length
    }
    try {
        writeRecord(0, `{"items":[~1-${records}]}`)
        for (let record = 1; record <= records; record++) {
            writeRecord(record,
                `<object id="item-${record}">{"value":0}`,
                `item-${record}`)
        }
    }
    finally {
        fs.closeSync(handle)
    }
    fs.writeFileSync(path.join(directory, 'index.offset.json'),
        JSON.stringify(offsets))
    fs.writeFileSync(path.join(directory, 'index.id.json'),
        JSON.stringify(ids))
    fs.writeFileSync(commandLog, '')
    fs.writeFileSync(commandStatus, '')
    fs.writeFileSync(commandsFile, `export default {
        edit(data, command) {
            data.items[command.record - 1].value = command.value
        }
    }`)
    await appendArtifactIntegrity(getDefaultIntegrityFile(datafile),
        datafile, hashFile(datafile), {data: directory})

    const options = {
        datafile, commandLog, commandStatus, commandsFile, indexFile,
        maxWorkers: 1, timeout: 10000, slowTimeout: 10000
    }
    runtime = await StoreRuntime.open(options)
    for (let version = 1; version <= versions; version++) {
        await runtime.acceptCommand(JSON.stringify({
            id: `edit-${version}`,
            name: 'edit',
            record: records,
            value: version,
            author: 'history benchmark',
            message: `Edit ${version}`
        }))
        await runtime.runQueuedCommands()
    }
    await runtime.close()
    runtime = null

    const descriptorsBefore = descriptorCount()
    const opening = performance.now()
    runtime = await StoreRuntime.open(options)
    const openMs = performance.now() - opening
    const before = await runtime.queryWorkerPool.run('historyStats', {})
    const memoryBefore = await runtime.queryWorkerPool.memoryUsage()
    const descriptorsAfterOpen = descriptorCount()

    const querying = performance.now()
    const response = await runtime.runQuery({
        path: '/',
        jsontag: false,
        body: `({
            history: meta.history.get('item-${records}').map(entry =>
                entry.object.value),
            peers: meta.versions.get(${versions}).objects.length,
            input: meta.commands.get('edit-${versions}').input.value
        })`
    })
    const queryMs = performance.now() - querying
    if (response.code) {
        throw new Error(response.body)
    }
    const result = JSON.parse(response.body)
    if (result.history.length !== versions + 1 ||
        result.history.at(-1) !== versions || result.peers !== 1 ||
        result.input !== versions) {
        throw new Error(`Unexpected history result: ${response.body}`)
    }
    const after = await runtime.queryWorkerPool.run('historyStats', {})
    const memoryAfter = await runtime.queryWorkerPool.memoryUsage()

    console.log(JSON.stringify({
        records,
        versions,
        openMs,
        queryMs,
        descriptors: {
            beforeOpen: descriptorsBefore,
            afterOpen: descriptorsAfterOpen,
            afterQuery: descriptorCount()
        },
        worker: {
            heapUsedBefore: memoryBefore.heapUsed,
            heapUsedAfter: memoryAfter.heapUsed,
            residentCurrentRecordsBefore: before.residentCurrentRecords,
            residentCurrentRecordsAfter: after.residentCurrentRecords,
            sources: after.sources
        }
    }, null, 2))
}
finally {
    await runtime?.close()
    fs.rmSync(directory, {recursive: true, force: true})
}
