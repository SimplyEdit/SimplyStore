import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { performance } from 'node:perf_hooks'
import { fileURLToPath } from 'node:url'
import StoreRuntime from '../src/store-runtime.mjs'

const args = Object.fromEntries(process.argv.slice(2).map(argument => {
    return argument.replace(/^--/, '').split('=')
}))
const records = Number(args.records || 20000)
const payload = Number(args.payload || 16384)
if (!Number.isSafeInteger(records) || records < 1 ||
    !Number.isSafeInteger(payload) || payload < 1) {
    throw new Error('records and payload must be positive integers')
}
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'simplystore-file-bench-'))
const datafile = path.join(dir, 'data.jsontag')
let runtime
try {
    const fd = fs.openSync(datafile, 'w')
    try {
        const writeRecord = text => {
            const bytes = Buffer.from(`(${Buffer.byteLength(text)})${text}\n`)
            let offset = 0
            while (offset < bytes.length) {
                offset += fs.writeSync(fd, bytes, offset)
            }
        }
        writeRecord(`{"items":[~1-${records}]}`)
        const padding = 'x'.repeat(payload)
        for (let number = 1; number <= records; number++) {
            writeRecord(`<object id="item-${number}">${JSON.stringify({
                number, padding
            })}`)
        }
    }
    finally {
        fs.closeSync(fd)
    }
    const commandLog = path.join(dir, 'command-log.jsontag')
    const commandStatus = path.join(dir, 'command-status.jsontag')
    fs.writeFileSync(commandLog, '')
    fs.writeFileSync(commandStatus, '')
    const started = performance.now()
    runtime = await StoreRuntime.open({
        datafile, commandLog, commandStatus, maxWorkers: 1,
        loadTimeout: 0, slowTimeout: 120000,
        commandsFile: fileURLToPath(new URL('../src/commands.mjs', import.meta.url))
    })
    const openMs = performance.now() - started
    const queried = performance.now()
    const response = await runtime.runQuery({
        path: '/', jsontag: false,
        body: `meta.index.id.get('item-${records}').number`
    }, { slow: true })
    if (response.code || JSON.parse(response.body) !== records) {
        throw new Error(`Query failed: ${JSON.stringify(response)}`)
    }
    const queryMs = performance.now() - queried
    global.gc?.()
    const memory = process.memoryUsage()
    const workerMemory = await runtime.slowQueryWorkerPool.memoryUsage()
    console.log(JSON.stringify({
        bytes: fs.statSync(datafile).size, records, openMs, queryMs,
        sources: runtime.sources.length,
        idCount: runtime.meta.index.id.size,
        parent: {
            heapUsed: memory.heapUsed, arrayBuffers: memory.arrayBuffers
        },
        worker: {
            heapUsed: workerMemory.heapUsed,
            arrayBuffers: workerMemory.arrayBuffers
        }
    }, null, 2))
}
finally {
    await runtime?.close()
    fs.rmSync(dir, { recursive: true, force: true })
}
