import { Buffer } from 'node:buffer'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import JSONTag from '@muze-nl/jsontag'
import { from, _, anyOf, not } from '@muze-nl/jaqt'
import Parser from '@muze-nl/od-jsontag/src/parse.mjs'
import serialize from '@muze-nl/od-jsontag/src/serialize.mjs'
import {
    inspectStore,
    inventory,
    hash,
    mutableDirectories,
    storePaths
} from './store-inspection.mjs'
import { acquireOwnership } from './store-ownership.mjs'
import {
    publishFile,
    appendRecord,
    durableMkdir,
    syncDirectory,
    syncFile
} from './storage.mjs'
import { executeWorker } from './execute-worker.mjs'
import { nextActiveCommandStatus } from './recovery.mjs'
import { loadIntegrityManifest, verifyIntegrity } from './integrity.mjs'

const defaultWorker = fileURLToPath(
    new URL('./command-worker.mjs', import.meta.url)
)
const defaultIndex = fileURLToPath(new URL('./index.mjs', import.meta.url))
const defaultCommands = fileURLToPath(
    new URL('./commands.mjs', import.meta.url)
)
function deployment(options) {
    return {
        commandsFile: path.resolve(options.commandsFile || defaultCommands),
        indexFile: path.resolve(options.indexFile || defaultIndex),
        commandWorker: path.resolve(options.commandWorker || defaultWorker)
    }
}
async function codeHashes(code) {
    const entries = Object.entries(code)
    const hashes = await Promise.all(
        entries.map(async ([key, file]) => {
            const bytes = await fs.readFile(file)
            return [key, hash(bytes)]
        })
    )
    return Object.fromEntries(hashes)
}
async function canonicalNew(file) {
    const absolute = path.resolve(file)
    try {
        await fs.lstat(absolute)
        throw new Error(`Destination already exists: ${absolute}`)
    }
    catch (error) {
        if (error.code !== 'ENOENT') {
            throw error
        }
    }
    return path.join(
        await fs.realpath(path.dirname(absolute)),
        path.basename(absolute)
    )
}
function outside(target, roots) {
    for (const root of roots) {
        if (
            target === root ||
            target.startsWith(root + path.sep) ||
            root.startsWith(target + path.sep)
        ) {
            throw new Error(
                `Overlapping source/destination: ${target} and ${root}`
            )
        }
    }
}
async function assertFresh(plan) {
    const files = await inventory(plan.config)
    if (hash(JSON.stringify(files)) !== plan.fingerprint) {
        throw new Error('Stale recovery plan: source inventory changed')
    }
    if (
        JSON.stringify(await codeHashes(plan.code)) !==
        JSON.stringify(plan.codeHashes)
    ) {
        throw new Error('Stale recovery plan: selected code changed')
    }
}
export async function planRecovery(options, { quiescent = false } = {}) {
    const report = await inspectStore(options)
    const code = deployment(options)
    const commands = from(report.commands)
    const candidates = commands.where(
        anyOf(
            { status: anyOf('accepted', 'active') },
            { status: 'done', present: false }
        )
    )
    const uncertain = commands.where(
        anyOf(
            { condition: 'corrupt' },
            { present: Boolean, status: not('done') }
        )
    )
    const blockedCandidates = candidates.where({
        laterDatasets: datasets => datasets.length > 0
    })

    const blocks = [...report.errors]
    for (const command of uncertain) {
        blocks.push(
            `${command.id}: existing uncertain dataset requires diagnosis`
        )
    }
    for (const command of blockedCandidates) {
        const laterIds = command.laterDatasets.join(',')
        blocks.push(`${command.id}: later accepted datasets exist: ${laterIds}`)
    }

    const rerun = [...candidates.select(_.id)]
    const summaries = commands.select(record => {
        const summary = { ...record }
        delete summary.command
        return summary
    })
    const selectedCodeHashes = await codeHashes(code)
    return {
        kind: 'simplystore-recovery-plan',
        config: report.config,
        code,
        codeHashes: selectedCodeHashes,
        files: report.files,
        fingerprint: report.fingerprint,
        actionable: quiescent && blocks.length === 0,
        blocks,
        rerun,
        committed: report.committed,
        commands: [...summaries],
        warnings: report.warnings,
        attestation:
            'Approval asserts source quiescence, complete authoritative history, complete logged command inputs, original command meaning, and assessed external effects.'
    }
}
export async function writePlan(file, plan) {
    const target = await canonicalNew(file)
    const roots = await Promise.all(
        mutableDirectories(plan.config).map(dir => fs.realpath(dir))
    )
    outside(target, roots)
    await publishFile(target, JSON.stringify(plan, null, 2) + '\n')
}
async function copyStore(config, files, target) {
    const directories = [
        ...new Set(Object.keys(files).map(file => path.dirname(file)))
    ].sort()
    let common = directories[0]
    while (
        !directories.every(
            dir =>
                dir === common ||
                dir.startsWith(common + path.sep) ||
                common === path.parse(common).root
        )
    ) {
        common = path.dirname(common)
    }
    const mapFile = file => path.join(target, path.relative(common, file))
    for (const directory of directories) {
        await durableMkdir(path.join(target, path.relative(common, directory)))
    }
    for (const [file, digest] of Object.entries(files)) {
        if (digest === null) {
            continue
        }
        const bytes = await fs.readFile(file)
        if (hash(bytes) !== digest) {
            throw new Error(`Source changed while copying: ${file}`)
        }
        await publishFile(mapFile(file), bytes, {
            mode: (await fs.stat(file)).mode & 0o777
        })
    }
    const result = {
        ...config,
        datafile: mapFile(config.datafile),
        commandLog: mapFile(config.commandLog),
        commandStatus: mapFile(config.commandStatus),
        integrityFile: mapFile(config.integrityFile),
        requiredFiles: config.requiredFiles.map(mapFile)
    }
    if (config.schemaFile) {
        result.schemaFile = mapFile(config.schemaFile)
    }
    return result
}
async function prepareWorkspace(target, audit, roots) {
    target = await canonicalNew(target)
    audit = await canonicalNew(audit)
    outside(target, roots)
    outside(audit, roots)
    outside(target, [audit])
    await durableMkdir(target)
    await durableMkdir(audit)
    return { target, audit }
}

export async function applyRecovery(
    plan,
    options = {}
) {
    const recovery = new RecoveryApplication(plan, options)
    return recovery.run()
}

class RecoveryApplication {
    constructor(
        plan,
        { to, auditDir, approveRerun = [], operator, reason } = {}
    ) {
        this.plan = plan
        this.targetOption = to
        this.auditOption = auditDir
        this.approveRerun = approveRerun
        this.operator = operator
        this.reason = reason
        this.freshPlan = null
        this.sourceOwner = null
        this.rootOwner = null
        this.candidateOwner = null
        this.target = null
        this.audit = null
        this.original = null
        this.config = null
        this.journal = null
        this.planHash = null
        this.meta = null
        this.buffers = null
        this.expectedManifest = null
    }

    async run() {
        this.validateApproval()
        this.sourceOwner = await acquireOwnership(
            mutableDirectories(this.plan.config)
        )
        try {
            await this.verifyFreshSource()
            await this.prepareCandidateWorkspace()
            await this.recordAuthorization()
            await this.loadCommittedPrefix()
            await this.runApprovedCommands()
            const complete = await this.inspectCompletedCandidate()
            return await this.publishCompletion(complete)
        }
        finally {
            // Failed candidate locks and audit evidence must remain. The
            // unchanged source can be released.
            await this.sourceOwner.release()
        }
    }

    validateApproval() {
        if (
            this.plan.kind !== 'simplystore-recovery-plan' ||
            !this.plan.actionable
        ) {
            throw new Error(
                'Plan is not actionable; inspect a quiescent source and ' +
                'resolve blocking evidence'
            )
        }
        if (!this.operator || !this.reason) {
            throw new Error('Operator and assessment reason are required')
        }
        if (
            JSON.stringify(this.approveRerun) !==
            JSON.stringify(this.plan.rerun)
        ) {
            throw new Error(
                'Explicit approval must match the complete ordered rerun list'
            )
        }
    }

    async verifyFreshSource() {
        await assertFresh(this.plan)
        // Do not trust editable plan fields to bypass the source predicate.
        this.freshPlan = await planRecovery(
            { ...this.plan.config, ...this.plan.code },
            { quiescent: true }
        )
        const sameRerun =
            JSON.stringify(this.freshPlan.rerun) ===
            JSON.stringify(this.plan.rerun)
        if (!this.freshPlan.actionable || !sameRerun) {
            throw new Error(
                'Source no longer satisfies ordered recovery predicate'
            )
        }
    }

    async prepareCandidateWorkspace() {
        const workspace = await prepareWorkspace(
            this.targetOption,
            this.auditOption,
            this.sourceOwner.directories
        )
        this.target = workspace.target
        this.audit = workspace.audit
        this.rootOwner = await acquireOwnership([this.target], {
            purpose: 'recovery',
            auditDir: this.audit
        })
        this.original = await copyStore(
            this.plan.config,
            this.plan.files,
            path.join(this.audit, 'original')
        )
        this.config = await copyStore(
            this.plan.config,
            this.plan.files,
            this.target
        )
        this.candidateOwner = await acquireOwnership(
            mutableDirectories(this.config).filter(
                directory => directory !== this.target
            ),
            { ancestorToken: this.rootOwner.token }
        )
    }

    async recordAuthorization() {
        this.planHash = hash(JSON.stringify(this.plan))
        await publishFile(
            path.join(this.audit, 'plan.json'),
            JSON.stringify(this.plan, null, 2)
        )
        await publishFile(
            path.join(this.audit, 'original.json'),
            JSON.stringify(this.original, null, 2)
        )
        this.journal = path.join(this.audit, 'attempts.jsonl')
        await appendRecord(
            this.journal,
            JSON.stringify({
                event: 'authorized',
                planHash: this.planHash,
                operator: this.operator,
                reason: this.reason,
                rerun: this.plan.rerun,
                config: this.config,
                attestation: this.plan.attestation
            })
        )
    }

    async loadCommittedPrefix() {
        const inspection = await inspectStore(this.config)
        if (inspection.errors.length) {
            throw new Error(inspection.errors.join('; '))
        }
        const parser = new Parser()
        let data
        for (const bytes of inspection.buffers) {
            data = parser.parse(bytes)
        }
        // Rebuild parser indexes without invoking custom hooks.
        this.meta = {
            index: { id: new Map() },
            data: path.dirname(this.config.datafile),
            parts: inspection.committed.length
        }
        this.buffers = [serialize(data, { meta: this.meta })]
        if (this.config.schemaFile) {
            this.meta.schema = JSONTag.parse(
                await fs.readFile(this.config.schemaFile, 'utf8')
            )
        }
        const integrityFile = this.plan.config.integrityFile
        if (this.plan.files[integrityFile] != null) {
            this.expectedManifest = await loadIntegrityManifest(integrityFile)
        }
    }

    async runApprovedCommands() {
        for (const id of this.plan.rerun) {
            await this.runApprovedCommand(id)
        }
    }

    async runApprovedCommand(id) {
        await assertFresh(this.plan)
        const command = this.freshPlan.commands.find(item => item.id === id)
        const active = await this.markCommandActive(command)
        const result = await this.executeCommand(id, command)
        await this.assertSuccessfulResult(id, result)
        await this.commitCommandResult(id, command, active, result)
    }

    async markCommandActive(command) {
        const { id } = command
        const active = nextActiveCommandStatus(id, command.history.at(-1))
        await this.recordAttempt(id, active)
        await appendRecord(
            this.config.commandStatus,
            JSONTag.stringify(active)
        )
        return active
    }

    async recordAttempt(id, active) {
        await appendRecord(
            this.journal,
            JSON.stringify({
                event: 'attempt',
                id,
                attempt: active.attempt,
                planHash: this.planHash
            })
        )
    }

    executeCommand(id, command) {
        return executeWorker(
            this.plan.code.commandWorker,
            {
                id,
                command: command.line,
                meta: this.meta,
                data: this.buffers,
                commandsFile: this.plan.code.commandsFile,
                indexFile: this.plan.code.indexFile,
                datafile: this.config.datafile,
                // Retained digests are checked before replacement manifest and
                // done records are allowed.
                integrityFile: null,
                integrityRequired: false
            },
            30000
        )
    }

    async assertSuccessfulResult(id, result) {
        const stopped =
            !result ||
            result.storageFailure ||
            result.status === 'failed' ||
            result.status === 'unsafe' ||
            result.code >= 300
        if (!stopped) {
            return
        }
        let resultSummary = result
        if (result) {
            resultSummary = {
                status: result.status,
                message: result.message
            }
        }
        await appendRecord(
            this.journal,
            JSON.stringify({ event: 'stopped', id, result: resultSummary })
        )
        throw new Error(
            `Recovery attempt ${id} uncertain or failed; inspect before ` +
            'approving another attempt'
        )
    }

    async commitCommandResult(id, command, active, result) {
        for (const file of this.config.requiredFiles) {
            await syncFile(file)
        }
        if (this.expectedManifest && command.status === 'done') {
            verifyIntegrity(
                this.expectedManifest,
                this.plan.config.integrityFile,
                command.file,
                result.data,
                { required: true }
            )
        }
        if (this.config.integrity || this.expectedManifest) {
            await this.appendResultIntegrity(command, result.data)
        }
        await appendRecord(
            this.config.commandStatus,
            JSONTag.stringify({ command: id, code: 200, status: 'done' })
        )
        this.buffers.push(result.data)
        Object.assign(this.meta, result.meta)
        await appendRecord(
            this.journal,
            JSON.stringify({ event: 'done', id, attempt: active.attempt })
        )
    }

    async appendResultIntegrity(command, data) {
        const { appendIntegrityRecord } = await import('./integrity.mjs')
        const targetFile = path.join(
            path.dirname(this.config.datafile),
            path.basename(command.file)
        )
        await appendIntegrityRecord(
            this.config.integrityFile,
            targetFile,
            data
        )
    }

    async inspectCompletedCandidate() {
        const complete = await inspectStore(this.config)
        if (complete.ready) {
            return complete
        }
        const problems = from(complete.commands).where({ problem: Boolean })
        const diagnostic = {
            errors: complete.errors,
            commands: [...problems]
        }
        throw new Error(
            'Recovered candidate is not ready: ' +
            JSON.stringify(diagnostic)
        )
    }

    async publishCompletion(complete) {
        const report = {
            kind: 'simplystore-recovery-complete',
            planHash: this.planHash,
            config: this.config,
            code: this.plan.code,
            codeHashes: this.plan.codeHashes,
            files: complete.files,
            fingerprint: complete.fingerprint,
            committed: complete.committed,
            operator: this.operator,
            reason: this.reason,
            warnings: complete.warnings
        }
        await publishFile(
            path.join(this.audit, 'complete.json'),
            JSON.stringify(report, null, 2)
        )
        await this.candidateOwner.release()
        this.candidateOwner = null
        await this.rootOwner.release()
        return report
    }
}

export async function backupStore(options, { to, quiescent = false } = {}) {
    if (!quiescent) {
        throw new Error('Backup requires a stopped/quiescent source')
    }
    const config = storePaths(options),
        owner = await acquireOwnership(mutableDirectories(config))
    try {
        const report = await inspectStore(config)
        if (!report.ready) {
            throw new Error('Backup source is not a complete validated store')
        }
        const target = await canonicalNew(to)
        outside(target, owner.directories)
        await durableMkdir(target)
        const backupOwner = await acquireOwnership([target])
        const copied = await copyStore(
            config,
            report.files,
            path.join(target, 'store')
        )
        const check = await inspectStore(copied)
        if (!check.ready) {
            throw new Error('Backup reconstruction failed')
        }
        if (
            hash(JSON.stringify(await inventory(config))) !== report.fingerprint
        ) {
            throw new Error('Backup source changed')
        }
        const manifest = {
            kind: 'simplystore-backup-complete',
            root: target,
            config: copied,
            files: check.files,
            fingerprint: check.fingerprint,
            committed: check.committed,
            sourceFingerprint: report.fingerprint,
            warnings: report.warnings
        }
        await publishFile(
            path.join(target, 'complete.json'),
            JSON.stringify(manifest, null, 2)
        )
        await backupOwner.release()
        return manifest
    }
    finally {
        await owner.release()
    }
}

function backupCoverage(retained, restored) {
    const originalBase = retained.files[retained.config.datafile]
    const backupBase = restored.files[restored.config.datafile]
    const sameBase = originalBase === backupBase
    const backupCommands = from(restored.commands)

    function isCovered(command) {
        if (!sameBase) {
            return false
        }
        const matching = backupCommands.where({
            id: command.id,
            line: command.line,
            status: command.status
        })
        if (command.status !== 'done' || !command.present) {
            return matching.length > 0
        }
        return matching.some(backupCommand => {
            const originalDigest = retained.files[command.file]
            const backupDigest = restored.files[backupCommand.file]
            return originalDigest === backupDigest
        })
    }

    const missing = from(retained.commands)
        .where({ accepted: true })
        .where(not(isCovered))
        .select(_.id)
    return { sameBase, missingFromBackup: [...missing] }
}

export async function restoreBackup(
    backupDirectory,
    options = {}
) {
    const restoration = new BackupRestoration(backupDirectory, options)
    return restoration.run()
}

class BackupRestoration {
    constructor(
        backupDirectory,
        { to, auditDir, source, sourceQuiescent = false } = {}
    ) {
        this.backupDirectory = backupDirectory
        this.targetOption = to
        this.auditOption = auditDir
        this.source = source
        this.sourceQuiescent = sourceQuiescent
        this.backup = null
        this.manifest = null
        this.owner = null
        this.rootOwner = null
        this.candidateOwner = null
        this.target = null
        this.audit = null
        this.config = null
        this.candidateInspection = null
        this.missingFromBackup = null
        this.sameBase = null
    }

    async run() {
        await this.loadManifest()
        this.validateSourceComparison()
        this.owner = await acquireOwnership(this.ownedDirectories())
        try {
            await this.validateBackupContents()
            await this.prepareRestoredCandidate()
            await this.compareRetainedSource()
            return await this.publishCompletion()
        }
        finally {
            await this.owner.release()
        }
    }

    async loadManifest() {
        this.backup = await fs.realpath(this.backupDirectory)
        this.manifest = JSON.parse(
            await fs.readFile(
                path.join(this.backup, 'complete.json'),
                'utf8'
            )
        )
        if (this.manifest.kind !== 'simplystore-backup-complete') {
            throw new Error('Backup is incomplete or unrecognized')
        }
        this.rebaseManifest()
    }

    rebaseManifest() {
        const oldRoot = this.manifest.root
        if (
            typeof oldRoot !== 'string' ||
            !path.isAbsolute(oldRoot) ||
            this.manifest.fingerprint !==
                hash(JSON.stringify(this.manifest.files))
        ) {
            throw new Error('Invalid backup inventory')
        }
        const rebase = file => this.rebasePath(file, oldRoot)
        this.manifest.files = Object.fromEntries(
            Object.entries(this.manifest.files).map(([file, digest]) => [
                rebase(file),
                digest
            ])
        )
        this.manifest.fingerprint = hash(
            JSON.stringify(this.manifest.files)
        )
        const configKeys = [
            'datafile',
            'commandLog',
            'commandStatus',
            'integrityFile',
            'schemaFile'
        ]
        for (const key of configKeys) {
            if (this.manifest.config[key]) {
                this.manifest.config[key] = rebase(
                    this.manifest.config[key]
                )
            }
        }
        this.manifest.config.requiredFiles =
            this.manifest.config.requiredFiles.map(rebase)
        const outsideBackup = mutableDirectories(this.manifest.config).some(
            directory =>
                directory !== this.backup &&
                !directory.startsWith(this.backup + path.sep)
        )
        if (outsideBackup) {
            throw new Error('Backup configuration points outside backup')
        }
    }

    rebasePath(file, oldRoot) {
        if (
            typeof file !== 'string' ||
            file !== path.resolve(file) ||
            !file.startsWith(oldRoot + path.sep)
        ) {
            throw new Error('Backup manifest points outside backup')
        }
        return path.join(this.backup, path.relative(oldRoot, file))
    }

    validateSourceComparison() {
        if (this.source && !this.sourceQuiescent) {
            throw new Error(
                'Source comparison requires a stopped/quiescent source'
            )
        }
    }

    ownedDirectories() {
        const directories = mutableDirectories(this.manifest.config)
        if (this.source) {
            const sourceConfig = storePaths(this.source)
            directories.push(...mutableDirectories(sourceConfig))
        }
        return directories
    }

    async validateBackupContents() {
        const report = await inspectStore(this.manifest.config)
        if (
            !report.ready ||
            report.fingerprint !== this.manifest.fingerprint
        ) {
            throw new Error(
                'Backup contents differ from completed manifest'
            )
        }
    }

    async prepareRestoredCandidate() {
        const workspace = await prepareWorkspace(
            this.targetOption,
            this.auditOption,
            [this.backup, ...this.owner.directories]
        )
        this.target = workspace.target
        this.audit = workspace.audit
        this.rootOwner = await acquireOwnership([this.target], {
            purpose: 'restore',
            auditDir: this.audit
        })
        this.config = await copyStore(
            this.manifest.config,
            this.manifest.files,
            this.target
        )
        this.candidateOwner = await acquireOwnership(
            mutableDirectories(this.config).filter(
                directory => directory !== this.target
            ),
            { ancestorToken: this.rootOwner.token }
        )
        this.candidateInspection = await inspectStore(this.config)
        if (!this.candidateInspection.ready) {
            throw new Error('Restored candidate failed validation')
        }
    }

    async compareRetainedSource() {
        if (!this.source) {
            return
        }
        const retained = await inspectStore(this.source)
        const coverage = backupCoverage(
            retained,
            this.candidateInspection
        )
        this.sameBase = coverage.sameBase
        this.missingFromBackup = coverage.missingFromBackup
    }

    async publishCompletion() {
        let coverage = 'Loss relative to current source is unknown'
        if (this.source) {
            coverage =
                'Compared with supplied retained history; ' +
                'completeness still requires external evidence'
        }
        const complete = {
            kind: 'simplystore-restore-complete',
            config: this.config,
            files: this.candidateInspection.files,
            fingerprint: this.candidateInspection.fingerprint,
            committed: this.candidateInspection.committed,
            missingFromBackup: this.missingFromBackup,
            sameBase: this.sameBase,
            warnings: this.candidateInspection.warnings,
            coverage
        }
        await publishFile(
            path.join(this.audit, 'complete.json'),
            JSON.stringify(complete, null, 2)
        )
        await this.candidateOwner.release()
        await this.rootOwner.release()
        return complete
    }
}

// Explicit offline operation: no PID-age or liveness heuristic can authorize
// it.
export async function releaseOfflineLocks(
    options,
    assessment = {}
) {
    const release = new OfflineLockRelease(options, assessment)
    return release.preview()
}

class OfflineLockRelease {
    constructor(
        options,
        { operator, reason, confirmedStopped = false } = {}
    ) {
        this.options = options
        this.operator = operator
        this.reason = reason
        this.confirmedStopped = confirmedStopped
        this.config = null
        this.report = null
        this.removed = []
    }

    async preview() {
        this.validateAssessment()
        this.config = storePaths(this.options)
        this.report = await inspectStore(this.config)
        const directories = await this.findLockDirectories()
        for (const directory of directories) {
            await this.inspectLock(directory)
        }
        return this.createPreview()
    }

    validateAssessment() {
        if (!this.confirmedStopped || !this.operator || !this.reason) {
            throw new Error(
                'Offline release requires confirmed stopped writer, ' +
                'operator, and reason'
            )
        }
    }

    async findLockDirectories() {
        const lockDirectories = new Set(
            await Promise.all(
                mutableDirectories(this.config).map(directory =>
                    fs.realpath(directory)
                )
            )
        )
        for (const directory of [...lockDirectories]) {
            await this.findAncestorLocks(directory, lockDirectories)
        }
        return [...lockDirectories].sort().reverse()
    }

    async findAncestorLocks(directory, lockDirectories) {
        for (
            let parent = path.dirname(directory);
            path.dirname(parent) !== parent;
            parent = path.dirname(parent)
        ) {
            try {
                await fs.access(path.join(parent, '.simplystore-lock'))
                lockDirectories.add(parent)
            }
            catch (error) {
                if (error.code !== 'ENOENT') {
                    throw error
                }
            }
        }
    }

    async inspectLock(directory) {
        const lock = path.join(directory, '.simplystore-lock')
        const entries = await this.readLockEntries(lock)
        if (entries === null) {
            return
        }
        const unknownContents = entries.some(
            entry => entry !== 'owner.json' && !entry.endsWith('.tmp')
        )
        if (unknownContents) {
            throw new Error(`Unknown lock contents: ${lock}`)
        }
        const ownerFiles = await this.readOwnerFiles(lock, entries)
        await this.validateRecoveryLock(ownerFiles)
        this.removed.push({ lock, ownerFiles })
    }

    async readLockEntries(lock) {
        try {
            return await fs.readdir(lock)
        }
        catch (error) {
            if (error.code === 'ENOENT') {
                return null
            }
            throw error
        }
    }

    async readOwnerFiles(lock, entries) {
        const ownerFiles = []
        for (const entry of entries) {
            const bytes = await fs.readFile(path.join(lock, entry))
            ownerFiles.push({
                name: entry,
                bytes: bytes.toString('base64')
            })
        }
        return ownerFiles
    }

    async validateRecoveryLock(ownerFiles) {
        const ownerRecord = ownerFiles.find(
            item => item.name === 'owner.json'
        )
        let owner = null
        if (ownerRecord) {
            const ownerBytes = Buffer.from(ownerRecord.bytes, 'base64')
            owner = JSON.parse(ownerBytes.toString())
        }
        if (owner?.purpose !== 'recovery' || !this.report.ready) {
            return
        }
        let completed
        try {
            completed = JSON.parse(
                await fs.readFile(
                    path.join(owner.auditDir, 'complete.json'),
                    'utf8'
                )
            )
        }
        catch {
            /* Missing report is not completion evidence. */
        }
        if (completed?.fingerprint !== this.report.fingerprint) {
            throw new Error(
                'Completed-looking recovery candidate requires finish with ' +
                'its retained audit before unlocking'
            )
        }
    }

    createPreview() {
        const commands = this.report.commands.map(command => {
            return {
                id: command.id,
                status: command.status,
                problem: command.problem
            }
        })
        const inspection = {
            ready: this.report.ready,
            errors: this.report.errors,
            commands
        }
        return {
            inspection,
            operator: this.operator,
            reason: this.reason,
            removed: this.removed,
            finish: () => this.finish()
        }
    }

    async finish() {
        for (const { lock, ownerFiles } of this.removed) {
            await this.verifyLockUnchanged(lock, ownerFiles)
            for (const entry of ownerFiles) {
                await fs.unlink(path.join(lock, entry.name))
            }
            await fs.rmdir(lock)
            await syncDirectory(path.dirname(lock))
        }
    }

    async verifyLockUnchanged(lock, ownerFiles) {
        for (const entry of ownerFiles) {
            const current = await fs.readFile(path.join(lock, entry.name))
            if (current.toString('base64') !== entry.bytes) {
                throw new Error('Lock changed after preview')
            }
        }
    }
}

export async function finishRecovery(
    auditDirectory,
    { operator, reason, confirmedStopped = false } = {}
) {
    if (!confirmedStopped || !operator || !reason) {
        throw new Error(
            'Finishing requires confirmed stopped writer and administrator assessment'
        )
    }
    const audit = await fs.realpath(auditDirectory)
    const plan = JSON.parse(
        await fs.readFile(path.join(audit, 'plan.json'), 'utf8')
    )
    const authorization = JSON.parse(
        (await fs.readFile(path.join(audit, 'attempts.jsonl'), 'utf8')).split(
            '\n'
        )[0]
    )
    if (authorization.planHash !== hash(JSON.stringify(plan))) {
        throw new Error('Audit authorization does not match retained plan')
    }
    await assertFresh(plan)
    const report = await inspectStore(authorization.config)
    if (
        !report.ready ||
        plan.rerun.some(id => !report.committed.includes(id))
    ) {
        throw new Error(
            'Recovery is incomplete; inspect and approve remaining attempts, never automatically rerun'
        )
    }
    const complete = {
        kind: 'simplystore-recovery-complete',
        planHash: authorization.planHash,
        config: report.config,
        code: plan.code,
        codeHashes: plan.codeHashes,
        files: report.files,
        fingerprint: report.fingerprint,
        committed: report.committed,
        operator,
        reason,
        warnings: report.warnings
    }
    await publishFile(
        path.join(audit, 'complete.json'),
        JSON.stringify(complete, null, 2)
    )
    const release = await releaseOfflineLocks(report.config, {
        operator,
        reason,
        confirmedStopped
    })
    await publishFile(
        path.join(audit, 'finish-unlock.json'),
        JSON.stringify(release)
    )
    await release.finish()
    return complete
}

export async function verifyCandidate(report) {
    if (
        ![
            'simplystore-recovery-complete',
            'simplystore-restore-complete'
        ].includes(report.kind)
    ) {
        throw new Error('Expected completed recovery/restore report')
    }
    const current = await inspectStore(report.config)
    if (!current.ready || current.fingerprint !== report.fingerprint) {
        throw new Error('Candidate changed or is incomplete')
    }
    if (
        report.code &&
        JSON.stringify(await codeHashes(report.code)) !==
            JSON.stringify(report.codeHashes)
    ) {
        throw new Error('Selected code changed after recovery')
    }
    return current
}
