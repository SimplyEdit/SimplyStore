import ivm from 'isolated-vm'
import { buildSync } from 'esbuild'
import { fileURLToPath } from 'node:url'
import { performance } from 'node:perf_hooks'
import { QueryView } from './query-view.mjs'

// Compile trusted helpers once per worker, outside query execution. esbuild
// resolves their imports here; the guest receives no module-loading capability.
const bundle = buildSync({
    entryPoints: [fileURLToPath(new URL('./query-guest.mjs', import.meta.url))],
    bundle: true,
    platform: 'neutral',
    mainFields: ['main'],
    format: 'iife',
    globalName: 'guest',
    write: false
}).outputFiles[0].text

export function isolatedQuery(dataset, request, {
    timeout = 1000, memoryLimit = 64, maxResultBytes = 10 * 1024 * 1024
} = {}) {
    const isolate = new ivm.Isolate({ memoryLimit })
    const start = performance.now()
    const remaining = () => {
        const duration = Math.ceil(timeout - (performance.now() - start))
        if (duration <= 0) {
            throw new Error('Query execution timed out')
        }
        return duration
    }
    let render
    let result
    try {
        const context = isolate.createContextSync()
        const view = new QueryView(dataset, maxResultBytes)
        const initial = {
            root: view.describe(dataset.root, [0]),
            schema: view.describe(dataset.parser.meta.schema, ['schema']),
            request,
            maxBytes: maxResultBytes
        }
        const read = new ivm.Callback((...args) => {
            remaining()
            return view.read(...args)
        })
        const validURL = new ivm.Callback((url, base) => {
            try {
                return Boolean(new URL(url, base))
            }
            catch {
                return false
            }
        })
        const input = new ivm.ExternalCopy(initial).copyInto({release: true})
        render = context.evalClosureSync(
            bundle + '\nreturn guest.prepare($0, $1, $2)',
            [read, validURL, input],
            { timeout: remaining(), result: { reference: true } }
        )
        result = context.evalSync(request.body || 'data', {
            timeout: remaining(), reference: true
        })
        const body = render.applySync(undefined, [result.derefInto()], {
            timeout: remaining(), result: { copy: true }
        })
        return { jsontag: request.jsontag, body }
    }
    finally {
        result?.release()
        render?.release()
        if (!isolate.isDisposed) {
            isolate.dispose()
        }
    }
}
