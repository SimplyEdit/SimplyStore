import * as commandWorker from './worker-command.mjs'
import worker_threads from 'node:worker_threads' 
import JSONTag from '@muze-nl/jsontag'

async function initialize() {
	let meta = {}
	let dataspace = JSONTag.parse(worker_threads.workerData, null, meta)
	await commandWorker.initialize(dataspace,meta)
	return commandWorker.runCommand
}

export default initialize()