import { Buffer } from 'node:buffer'
import fs from 'node:fs/promises'
import net from 'node:net'
import path from 'node:path'
import os from 'node:os'
import process from 'node:process'
import { randomUUID } from 'node:crypto'
import { publishFile, syncDirectory, syncAncestors } from './storage.mjs'

const lockName = '.simplystore-lock'
const takeoverName = '.simplystore-lock.takeover'
const auditName = '.simplystore-takeovers.jsonl'
// A Unix socket path holds at most 107 bytes plus a terminating zero.
const maxSocketPath = 107
const probeTimeout = 1000

// The owner listens on a socket in its lock. The kernel refuses connections
// once the owning process has ended, however it ended: that is the proof a
// restarting server needs. Without a socket, only an administrator may
// release the lock.
async function listenForLiveness(lock) {
    const socket = path.join(lock, 'owner.sock')
    if (Buffer.byteLength(socket) > maxSocketPath) {
        return null
    }
    const server = net.createServer(connection => {
        connection.end()
    })
    try {
        await new Promise((resolve, reject) => {
            server.once('error', reject)
            server.listen(socket, resolve)
        })
    }
    catch {
        return null
    }
    server.unref()
    return server
}

function probeLiveness(lock) {
    return new Promise(resolve => {
        const connection = net.connect(path.join(lock, 'owner.sock'))
        const timer = setTimeout(() => {
            connection.destroy()
            resolve('timeout')
        }, probeTimeout)
        connection.once('connect', () => {
            clearTimeout(timer)
            connection.destroy()
            resolve('alive')
        })
        connection.once('error', error => {
            clearTimeout(timer)
            resolve(error.code || 'error')
        })
    })
}

async function readOwner(lock) {
    try {
        return JSON.parse(
            await fs.readFile(path.join(lock, 'owner.json'), 'utf8')
        )
    }
    catch {
        return null
    }
}

// Only a runtime owner with a liveness socket that refuses connections is
// proven gone. Everything else, including errors and timeouts, is no proof.
async function provenDeadOwner(lock) {
    const owner = await readOwner(lock)
    if (owner?.purpose !== 'runtime' || owner.liveness !== 'socket') {
        return null
    }
    if (await probeLiveness(lock) !== 'ECONNREFUSED') {
        return null
    }
    return owner
}

async function createLock(lock) {
    try {
        await fs.mkdir(lock)
        return true
    }
    catch (error) {
        if (error.code === 'EEXIST') {
            return false
        }
        throw error
    }
}

async function appendTakeoverAudit(directory, record) {
    const file = await fs.open(path.join(directory, auditName), 'a')
    try {
        await file.write(JSON.stringify(record) + '\n')
        await file.sync()
    }
    finally {
        await file.close()
    }
}

// Takeovers serialize on a takeover directory. Holding it, re-check that the
// same owner is still proven gone, record the takeover, move its lock aside
// and create ours. A leftover takeover directory blocks until an
// administrator releases it.
async function takeOverDeadLock(directory, token) {
    const lock = path.join(directory, lockName)
    const dead = await provenDeadOwner(lock)
    if (!dead) {
        return null
    }
    const takeover = path.join(directory, takeoverName)
    if (!await createLock(takeover)) {
        throw new Error(
            `Store lock takeover is in progress or was interrupted: ${takeover}. Offline administrator release is required if no server is starting.`
        )
    }
    const again = await provenDeadOwner(lock)
    if (again?.token !== dead.token) {
        await fs.rmdir(takeover)
        return null
    }
    await appendTakeoverAudit(directory, {
        time: new Date().toISOString(),
        token,
        pid: process.pid,
        host: os.hostname(),
        proof: 'ECONNREFUSED',
        previous: again
    })
    const previous = path.join(takeover, 'previous')
    await fs.rename(lock, previous)
    const created = await createLock(lock)
    await fs.rm(previous, { recursive: true })
    await fs.rmdir(takeover)
    await syncDirectory(directory)
    if (!created) {
        return null
    }
    return again
}

export async function acquireOwnership(
    directories,
    { ancestorToken, purpose, auditDir } = {}
) {
    const canonical = [
        ...new Set(await Promise.all(directories.map(dir => fs.realpath(dir))))
    ].sort()
    for (const directory of canonical) {
        for (
            let parent = path.dirname(directory);
            ;
            parent = path.dirname(parent)
        ) {
            if (!canonical.includes(parent)) {
                const lock = path.join(parent, '.simplystore-lock')
                try {
                    await fs.access(lock)
                    let owner
                    try {
                        owner = JSON.parse(
                            await fs.readFile(
                                path.join(lock, 'owner.json'),
                                'utf8'
                            )
                        )
                    }
                    catch {
                        /* An incomplete lock remains exclusive. */
                    }
                    if (!ancestorToken || owner?.token !== ancestorToken) {
                        throw new Error(
                            `Store is locked by unfinished parent operation: ${lock}`
                        )
                    }
                }
                catch (error) {
                    if (error.code !== 'ENOENT') {
                        throw error
                    }
                }
            }
            if (path.dirname(parent) === parent) {
                break
            }
        }
    }
    const token = randomUUID(),
        held = [],
        servers = new Map(),
        takeovers = []
    try {
        for (const directory of canonical) {
            const lock = path.join(directory, lockName)
            let created = await createLock(lock)
            if (!created && purpose === 'runtime') {
                const previous = await takeOverDeadLock(directory, token)
                if (previous) {
                    takeovers.push({ lock, previous })
                    created = true
                }
            }
            if (!created) {
                throw new Error(
                    `Store is locked: ${lock}. The owner may still run; offline administrator inspection is required.`
                )
            }
            held.push(lock)
            const server = await listenForLiveness(lock)
            let liveness
            if (server) {
                servers.set(lock, server)
                liveness = 'socket'
            }
            await publishFile(
                path.join(lock, 'owner.json'),
                JSON.stringify({
                    token,
                    purpose,
                    auditDir,
                    liveness,
                    pid: process.pid,
                    host: os.hostname(),
                    started: new Date().toISOString()
                })
            )
            await syncAncestors(directory)
        }
    }
    catch (error) {
        // No store writes have begun, so only our own acquired locks can be
        // released.
        for (const lock of held.reverse()) {
            await closeLiveness(servers, lock)
            await fs.rm(lock, { recursive: true })
            await syncDirectory(path.dirname(lock))
        }
        throw error
    }
    return {
        token,
        directories: canonical,
        takeovers,
        async release() {
            for (const lock of [...held].reverse()) {
                const owner = JSON.parse(
                    await fs.readFile(path.join(lock, 'owner.json'), 'utf8')
                )
                if (owner.token !== token) {
                    throw new Error(`Ownership changed: ${lock}`)
                }
                await closeLiveness(servers, lock)
                await fs.unlink(path.join(lock, 'owner.json'))
                await fs.rmdir(lock)
                await syncDirectory(path.dirname(lock))
            }
            held.length = 0
        }
    }
}

async function closeLiveness(servers, lock) {
    const server = servers.get(lock)
    if (!server) {
        return
    }
    servers.delete(lock)
    await new Promise(resolve => {
        server.close(() => {
            resolve()
        })
    })
    await fs.rm(path.join(lock, 'owner.sock'), { force: true })
}
