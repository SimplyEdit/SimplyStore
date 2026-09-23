import { parentPort } from 'node:worker_threads'
import runCommand, { initialize, close } from '../src/command-worker-module.mjs'

parentPort.on('message', async data => {
    let result
    await initialize(data)
    try {
        result = await runCommand(data.command)
    }
    catch (error) {
        result = {
            status: 'failed',
            code: 500,
            message: error.message,
            storageFailure: Boolean(error.storageFailure)
        }
    }
    finally {
        close()
    }
    parentPort.postMessage(result)
})
