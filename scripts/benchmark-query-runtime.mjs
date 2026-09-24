import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import assert from 'node:assert/strict'
import { performance } from 'node:perf_hooks'
import StoreRuntime from '../src/store-runtime.mjs'
import { appendIntegrityRecord } from '../src/integrity.mjs'

function median(values) {
    return [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)]
}

async function benchmark(count) {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'query-bench-'))
    let runtime
    try {
        const chunks = []
        const values = []
        for (let index = 0; index <= count; index++) {
            let body = `{"items":[~1-${count}]}`
            if (index) {
                const value = {
                    name: 'Padmé 𠮷 ' + index, value: index,
                    group: index % 20, active: index % 3 === 0,
                    note: 'Unicode café 日本語 ' + 'x'.repeat(index % 80)
                }
                values.push(value)
                body = `<object id="${index}">` + JSON.stringify(value)
            }
            chunks.push(`(${Buffer.byteLength(body)})${body}\n`)
        }
        const bytes = Buffer.from(chunks.join(''))
        const datafile = path.join(directory, 'data.jsontag')
        const integrityFile = path.join(directory, 'data.integrity.jsontag')
        const access = path.join(directory, 'access.mjs')
        await fs.writeFile(datafile, bytes)
        await fs.writeFile(path.join(directory, 'command-log.jsontag'), '')
        await fs.writeFile(path.join(directory, 'command-status.jsontag'), '')
        await fs.writeFile(access, `export default (object, property) => {
            return property !== 'denied'
        }`)
        await appendIntegrityRecord(integrityFile, datafile, bytes)
        runtime = await StoreRuntime.open({
            datafile, integrityFile, access, maxWorkers: 1, timeout: 10000,
            commandLog: path.join(directory, 'command-log.jsontag'),
            commandStatus: path.join(directory, 'command-status.jsontag')
        })
        const queries = [
            ['scan', 'data.items.reduce((s,x)=>s+x.value,0)',
                count * (count + 1) / 2],
            ['filter_sort_project', `data.items.filter(x=>x.active&&
                x.value>${count / 2}).sort((a,b)=>b.value-a.value)
                .slice(0,50).map(x=>({name:x.name,value:x.value}))`,
            values.filter(value => value.active && value.value > count / 2)
                .sort((a, b) => b.value - a.value).slice(0, 50)
                .map(value => ({name: value.name, value: value.value}))],
            ['serialize_1000', `data.items.slice(0,1000).map(x=>({
                name:x.name,value:x.value,note:x.note}))`,
            values.slice(0, 1000).map(value => ({
                name: value.name, value: value.value, note: value.note
            }))]
        ]
        const results = []
        // Finish worker initialization before measuring any query.
        await runtime.runQuery({path: '/', body: '1', jsontag: false})
        for (const [name, body, expected] of queries) {
            const samples = []
            for (let iteration = 0; iteration < 7; iteration++) {
                const start = performance.now()
                const result = await runtime.runQuery({
                    path: '/', body, jsontag: false
                })
                const duration = performance.now() - start
                assert.equal(result.code, undefined, result.body)
                assert.deepEqual(JSON.parse(result.body), expected)
                if (iteration >= 2) {
                    samples.push(duration)
                }
            }
            results.push({name, samples, median: median(samples)})
        }
        return {records: count, fileBytes: bytes.length, results}
    }
    finally {
        await runtime?.close()
        await fs.rm(directory, {recursive: true, force: true})
    }
}

const results = []
for (const count of [1000, 10000]) {
    results.push(await benchmark(count))
}
console.log(JSON.stringify({
    node: process.version,
    cpu: os.cpus()[0].model,
    description: 'Fresh isolates, host grants, file reads and worker messaging',
    results
}, null, 2))
