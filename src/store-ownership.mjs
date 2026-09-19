import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import process from 'node:process'
import {randomUUID} from 'node:crypto'
import {publishFile, syncDirectory, syncAncestors} from './storage.mjs'

export async function acquireOwnership(directories, {ancestorToken, purpose, auditDir} = {}) {
    const canonical = [...new Set(await Promise.all(directories.map(dir => fs.realpath(dir))))].sort()
    for (const directory of canonical) {
        for (let parent = path.dirname(directory); ; parent = path.dirname(parent)) {
            if (!canonical.includes(parent)) {
                const lock = path.join(parent, '.simplystore-lock')
                try {
                    await fs.access(lock)
                    let owner
                    try { owner = JSON.parse(await fs.readFile(path.join(lock,'owner.json'),'utf8')) } catch { /* An incomplete lock remains exclusive. */ }
                    if (!ancestorToken || owner?.token !== ancestorToken) throw new Error(`Store is locked by unfinished parent operation: ${lock}`)
                } catch (error) { if (error.code !== 'ENOENT') throw error }
            }
            if (path.dirname(parent) === parent) break
        }
    }
    const token = randomUUID(), held = []
    try {
        for (const directory of canonical) {
            const lock = path.join(directory, '.simplystore-lock')
            try { await fs.mkdir(lock) } catch (error) {
                if (error.code === 'EEXIST') throw new Error(`Store is locked: ${lock}. Offline administrator inspection is required; do not automatically steal a lock.`)
                throw error
            }
            held.push(lock)
            await publishFile(path.join(lock, 'owner.json'), JSON.stringify({token, purpose, auditDir, pid: process.pid, host: os.hostname(), started: new Date().toISOString()}))
            await syncAncestors(directory)
        }
    } catch (error) {
        // No store writes have begun, so only our own acquired locks can be released.
        for (const lock of held.reverse()) { await fs.rm(lock, {recursive: true}); await syncDirectory(path.dirname(lock)) }
        throw error
    }
    return {token, directories: canonical, async release() {
        for (const lock of [...held].reverse()) {
            const owner = JSON.parse(await fs.readFile(path.join(lock, 'owner.json'), 'utf8'))
            if (owner.token !== token) throw new Error(`Ownership changed: ${lock}`)
            await fs.unlink(path.join(lock, 'owner.json'))
            await fs.rmdir(lock)
            await syncDirectory(path.dirname(lock))
        }
        held.length = 0
    }}
}
