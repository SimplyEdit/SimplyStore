import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { isDeepStrictEqual } from 'node:util'
import idIndex from './index.id.mjs'
import offsetIndex from './index.offset.mjs'
import JSONTag from '@muze-nl/jsontag'
import Parser from '@muze-nl/od-jsontag/src/parse.mjs'
import { RecoveryIntegrityError, assertChangesetExists } from './recovery.mjs'
import { loadIntegrityManifest, verifyDigest } from './integrity.mjs'
import { storageError } from './storage.mjs'

function identity(stat) {
    return {
        device: stat.dev, inode: stat.ino, size: stat.size,
        modified: stat.mtimeMs, changed: stat.ctimeMs
    }
}

function assertIdentity(fd, source) {
    if (JSON.stringify(identity(fs.fstatSync(fd))) !==
        JSON.stringify(source.identity)) {
        throw new Error(`Dataset source changed: ${source.file}`)
    }
}

// A fixed-size buffer covers both hashing and framing; payloads are skipped
// without decoding or allocating a buffer the size of a record/file.
class FileScan {
    constructor(fd, file) {
        this.fd = fd
        this.file = file
        this.buffer = Buffer.allocUnsafe(64 * 1024)
        this.cursor = 0
        this.available = 0
        this.offset = 0
        this.digest = createHash('sha256')
    }

    peek() {
        if (this.cursor === this.available) {
            this.available = fs.readSync(
                this.fd, this.buffer, 0, this.buffer.length, this.offset
            )
            this.cursor = 0
            if (!this.available) {
                return undefined
            }
            this.digest.update(this.buffer.subarray(0, this.available))
        }
        return this.buffer[this.cursor]
    }

    advance(length = 1) {
        while (length > 0) {
            if (this.peek() === undefined) {
                this.fail('truncated record payload')
            }
            const consumed = Math.min(length, this.available - this.cursor)
            this.cursor += consumed
            this.offset += consumed
            length -= consumed
        }
    }

    recordId(end) {
        while (this.offset < end && [9, 10, 13, 32].includes(this.peek())) {
            this.advance()
        }
        if (this.offset === end) {
            return undefined
        }
        if (this.peek() === 126) {
            // A reference-only record needs the full parser to resolve its ID.
            return null
        }
        if (this.peek() !== 60) {
            return undefined
        }
        const bytes = []
        let quoted = false
        let escaped = false
        while (this.offset < end) {
            const byte = this.peek()
            this.advance()
            bytes.push(byte)
            if (escaped) {
                escaped = false
            }
            else if (quoted && byte === 92) {
                escaped = true
            }
            else if (byte === 34) {
                quoted = !quoted
            }
            else if (!quoted && byte === 62) {
                // Share the actual tag grammar, including Unicode escapes.
                const parser = this.tagParser ??= new JSONTag.Parser()
                parser.input = Buffer.from(bytes).toString('utf8')
                parser.at = 0
                parser.next()
                try {
                    const attributes = parser.tag().attributes
                    const value = {}
                    JSONTag.setAttributes(value, attributes)
                    return JSONTag.getAttribute(value, 'id')
                }
                catch (error) {
                    this.fail(`invalid record tag: ${error.message}`)
                }
            }
        }
        this.fail('unterminated record tag')
    }

    number(kind) {
        let digits = 0
        let value = 0
        while (this.peek() >= 48 && this.peek() <= 57) {
            value = value * 10 + this.peek() - 48
            this.advance()
            digits++
            if (!Number.isSafeInteger(value)) {
                this.fail(`invalid ${kind}`)
            }
        }
        if (!digits) {
            this.fail(`malformed ${kind}`)
        }
        return value
    }

    fail(message) {
        throw new RecoveryIntegrityError(`Invalid OD-JSONTag data: ${message}`, {
            file: this.file,
            recordKind: 'OD-JSONTag data'
        })
    }
}

export function hashFile(file) {
    const fd = fs.openSync(file, 'r')
    try {
        const source = { file, identity: identity(fs.fstatSync(fd)) }
        const scan = new FileScan(fd, file)
        while (scan.peek() !== undefined) {
            scan.advance(scan.available - scan.cursor)
        }
        assertIdentity(fd, source)
        if (scan.offset !== source.identity.size) {
            throw new Error(`Unexpected EOF while hashing: ${file}`)
        }
        return scan.digest.digest('hex')
    }
    finally {
        fs.closeSync(fd)
    }
}

export function scanDataFile(filename, recordIds = null) {
    const file = path.resolve(filename)
    const fd = fs.openSync(file, 'r')
    try {
        const source = {
            file, identity: identity(fs.fstatSync(fd)), offsets: {}
        }
        const scan = new FileScan(fd, file)
        let record = 0
        while (scan.peek() !== undefined) {
            const byte = scan.peek()
            if (byte === 10 || byte === 13) {
                scan.advance()
                continue
            }
            if (byte === 43) {
                scan.advance()
                record += scan.number('skip record')
                if (scan.peek() !== undefined &&
                    scan.peek() !== 10 && scan.peek() !== 13) {
                    scan.fail('malformed skip record')
                }
            }
            else {
                if (byte !== 40) {
                    scan.fail('expected record length')
                }
                scan.advance()
                const length = scan.number('record length')
                if (scan.peek() !== 41 || length === 0) {
                    scan.fail('malformed record length')
                }
                scan.advance()
                const start = scan.offset
                const end = start + length
                if (recordIds) {
                    recordIds.set(record, scan.recordId(end))
                }
                scan.advance(end - scan.offset)
                source.offsets[record++] = [start, scan.offset]
            }
            if (!Number.isSafeInteger(record) || record >= 0xffffffff) {
                scan.fail('invalid record number')
            }
        }
        assertIdentity(fd, source)
        if (scan.offset !== source.identity.size) {
            scan.fail('unexpected EOF')
        }
        source.size = scan.offset
        source.digest = scan.digest.digest('hex')
        return source
    }
    finally {
        fs.closeSync(fd)
    }
}

// Keep read failure in host-owned state even when a handler/query catches it.
export class FileParser extends Parser {
    firstParse(target) {
        try {
            return super.firstParse(target)
        }
        catch (error) {
            this.readFailure = storageError(error)
            throw this.readFailure
        }
    }

    getLineProxy(index) {
        try {
            return super.getLineProxy(index)
        }
        catch (error) {
            this.readFailure = storageError(error)
            throw this.readFailure
        }
    }
}

export class FileDataset {
    constructor(meta = {}, immutable = true, ParserType = FileParser) {
        this.parser = new ParserType(undefined, immutable)
        this.parser.meta = { ...meta, resultArray: [] }
        this.handles = []
        this.sources = []
        this.root = undefined
    }

    append(source) {
        const fd = fs.openSync(source.file, 'r')
        try {
            assertIdentity(fd, source)
            this.root = this.parser.parse(fd, source.offsets)
            this.handles.push(fd)
            this.sources.push(source)
            return this.root
        }
        catch (error) {
            fs.closeSync(fd)
            throw error
        }
    }

    open(sources) {
        try {
            for (const source of sources) {
                this.append(source)
            }
            return this.root
        }
        catch (error) {
            this.close()
            throw error
        }
    }

    rebuildIds() {
        const records = new Set()
        for (const source of this.sources) {
            for (const number of Object.keys(source.offsets)) {
                records.add(Number(number))
            }
        }
        const ids = new Map()
        for (const number of [...records].sort((a, b) => a - b)) {
            const value = this.parser.getLineProxy(number)
            const id = JSONTag.getAttribute(value, 'id')
            if (id) {
                ids.set(id, number)
            }
        }
        this.parser.meta.index = { ...this.parser.meta.index, id: ids }
        return ids
    }

    close() {
        for (const fd of this.handles.splice(0)) {
            fs.closeSync(fd)
        }
        this.sources = []
        this.root = undefined
    }
}

function optionalIndex(index, meta, command) {
    try {
        return index.load(meta, command)
    }
    catch (error) {
        if (error instanceof SyntaxError || error.code) {
            return undefined
        }
        throw error
    }
}

function idsFromRecords(records) {
    const ids = new Map()
    for (const number of [...records.keys()].sort((a, b) => a - b)) {
        const id = records.get(number)
        if (id) {
            ids.set(id, number)
        }
    }
    return ids
}

export async function loadFileData(files) {
    const manifest = files.integrityFile
        ? await loadIntegrityManifest(files.integrityFile)
        : null
    const paths = [files.dataFile, ...files.commands.map(id => {
        return assertChangesetExists(files.dataFile, id)
    })]
    const meta = {
        data: path.dirname(path.resolve(files.dataFile)),
        parts: files.commands.length
    }
    const recordIds = new Map()
    const persistedIds = new Map()
    let completeIds = true
    const sources = paths.map((file, part) => {
        const command = part === 0 ? null : files.commands[part - 1]
        const source = scanDataFile(file, recordIds)
        if (manifest) {
            verifyDigest(manifest, files.integrityFile, file, source.digest, {
                required: files.integrityRequired
            })
        }
        const offsets = optionalIndex(offsetIndex, meta, command)
        if (isDeepStrictEqual(offsets, source.offsets)) {
            source.offsets = offsets
        }
        const ids = optionalIndex(idIndex, meta, command)
        if (ids && typeof ids === 'object' && !Array.isArray(ids)) {
            for (const [id, number] of Object.entries(ids)) {
                persistedIds.set(id, number)
            }
        }
        else {
            completeIds = false
        }
        return source
    })
    if (!sources[0].size) {
        throw new Error('Empty base dataset')
    }
    const dataset = new FileDataset()
    try {
        dataset.open(sources)
        let ids = idsFromRecords(recordIds)
        if ([...recordIds.values()].includes(null)) {
            ids = dataset.rebuildIds()
        }
        if (completeIds && isDeepStrictEqual(persistedIds, ids)) {
            ids = persistedIds
        }
        meta.index = { id: ids }
        if (files.schemaFile) {
            meta.schema = JSONTag.parse(
                fs.readFileSync(files.schemaFile, 'utf8')
            )
        }
        return { sources, meta }
    }
    finally {
        dataset.close()
    }
}
