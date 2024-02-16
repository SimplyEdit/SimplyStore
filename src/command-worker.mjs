import { parentPort } from 'node:worker_threads'
import runCommand, { initialize } from '../src/command-worker-module.mjs' 

parentPort.on('message', async data => {
    let result
    try {
        await initialize(data)
        result = await runCommand(data.command)
    } catch(err) {
        result = { error: err.message }
    }
    parentPort.postMessage(result)
})