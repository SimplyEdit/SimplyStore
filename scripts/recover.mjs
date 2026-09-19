import process from 'node:process'
import fs from 'node:fs/promises'
import path from 'node:path'
import {
    planRecovery,
    writePlan,
    applyRecovery,
    backupStore,
    restoreBackup,
    releaseOfflineLocks,
    finishRecovery,
    verifyCandidate
} from '../src/admin-recovery.mjs'
import { inspectStore } from '../src/store-inspection.mjs'

const [action, ...args] = process.argv.slice(2)
const options = {}
for (let i = 0; i < args.length; i++) {
    if (!args[i].startsWith('--')) {
        throw new Error(`Expected option, got ${args[i]}`)
    }
    const key = args[i].slice(2)
    const next = args[i + 1]
    if (next && !next.startsWith('--')) {
        options[key] = args[++i]
    }
    else {
        options[key] = true
    }
}
const read = async file => JSON.parse(await fs.readFile(file, 'utf8'))
const required = key => {
    if (typeof options[key] !== 'string') {
        throw new Error(`--${key} is required`)
    }
    return options[key]
}
async function main() {
    switch (action) {
        case 'inspect': {
            const plan = await planRecovery(await read(required('store')), {
                quiescent: options.quiescent === true
            })
            await writePlan(required('out'), plan)
            return plan
        }
        case 'apply': {
            const plan = await read(required('plan'))
            const to = required('to')
            const auditDir = required('audit-dir')
            let approveRerun = []
            if (typeof options['approve-rerun'] === 'string') {
                approveRerun = options['approve-rerun']
                    .split(',')
                    .filter(Boolean)
            }
            return applyRecovery(plan, {
                to,
                auditDir,
                approveRerun,
                operator: required('operator'),
                reason: required('reason')
            })
        }
        case 'finish':
            return finishRecovery(required('audit-dir'), {
                operator: required('operator'),
                reason: required('reason'),
                confirmedStopped: options['confirmed-stopped'] === true
            })
        case 'backup':
            return backupStore(await read(required('store')), {
                to: required('to'),
                quiescent: options.quiescent === true
            })
        case 'restore': {
            const backup = required('backup')
            const to = required('to')
            const auditDir = required('audit-dir')
            let source
            if (options.store) {
                source = await read(options.store)
            }
            return restoreBackup(backup, {
                to,
                auditDir,
                source,
                sourceQuiescent: options.quiescent === true
            })
        }
        case 'unlock': {
            const store = await read(required('store'))
            const release = await releaseOfflineLocks(store, {
                operator: required('operator'),
                reason: required('reason'),
                confirmedStopped: options['confirmed-stopped'] === true
            })
            const audit = path.resolve(required('out'))
            // writePlan enforces new output outside every source data
            // directory.
            await writePlan(audit, {
                ...release,
                config: (await inspectStore(store)).config
            })
            await release.finish()
            return { audit, released: release.removed.map(item => item.lock) }
        }
        case 'verify': {
            const report = await read(required('report'))
            const current = await verifyCandidate(report)
            const output = path.resolve(required('out'))
            await writePlan(output, {
                config: report.config,
                kind: 'simplystore-activation-preview',
                store: { ...report.config, ...report.code },
                committed: current.committed,
                instruction:
                    'Stop the old service, preserve its configuration, and explicitly select this store. This command does not deploy or switch a service.'
            })
            return { verified: true, activationPreview: output }
        }
        default:
            throw new Error(
                'Usage: recover.mjs inspect|apply|backup|restore|unlock|finish|verify --store config.json ...; see docs/recovery.md'
            )
    }
}
main()
    .then(result => console.log(JSON.stringify(result, null, 2)))
    .catch(error => {
        console.error(error.message)
        process.exitCode = 1
    })
