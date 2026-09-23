import { parentPort } from 'node:worker_threads'
import { loadFileData } from './file-data.mjs'

parentPort.on('message', async files => {
    parentPort.postMessage(await loadFileData(files))
})
