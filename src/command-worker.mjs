import { parentPort } from 'node:worker_threads'
import runCommand from './command-worker-module.mjs' 
import commands from './commands.mjs'

parentPort.on('message', async task => {
	let result
	if (commands[task.name]) {
		result = await runCommand(task)
	} else {
		result = new Error('Unknown task '+task.name)
	}
	parentPort.postMessage(result)
})