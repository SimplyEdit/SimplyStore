import fs from 'node:fs/promises'
import path from 'node:path'
import { FileDataset, validateUnsealedData } from './file-data.mjs'
import { indexPath } from './index-files.mjs'
import { serializeIntegrityRecords } from './integrity.mjs'
import { publishFile, syncFile } from './storage.mjs'
import { acquireOwnership } from './store-ownership.mjs'
import {
    storePaths, mutableDirectories, inspectUnsealedStore, inventory, hash
} from './store-inspection.mjs'

export async function initializeIntegrity(options = {}) {
    const config = storePaths(options)
    const ownership = await acquireOwnership(mutableDirectories(config), {
        purpose: 'initialize-integrity'
    })
    let publishing = false
    try {
        try {
            await fs.lstat(config.integrityFile)
            throw new Error('Integrity manifest already exists; initialization ' +
                'never replaces an established baseline')
        }
        catch (error) {
            if (error.code !== 'ENOENT') {
                throw error
            }
        }
        const report = await inspectUnsealedStore(config)
        if (!report.ready) {
            const problems = [...report.errors,
                ...report.commands.map(command => command.problem)
                    .filter(Boolean)]
            throw new Error('Store is not ready for integrity initialization: ' +
                (problems.join('; ') || 'pending or uncertain command history'))
        }
        const loaded = await validateUnsealedData({
            dataFile: config.datafile, commands: report.committed,
            schemaFile: config.schemaFile
        })
        const dataset = new FileDataset(loaded.meta)
        try {
            dataset.open(loaded.sources)
            // Decode every record during this explicit baseline operation.
            dataset.rebuildIds()
        }
        finally {
            dataset.close()
        }
        const meta = {data: path.dirname(config.datafile)}
        const digests = []
        for (const [part, source] of loaded.sources.entries()) {
            const command = part === 0 ? null : report.committed[part - 1]
            if (source.digest !== report.files[source.file]) {
                throw new Error('Store changed during integrity initialization')
            }
            digests.push([source.file, source.digest])
            for (const kind of ['offset', 'id']) {
                const file = indexPath(meta, kind, command)
                if (report.files[file] != null) {
                    digests.push([file, report.files[file]])
                }
            }
        }
        // Preserve the committed prefix before publishing its baseline.
        const files = new Set([...digests.map(([file]) => file),
            config.commandLog, config.commandStatus, ...config.requiredFiles])
        for (const file of files) {
            await syncFile(file)
        }
        const current = hash(JSON.stringify(await inventory(config)))
        if (current !== report.fingerprint) {
            throw new Error('Store changed during integrity initialization')
        }
        publishing = true
        await publishFile(config.integrityFile,
            serializeIntegrityRecords(config.integrityFile, digests) + '\n')
        await ownership.release()
        return {
            integrityFile: config.integrityFile,
            files: digests.length,
            committed: report.committed
        }
    }
    catch (error) {
        if (!publishing) {
            await ownership.release()
        }
        throw error
    }
}
