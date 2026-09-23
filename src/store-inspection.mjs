import fs from 'node:fs/promises'
import path from 'node:path'
import JSONTag from '@muze-nl/jsontag'
import { from, _, anyOf, not } from '@muze-nl/jaqt'
import { FileDataset, hashFile, scanDataFile } from './file-data.mjs'
import { createHash } from 'node:crypto'
import { getChangesetPath } from './recovery.mjs'
import {
    getDefaultIntegrityFile,
    loadIntegrityManifest,
    verifyDigest
} from './integrity.mjs'

export const hash = bytes => createHash('sha256').update(bytes).digest('hex')
export const validCommandId = id =>
    typeof id === 'string' && id.length > 0 && !/[/\\\0]/.test(id)
export function storePaths(options = {}) {
    const datafile = path.resolve(options.datafile || './data.od-jsontag')
    let integrity
    if (options.integrity === undefined) {
        integrity = Boolean(options.integrityFile)
    }
    else {
        integrity = Boolean(options.integrity)
    }
    const config = {
        datafile,
        commandLog: path.resolve(options.commandLog || './command-log.jsontag'),
        commandStatus: path.resolve(
            options.commandStatus || './command-status.jsontag'
        ),
        integrityFile: path.resolve(
            options.integrityFile || getDefaultIntegrityFile(datafile)
        ),
        integrity,
        requiredFiles: (options.requiredFiles || []).map(file =>
            path.resolve(file)
        )
    }
    if (options.schemaFile) {
        config.schemaFile = path.resolve(options.schemaFile)
    }
    return config
}
export function mutableDirectories(config) {
    return [
        ...new Set(
            [
                config.datafile,
                config.commandLog,
                config.commandStatus,
                config.integrityFile,
                ...config.requiredFiles
            ].map(file => path.dirname(file))
        )
    ].sort()
}
export async function inventory(config) {
    const files = {}
    const artifacts = [
        config.datafile,
        config.commandLog,
        config.commandStatus,
        config.integrityFile,
        ...config.requiredFiles
    ]
    if (config.schemaFile) {
        artifacts.push(config.schemaFile)
    }
    const expected = new Set(artifacts)
    const extension = path.extname(config.datafile),
        stem = path.basename(config.datafile, extension) + '.'
    for (const directory of mutableDirectories(config)) {
        const entries = await fs.readdir(directory, { withFileTypes: true })
        for (const entry of entries.sort((a, b) =>
            a.name.localeCompare(b.name)
        )) {
            if (entry.name === '.simplystore-lock') {
                continue
            }
            const file = path.join(directory, entry.name)
            const dataArtifact =
                directory === path.dirname(config.datafile) &&
                entry.name.startsWith(stem) &&
                (entry.name.endsWith(extension) || entry.name.endsWith('.tmp'))
            const indexArtifact =
                directory === path.dirname(config.datafile) &&
                entry.name.startsWith('index.')
            const temporary = [...expected].some(
                name => file.startsWith(name + '.') && file.endsWith('.tmp')
            )
            if (
                !expected.has(file) &&
                !dataArtifact &&
                !indexArtifact &&
                !temporary
            ) {
                continue
            }
            if (entry.isSymbolicLink()) {
                throw new Error(`Symlink in store artifact: ${file}`)
            }
            if (entry.isFile()) {
                files[file] = hashFile(file)
            }
        }
    }
    const required = [config.datafile, config.commandLog, config.commandStatus]
    if (config.integrity) {
        required.push(config.integrityFile)
    }
    required.push(...config.requiredFiles)
    if (config.schemaFile) {
        required.push(config.schemaFile)
    }
    for (const file of required) {
        if (!(file in files)) {
            try {
                files[file] = hashFile(file)
            }
            catch (error) {
                if (error.code !== 'ENOENT') {
                    throw error
                }
                files[file] = null
            }
        }
    }
    return Object.fromEntries(
        Object.entries(files).sort(([a], [b]) => a.localeCompare(b))
    )
}

// Reads canonical files only; deliberately never imports user handlers/index
// modules.
export async function inspectStore(options = {}) {
    const inspector = new StoreInspector(storePaths(options))
    return inspector.inspect()
}

class StoreInspector {
    constructor(config) {
        this.config = config
        this.errors = []
        this.warnings = []
        this.files = null
        this.commands = []
        this.commandsById = new Map()
        this.manifest = null
        this.dataset = new FileDataset()
        this.verified = new Map()
        this.committed = []
        this.prefixValid = false
    }

    async inspect() {
        try {
            await this.validateConfiguredPaths()
            this.files = await inventory(this.config)
            await this.loadCommandHistory()
            await this.loadIntegrityManifest()
            await this.reconstructCommittedState()
            this.validateStoreArtifacts()
            await this.verifyStableSnapshot()
            return this.createReport()
        }
        finally {
            this.dataset.close()
        }
    }

    async loadCommandHistory() {
        const log = await this.readRecords(
            this.config.commandLog,
            'command log'
        )
        const statuses = await this.readRecords(
            this.config.commandStatus,
            'command status'
        )
        this.readCommands(log)
        const doneOrder = this.applyStatusHistory(statuses)
        this.validateCommittedOrder(doneOrder)
    }

    async validateConfiguredPaths() {
        const configuredPaths = [
            this.config.datafile,
            this.config.commandLog,
            this.config.commandStatus,
            this.config.integrityFile
        ]
        const canonicalPaths = await Promise.all(
            configuredPaths.map(async file => {
                const directory = await fs.realpath(path.dirname(file))
                return path.join(directory, path.basename(file))
            })
        )
        if (new Set(canonicalPaths).size !== canonicalPaths.length) {
            this.errors.push('Configured canonical artifact paths overlap')
        }
    }

    async readRecords(file, kind) {
        let text
        try {
            text = await fs.readFile(file, 'utf8')
        }
        catch (error) {
            this.errors.push(`${kind}: ${error.message}`)
            return []
        }
        if (text && !text.endsWith('\n')) {
            this.errors.push(`${kind}: incomplete final record in ${file}`)
        }
        const result = []
        for (const [index, line] of text.split('\n').entries()) {
            if (!line) {
                continue
            }
            try {
                const value = JSONTag.parse(line)
                if (
                    !value ||
                    typeof value !== 'object' ||
                    Array.isArray(value)
                ) {
                    throw new Error('record is not an object')
                }
                result.push({ value, line, lineNumber: index + 1 })
            }
            catch (error) {
                this.errors.push(
                    `${kind} ${file}:${index + 1}: ${error.message}`
                )
            }
        }
        return result
    }

    readCommands(log) {
        for (const record of log) {
            const { id, name } = record.value
            if (!validCommandId(id) || typeof name !== 'string' || !name) {
                this.errors.push(
                    `Invalid command at log line ${record.lineNumber}`
                )
                continue
            }
            if (this.commandsById.has(id)) {
                const existing = this.commandsById.get(id).command
                if (
                    JSONTag.stringify(existing) !==
                    JSONTag.stringify(record.value)
                ) {
                    this.errors.push(`Conflicting command ID ${id}`)
                }
                continue
            }
            const command = {
                id,
                position: this.commands.length,
                command: record.value,
                line: record.line,
                history: [],
                accepted: false,
                status: null,
                file: getChangesetPath(this.config.datafile, id)
            }
            this.commandsById.set(id, command)
            this.commands.push(command)
        }
    }

    applyStatusHistory(statuses) {
        const doneOrder = new Map()
        for (const { value, lineNumber } of statuses) {
            const command = this.commandsById.get(value.command)
            if (!command) {
                this.errors.push(
                    `Status line ${lineNumber} has no logged command: ` +
                    value.command
                )
                continue
            }
            const knownStatus = [
                'accepted',
                'active',
                'done',
                'failed',
                'unsafe'
            ].includes(value.status)
            if (!knownStatus) {
                this.errors.push(
                    `Unknown status for ${command.id}: ${value.status}`
                )
                continue
            }
            if (value.status === 'accepted') {
                command.accepted = true
            }
            if (value.status !== 'accepted' && !command.accepted) {
                this.errors.push(`No acceptance evidence for ${command.id}`)
            }
            if (value.status === 'done') {
                doneOrder.delete(command.id)
                doneOrder.set(command.id, command.position)
            }
            command.history.push(value)
            command.status = value.status
        }
        return doneOrder
    }

    validateCommittedOrder(doneOrder) {
        let lastDonePosition = -1
        for (const [id, position] of doneOrder) {
            if (this.commandsById.get(id).status !== 'done') {
                continue
            }
            if (position < lastDonePosition) {
                this.errors.push(
                    'Committed execution differs from command-log order ' +
                    `at ${id}`
                )
            }
            lastDonePosition = position
        }
    }

    async loadIntegrityManifest() {
        try {
            const integrityFile = this.config.integrityFile
            const enabled =
                this.config.integrity || this.files[integrityFile] != null
            if (!enabled) {
                return
            }
            if (this.files[integrityFile] == null) {
                throw new Error(`Missing integrity manifest ${integrityFile}`)
            }
            await this.readRecords(integrityFile, 'integrity manifest')
            this.manifest = await loadIntegrityManifest(integrityFile)
        }
        catch (error) {
            this.errors.push(error.message)
        }
    }

    async readVerifiedData(file) {
        const source = scanDataFile(file)
        if (this.manifest) {
            verifyDigest(
                this.manifest,
                this.config.integrityFile,
                file,
                source.digest,
                { required: true }
            )
        }
        this.verified.set(file, source)
        return source
    }

    async reconstructCommittedState() {
        this.prefixValid = this.errors.length === 0
        await this.readBaseDataset()
        for (const command of this.commands) {
            await this.inspectCommandDataset(command)
            this.findLaterDatasets(command)
        }
    }

    async readBaseDataset() {
        try {
            const source = await this.readVerifiedData(this.config.datafile)
            if (!source.size) {
                throw new Error('Empty base dataset')
            }
            this.dataset.append(source)
        }
        catch (error) {
            this.errors.push(error.message)
            this.prefixValid = false
        }
    }

    async inspectCommandDataset(command) {
        command.present = this.files[command.file] != null
        command.condition = 'missing'
        if (command.present) {
            command.condition = 'present'
        }
        if (!command.accepted) {
            this.errors.push(
                `Orphan command without acceptance: ${command.id}`
            )
        }
        if (command.present) {
            try {
                await this.readVerifiedData(command.file)
            }
            catch (error) {
                command.condition = 'corrupt'
                command.problem = error.message
            }
        }
        if (command.status === 'done') {
            await this.applyCommittedCommand(command)
        }
        else if (
            command.status === 'accepted' ||
            command.status === 'active'
        ) {
            this.prefixValid = false
        }
    }

    async applyCommittedCommand(command) {
        if (!command.present || command.condition === 'corrupt') {
            if (!command.problem) {
                command.problem =
                    `Missing changeset for committed command ${command.id}: ` +
                    command.file
            }
            this.prefixValid = false
            return
        }
        if (!this.prefixValid) {
            return
        }
        try {
            const source = this.verified.get(command.file)
            this.dataset.append(source)
            this.committed.push(command.id)
        }
        catch (error) {
            command.problem = error.message
            this.prefixValid = false
        }
    }

    findLaterDatasets(command) {
        const laterDatasets = from(this.commands)
            .where({
                position: position => position > command.position,
                accepted: true,
                file: file => this.files[file] != null
            })
            .select(_.id)
        command.laterDatasets = [...laterDatasets]
    }

    validateStoreArtifacts() {
        const extension = path.extname(this.config.datafile)
        const stem = path.basename(this.config.datafile, extension) + '.'
        const known = new Set(this.commands.map(command => command.file))
        for (const file of Object.keys(this.files)) {
            if (
                path.dirname(file) === path.dirname(this.config.datafile) &&
                path.basename(file).startsWith(stem) &&
                file.endsWith(extension) &&
                file !== this.config.datafile &&
                file !== this.config.integrityFile &&
                !known.has(file)
            ) {
                this.errors.push(`Unexplained changeset: ${file}`)
            }
        }
        for (const file of this.config.requiredFiles) {
            if (this.files[file] == null) {
                this.errors.push(`Missing required artifact: ${file}`)
            }
        }
    }

    async verifyStableSnapshot() {
        const finalFiles = await inventory(this.config)
        if (JSON.stringify(this.files) !== JSON.stringify(finalFiles)) {
            this.errors.push('Store changed during inspection')
        }
    }

    createReport() {
        const commandQuery = from(this.commands)
        const pending = commandQuery.where({
            status: anyOf('accepted', 'active')
        })
        const damaged = commandQuery.where(
            anyOf(
                { problem: Boolean },
                { present: Boolean, status: not('done') }
            )
        )
        const ready =
            this.errors.length === 0 &&
            pending.length === 0 &&
            damaged.length === 0
        this.warnings.push(
            'History completeness and original code/hidden inputs require ' +
            'independent administrator evidence; current files alone cannot ' +
            'prove them.'
        )
        return {
            config: this.config,
            files: this.files,
            fingerprint: hash(JSON.stringify(this.files)),
            errors: this.errors,
            warnings: this.warnings,
            commands: this.commands,
            committed: this.committed,
            ready,
            sources: [...this.dataset.sources]
        }
    }
}
