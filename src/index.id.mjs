import { readIndexFile } from './index-files.mjs'
import path from 'node:path'
import JSONTag from '@muze-nl/jsontag'
import { getIndex, isChanged } from '@muze-nl/od-jsontag/src/symbols.mjs'
import { publishFileSync } from './storage.mjs'
import { scanOdJsonTagRecords } from './recovery.mjs'

export function addUniqueId(ids, id, number) {
    if (!id) {
        return
    }
    if (typeof id !== 'string') {
        throw new Error('Record IDs must be strings')
    }
    if (ids.has(id) && ids.get(id) !== number) {
        throw new Error(`Duplicate ID: ${id}`)
    }
    ids.set(id, number)
}

export function readIdEntries(value, records) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new Error('Invalid ID index: expected an object')
    }
    const entries = new Map()
    const assigned = new Set()
    for (const [id, number] of Object.entries(value)) {
        if (!id || !Number.isSafeInteger(number) || number < 0 ||
            !records.has(number) || assigned.has(number)) {
            throw new Error(`Invalid ID index entry: ${id}`)
        }
        assigned.add(number)
        entries.set(id, number)
    }
    return entries
}

export function mergeIdIndex(ids, records, entries) {
    // Remove all replaced records first, allowing ID swaps within one command.
    for (const [id, number] of ids) {
        if (records.has(number)) {
            ids.delete(id)
        }
    }
    for (const [id, number] of entries) {
        addUniqueId(ids, id, number)
    }
    return ids
}

export function markIdChanges(meta, committedIds) {
    const original = new Map([...committedIds].map(([id, number]) => {
        return [number, id]
    }))
    // JSONTag edits its attribute object in place. Check only materialized
    // records so ID-only mutations participate in change serialization.
    for (const value of Object.values(meta.resultArray)) {
        if (value && JSONTag.getAttribute(value, 'id') !==
            original.get(value[getIndex])) {
            value[isChanged] = true
        }
    }
}

export function prepareIdIndex(serialized, committedIds = new Map()) {
    let bytes
    if (typeof serialized === 'string') {
        bytes = Buffer.from(serialized)
    }
    else {
        bytes = Buffer.from(serialized.buffer,
            serialized.byteOffset, serialized.byteLength)
    }
    const entries = new Map()
    const records = new Set()
    const parser = new JSONTag.Parser()
    scanOdJsonTagRecords(bytes, 'serialized data', 'ID index source',
        (number, start, end) => {
            records.add(number)
            // Command output is already buffered. Decode one record at a time,
            // but parse only its leading tag; references need no resolution.
            parser.input = bytes.toString('utf8', start, end)
            parser.at = 0
            parser.ch = ' '
            parser.whitespace()
            if (parser.ch === '<') {
                const value = {}
                JSONTag.setAttributes(value, parser.tag().attributes)
                addUniqueId(entries, JSONTag.getAttribute(value, 'id'), number)
            }
        })
    const ids = mergeIdIndex(new Map(committedIds), records, entries)
    return { entries, ids }
}

function filename(meta, uuid) {
    let name = 'index.id.json'
    if (uuid !== null) {
        name = `index.id.${uuid}.json`
    }
    return path.join(meta.data, name)
}

export default {
    write(meta, entries, uuid = null) {
        publishFileSync(filename(meta, uuid),
            JSON.stringify(Object.fromEntries(entries)))
    },
    load(meta, uuid = null, options = {}) {
        return readIndexFile(filename(meta, uuid), options)
    }
}
