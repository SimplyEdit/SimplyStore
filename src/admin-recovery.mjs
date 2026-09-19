import {Buffer} from 'node:buffer'
import fs from 'node:fs/promises'
import path from 'node:path'
import {fileURLToPath} from 'node:url'
import JSONTag from '@muze-nl/jsontag'
import {from, _, anyOf, not} from '@muze-nl/jaqt'
import Parser from '@muze-nl/od-jsontag/src/parse.mjs'
import serialize from '@muze-nl/od-jsontag/src/serialize.mjs'
import {inspectStore, inventory, hash, mutableDirectories, storePaths} from './store-inspection.mjs'
import {acquireOwnership} from './store-ownership.mjs'
import {publishFile, appendRecord, durableMkdir, syncDirectory, syncFile} from './storage.mjs'
import {executeWorker} from './execute-worker.mjs'
import {nextActiveCommandStatus} from './recovery.mjs'
import {loadIntegrityManifest, verifyIntegrity} from './integrity.mjs'

const defaultWorker = fileURLToPath(new URL('./command-worker.mjs', import.meta.url))
const defaultIndex = fileURLToPath(new URL('./index.mjs', import.meta.url))
const defaultCommands = fileURLToPath(new URL('./commands.mjs', import.meta.url))
function deployment(options) {
    return {commandsFile:path.resolve(options.commandsFile || defaultCommands),
        indexFile:path.resolve(options.indexFile || defaultIndex),
        commandWorker:path.resolve(options.commandWorker || defaultWorker)}
}
async function codeHashes(code) {
    const entries = Object.entries(code)
    const hashes = await Promise.all(entries.map(async ([key, file]) => {
        const bytes = await fs.readFile(file)
        return [key, hash(bytes)]
    }))
    return Object.fromEntries(hashes)
}
async function canonicalNew(file) {
    const absolute = path.resolve(file)
    try {
        await fs.lstat(absolute); throw new Error(`Destination already exists: ${absolute}`)
    }
    catch (error) {
        if (error.code !== 'ENOENT') {
            throw error
        }
    }
    return path.join(await fs.realpath(path.dirname(absolute)), path.basename(absolute))
}
function outside(target, roots) {
    for (const root of roots) {
        if (target === root || target.startsWith(root + path.sep) || root.startsWith(target + path.sep)) {
            throw new Error(`Overlapping source/destination: ${target} and ${root}`)
        }
    }
}
async function assertFresh(plan) {
    const files = await inventory(plan.config)
    if (hash(JSON.stringify(files)) !== plan.fingerprint) {
        throw new Error('Stale recovery plan: source inventory changed')
    }
    if (JSON.stringify(await codeHashes(plan.code)) !== JSON.stringify(plan.codeHashes)) {
        throw new Error('Stale recovery plan: selected code changed')
    }
}
export async function planRecovery(options, {quiescent = false} = {}) {
    const report = await inspectStore(options)
    const code = deployment(options)
    const commands = from(report.commands)
    const candidates = commands.where(anyOf(
        {status: anyOf('accepted', 'active')},
        {status: 'done', present: false}
    ))
    const uncertain = commands.where(anyOf(
        {condition: 'corrupt'},
        {present: Boolean, status: not('done')}
    ))
    const blockedCandidates = candidates.where({
        laterDatasets: datasets => datasets.length > 0
    })

    const blocks = [...report.errors]
    for (const command of uncertain) {
        blocks.push(`${command.id}: existing uncertain dataset requires diagnosis`)
    }
    for (const command of blockedCandidates) {
        const laterIds = command.laterDatasets.join(',')
        blocks.push(`${command.id}: later accepted datasets exist: ${laterIds}`)
    }

    const rerun = [...candidates.select(_.id)]
    const summaries = commands.select(record => {
        const summary = {...record}
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
        attestation: 'Approval asserts source quiescence, complete authoritative history, complete logged command inputs, original command meaning, and assessed external effects.'
    }
}
export async function writePlan(file, plan) {
    const target = await canonicalNew(file)
    const roots = await Promise.all(mutableDirectories(plan.config).map(dir => fs.realpath(dir)))
    outside(target, roots)
    await publishFile(target, JSON.stringify(plan, null, 2) + '\n')
}
async function copyStore(config, files, target) {
    const directories = [...new Set(Object.keys(files).map(file => path.dirname(file)))].sort()
    let common = directories[0]
    while (!directories.every(dir => dir === common || dir.startsWith(common + path.sep) || common === path.parse(common).root)) {
        common = path.dirname(common)
    }
    const mapFile = file => path.join(target, path.relative(common,file))
    for (const directory of directories) {
        await durableMkdir(path.join(target,path.relative(common,directory)))
    }
    for (const [file,digest] of Object.entries(files)) {
        if (digest === null) {
            continue
        }
        const bytes = await fs.readFile(file)
        if (hash(bytes) !== digest) {
            throw new Error(`Source changed while copying: ${file}`)
        }
        await publishFile(mapFile(file), bytes, {mode:(await fs.stat(file)).mode & 0o777})
    }
    const result = {...config, datafile:mapFile(config.datafile), commandLog:mapFile(config.commandLog),
        commandStatus:mapFile(config.commandStatus), integrityFile:mapFile(config.integrityFile),
        requiredFiles:config.requiredFiles.map(mapFile)}
    if (config.schemaFile) {
        result.schemaFile = mapFile(config.schemaFile)
    }
    return result
}
async function prepareWorkspace(target, audit, roots) {
    target = await canonicalNew(target); audit = await canonicalNew(audit)
    outside(target, roots); outside(audit, roots); outside(target,[audit])
    await durableMkdir(target); await durableMkdir(audit)
    return {target,audit}
}

export async function applyRecovery(plan, {to, auditDir, approveRerun = [], operator, reason} = {}) {
    if (plan.kind !== 'simplystore-recovery-plan' || !plan.actionable) {
        throw new Error('Plan is not actionable; inspect a quiescent source and resolve blocking evidence')
    }
    if (!operator || !reason) {
        throw new Error('Operator and assessment reason are required')
    }
    if (JSON.stringify(approveRerun) !== JSON.stringify(plan.rerun)) {
        throw new Error('Explicit approval must match the complete ordered rerun list')
    }
    const sourceOwner = await acquireOwnership(mutableDirectories(plan.config))
    let candidateOwner
    try {
        await assertFresh(plan)
        // Do not trust editable plan fields to bypass the source predicate.
        const fresh = await planRecovery({...plan.config,...plan.code}, {quiescent:true})
        if (!fresh.actionable || JSON.stringify(fresh.rerun) !== JSON.stringify(plan.rerun)) {
            throw new Error('Source no longer satisfies ordered recovery predicate')
        }
        const workspace = await prepareWorkspace(to, auditDir, sourceOwner.directories)
        const {target,audit} = workspace
        const rootOwner = await acquireOwnership([target],{purpose:'recovery',auditDir:audit})
        // A root lock protects partially copied candidates before layout is complete.
        const original = await copyStore(plan.config, plan.files, path.join(audit,'original'))
        const config = await copyStore(plan.config, plan.files, target)
        candidateOwner = await acquireOwnership(mutableDirectories(config).filter(dir=>dir!==target),{ancestorToken:rootOwner.token})
        const planHash = hash(JSON.stringify(plan))
        await publishFile(path.join(audit,'plan.json'), JSON.stringify(plan,null,2))
        await publishFile(path.join(audit,'original.json'), JSON.stringify(original,null,2))
        const journal = path.join(audit,'attempts.jsonl')
        await appendRecord(journal, JSON.stringify({event:'authorized',planHash,operator,reason,rerun:plan.rerun,config,attestation:plan.attestation}))
        const inspection = await inspectStore(config)
        if (inspection.errors.length) {
            throw new Error(inspection.errors.join('; '))
        }
        const parser = new Parser()
        let data
        for (const bytes of inspection.buffers) {
            data = parser.parse(bytes)
        }
        // Serialize committed prefix, rebuilding parser indexes without custom hooks.
        let meta = {index:{id:new Map()}, data:path.dirname(config.datafile), parts:inspection.committed.length}
        const buffers = [serialize(data,{meta})]
        if (config.schemaFile) {
            meta.schema = JSONTag.parse(await fs.readFile(config.schemaFile,'utf8'))
        }
        const expectedManifest = plan.files[plan.config.integrityFile] != null ? await loadIntegrityManifest(plan.config.integrityFile) : null
        for (const id of plan.rerun) {
            await assertFresh(plan)
            const command = fresh.commands.find(c => c.id === id)
            const active = nextActiveCommandStatus(id, command.history.at(-1))
            await appendRecord(journal, JSON.stringify({event:'attempt',id,attempt:active.attempt,planHash}))
            await appendRecord(config.commandStatus, JSONTag.stringify(active))
            const result = await executeWorker(plan.code.commandWorker, {id,command:command.line,meta,data:buffers,
                commandsFile:plan.code.commandsFile,indexFile:plan.code.indexFile,datafile:config.datafile,
                // Verify a retained digest before allowing replacement manifest/done records.
                integrityFile:null, integrityRequired:false}, 30000)
            if (!result || result.storageFailure || result.status === 'failed' || result.status === 'unsafe' || result.code >= 300) {
                await appendRecord(journal, JSON.stringify({event:'stopped',id,result:result && {status:result.status,message:result.message}}))
                throw new Error(`Recovery attempt ${id} uncertain or failed; inspect before approving another attempt`)
            }
            for (const file of config.requiredFiles) {
                await syncFile(file)
            }
            if (expectedManifest && command.status === 'done') {
                verifyIntegrity(expectedManifest, plan.config.integrityFile, command.file, result.data, {required:true})
            }
            if (config.integrity || expectedManifest) {
                const {appendIntegrityRecord} = await import('./integrity.mjs')
                const targetFile = path.join(path.dirname(config.datafile),path.basename(command.file))
                await appendIntegrityRecord(config.integrityFile,targetFile,result.data)
            }
            await appendRecord(config.commandStatus, JSONTag.stringify({command:id,code:200,status:'done'}))
            buffers.push(result.data); Object.assign(meta,result.meta)
            await appendRecord(journal, JSON.stringify({event:'done',id,attempt:active.attempt}))
        }
        const complete = await inspectStore(config)
        if (!complete.ready) {
            const problems = from(complete.commands).where({problem: Boolean})
            const diagnostic = {errors: complete.errors, commands: [...problems]}
            const details = JSON.stringify(diagnostic)
            throw new Error(`Recovered candidate is not ready: ${details}`)
        }
        const report = {kind:'simplystore-recovery-complete',planHash,config,code:plan.code,codeHashes:plan.codeHashes,files:complete.files,
            fingerprint:complete.fingerprint,committed:complete.committed,operator,reason,warnings:complete.warnings}
        await publishFile(path.join(audit,'complete.json'), JSON.stringify(report,null,2))
        await candidateOwner.release(); candidateOwner = null
        await rootOwner.release()
        return report
    }
    finally {
        // On failure retain candidate locks and its audit. The unchanged source can be released.
        await sourceOwner.release()
    }
}

export async function backupStore(options, {to, quiescent = false} = {}) {
    if (!quiescent) {
        throw new Error('Backup requires a stopped/quiescent source')
    }
    const config = storePaths(options), owner = await acquireOwnership(mutableDirectories(config))
    try {
        const report = await inspectStore(config)
        if (!report.ready) {
            throw new Error('Backup source is not a complete validated store')
        }
        const target = await canonicalNew(to); outside(target, owner.directories)
        await durableMkdir(target)
        const backupOwner = await acquireOwnership([target])
        const copied = await copyStore(config, report.files, path.join(target,'store'))
        const check = await inspectStore(copied)
        if (!check.ready) {
            throw new Error('Backup reconstruction failed')
        }
        if (hash(JSON.stringify(await inventory(config))) !== report.fingerprint) {
            throw new Error('Backup source changed')
        }
        const manifest = {kind:'simplystore-backup-complete',root:target,config:copied,files:check.files,fingerprint:check.fingerprint,
            committed:check.committed,sourceFingerprint:report.fingerprint,warnings:report.warnings}
        await publishFile(path.join(target,'complete.json'),JSON.stringify(manifest,null,2))
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
        .where({accepted: true})
        .where(not(isCovered))
        .select(_.id)
    return {sameBase, missingFromBackup: [...missing]}
}

export async function restoreBackup(backupDirectory, {to, auditDir, source, sourceQuiescent=false} = {}) {
    const backup = await fs.realpath(backupDirectory)
    const manifest = JSON.parse(await fs.readFile(path.join(backup,'complete.json'),'utf8'))
    if (manifest.kind !== 'simplystore-backup-complete') {
        throw new Error('Backup is incomplete or unrecognized')
    }
    const oldRoot=manifest.root
    if(typeof oldRoot!=='string' || !path.isAbsolute(oldRoot) || manifest.fingerprint!==hash(JSON.stringify(manifest.files))){
        throw new Error('Invalid backup inventory')
    }
    const rebase=file=>{
        if(typeof file!=='string' || file!==path.resolve(file) || !file.startsWith(oldRoot+path.sep)){
            throw new Error('Backup manifest points outside backup')
        }
        return path.join(backup,path.relative(oldRoot,file))
    }
    manifest.files=Object.fromEntries(Object.entries(manifest.files).map(([file,digest])=>[rebase(file),digest]))
    manifest.fingerprint=hash(JSON.stringify(manifest.files))
    for(const key of ['datafile','commandLog','commandStatus','integrityFile','schemaFile']){
        if(manifest.config[key]){
            manifest.config[key]=rebase(manifest.config[key])
        }
    }
    manifest.config.requiredFiles=manifest.config.requiredFiles.map(rebase)
    if (mutableDirectories(manifest.config).some(dir=>dir!==backup && !dir.startsWith(backup+path.sep))) {
        throw new Error('Backup configuration points outside backup')
    }
    if (source && !sourceQuiescent) {
        throw new Error('Source comparison requires a stopped/quiescent source')
    }
    const owner = await acquireOwnership([...mutableDirectories(manifest.config),...(source ? mutableDirectories(storePaths(source)) : [])])
    try {
        const report = await inspectStore(manifest.config)
        if (!report.ready || report.fingerprint !== manifest.fingerprint) {
            throw new Error('Backup contents differ from completed manifest')
        }
        const {target,audit} = await prepareWorkspace(to,auditDir,[backup,...owner.directories])
        const rootOwner = await acquireOwnership([target],{purpose:'restore',auditDir:audit})
        const config = await copyStore(manifest.config,manifest.files,target)
        const candidate = await acquireOwnership(mutableDirectories(config).filter(dir=>dir!==target),{ancestorToken:rootOwner.token})
        const check = await inspectStore(config)
        if (!check.ready) {
            throw new Error('Restored candidate failed validation')
        }
        let missingFromBackup = null, sameBase = null
        if (source) {
            const retained = await inspectStore(source)
            const coverage = backupCoverage(retained, check)
            sameBase = coverage.sameBase
            missingFromBackup = coverage.missingFromBackup
        }
        const complete = {kind:'simplystore-restore-complete',config,files:check.files,fingerprint:check.fingerprint,
            committed:check.committed,missingFromBackup,sameBase,warnings:check.warnings,
            coverage:source ? 'Compared with supplied retained history; completeness still requires external evidence' : 'Loss relative to current source is unknown'}
        await publishFile(path.join(audit,'complete.json'),JSON.stringify(complete,null,2))
        await candidate.release(); await rootOwner.release()
        return complete
    }
    finally {
        await owner.release()
    }
}

// Explicit offline operation: no PID-age or liveness heuristic can authorize it.
export async function releaseOfflineLocks(options, {operator, reason, confirmedStopped = false} = {}) {
    if (!confirmedStopped || !operator || !reason) {
        throw new Error('Offline release requires confirmed stopped writer, operator, and reason')
    }
    const config = storePaths(options), report = await inspectStore(config)
    const removed = []
    const lockDirectories = new Set(await Promise.all(mutableDirectories(config).map(dir=>fs.realpath(dir))))
    for (const directory of [...lockDirectories]) {
        for (let parent=path.dirname(directory); path.dirname(parent)!==parent; parent=path.dirname(parent)) {
            try {
                await fs.access(path.join(parent,'.simplystore-lock')); lockDirectories.add(parent)
            }
            catch(error) {
                if(error.code!=='ENOENT'){
                    throw error
                }
            }
        }
    }
    for (const directory of [...lockDirectories].sort().reverse()) {
        const lock = path.join(directory,'.simplystore-lock')
        let entries
        try {
            entries = await fs.readdir(lock)
        }
        catch (error) {
            if (error.code === 'ENOENT') {
                continue;
            } throw error
        }
        if (entries.some(entry => entry !== 'owner.json' && !entry.endsWith('.tmp'))) {
            throw new Error(`Unknown lock contents: ${lock}`)
        }
        const saved = []
        for (const entry of entries) {
            saved.push({name:entry,bytes:(await fs.readFile(path.join(lock,entry))).toString('base64')})
        }
        const ownerRecord=saved.find(item=>item.name==='owner.json')
        const owner=ownerRecord ? JSON.parse(Buffer.from(ownerRecord.bytes,'base64').toString()) : null
        if (owner?.purpose==='recovery' && report.ready) {
            let completed
            try {
                completed=JSON.parse(await fs.readFile(path.join(owner.auditDir,'complete.json'),'utf8'))
            }
            catch {
                /* Missing report is not completion evidence. */
            }
            if(completed?.fingerprint!==report.fingerprint) {
                throw new Error('Completed-looking recovery candidate requires finish with its retained audit before unlocking')
            }
        }
        removed.push({lock,ownerFiles:saved})
    }
    // Return preview only; the CLI persists its external audit before calling finish.
    const commands = report.commands.map(command => {
        return {id: command.id, status: command.status, problem: command.problem}
    })
    const inspection = {ready: report.ready, errors: report.errors, commands}
    return {inspection,
        operator,reason,removed,async finish() {
            for (const {lock,ownerFiles} of removed) {
                for (const entry of ownerFiles) {
                    if ((await fs.readFile(path.join(lock,entry.name))).toString('base64') !== entry.bytes) {
                        throw new Error('Lock changed after preview')
                    }
                }
                for (const entry of ownerFiles) {
                    await fs.unlink(path.join(lock,entry.name))
                }
                await fs.rmdir(lock); await syncDirectory(path.dirname(lock))
            }
        }}
}

export async function finishRecovery(auditDirectory, {operator,reason,confirmedStopped=false}={}) {
    if(!confirmedStopped || !operator || !reason){
        throw new Error('Finishing requires confirmed stopped writer and administrator assessment')
    }
    const audit=await fs.realpath(auditDirectory)
    const plan=JSON.parse(await fs.readFile(path.join(audit,'plan.json'),'utf8'))
    const authorization=JSON.parse((await fs.readFile(path.join(audit,'attempts.jsonl'),'utf8')).split('\n')[0])
    if(authorization.planHash!==hash(JSON.stringify(plan))){
        throw new Error('Audit authorization does not match retained plan')
    }
    await assertFresh(plan)
    const report=await inspectStore(authorization.config)
    if(!report.ready || plan.rerun.some(id=>!report.committed.includes(id))){
        throw new Error('Recovery is incomplete; inspect and approve remaining attempts, never automatically rerun')
    }
    const complete={kind:'simplystore-recovery-complete',planHash:authorization.planHash,config:report.config,
        code:plan.code,codeHashes:plan.codeHashes,files:report.files,fingerprint:report.fingerprint,committed:report.committed,operator,reason,warnings:report.warnings}
    await publishFile(path.join(audit,'complete.json'),JSON.stringify(complete,null,2))
    const release=await releaseOfflineLocks(report.config,{operator,reason,confirmedStopped})
    await publishFile(path.join(audit,'finish-unlock.json'),JSON.stringify(release))
    await release.finish()
    return complete
}

export async function verifyCandidate(report) {
    if (!['simplystore-recovery-complete','simplystore-restore-complete'].includes(report.kind)) {
        throw new Error('Expected completed recovery/restore report')
    }
    const current = await inspectStore(report.config)
    if (!current.ready || current.fingerprint !== report.fingerprint) {
        throw new Error('Candidate changed or is incomplete')
    }
    if (report.code && JSON.stringify(await codeHashes(report.code)) !== JSON.stringify(report.codeHashes)) {
        throw new Error('Selected code changed after recovery')
    }
    return current
}
