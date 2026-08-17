import fs from 'fs'
import JSONTag from '@muze-nl/jsontag'

export const committedCommandStatus = 'done'
export const pendingCommandStatus = 'accepted'

export function loadCommandStatus(commandStatusFile, logger = console) {
	const status = new Map()
	if (fs.existsSync(commandStatusFile)) {
		const file = fs.readFileSync(commandStatusFile, 'utf-8')
		if (file) {
			const lines = file.split("\n").filter(Boolean)
			for (const line of lines) {
				const command = JSONTag.parse(line)
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
		const lines = log.split("\n").filter(Boolean)
		for (const line of lines) {
			const command = JSONTag.parse(line)
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
