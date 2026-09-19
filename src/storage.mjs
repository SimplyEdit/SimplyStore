import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import {randomUUID} from 'node:crypto'
import {Buffer} from 'node:buffer'

export function storageError(error) {
    if (!(error instanceof Error)) error = new Error(String(error))
    error.storageFailure = true
    return error
}

// A rejected operation poisons its writer: later operations must not pass it.
export function serialWriter() {
    let tail = Promise.resolve()
    return operation => {
        const result = tail.then(operation)
        tail = result
        void result.catch(() => {})
        return result
    }
}

async function withHandle(file, flags, operation, mode) {
    let handle, failure, result
    try {
        handle = await fsp.open(file, flags, mode)
        result = await operation(handle)
    } catch (error) { failure = error }
    if (handle) {
        try { await handle.close() } catch (error) { failure ??= error }
    }
    if (failure) throw storageError(failure)
    return result
}

export async function writeAll(handle, data) {
    const bytes = Buffer.isBuffer(data) ? data : Buffer.from(data)
    let offset = 0
    while (offset < bytes.length) {
        const {bytesWritten} = await handle.write(bytes, offset, bytes.length - offset, null)
        if (!Number.isInteger(bytesWritten) || bytesWritten <= 0 || bytesWritten > bytes.length - offset) {
            throw storageError(new Error('Invalid or zero-progress write'))
        }
        offset += bytesWritten
    }
}

export async function syncDirectory(directory) {
    await withHandle(directory, 'r', handle => handle.sync())
}

export async function syncAncestors(directory) {
    const device = (await fsp.stat(directory)).dev
    for (let current = directory; ; current = path.dirname(current)) {
        await syncDirectory(current)
        const parent = path.dirname(current)
        if (parent === current || (await fsp.stat(parent)).dev !== device) break
    }
}

export async function syncFile(file) {
    await withHandle(file, 'r', handle => handle.sync())
    await syncDirectory(path.dirname(file))
}

export async function durableMkdir(directory) {
    try { await fsp.mkdir(directory) } catch (error) {
        if (error.code === 'ENOENT') {
            await durableMkdir(path.dirname(directory))
            await fsp.mkdir(directory)
        } else if (error.code !== 'EEXIST') throw storageError(error)
    }
    await syncDirectory(directory)
    await syncDirectory(path.dirname(directory))
}

export async function publishFile(file, data, {mode} = {}) {
    const temporary = `${file}.${randomUUID()}.tmp`
    let renamed = false
    try {
        try {
            const stat = await fsp.lstat(file)
            if (stat.isSymbolicLink()) throw new Error('Refusing to publish over a symlink')
            mode ??= stat.mode & 0o777
        } catch (error) { if (error.code !== 'ENOENT') throw error }
        await withHandle(temporary, 'wx', async handle => {
            if (mode !== undefined) await handle.chmod(mode)
            await writeAll(handle, data)
            await handle.sync()
        }, mode)
        await fsp.rename(temporary, file)
        renamed = true
        await syncDirectory(path.dirname(file))
    } catch (error) {
        if (!renamed) await fsp.unlink(temporary).catch(() => {})
        throw storageError(error)
    }
}

const appenders = new Map()
export function appendRecord(file, record) {
    const key = path.resolve(file)
    if (!appenders.has(key)) appenders.set(key, serialWriter())
    return appenders.get(key)(async () => {
        await withHandle(file, 'a', async handle => {
            await writeAll(handle, record + '\n')
            await handle.datasync()
        })
        await syncDirectory(path.dirname(file))
    })
}

// Existing synchronous index hooks keep their contract while gaining barriers.
export function publishFileSync(file, data) {
    const temporary = `${file}.${randomUUID()}.tmp`
    let fd, failure, renamed = false
    try {
        const bytes = Buffer.from(data)
        let mode
        try {
            const stat = fs.lstatSync(file)
            if (stat.isSymbolicLink()) throw new Error('Refusing to publish over a symlink')
            mode = stat.mode & 0o777
        } catch (error) { if (error.code !== 'ENOENT') throw error }
        fd = fs.openSync(temporary, 'wx', mode)
        if (mode !== undefined) fs.fchmodSync(fd,mode)
        let offset = 0
        while (offset < bytes.length) {
            const count = fs.writeSync(fd, bytes, offset, bytes.length - offset)
            if (!Number.isInteger(count) || count <= 0 || count > bytes.length - offset) throw new Error('Invalid or zero-progress write')
            offset += count
        }
        fs.fsyncSync(fd)
    } catch (error) { failure = error }
    if (fd !== undefined) {
        try { fs.closeSync(fd) } catch (error) { failure ??= error }
    }
    try {
        if (failure) throw failure
        fs.renameSync(temporary, file)
        renamed = true
        fd = fs.openSync(path.dirname(file), 'r')
        failure = undefined
        try { fs.fsyncSync(fd) } catch (error) { failure = error }
        try { fs.closeSync(fd) } catch (error) { failure ??= error }
        if (failure) throw failure
    } catch (error) {
        if (!renamed) { try { fs.unlinkSync(temporary) } catch { /* Preserve the primary failure. */ } }
        throw storageError(error)
    }
}
