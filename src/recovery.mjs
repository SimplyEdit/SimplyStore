import fs from 'fs'
import JSONTag from '@muze-nl/jsontag'
import { appendFile } from './util.mjs'

export const committedCommandStatus = 'done'
export const pendingCommandStatus = 'accepted'
export const activeCommandStatus = 'active'
export const unsafeCommandStatus = 'unsafe'
export const defaultMaxCommandCrashAttempts = 2

export class RecoveryIntegrityError extends Error {
	constructor(message, options = {}) {
		const location = options.file && options.lineNumber
			? ` (${options.file}:${options.lineNumber})`
			: ''
		super(`${message}${location}`, {cause: options.cause})
		this.name = 'RecoveryIntegrityError'
		this.file = options.file
		this.lineNumber = options.lineNumber
		this.recordKind = options.recordKind
	}
}

function parseDurableRecord(file, line, lineNumber, recordKind) {
	try {
		const record = JSONTag.parse(line)
		if (!record || typeof record !== 'object' || Array.isArray(record)) {
			throw new Error(`${recordKind} record must be an object`)
		}
		return record
	} catch (cause) {
		throw new RecoveryIntegrityError(`Invalid ${recordKind} record`, {
			file,
			lineNumber,
			recordKind,
			cause
		})
	}
}

function assertStringField(record, field, file, lineNumber, recordKind) {
	if (typeof record[field] !== 'string' || record[field] === '') {
		throw new RecoveryIntegrityError(`Invalid ${recordKind} record: missing string field "${field}"`, {
			file,
			lineNumber,
			recordKind
		})
	}
}

export function loadCommandStatus(commandStatusFile, logger = console) {
	const status = new Map()
	if (fs.existsSync(commandStatusFile)) {
		const file = fs.readFileSync(commandStatusFile, 'utf-8')
		if (file) {
			const lines = file.split("\n")
			for (const [index, line] of lines.entries()) {
				if (!line) {
					continue
				}
				const command = parseDurableRecord(commandStatusFile, line, index + 1, 'command status')
				assertStringField(command, 'command', commandStatusFile, index + 1, 'command status')
				assertStringField(command, 'status', commandStatusFile, index + 1, 'command status')
				status.set(command.command, command)
			}
		} else {
			logger.error('Could not open command status', commandStatusFile)
		}
	} else {
		logger.log('no command status', commandStatusFile)
	}
	return status
}

export function getCommittedCommandIds(status) {
	return Array.from(status.entries())
		.filter(([, command]) => command?.status === committedCommandStatus)
		.map(([commandId]) => commandId)
}

export function loadCommandLog(status, commandLog, taskDefaults = {}) {
	const commands = []
	if (!fs.existsSync(commandLog)) {
		return commands
	}
	const log = fs.readFileSync(commandLog, 'utf-8')
	if (log) {
		const lines = log.split("\n")
		for (const [index, line] of lines.entries()) {
			if (!line) {
				continue
			}
			const command = parseDurableRecord(commandLog, line, index + 1, 'command log')
			assertStringField(command, 'id', commandLog, index + 1, 'command log')
			const state = status.get(command.id)?.status
			if (state === pendingCommandStatus) {
				commands.push({
					...taskDefaults,
					id: command.id,
					command: line,
					request: null
				})
			}
		}
	}
	return commands
}

function readAttempt(record, fallback = 1) {
	const attempt = Number(record?.attempt)
	if (Number.isInteger(attempt) && attempt > 0) {
		return attempt
	}
	return fallback
}

export async function recoverActiveCommands(status, commandStatusFile, options = {}) {
	const maxCrashAttempts = options.maxCrashAttempts ?? defaultMaxCommandCrashAttempts

	for (const [commandId, command] of status.entries()) {
		if (command?.status !== activeCommandStatus) {
			continue
		}
		const attempt = readAttempt(command)
		let nextStatus
		if (attempt >= maxCrashAttempts) {
			nextStatus = {
				command: commandId,
				code: 500,
				status: unsafeCommandStatus,
				message: `Command marked unsafe after ${attempt} crashed active attempt(s)`,
				attempt
			}
		} else {
			nextStatus = {
				command: commandId,
				code: 202,
				status: pendingCommandStatus,
				message: `Retrying command after ${attempt} crashed active attempt(s)`,
				attempt
			}
		}
		status.set(commandId, nextStatus)
		await appendFile(commandStatusFile, JSONTag.stringify(nextStatus))
	}

	return status
}

export function nextActiveCommandStatus(commandId, currentStatus) {
	return {
		command: commandId,
		code: 102,
		status: activeCommandStatus,
		attempt: readAttempt(currentStatus, 0) + 1
	}
}

export function getChangesetPath(dataFile, commandId) {
	const extension = dataFile.split('.').pop()
	const basefile = dataFile.substring(0, dataFile.length - (extension.length + 1))
	return `${basefile}.${commandId}.${extension}`
}

export function assertChangesetExists(dataFile, commandId) {
	const changesetPath = getChangesetPath(dataFile, commandId)
	if (!fs.existsSync(changesetPath)) {
		throw new Error(`Missing changeset for committed command ${commandId}: ${changesetPath}`)
	}
	return changesetPath
}
