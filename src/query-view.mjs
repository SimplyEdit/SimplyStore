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

// Schema objects may be shared or cyclic, so a path does not identify them.
// Number them once per parsed schema, walking in property order, so the same
// schema yields the same handles in every worker and query. Handles stay in
// the bridge; query code never sees them.
const numberedSchemas = new WeakMap()

function numberSchema(schema) {
    const objects = []
    const handles = new Map()
    const pending = [schema]
    while (pending.length) {
        const value = pending.pop()
        if (!value || typeof value !== 'object' || handles.has(value)) {
            continue
        }
        handles.set(value, objects.length)
        objects.push(value)
        const keys = Object.keys(value)
        for (let index = keys.length - 1; index >= 0; index--) {
            pending.push(value[keys[index]])
        }
    }
    return { objects, handles }
}

function schemaHandles(schema) {
    if (!schema || typeof schema !== 'object') {
        return { objects: [], handles: new Map() }
    }
    let numbered = numberedSchemas.get(schema)
    if (!numbered) {
        numbered = numberSchema(schema)
        numberedSchemas.set(schema, numbered)
    }
    return numbered
}

export class QueryView {
    constructor(dataset, maxBytes) {
        this.dataset = dataset
        this.maxBytes = maxBytes
        this.schema = schemaHandles(dataset.parser.meta.schema)
        this.versionParsers = new Map()
        this.commands = dataset.history?.commands || []
        this.commandsById = new Map(
            this.commands.map(command => [command.id, command])
        )
    }

    virtual(reference, array = false, length) {
        return { reference, array, ...(array ? { length } : {}) }
    }

    versionParser(version) {
        if (!this.versionParsers.has(version)) {
            this.versionParsers.set(version,
                this.dataset.versionParser(version))
        }
        return this.versionParsers.get(version)?.parser
    }

    resolve(reference) {
        const [record, ...keys] = reference
        let value
        if (record === 'schema') {
            const handle = keys.shift()
            if (!Number.isSafeInteger(handle) ||
                handle < 0 || handle >= this.schema.objects.length) {
                throw new Error('Invalid query reference')
            }
            value = this.schema.objects[handle]
        }
        else if (record === 'historical') {
            const version = keys.shift()
            const number = keys.shift()
            const parser = this.versionParser(version)
            if (!parser) {
                throw new Error('Invalid dataset version')
            }
            value = parser.getLineProxy(number)
        }
        else if (record === 'command') {
            const version = keys.shift()
            const command = this.commands[version - 1]
            if (!command) {
                throw new Error('Invalid command version')
            }
            value = {
                id: command.id,
                name: command.name,
                author: command.author,
                message: command.message,
                timestamp: command.timestamp,
                version: command.version
            }
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
        const requestedReference = reference
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
        const handle = this.schema.handles.get(value)
        if (Number.isSafeInteger(record)) {
            const identified = JSONTag.getAttribute(value, 'id') !== undefined
            if (reference[0] === 'historical') {
                reference = ['historical', reference[1], record]
            }
            else {
                reference = [record]
            }
            if (!identified && requestedReference.length > 1) {
                // Identity follows the stored record; history follows the
                // identified owner through which this inline view was read.
                reference.historyReference = requestedReference
            }
        }
        else if (handle !== undefined) {
            reference = ['schema', handle]
        }
        const result = { reference, array: Array.isArray(value) }
        if (reference.historyReference) {
            result.historyReference = reference.historyReference
            delete reference.historyReference
        }
        if (result.array) {
            result.length = value.length
        }
        return result
    }

    read(operation, reference, key) {
        const history = this.readHistory(operation, reference, key)
        if (history !== undefined) {
            return history
        }
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

    readHistory(operation, reference, key) {
        if (operation === 'commands') {
            return this.virtual(['commands'], true, this.commands.length)
        }
        if (operation === 'command') {
            const command = this.commandsById.get(key)
            return command ? this.virtual(['command', command.version]) :
                { value: undefined }
        }
        if (operation === 'version') {
            if (!Number.isSafeInteger(key) || key < 0 ||
                key >= this.dataset.sources.length) {
                return { value: undefined }
            }
            return this.virtual(['version', key])
        }
        if (operation === 'history') {
            let record
            if (Array.isArray(key)) {
                if (typeof key[0] === 'number') {
                    record = key[0]
                }
                else if (key[0] === 'historical') {
                    record = key[2]
                }
            }
            else if (typeof key === 'string' || typeof key === 'number') {
                record = this.dataset.parser.meta.index?.id?.get(key)
            }
            if (!Number.isSafeInteger(record)) {
                return { value: undefined }
            }
            return this.virtual(['history', record], true,
                this.dataset.versions(record).length)
        }
        if (!reference || typeof reference[0] !== 'string') {
            return undefined
        }
        const type = reference[0]
        if (!['commands', 'version', 'versionObjects', 'history',
            'historyEntry'].includes(type)) {
            return undefined
        }
        if (operation === 'keys') {
            if (type === 'commands' || type === 'versionObjects' ||
                type === 'history') {
                const length = type === 'commands' ? this.commands.length :
                    type === 'versionObjects' ?
                        (this.dataset.sources[reference[1]].objects || [])
                            .length :
                        this.dataset.versions(reference[1]).length
                return [...Array(length).keys()].map(String).concat('length')
            }
            if (type === 'version') {
                return ['version', 'timestamp', 'command', 'objects']
            }
            return ['version', 'timestamp', 'command', 'object']
        }
        if (operation === 'has') {
            return this.readHistory('keys', reference).includes(String(key))
        }
        if (operation !== 'get') {
            return undefined
        }
        const name = String(key)
        if (type === 'commands') {
            if (name === 'length') {
                return this.entry(this.commands.length)
            }
            const index = Number(name)
            if (String(index) === name && this.commands[index]) {
                return this.entryDescription(
                    this.virtual(['command', this.commands[index].version]))
            }
            return { present: false }
        }
        if (type === 'version') {
            const version = reference[1]
            const source = this.dataset.sources[version]
            if (name === 'version') {
                return this.entry(version)
            }
            if (name === 'timestamp') {
                const timestamp = new Date(source.identity.modified)
                    .toISOString()
                return this.entry(timestamp)
            }
            if (name === 'command') {
                return this.entryDescription(version === 0 ? { value: null } :
                    this.virtual(['command', version]))
            }
            if (name === 'objects') {
                return this.entryDescription(this.virtual(
                    ['versionObjects', version], true,
                    (source.objects || []).length
                ))
            }
            return { present: false }
        }
        if (type === 'versionObjects') {
            const version = reference[1]
            const objects = this.dataset.sources[version].objects || []
            if (name === 'length') {
                return this.entry(objects.length)
            }
            const index = Number(name)
            if (String(index) === name && objects[index]) {
                return this.entryDescription(this.virtual([
                    'historical', version, objects[index].record
                ]))
            }
            return { present: false }
        }
        if (type === 'history') {
            const versions = this.dataset.versions(reference[1])
            if (name === 'length') {
                return this.entry(versions.length)
            }
            const index = Number(name)
            if (String(index) === name && versions[index]) {
                return this.entryDescription(this.virtual([
                    'historyEntry', reference[1], index
                ]))
            }
            return { present: false }
        }
        const record = reference[1]
        const version = this.dataset.versions(record)[reference[2]].version
        const source = this.dataset.sources[version]
        if (name === 'version') {
            return this.entry(version)
        }
        if (name === 'timestamp') {
            return this.entry(new Date(source.identity.modified).toISOString())
        }
        if (name === 'command') {
            return this.entryDescription(version === 0 ? { value: null } :
                this.virtual(['command', version]))
        }
        if (name === 'object') {
            return this.entryDescription(this.virtual([
                'historical', version, record
            ]))
        }
        return { present: false }
    }

    entry(value) {
        return this.entryDescription({ value })
    }

    entryDescription(entry) {
        return { present: true, enumerable: true, entry }
    }
}
