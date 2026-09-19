import fs from 'node:fs/promises'
import path from 'node:path'
import JSONTag from '@muze-nl/jsontag'
import Parser from '@muze-nl/od-jsontag/src/parse.mjs'
import {createHash} from 'node:crypto'
import {assertOdJsonTagFraming, getChangesetPath} from './recovery.mjs'
import {getDefaultIntegrityFile, loadIntegrityManifest, verifyIntegrity} from './integrity.mjs'

export const hash = bytes => createHash('sha256').update(bytes).digest('hex')
export const validCommandId = id => typeof id === 'string' && id.length > 0 && !/[/\\\0]/.test(id)
export function storePaths(options = {}) {
    const datafile = path.resolve(options.datafile || './data.od-jsontag')
    return {datafile, commandLog: path.resolve(options.commandLog || './command-log.jsontag'),
        commandStatus: path.resolve(options.commandStatus || './command-status.jsontag'),
        integrityFile: path.resolve(options.integrityFile || getDefaultIntegrityFile(datafile)),
        integrity: options.integrity === undefined ? Boolean(options.integrityFile) : Boolean(options.integrity),
        requiredFiles: (options.requiredFiles || []).map(file => path.resolve(file)),
        ...(options.schemaFile ? {schemaFile: path.resolve(options.schemaFile)} : {})}
}
export function mutableDirectories(config) {
    return [...new Set([config.datafile, config.commandLog, config.commandStatus,
        config.integrityFile, ...config.requiredFiles].map(file => path.dirname(file)))].sort()
}
export async function inventory(config) {
    const files = {}
    const expected = new Set([config.datafile,config.commandLog,config.commandStatus,config.integrityFile,...config.requiredFiles,...(config.schemaFile?[config.schemaFile]:[])])
    const extension = path.extname(config.datafile), stem = path.basename(config.datafile,extension)+'.'
    for (const directory of mutableDirectories(config)) {
        const entries = await fs.readdir(directory, {withFileTypes: true})
        for (const entry of entries.sort((a,b) => a.name.localeCompare(b.name))) {
            if (entry.name === '.simplystore-lock') { continue }
            const file = path.join(directory, entry.name)
            const dataArtifact = directory===path.dirname(config.datafile) && entry.name.startsWith(stem) && (entry.name.endsWith(extension) || entry.name.endsWith('.tmp'))
            const indexArtifact = directory===path.dirname(config.datafile) && entry.name.startsWith('index.')
            const temporary = [...expected].some(name=>file.startsWith(name+'.') && file.endsWith('.tmp'))
            if (!expected.has(file) && !dataArtifact && !indexArtifact && !temporary) { continue }
            if (entry.isSymbolicLink()) { throw new Error(`Symlink in store artifact: ${file}`) }
            if (entry.isFile()) { files[file] = hash(await fs.readFile(file)) }
        }
    }
    for (const file of [config.datafile, config.commandLog, config.commandStatus,
        ...(config.integrity ? [config.integrityFile] : []), ...config.requiredFiles,
        ...(config.schemaFile ? [config.schemaFile] : [])]) {
        if (!(file in files)) {
            try { files[file] = hash(await fs.readFile(file)) } catch (error) {
                if (error.code !== 'ENOENT') { throw error }
                files[file] = null
            }
        }
    }
    return Object.fromEntries(Object.entries(files).sort(([a],[b]) => a.localeCompare(b)))
}

async function records(file, errors, kind) {
    let text
    try { text = await fs.readFile(file, 'utf8') } catch (error) {
        errors.push(`${kind}: ${error.message}`); return []
    }
    if (text && !text.endsWith('\n')) { errors.push(`${kind}: incomplete final record in ${file}`) }
    const result = []
    for (const [index, line] of text.split('\n').entries()) {
        if (!line) { continue }
        try {
            const value = JSONTag.parse(line)
            if (!value || typeof value !== 'object' || Array.isArray(value)) { throw new Error('record is not an object') }
            result.push({value, line, lineNumber: index + 1})
        } catch (error) { errors.push(`${kind} ${file}:${index + 1}: ${error.message}`) }
    }
    return result
}

// Reads canonical files only; deliberately never imports user handlers/index modules.
export async function inspectStore(options = {}) {
    const config = storePaths(options)
    const errors = [], warnings = []
    const canonicalPaths = await Promise.all([config.datafile, config.commandLog, config.commandStatus, config.integrityFile].map(async file => path.join(await fs.realpath(path.dirname(file)),path.basename(file))))
    if (new Set(canonicalPaths).size !== canonicalPaths.length) { errors.push('Configured canonical artifact paths overlap') }
    const before = await inventory(config)
    const log = await records(config.commandLog, errors, 'command log')
    const statuses = await records(config.commandStatus, errors, 'command status')
    const commands = [], byId = new Map()
    for (const record of log) {
        const {id, name} = record.value
        if (!validCommandId(id) || typeof name !== 'string' || !name) {
            errors.push(`Invalid command at log line ${record.lineNumber}`); continue
        }
        if (byId.has(id)) {
            if (JSONTag.stringify(byId.get(id).command) !== JSONTag.stringify(record.value)) { errors.push(`Conflicting command ID ${id}`) }
            continue
        }
        const command = {id, position: commands.length, command: record.value, line: record.line,
            history: [], accepted: false, status: null, file: getChangesetPath(config.datafile, id)}
        byId.set(id, command); commands.push(command)
    }
    const doneOrder = new Map()
    for (const {value, lineNumber} of statuses) {
        const command = byId.get(value.command)
        if (!command) { errors.push(`Status line ${lineNumber} has no logged command: ${value.command}`); continue }
        if (!['accepted', 'active', 'done', 'failed', 'unsafe'].includes(value.status)) {
            errors.push(`Unknown status for ${command.id}: ${value.status}`); continue
        }
        if (value.status === 'accepted') { command.accepted = true }
        if (value.status !== 'accepted' && !command.accepted) { errors.push(`No acceptance evidence for ${command.id}`) }
        if (value.status === 'done') {
            doneOrder.delete(command.id); doneOrder.set(command.id, command.position)
        }
        command.history.push(value); command.status = value.status
    }
    let lastDonePosition = -1
    for (const [id, position] of doneOrder) {
        if (byId.get(id).status !== 'done') { continue }
        if (position < lastDonePosition) { errors.push(`Committed execution differs from command-log order at ${id}`) }
        lastDonePosition = position
    }
    let manifest
    try {
        // Preserve optional existence-based compatibility; required integrity is explicit.
        const enabled = config.integrity || before[config.integrityFile] != null
        if (enabled) {
            if (before[config.integrityFile] == null) { throw new Error(`Missing integrity manifest ${config.integrityFile}`) }
            await records(config.integrityFile, errors, 'integrity manifest')
            manifest = await loadIntegrityManifest(config.integrityFile)
        }
    } catch (error) { errors.push(error.message) }
    const parser = new Parser()
    const buffers = [], committed = []
    let data, prefixValid = errors.length === 0
    async function validateData(file) {
        const bytes = await fs.readFile(file)
        assertOdJsonTagFraming(bytes, file)
        if (manifest) { verifyIntegrity(manifest, config.integrityFile, file, bytes, {required: true}) }
        return bytes
    }
    try {
        const bytes = await validateData(config.datafile)
        if (!bytes.length) { throw new Error('Empty base dataset') }
        data = parser.parse(bytes); buffers.push(bytes)
    } catch (error) { errors.push(error.message); prefixValid = false }
    for (const command of commands) {
        command.present = before[command.file] != null
        command.condition = command.present ? 'present' : 'missing'
        if (!command.accepted) { errors.push(`Orphan command without acceptance: ${command.id}`) }
        if (command.present) {
            try { await validateData(command.file) } catch (error) {
                command.condition = 'corrupt'; command.problem = error.message
            }
        }
        if (command.status === 'done') {
            if (!command.present || command.condition === 'corrupt') {
                command.problem ||= `Missing changeset for committed command ${command.id}: ${command.file}`
                prefixValid = false
            } else if (prefixValid) {
                try {
                    const bytes = await validateData(command.file)
                    data = parser.parse(bytes); buffers.push(bytes); committed.push(command.id)
                } catch (error) { command.problem = error.message; prefixValid = false }
            }
        } else if (command.status === 'accepted' || command.status === 'active') {
            prefixValid = false
        }
        command.laterDatasets = commands.filter(later => later.position > command.position && later.accepted && before[later.file] != null).map(later => later.id)
    }
    const extension = path.extname(config.datafile), stem = path.basename(config.datafile, extension) + '.'
    const known = new Set(commands.map(command => command.file))
    for (const file of Object.keys(before)) {
        if (path.dirname(file) === path.dirname(config.datafile) && path.basename(file).startsWith(stem) && file.endsWith(extension) && file !== config.datafile && file !== config.integrityFile && !known.has(file)) {
            errors.push(`Unexplained changeset: ${file}`)
        }
    }
    for (const file of config.requiredFiles) { if (before[file] == null) { errors.push(`Missing required artifact: ${file}`) } }
    const after = await inventory(config)
    if (JSON.stringify(before) !== JSON.stringify(after)) { errors.push('Store changed during inspection') }
    const pending = commands.filter(c => c.status === 'accepted' || c.status === 'active')
    const damaged = commands.filter(c => c.problem || (c.present && c.status !== 'done'))
    const ready = errors.length === 0 && pending.length === 0 && damaged.length === 0
    warnings.push('History completeness and original code/hidden inputs require independent administrator evidence; current files alone cannot prove them.')
    return {config, files: before, fingerprint: hash(JSON.stringify(before)), errors, warnings,
        commands, committed, ready, data, buffers}
}
