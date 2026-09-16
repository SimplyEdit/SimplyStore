import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

// Preserve the existing entry point; Python/rdflib also serves the pinned core.
const script = fileURLToPath(new URL('./validate-spiral-provenance.py', import.meta.url))
const result = spawnSync(process.env.PYTHON || 'python3', [script, ...process.argv.slice(2)], {
    stdio: 'inherit'
})
if (result.error) {
    console.error(`Cannot run Spiral validation: ${result.error.message}`)
}
process.exit(result.status ?? 1)
