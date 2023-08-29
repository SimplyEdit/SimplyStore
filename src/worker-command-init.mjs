import * as commandWorker from './worker-command.mjs'
import worker_threads from 'node:worker_threads' 

async function initialize() {
	await commandWorker.initialize(worker_threads.workerData)
	return commandWorker.runCommand
}

export default initialize()