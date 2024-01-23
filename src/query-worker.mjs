import { parentPort } from 'node:worker_threads'
import tasks from './query-worker-module.mjs'

parentPort.on('message', async task => {
	console.log('query message',task.name)
	let result
	if (tasks[task.name]) {
		result = await tasks[task.name].call(tasks, task)
	} else {
		result = new Error('Unknown task '+task.name)
	}
	parentPort.postMessage(result)
})