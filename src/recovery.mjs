import fs from 'fs'

export const committedCommandStatus = 'done'

export function getCommittedCommandIds(status) {
	return Array.from(status.entries())
		.filter(([, command]) => command?.status === committedCommandStatus)
		.map(([commandId]) => commandId)
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
