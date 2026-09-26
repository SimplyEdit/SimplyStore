import JSONTag from '@muze-nl/jsontag'
import * as jaqt from '@muze-nl/jaqt'

// Bundled as pure JavaScript. This module never imports host APIs. Callbacks
// remain private to this closure, and exchange only copied data.
export function prepare(read, validURL, initial) {
    const symbols = [
        Symbol['JSONTag:Type'],
        Symbol['JSONTag:Attributes'],
        Symbol['JSONTag:Null']
    ]
    const setPrototype = Object.setPrototypeOf
    const freeze = Object.freeze
    const WeakReference = WeakRef
    const stringifyTagged = JSONTag.stringify
    const stringify = JSON.stringify
    const parse = JSONTag.parse
    const charCode = Function.prototype.call.bind(String.prototype.charCodeAt)
    const Cache = Map
    const cache = new Cache()
    const getCached = cache.get.bind(cache)
    const setCached = cache.set.bind(cache)
    const cacheHas = Function.prototype.call.bind(Map.prototype.has)
    const cacheGet = Function.prototype.call.bind(Map.prototype.get)
    const cacheSet = Function.prototype.call.bind(Map.prototype.set)
    const dereference = Function.prototype.call.bind(WeakRef.prototype.deref)
    const makeWeak = value => new WeakReference(value)
    const metadataKey = key => symbols.indexOf(key)
    const immutable = () => {
        throw new Error('dataspace is immutable')
    }
    JSONTag.Parser.prototype.isUrl = function (url) {
        if (!validURL(String(url), String(this.meta.baseURL))) {
            this.typeError('url', url)
        }
        return true
    }

    function wrap(description) {
        setPrototype(description, null)
        if ('tagged' in description) {
            return parse(description.tagged)
        }
        if (!description.reference) {
            return description.value
        }
        const reference = description.reference
        setPrototype(reference, null)
        freeze(reference)
        const key = stringify(reference)
        const cached = getCached(key)
        if (cached) {
            const existing = dereference(cached)
            if (existing) {
                return existing
            }
        }
        let target = {}
        if (description.array) {
            target = new Array(description.length)
            Object.defineProperty(target, 'length', { writable: false })
        }
        const remoteKey = key => {
            if (typeof key === 'symbol') {
                return metadataKey(key)
            }
            return key
        }
        // Data cannot change during a query, so each host answer is read once.
        // Shared objects are then traversed without repeating host calls.
        // Descriptions are cached, not values: tagged copies stay fresh.
        const reads = new Cache()
        const exists = new Cache()
        let keys
        const readOnce = (answers, operation, encoded) => {
            if (!cacheHas(answers, encoded)) {
                cacheSet(answers, encoded, read(operation, reference, encoded))
            }
            return cacheGet(answers, encoded)
        }
        const proxy = new Proxy(target, {
            get(target, key, receiver) {
                const encoded = remoteKey(key)
                if (encoded !== -1) {
                    const result = readOnce(reads, 'get', encoded)
                    if (result.present) {
                        return wrap(result.entry)
                    }
                }
                return Reflect.get(target, key, receiver)
            },
            has(target, key) {
                const encoded = remoteKey(key)
                return (encoded !== -1 && readOnce(exists, 'has', encoded)) ||
                    Reflect.has(target, key)
            },
            ownKeys() {
                if (!keys) {
                    keys = read('keys', reference)
                }
                const names = []
                for (let index = 0; index < keys.length; index++) {
                    const key = keys[index]
                    if (typeof key === 'number') {
                        names[index] = symbols[key]
                    }
                    else {
                        names[index] = key
                    }
                }
                return names
            },
            getOwnPropertyDescriptor(target, key) {
                if (description.array && key === 'length') {
                    return Reflect.getOwnPropertyDescriptor(target, key)
                }
                const encoded = remoteKey(key)
                if (encoded === -1) {
                    return undefined
                }
                const result = readOnce(reads, 'get', encoded)
                if (!result.present) {
                    return undefined
                }
                return {
                    value: wrap(result.entry),
                    enumerable: result.enumerable,
                    configurable: true,
                    writable: false
                }
            },
            set: immutable,
            deleteProperty: immutable,
            defineProperty: immutable,
            setPrototypeOf: immutable,
            preventExtensions: immutable
        })
        setCached(key, makeWeak(proxy))
        return proxy
    }

    const root = wrap(initial.root)
    const meta = {
        index: {
            id: {
                get(id) {
                    if (typeof id !== 'string' && typeof id !== 'number') {
                        return undefined
                    }
                    return wrap(read('id', null, id))
                },
                has(id) {
                    if (typeof id !== 'string' && typeof id !== 'number') {
                        return false
                    }
                    return read('hasId', null, id)
                }
            }
        },
        schema: wrap(initial.schema)
    }
    const request = initial.request
    const taggedResponse = Boolean(request.jsontag)
    const browse = !request.body
    const [data, path] = getDataSpace(request.path, root)
    Object.assign(globalThis, jaqt, { root, data, meta, request, JSONTag })
    delete globalThis.WebAssembly
    delete globalThis.SharedArrayBuffer
    delete globalThis.Atomics

    // Keep the limit and length calculation outside query-writable globals.
    const maxBytes = initial.maxBytes
    function checkSize(text) {
        if (text === undefined) {
            return
        }
        let bytes = 0
        for (let index = 0; index < text.length; index++) {
            const code = charCode(text, index)
            if (code < 0x80) {
                bytes++
            }
            else if (code < 0x800) {
                bytes += 2
            }
            else if (code >= 0xd800 && code <= 0xdbff &&
                charCode(text, index + 1) >= 0xdc00 &&
                charCode(text, index + 1) <= 0xdfff) {
                bytes += 4
                index++
            }
            else {
                bytes += 3
            }
            if (bytes > maxBytes) {
                throw new Error('Query result exceeds the result size limit')
            }
        }
    }
    return result => {
        if (result && typeof result.then === 'function') {
            throw new Error('Asynchronous queries are not supported')
        }
        if (browse) {
            result = linkReplacer(result, path + '/')
        }
        let body
        if (taggedResponse) {
            parseAllObjects(result)
            body = stringifyTagged(result)
        }
        else {
            body = stringify(result)
        }
        if (body !== undefined && typeof body !== 'string') {
            throw new Error('Invalid serialized query result')
        }
        checkSize(body)
        return body
    }
}

function getDataSpace(path, root) {
    if (!path) {
        throw new Error('missing pointer parameter')
    }
    if (path.endsWith('/')) {
        path = path.slice(0, -1)
    }
    let data = root
    for (const part of path.split('/')) {
        if (part && data) {
            data = data[part]
        }
    }
    if (data === undefined) {
        data = JSONTag.parse('<object class="Error">' + JSON.stringify({
            message: 'Path Not found', code: 404, path
        }))
    }
    return [data, path]
}

function parseAllObjects(value, seen = new WeakSet()) {
    if (!value || typeof value !== 'object' || seen.has(value)) {
        return
    }
    seen.add(value)
    for (const key of Object.keys(value)) {
        parseAllObjects(value[key], seen)
    }
}

function linkReplacer(data, baseURL) {
    if (Array.isArray(data)) {
        return data.map((value, index) => {
            return linkReplacer(value, baseURL + index + '/')
        })
    }
    if (!data || typeof data !== 'object' || JSONTag.getType(data) === 'link') {
        return data
    }
    // Read through the authorized view, never through a parser source symbol.
    const copy = {}
    JSONTag.setAttributes(copy, JSONTag.getAttributes(data))
    for (const key of Object.keys(data)) {
        const value = data[key]
        if (Array.isArray(value)) {
            copy[key] = new JSONTag.Link(baseURL + key + '/')
        }
        else if (value && typeof value === 'object' &&
            JSONTag.getType(value) === 'object') {
            const id = JSONTag.getAttribute(value, 'id')
            copy[key] = new JSONTag.Link(id || baseURL + key + '/')
        }
        else {
            copy[key] = value
        }
    }
    return copy
}
