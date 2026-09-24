import JSONTag from '@muze-nl/jsontag'
import { getIndex } from '@muze-nl/od-jsontag/src/symbols.mjs'

// Only JSONTag's public metadata crosses the query boundary. Parser symbols
// contain source/cache state and must never be discoverable by a query.
const metadataSymbols = [
    Symbol['JSONTag:Type'],
    Symbol['JSONTag:Attributes'],
    Symbol['JSONTag:Null']
]

function property(key) {
    if (typeof key === 'string') {
        return key
    }
    if (Number.isInteger(key) && metadataSymbols[key]) {
        return metadataSymbols[key]
    }
    throw new Error('Invalid query property')
}

export class QueryView {
    constructor(dataset, maxBytes) {
        this.dataset = dataset
        this.maxBytes = maxBytes
    }

    resolve(reference) {
        const [record, ...keys] = reference
        let value
        if (record === 'schema') {
            value = this.dataset.parser.meta.schema
        }
        else {
            value = this.dataset.parser.getLineProxy(record)
        }
        for (const key of keys) {
            value = value[property(key)]
        }
        return value
    }

    describe(value, reference) {
        if (typeof value === 'function') {
            throw new Error('Functions are not query data')
        }
        if (typeof value === 'symbol') {
            return { value: undefined }
        }
        if (typeof value === 'string' &&
            Buffer.byteLength(value) > this.maxBytes) {
            throw new Error('Query value exceeds the result size limit')
        }
        if (!value || typeof value !== 'object') {
            return { value }
        }
        const type = JSONTag.getType(value)
        if (type !== 'object' && type !== 'array' || JSONTag.isNull(value)) {
            const tagged = JSONTag.stringify(value)
            if (Buffer.byteLength(tagged) > this.maxBytes) {
                throw new Error('Query value exceeds the result size limit')
            }
            return { tagged }
        }
        const record = value[getIndex]
        if (Number.isSafeInteger(record)) {
            reference = [record]
        }
        const result = { reference, array: Array.isArray(value) }
        if (result.array) {
            result.length = value.length
        }
        return result
    }

    read(operation, reference, key) {
        if (operation === 'id') {
            const index = this.dataset.parser.meta.index?.id
            if (!index?.has(key)) {
                return { value: undefined }
            }
            const record = index.get(key)
            return this.describe(this.dataset.parser.getLineProxy(record),
                [record])
        }
        if (operation === 'hasId') {
            return this.dataset.parser.meta.index?.id?.has(key) || false
        }
        const value = this.resolve(reference)
        if (operation === 'keys') {
            if (Array.isArray(value) && value.length > this.maxBytes / 16) {
                throw new Error('Query keys exceed the result size limit')
            }
            const keys = []
            let bytes = 0
            for (const name of Reflect.ownKeys(value)) {
                let key = name
                if (typeof name === 'symbol') {
                    key = metadataSymbols.indexOf(name)
                    if (key === -1) {
                        continue
                    }
                }
                bytes += String(key).length * 2 + 16
                if (bytes > this.maxBytes) {
                    throw new Error('Query keys exceed the result size limit')
                }
                keys.push(key)
            }
            return keys
        }
        const name = property(key)
        // The parser's descriptor trap applies the same grants as reading.
        // Never forward a host prototype or function into the isolate.
        if (operation === 'has') {
            return Reflect.has(value, name)
        }
        const descriptor = Reflect.getOwnPropertyDescriptor(value, name)
        if (!descriptor) {
            return { present: false }
        }
        return {
            present: true,
            enumerable: descriptor.enumerable,
            entry: this.describe(value[name], [...reference, key])
        }
    }
}
