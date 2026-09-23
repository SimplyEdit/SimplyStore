import path from 'node:path'
import { fileURLToPath } from 'node:url'
import JSONTag from '@muze-nl/jsontag'
import { from, _, anyOf, not } from '@muze-nl/jaqt'
import WorkerPool from './workerPool.mjs'
import { appendFile } from './util.mjs'
import {
    activeCommandStatus,
    committedCommandStatus,
    failedCommandStatus,
    nextActiveCommandStatus,
    pendingCommandStatus,
    unsafeCommandStatus
} from './recovery.mjs'
import { serialWriter, syncFile } from './storage.mjs'
import {
    inspectStore,
    storePaths,
    mutableDirectories,
    validCommandId
} from './store-inspection.mjs'
import { acquireOwnership } from './store-ownership.mjs'
import { executeWorker, runWorker } from './execute-worker.mjs'
import { assertRuntimeEnvironmentConfiguration } from './runtime-environment.mjs'
import { faultPoint } from './faults.mjs'
import { getDefaultIntegrityFile } from './integrity.mjs'

const rootDirectory = path.dirname(
    path.dirname(fileURLToPath(import.meta.url))
)
const defaultCommandTimeout = 30000
const defaultLoadTimeout = 30000

function normalizeWorkerTimeout(name, value, defaultValue) {
    if (
        value === 0 ||
        value === false ||
        value === null ||
        value === Infinity
    ) {
        return 0
    }
    const timeout = value ?? defaultValue
    if (!Number.isFinite(timeout) || timeout < 0) {
        throw new Error(
            `${name} must be a non-negative finite number, ` +
            '0, false, null, or Infinity'
        )
    }
    return timeout
}

function createRuntimeConfiguration(options) {
    const datafile = options.datafile || './data.od-jsontag'
    const integrityFile =
        options.integrityFile || getDefaultIntegrityFile(datafile)
    const storeOptions = {
        ...options,
        datafile,
        commandLog: options.commandLog || './command-log.jsontag',
        commandStatus: options.commandStatus || './command-status.jsontag',
        integrityFile
    }
    const store = storePaths(storeOptions)

    return {
        store,
        schemaFile: options.schemaFile || null,
        validateIndexes: Boolean(options.validateIndexes),
        rebuildIndexes: Boolean(options.rebuildIndexes),
        maxWorkers: options.maxWorkers || 8,
        queryWorker:
            options.queryWorker || rootDirectory + '/src/query-worker.mjs',
        loadWorker:
            options.loadWorker || rootDirectory + '/src/load-worker.mjs',
        commandWorker:
            options.commandWorker || rootDirectory + '/src/command-worker.mjs',
        commandsFile:
            options.commandsFile || rootDirectory + '/src/commands.mjs',
        indexFile: options.indexFile || rootDirectory + '/src/index.mjs',
        access: options.access || null,
        timeout: options.timeout || 1000,
        slowTimeout: options.slowTimeout || 10000,
        commandTimeout: normalizeWorkerTimeout(
            'commandTimeout',
            options.commandTimeout,
            defaultCommandTimeout
        ),
        loadTimeout: normalizeWorkerTimeout(
            'loadTimeout',
            options.loadTimeout,
            defaultLoadTimeout
        )
    }
}

function createRuntimeMechanisms(overrides) {
    return {
        acquireOwnership,
        appendFile,
        createWorkerPool(threadCount, workerFile, initialTask) {
            return new WorkerPool(threadCount, workerFile, initialTask)
        },
        executeWorker,
        faultPoint,
        inspectStore,
        logger: console,
        runWorker,
        syncFile,
        ...overrides
    }
}

function storeReadinessErrors(inspection) {
    const commands = from(inspection.commands)

    const problems = commands
        .where({ problem: Boolean })
        .select(_.problem)

    const pending = commands
        .where({ status: anyOf(pendingCommandStatus, activeCommandStatus) })
        .select(command => {
            return `${command.id}: ${command.status}; ` +
                'administrator assessment required'
        })

    const uncommitted = commands
        .where({
            present: Boolean,
            status: not(committedCommandStatus)
        })
        .select(command => {
            return `${command.id}: uncommitted dataset`
        })

    return [
        ...inspection.errors,
        ...problems,
        ...pending,
        ...uncommitted
    ]
}

export class StoreRuntime {
    static async open(options = {}, mechanismOverrides = {}) {
        assertRuntimeEnvironmentConfiguration()
        if (!options) {
            options = {}
        }
        const configuration = createRuntimeConfiguration(options)
        const mechanisms = createRuntimeMechanisms(mechanismOverrides)
        const runtime = new StoreRuntime(configuration, mechanisms)
        await runtime.open()
        return runtime
    }

    constructor(configuration, mechanisms) {
        this.configuration = configuration
        this.mechanisms = mechanisms
        this.sources = []
        this.meta = {}
        this.status = new Map()
        this.commandQueue = []
        this.serializeAcceptance = serialWriter()
        this.runner = Promise.resolve()
        this.commandRunnerActive = false
        this.storageFailed = false
        this.closing = false
        this.closure = null
        this.ownership = null
        this.queryWorkerPool = null
        this.slowQueryWorkerPool = null
    }

    async open() {
        const { store } = this.configuration
        this.ownership = await this.mechanisms.acquireOwnership(
            mutableDirectories(store)
        )
        try {
            const inspection = await this.mechanisms.inspectStore(store)
            this.assertStoreReady(inspection)
            await this.synchronizeCommittedFiles(inspection.files)
            const loaded = await this.loadCommittedData(inspection.committed)
            this.initializeLoadedState(inspection, loaded)
            this.startQueryWorkers()
        }
        catch (error) {
            await this.ownership.release()
            this.ownership = null
            throw error
        }
        return this
    }

    assertStoreReady(inspection) {
        if (inspection.ready) {
            return
        }
        const details = storeReadinessErrors(inspection).join('; ')
        throw new Error(`Administrative recovery required: ${details}`)
    }

    async synchronizeCommittedFiles(files) {
        for (const [file, digest] of Object.entries(files)) {
            if (digest !== null) {
                await this.mechanisms.syncFile(file)
            }
        }
    }

    async loadCommittedData(commands) {
        const config = this.configuration
        return this.mechanisms.runWorker(
            config.loadWorker,
            {
                dataFile: config.store.datafile,
                indexFile: config.indexFile,
                schemaFile: config.schemaFile,
                validateIndexes: config.validateIndexes,
                rebuildIndexes: config.rebuildIndexes,
                commands,
                integrityFile: config.store.integrityFile
            },
            {
                timeout: config.loadTimeout,
                workerKind: 'load worker'
            }
        )
    }

    initializeLoadedState(inspection, loaded) {
        this.sources = loaded.sources
        this.meta = loaded.meta
        this.status = new Map(
            inspection.commands.map(command => {
                return [command.id, command.history.at(-1)]
            })
        )
    }

    startQueryWorkers() {
        const config = this.configuration
        const createPool = this.mechanisms.createWorkerPool
        this.queryWorkerPool = createPool(
            config.maxWorkers,
            config.queryWorker,
            this.queryWorkerInitialTask(config.timeout)
        )
        this.slowQueryWorkerPool = createPool(
            1,
            config.queryWorker,
            this.queryWorkerInitialTask(config.slowTimeout)
        )
        for (const pool of [this.queryWorkerPool, this.slowQueryWorkerPool]) {
            pool.on?.('error', error => this.failStorage(error))
        }
    }

    queryWorkerInitialTask(timeout) {
        return {
            name: 'init',
            req: {
                sources: this.sources,
                meta: this.meta,
                access: this.configuration.access
            },
            timeout
        }
    }

    async runQuery(request, { slow = false } = {}) {
        let pool = this.queryWorkerPool
        let timeout = this.configuration.timeout
        if (slow) {
            pool = this.slowQueryWorkerPool
            timeout = this.configuration.slowTimeout
        }
        const result = await pool.run('query', request, { timeout })
        if (result.storageFailure) {
            this.failStorage(new Error('Unable to read committed data'))
        }
        return result
    }

    getCommandStatus(commandId) {
        if (this.status.has(commandId)) {
            return {
                code: 200,
                value: this.status.get(commandId)
            }
        }
        return {
            code: 404,
            value: {
                code: 404,
                message: 'Command not found',
                details: commandId
            }
        }
    }

    async acceptCommand(commandText) {
        if (this.storageFailed || this.closing) {
            return {
                code: 503,
                value: { message: 'Store is unavailable' }
            }
        }
        try {
            return await this.serializeAcceptance(async () => {
                if (this.storageFailed) {
                    throw new Error('Store is unavailable')
                }
                if (this.closing) {
                    return {
                        code: 503,
                        value: { message: 'Store is closing' }
                    }
                }
                return this.acceptCommandInOrder(commandText)
            })
        }
        catch (error) {
            this.failStorage(error)
            throw error
        }
    }

    async acceptCommandInOrder(commandText) {
        const candidate = this.prepareCommand(commandText)
        if (candidate.result) {
            return candidate.result
        }
        const { command, line } = candidate

        const accepted = {
            command: command.id,
            code: 202,
            status: pendingCommandStatus
        }
        await this.mechanisms.appendFile(
            this.configuration.store.commandLog,
            line
        )
        await this.mechanisms.faultPoint(
            'after-command-log-before-accepted-status'
        )
        await this.appendCommandStatus(accepted)
        this.status.set(command.id, accepted)
        await this.mechanisms.faultPoint(
            'after-command-accepted-status-before-response'
        )
        if (this.storageFailed) {
            throw new Error('Store failed during acceptance')
        }
        this.commandQueue.push({ id: command.id, command: line })

        return {
            accepted: true,
            code: 202,
            value: accepted
        }
    }

    prepareCommand(commandText) {
        let command
        try {
            command = JSONTag.parse(commandText)
        }
        catch (error) {
            this.mechanisms.logger.error('Error: ', error)
            return {
                result: {
                    code: 400,
                    value: {
                        code: 400,
                        message: 'Bad request',
                        details: error.message
                    }
                }
            }
        }
        if (!command || !validCommandId(command.id)) {
            return {
                result: {
                    code: 422,
                    value: {
                        code: 422,
                        message: 'Command has no id',
                        details: command
                    }
                }
            }
        }
        if (this.status.has(command.id)) {
            return {
                result: {
                    code: 200,
                    value: {
                        command: command.id,
                        ...this.status.get(command.id)
                    }
                }
            }
        }
        if (!command.name) {
            return {
                result: {
                    code: 422,
                    value: {
                        code: 422,
                        message: 'Command has no name',
                        details: command
                    }
                }
            }
        }
        return {
            command,
            line: JSONTag.stringify(command)
        }
    }

    runQueuedCommands() {
        if (this.commandRunnerActive || this.storageFailed) {
            return this.runner
        }
        this.commandRunnerActive = true
        this.runner = this.drainCommandQueue()
        return this.runner
    }

    async drainCommandQueue() {
        try {
            while (this.commandQueue.length && !this.storageFailed) {
                const command = this.commandQueue.shift()
                await this.executeQueuedCommand(command)
            }
        }
        catch (error) {
            this.failStorage(error)
        }
        finally {
            this.commandRunnerActive = false
        }
    }

    async executeQueuedCommand(command) {
        this.mechanisms.logger.log('starting command', command.id)
        const active = await this.markCommandActive(command)
        const result = await this.executeCommand(command)

        if (this.commandResultFailed(result)) {
            await this.recordCommandFailure(command, active, result)
            return
        }

        await this.synchronizeRequiredFiles()
        await this.markCommandDone(command)
        this.publishCommandResult(result)
    }

    async markCommandActive(command) {
        const active = nextActiveCommandStatus(
            command.id,
            this.status.get(command.id)
        )
        await this.appendCommandStatus(active)
        if (this.storageFailed) {
            throw new Error('Store failed before execution')
        }
        this.status.set(command.id, active)
        await this.mechanisms.faultPoint(
            'after-active-status-before-command-worker'
        )
        return active
    }

    async executeCommand(command) {
        const config = this.configuration
        const result = await this.mechanisms.executeWorker(
            config.commandWorker,
            {
                ...command,
                meta: this.meta,
                sources: this.sources,
                commandsFile: config.commandsFile,
                indexFile: config.indexFile,
                datafile: config.store.datafile,
                integrityFile: config.store.integrityFile
            },
            config.commandTimeout
        )
        if (this.storageFailed) {
            throw new Error('Store failed during execution')
        }
        if (result?.storageFailure) {
            throw new Error(
                result.message || 'Worker persistence failure'
            )
        }
        return result
    }

    commandResultFailed(result) {
        return !result ||
            result.status === failedCommandStatus ||
            result.status === unsafeCommandStatus ||
            result.code >= 300
    }

    async recordCommandFailure(command, active, result) {
        let status = failedCommandStatus
        if (result?.status === unsafeCommandStatus) {
            status = unsafeCommandStatus
        }
        const terminal = {
            command: command.id,
            status,
            code: result?.code || 500,
            message: result?.message || 'Command failed',
            attempt: active.attempt
        }
        await this.appendCommandStatus(terminal)
        this.status.set(command.id, terminal)
    }

    async synchronizeRequiredFiles() {
        for (const file of this.configuration.store.requiredFiles) {
            await this.mechanisms.syncFile(file)
        }
    }

    async markCommandDone(command) {
        await this.mechanisms.faultPoint('before-command-done-status')
        const done = {
            command: command.id,
            code: 200,
            status: committedCommandStatus
        }
        await this.appendCommandStatus(done)
        await this.mechanisms.faultPoint(
            'after-command-done-status-before-query-update'
        )
        this.status.set(command.id, done)
    }

    appendCommandStatus(status) {
        return this.mechanisms.appendFile(
            this.configuration.store.commandStatus,
            JSONTag.stringify(status)
        )
    }

    publishCommandResult(result) {
        if (!result.source) {
            return
        }
        this.sources.push(result.source)
        Object.assign(this.meta, result.meta)
        const task = {
            name: 'update',
            req: { source: result.source, meta: this.meta }
        }
        this.queryWorkerPool.update(task)
        this.slowQueryWorkerPool.update(task)
    }

    failStorage(error) {
        if (this.storageFailed) {
            return
        }
        this.storageFailed = true
        if (this.mechanisms.onStorageFailure) {
            this.mechanisms.onStorageFailure(error)
        }
    }

    close() {
        if (!this.closure) {
            this.closing = true
            this.closure = this.closeResources()
        }
        return this.closure
    }

    async closeResources() {
        await this.serializeAcceptance()
        await this.runner
        await this.queryWorkerPool.close()
        await this.slowQueryWorkerPool.close()
        if (!this.storageFailed && this.ownership) {
            await this.ownership.release()
            this.ownership = null
        }
    }
}

export default StoreRuntime
