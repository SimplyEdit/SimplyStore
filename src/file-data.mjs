import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { isDeepStrictEqual } from 'node:util'
import idIndex, {
    addUniqueId, readIdEntries, mergeIdIndex
} from './index.id.mjs'
import offsetIndex from './index.offset.mjs'
import { loadStoredIndex } from './index-files.mjs'
import JSONTag from '@muze-nl/jsontag'
import Parser from '@muze-nl/od-jsontag/src/parse.mjs'
import { RecoveryIntegrityError, assertChangesetExists } from './recovery.mjs'
import { getDefaultIntegrityFile, loadIntegrityManifest, verifyDigest }
    from './integrity.mjs'
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
    return hashSource(file).digest
}

function hashSource(file) {
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
        return { ...source, size: scan.offset, digest: scan.digest.digest('hex') }
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
            addUniqueId(ids, id, number)
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

function validateOffsets(offsets, source) {
    const fail = () => {
        throw new Error(`Invalid offset index: ${source.file}`)
    }
    if (!offsets || typeof offsets !== 'object' || Array.isArray(offsets)) {
        fail()
    }
    let previousEnd = 0
    for (const [key, range] of Object.entries(offsets)) {
        const number = Number(key)
        if (!Number.isSafeInteger(number) || number < 0 ||
            number >= 0xfffffffe || String(number) !== key ||
            !Array.isArray(range) || range.length !== 2) {
            fail()
        }
        const [start, end] = range
        if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) ||
            start < previousEnd || start < 3 || end <= start ||
            end > source.size) {
            fail()
        }
        previousEnd = end
    }
}

function readRecordIds(source, recordIds) {
    const fd = fs.openSync(source.file, 'r')
    try {
        assertIdentity(fd, source)
        const scan = new FileScan(fd, source.file)
        for (const [number, [start, end]] of Object.entries(source.offsets)) {
            // Reuse buffered bytes when adjacent headers share a read.
            const bufferStart = scan.offset - scan.cursor
            if (start >= bufferStart && start < bufferStart + scan.available) {
                scan.cursor = start - bufferStart
            }
            else {
                scan.cursor = 0
                scan.available = 0
            }
            scan.offset = start
            recordIds.set(Number(number), scan.recordId(end))
        }
        assertIdentity(fd, source)
    }
    finally {
        fs.closeSync(fd)
    }
}

export function loadDataSource(filename, meta, command = null, options = {},
    recordIds = null) {
    const file = path.resolve(filename)
    const offsets = loadStoredIndex(offsetIndex, meta, command, options)
    let source
    if (offsets === undefined || options.validateIndexes) {
        source = scanDataFile(file, recordIds)
        if (offsets !== undefined &&
            !isDeepStrictEqual(offsets, source.offsets)) {
            throw new Error(`Offset index does not match data: ${file}`)
        }
    }
    else {
        source = hashSource(file)
        validateOffsets(offsets, source)
        source.offsets = offsets
    }
    if (options.manifest) {
        verifyDigest(options.manifest, options.integrityFile, file,
            source.digest, { required: options.integrityRequired })
    }
    if (recordIds && offsets !== undefined && !options.validateIndexes) {
        readRecordIds(source, recordIds)
    }
    return source
}

function idsFromRecords(records) {
    const ids = new Map()
    for (const number of [...records.keys()].sort((a, b) => a - b)) {
        const id = records.get(number)
        addUniqueId(ids, id, number)
    }
    return ids
}

export async function loadFileData(files) {
    const integrityFile = files.integrityFile ||
        getDefaultIntegrityFile(files.dataFile)
    const manifest = await loadIntegrityManifest(integrityFile)
    return readFileData({...files, integrityFile}, manifest)
}

// Initialization validates current bytes before any trusted baseline exists.
export function validateUnsealedData(files) {
    return readFileData({...files,
        validateIndexes: true, rebuildIndexes: false}, null)
}

async function readFileData(files, manifest) {
    const paths = [files.dataFile, ...files.commands.map(id => {
        return assertChangesetExists(files.dataFile, id)
    })]
    const meta = {
        data: path.dirname(path.resolve(files.dataFile)),
        parts: files.commands.length
    }
    let ids = new Map()
    let unresolvedReferences = false
    const sources = paths.map((file, part) => {
        const command = part === 0 ? null : files.commands[part - 1]
        const options = { ...files, manifest, integrityRequired: true }
        const storedIds = loadStoredIndex(idIndex, meta, command, options)
        let recordIds = null
        if (storedIds === undefined || files.validateIndexes) {
            recordIds = new Map()
        }
        const source = loadDataSource(file, meta, command, options, recordIds)
        const records = new Set(Object.keys(source.offsets).map(Number))
        let entries
        if (storedIds === undefined) {
            entries = idsFromRecords(recordIds)
            unresolvedReferences ||= [...recordIds.values()].includes(null)
        }
        else {
            entries = readIdEntries(storedIds, records)
            if (files.validateIndexes &&
                !isDeepStrictEqual(entries, idsFromRecords(recordIds))) {
                throw new Error(`ID index does not match data: ${file}`)
            }
        }
        mergeIdIndex(ids, records, entries)
        return source
    })
    if (!sources[0].size) {
        throw new Error('Empty base dataset')
    }
    const dataset = new FileDataset()
    try {
        dataset.open(sources)
        if (unresolvedReferences) {
            ids = dataset.rebuildIds()
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
