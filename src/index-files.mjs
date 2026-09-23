import fs from 'node:fs'
import path from 'node:path'
import { appendIntegrityDigests, digestBuffer, verifyIntegrity }
    from './integrity.mjs'

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
export function indexDigests(meta, command = null) {
    const digests = []
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
        digests.push([file, digestBuffer(bytes)])
    }
    return digests
}

export async function appendIndexIntegrity(
    integrityFile, meta, command = null
) {
    await appendIntegrityDigests(integrityFile, indexDigests(meta, command))
}

export async function appendArtifactIntegrity(
    integrityFile, file, digest, meta, command = null
) {
    await appendIntegrityDigests(integrityFile, [
        [file, digest], ...indexDigests(meta, command)
    ])
}
