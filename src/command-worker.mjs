import { parentPort } from 'node:worker_threads'
import runCommand, { initialize } from '../src/command-worker-module.mjs' 

parentPort.on('message', async data => {
    let result
    await initialize(data)
    result = await runCommand(data.command)
    parentPort.postMessage(result)
})