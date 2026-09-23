import fs from 'node:fs'
import path from 'node:path'
import { appendIntegrityRecord, verifyIntegrity } from './integrity.mjs'

export function indexPath(meta, kind, command = null) {
    const suffix = command === null ? '' : `.${command}`
    return path.join(meta.data, `index.${kind}${suffix}.json`)
}

export function readIndexFile(file, options = {}) {
    const bytes = fs.readFileSync(file)
    if (options.manifest) {
        verifyIntegrity(options.manifest, options.integrityFile, file, bytes, {
            required: options.integrityRequired
        })
    }
    return JSON.parse(bytes)
}

export function loadStoredIndex(index, meta, command, options = {}) {
    if (options.rebuildIndexes) {
        return undefined
    }
    try {
        return index.load(meta, command, options)
    }
    catch (error) {
        if (error.code !== 'ENOENT') {
            throw error
        }
        return undefined
    }
}

// Finalizers have completed all writes before these bytes are fingerprinted.
export async function appendIndexIntegrity(
    integrityFile, meta, command = null
) {
    for (const kind of ['offset', 'id']) {
        const file = indexPath(meta, kind, command)
        let bytes
        try {
            bytes = fs.readFileSync(file)
        }
        catch (error) {
            if (error.code === 'ENOENT') {
                continue
            }
            throw error
        }
        await appendIntegrityRecord(integrityFile, file, bytes)
    }
}
