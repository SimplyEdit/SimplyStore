import { memoryUsage } from 'node:process'
import JSONTag from '@muze-nl/jsontag'
import { FileDataset } from './file-data.mjs'
import { isolatedQuery } from './query-isolate.mjs'

let dataset
let limits

function errorResponse(request, code, message) {
    // Error text is untrusted too; never return an arbitrarily large throw.
    const textLimit = Math.min(512, (limits?.maxResultBytes || 1024) / 8)
    const error = { code, message: String(message).slice(0, textLimit) }
    let body = JSON.stringify(error)
    if (request.jsontag) {
        JSONTag.setAttribute(error, 'class', 'Error')
        body = JSONTag.stringify(error)
    }
    return { code, jsontag: request.jsontag, body }
}

export default {
    async init(task) {
        dataset?.close()
        dataset = new FileDataset(task.req.meta)
        if (task.req.access) {
            const access = await import(task.req.access)
            dataset.parser.meta.access = access.default
        }
        limits = task.req.limits
        dataset.open(task.req.sources)
        return true
    },

    async update(task) {
        if (task.req.meta.index) {
            dataset.parser.meta.index = task.req.meta.index
        }
        dataset.append(task.req.source)
        return true
    },

    async query(task) {
        let response
        try {
            if (!dataset.parser.readFailure) {
                response = isolatedQuery(dataset, task.req, {
                    ...limits, timeout: task.timeout
                })
            }
        }
        catch (error) {
            let message = 'Query execution failed'
            if (typeof error === 'string') {
                message = error
            }
            else if (typeof error?.message === 'string') {
                message = error.message
            }
            response = errorResponse(task.req, 422, message)
        }
        // A query may catch read errors or forge error properties. Storage
        // failure is determined only by the host-owned parser state.
        if (dataset.parser.readFailure) {
            return {
                ...errorResponse(task.req, 500, 'Unable to read committed data'),
                storageFailure: true
            }
        }
        return response
    },

    async memoryUsage() {
        return memoryUsage()
    }
}
