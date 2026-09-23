import { createHash } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import JSONTag from '@muze-nl/jsontag'
import { RecoveryIntegrityError } from './recovery.mjs'
import { appendFile } from './util.mjs'

const integrityAlgorithm = 'sha256'

export function getDefaultIntegrityFile(dataFile) {
	const extension = dataFile.split('.').pop()
	const basefile = dataFile.substring(
		0, dataFile.length - (extension.length + 1)
	)
	return `${basefile}.integrity.${extension}`
}

export function digestBuffer(buffer) {
	return createHash(integrityAlgorithm).update(buffer).digest('hex')
}

function integrityFileKey(integrityFile, file) {
	return path.relative(path.dirname(integrityFile), file)
}

export async function loadIntegrityManifest(integrityFile) {
	const entries = new Map()
	let text
	try {
		text = await fs.readFile(integrityFile, 'utf8')
	}
 catch (error) {
		if (error.code === 'ENOENT') {
			throw new RecoveryIntegrityError(
				`Missing integrity manifest ${integrityFile}; ` +
				'use recover.mjs init-integrity for a stopped existing store',
				{ file: integrityFile, recordKind: 'integrity manifest' }
			)
		}
		throw error
	}
	for (const [index, line] of text.split('\n').entries()) {
		if (!line) {
			continue
		}
		let record
		try {
			record = JSONTag.parse(line)
		}
 catch (cause) {
			throw new RecoveryIntegrityError('Invalid integrity manifest record', {
				file: integrityFile,
				lineNumber: index + 1,
				recordKind: 'integrity manifest',
				cause
			})
		}
		if (!record || typeof record !== 'object' || Array.isArray(record)) {
			throw new RecoveryIntegrityError('Invalid integrity manifest record: record must be an object', {
				file: integrityFile,
				lineNumber: index + 1,
				recordKind: 'integrity manifest'
			})
		}
		if (typeof record.file !== 'string' || record.file === '') {
			throw new RecoveryIntegrityError('Invalid integrity manifest record: missing string field "file"', {
				file: integrityFile,
				lineNumber: index + 1,
				recordKind: 'integrity manifest'
			})
		}
		if (record.algorithm !== integrityAlgorithm || typeof record.digest !== 'string' || record.digest === '') {
			throw new RecoveryIntegrityError('Invalid integrity manifest record: invalid digest', {
				file: integrityFile,
				lineNumber: index + 1,
				recordKind: 'integrity manifest'
			})
		}
		entries.set(record.file, record)
	}
	return entries
}

export function verifyIntegrity(
	manifest, integrityFile, file, buffer, options = {}
) {
	return verifyDigest(
		manifest, integrityFile, file, digestBuffer(buffer), options
	)
}

export function verifyDigest(
	manifest, integrityFile, file, actual, options = {}
) {
	const key = integrityFileKey(integrityFile, file)
	const record = manifest.get(key)
	if (!record) {
		if (options.required) {
			throw new RecoveryIntegrityError(`Missing integrity manifest entry for ${key}`, {
				file,
				recordKind: 'OD-JSONTag data'
			})
		}
		return false
	}
	if (record.digest !== actual) {
		throw new RecoveryIntegrityError(`Integrity mismatch for ${key}`, {
			file,
			recordKind: 'OD-JSONTag data'
		})
	}
	return true
}

export async function appendIntegrityRecord(integrityFile, file, buffer) {
	return appendIntegrityDigest(integrityFile, file, digestBuffer(buffer))
}

export function integrityRecords(integrityFile, digests) {
    return digests.map(([file, digest]) => ({
        file: integrityFileKey(integrityFile, file),
        algorithm: integrityAlgorithm,
        digest
    }))
}

export function serializeIntegrityRecords(integrityFile, digests) {
    return integrityRecords(integrityFile, digests)
        .map(record => JSONTag.stringify(record)).join('\n')
}

export async function appendIntegrityDigests(integrityFile, digests) {
    if (digests.length) {
        await appendFile(integrityFile,
            serializeIntegrityRecords(integrityFile, digests))
    }
}

export async function appendIntegrityDigest(integrityFile, file, digest) {
    await appendIntegrityDigests(integrityFile, [[file, digest]])
    return integrityRecords(integrityFile, [[file, digest]])[0]
}
