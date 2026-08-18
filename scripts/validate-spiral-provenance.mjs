import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'

const root = process.cwd()
const ttlRoot = path.join(root, '.spiral')
const projectPrefix = 'https://github.com/simplyedit/simplystore/spiral#'

function runGit(args, options = {}) {
	const result = spawnSync('git', args, {
		cwd: root,
		encoding: 'utf8',
		...options
	})
	if (result.status !== 0) {
		throw new Error(`git ${args.join(' ')} failed: ${result.stderr || result.stdout}`)
	}
	return result.stdout.trim()
}

function gitOk(args) {
	const result = spawnSync('git', args, {
		cwd: root,
		stdio: 'ignore'
	})
	return result.status === 0
}

function listTurtleFiles(dir = ttlRoot) {
	const entries = fs.readdirSync(dir, {withFileTypes: true})
	const files = []
	for (const entry of entries) {
		const fullPath = path.join(dir, entry.name)
		if (entry.isDirectory()) {
			files.push(...listTurtleFiles(fullPath))
		} else if (entry.isFile() && entry.name.endsWith('.ttl')) {
			files.push(fullPath)
		}
	}
	return files.sort()
}

function compactTerm(term) {
	if (term.startsWith('project:')) {
		return term.slice('project:'.length)
	}
	if (term.startsWith('sd:')) {
		return term.slice('sd:'.length)
	}
	return term
}

function assertBalanced(text, file) {
	let square = 0
	let inString = false
	let escaped = false
	for (const char of text) {
		if (inString) {
			if (escaped) {
				escaped = false
			} else if (char === '\\') {
				escaped = true
			} else if (char === '"') {
				inString = false
			}
			continue
		}
		if (char === '"') {
			inString = true
		} else if (char === '[') {
			square++
		} else if (char === ']') {
			square--
			if (square < 0) {
				throw new Error(`${file}: unmatched ]`)
			}
		}
	}
	if (inString) {
		throw new Error(`${file}: unterminated string`)
	}
	if (square !== 0) {
		throw new Error(`${file}: unbalanced []`)
	}
}

function parseTurtleSubset(text, file) {
	assertBalanced(text, file)
	if (!text.includes('@prefix sd:') || !text.includes('@prefix project:')) {
		throw new Error(`${file}: expected sd and project prefixes`)
	}
	if (!text.trim().endsWith('.')) {
		throw new Error(`${file}: expected final .`)
	}

	const subjectMatch = text.match(/project:([A-Za-z]+-\d+)\s+([\s\S]*)\.\s*$/)
	if (!subjectMatch) {
		throw new Error(`${file}: expected one project subject block`)
	}
	const artifact = subjectMatch[1]
	const body = subjectMatch[2]
	const typeMatch = body.match(/(?:^|\s)a\s+sd:([A-Za-z]+)\s*;/)
	if (!typeMatch) {
		throw new Error(`${file}: expected rdf type`)
	}
	const pathMatch = body.match(/sd:repositoryPath\s+"([^"]+)"/)
	if (!pathMatch) {
		throw new Error(`${file}: expected sd:repositoryPath`)
	}

	const references = []
	const refRegex = /sd:([A-Za-z]+)\s+\[\s*a\s+sd:ArtifactReference\s*;\s*sd:artifact\s+project:([A-Za-z]+-\d+)\s*;\s*sd:gitCommit\s+"([0-9a-f]+)"(?:\s*;\s*sd:fragment\s+"([^"]+)")?\s*\]/g
	let match
	while ((match = refRegex.exec(body)) !== null) {
		references.push({
			predicate: match[1],
			artifact: match[2],
			gitCommit: match[3],
			fragment: match[4] || null
		})
	}

	const locations = [...body.matchAll(/sd:implementationLocation\s+"([^"]+)"/g)]
		.map(locationMatch => locationMatch[1])
	const statusMatch = body.match(/sd:status\s+sd:([A-Za-z]+)/)

	return {
		file,
		ttlPath: file,
		artifact,
		type: typeMatch[1],
		repositoryPath: pathMatch[1],
		status: statusMatch ? statusMatch[1] : null,
		references,
		locations,
		text
	}
}

function loadCurrentGraph() {
	const graph = new Map()
	for (const file of listTurtleFiles()) {
		const parsed = parseTurtleSubset(fs.readFileSync(file, 'utf8'), path.relative(root, file))
		graph.set(parsed.artifact, parsed)
	}
	return graph
}

function loadHistoricalArtifact(artifact, commit) {
	const current = currentGraph.get(artifact)
	if (!current) {
		throw new Error(`Unknown artifact ${artifact}`)
	}
	const text = runGit(['show', `${commit}:${current.ttlPath}`])
	return parseTurtleSubset(text, `${current.ttlPath}@${commit}`)
}

function latestCommitForPath(repositoryPath) {
	return runGit(['log', '-1', '--format=%H', '--', repositoryPath])
}

function validateReferences(graph) {
	const errors = []
	const shortHashes = []
	const checked = []

	for (const artifact of graph.values()) {
		const sourceCommit = latestCommitForPath(artifact.ttlPath)
		for (const reference of artifact.references) {
			const label = `${artifact.artifact}.${reference.predicate}->${reference.artifact}@${reference.gitCommit}`
			if (!/^[0-9a-f]{40}$/.test(reference.gitCommit)) {
				shortHashes.push(label)
				continue
			}
			if (!gitOk(['cat-file', '-e', `${reference.gitCommit}^{commit}`])) {
				errors.push(`${label}: commit does not resolve`)
				continue
			}
			if (reference.gitCommit === sourceCommit) {
				errors.push(`${label}: target equals source artifact commit ${sourceCommit}`)
				continue
			}
			if (!gitOk(['merge-base', '--is-ancestor', reference.gitCommit, sourceCommit])) {
				errors.push(`${label}: target is not a strict ancestor of source artifact commit ${sourceCommit}`)
				continue
			}
			checked.push(label)
		}
	}

	if (shortHashes.length) {
		errors.push(`short sd:gitCommit references: ${shortHashes.join(', ')}`)
	}
	if (errors.length) {
		throw new Error(errors.join('\n'))
	}
	return checked
}

function findImplementationByLocation(location, preferredArtifact) {
	const matches = [...currentGraph.values()]
		.filter(artifact => artifact.type === 'Implementation' && artifact.locations.includes(location))
		.map(artifact => artifact.artifact)
		.sort()
	if (preferredArtifact && matches.includes(preferredArtifact)) {
		return preferredArtifact
	}
	if (matches.length !== 1) {
		throw new Error(`Expected one implementation for ${location}, found ${matches.join(', ')}`)
	}
	return matches[0]
}

function ref(artifact, predicate, target = null) {
	const matches = artifact.references.filter(reference => {
		return reference.predicate === predicate && (!target || reference.artifact === target)
	})
	if (!matches.length) {
		throw new Error(`${artifact.artifact}: missing ${predicate}${target ? ` -> ${target}` : ''}`)
	}
	return matches
}

function traverseIntent(implementationId) {
	const implementation = currentGraph.get(implementationId)
	const designRef = ref(implementation, 'implements')[0]
	const design = loadHistoricalArtifact(designRef.artifact, designRef.gitCommit)

	let requestRef
	if (design.artifact === 'DES-002') {
		requestRef = ref(design, 'derivedFrom', 'REQ-001')[0]
	} else {
		requestRef = ref(design, 'derivedFrom')[0]
	}
	const request = loadHistoricalArtifact(requestRef.artifact, requestRef.gitCommit)
	const understandingRef = ref(request, 'derivedFrom')[0]
	const understanding = loadHistoricalArtifact(understandingRef.artifact, understandingRef.gitCommit)
	const sourceRef = ref(understanding, 'interprets')[0]
	const source = loadHistoricalArtifact(sourceRef.artifact, sourceRef.gitCommit)

	return [
		{artifact: implementation.artifact, type: implementation.type},
		{artifact: design.artifact, type: design.type, commit: designRef.gitCommit},
		{artifact: request.artifact, type: request.type, commit: requestRef.gitCommit},
		{artifact: understanding.artifact, type: understanding.type, commit: understandingRef.gitCommit},
		{artifact: source.artifact, type: source.type, commit: sourceRef.gitCommit}
	]
}

function historyForImplementation(implementationId) {
	const implementation = currentGraph.get(implementationId)
	const transforms = implementation.references.filter(reference => reference.predicate === 'transforms')
	const changeCauses = implementation.references.filter(reference => reference.predicate === 'changeCausedBy')
	const verification = [...currentGraph.values()]
		.filter(artifact => artifact.type === 'VerificationEvidence')
		.flatMap(artifact => {
			return artifact.references
				.filter(reference => reference.predicate === 'verifies' && reference.artifact === implementationId)
				.map(reference => ({
					evidence: artifact.artifact,
					verifies: `${reference.artifact}@${reference.gitCommit}`
				}))
		})
		.sort((a, b) => a.evidence.localeCompare(b.evidence))

	const predecessorDetails = transforms.map(transform => {
		const predecessor = loadHistoricalArtifact(transform.artifact, transform.gitCommit)
		return {
			artifact: transform.artifact,
			commit: transform.gitCommit,
			changeCausedBy: predecessor.references
				.filter(reference => reference.predicate === 'changeCausedBy')
				.map(reference => `${reference.artifact}@${reference.gitCommit}`),
			transforms: predecessor.references
				.filter(reference => reference.predicate === 'transforms')
				.map(reference => `${reference.artifact}@${reference.gitCommit}`)
		}
	})

	return {
		currentChangeCausedBy: changeCauses.map(reference => `${reference.artifact}@${reference.gitCommit}`),
		transforms: transforms.map(reference => `${reference.artifact}@${reference.gitCommit}`),
		predecessorDetails,
		verification
	}
}

function validateBranchCycle() {
	const branch = runGit(['branch', '--show-current'])
	if (!branch.includes('CYC-016')) {
		throw new Error(`Expected CYC-016 branch, got ${branch}`)
	}
	const context = fs.readFileSync(path.join(root, '.spiral/project-context.md'), 'utf8')
	const contextNamesCyc016 = context.includes('Current active Spiral cycle: `.spiral/cycles/CYC-016.md`')
		|| context.includes('Latest accepted Spiral cycle: `.spiral/cycles/CYC-016.md`')
	if (!contextNamesCyc016) {
		throw new Error('project context does not identify CYC-016 as active or latest accepted')
	}
	const cycle = currentGraph.get('CYC-016')
	if (!cycle || !['Active', 'Accepted'].includes(cycle.status)) {
		throw new Error('CYC-016 TTL is neither active nor accepted')
	}
	return branch
}

const currentGraph = loadCurrentGraph()
const checkedReferences = validateReferences(currentGraph)
const branch = validateBranchCycle()

const examples = [
	{
		name: 'server done commit-before-query visibility',
		code: 'src/server.mjs#runNextCommand',
		implementation: findImplementationByLocation('src/server.mjs#runNextCommand', 'IMP-004')
	},
	{
		name: 'startup recovery with several historical contributions',
		code: 'src/recovery.mjs#loadCommandStatus',
		implementation: findImplementationByLocation('src/recovery.mjs#loadCommandStatus', 'IMP-001')
	},
	{
		name: 'recent after-change/index characterization',
		code: 'test/after-change-handlers.mjs',
		implementation: findImplementationByLocation('test/after-change-handlers.mjs', 'IMP-009')
	}
]

const traversals = examples.map(example => ({
	...example,
	intentPath: traverseIntent(example.implementation),
	history: historyForImplementation(example.implementation)
}))

const output = {
	parser: 'repository-local Spiral Turtle subset parser',
	projectPrefix,
	branch,
	turtleFilesParsed: currentGraph.size,
	historicalReferencesChecked: checkedReferences.length,
	examples: traversals
}

console.log(JSON.stringify(output, null, 2))
