import JSONTag from '@muze-nl/jsontag';
import worker_threads from 'node:worker_threads';
import * as queryWorker from './worker-query.mjs';

async function initialize() {
	let meta = {}
	let dataspace = JSONTag.parse(worker_threads.workerData, null, meta)
	//console.log('starting')
	await queryWorker.initialize(dataspace,meta)
	//console.log('initialized')
	return queryWorker.runQuery
}

export default initialize()