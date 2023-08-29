import JSONTag from '@muze-nl/jsontag';
import worker_threads from 'node:worker_threads';
import * as queryWorker from './worker-query.mjs';

async function initialize() {
	let dataspace = JSONTag.parse(worker_threads.workerData)
	//console.log('starting')
	queryWorker.initialize(dataspace)
	//console.log('initialized')
	return queryWorker.runQuery
}

export default initialize()