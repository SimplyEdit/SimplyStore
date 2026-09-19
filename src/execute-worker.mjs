import { Worker } from 'node:worker_threads'

export function executeWorker(filename, task, timeout = 30000) {
    return new Promise((resolve, reject) => {
        const worker = new Worker(filename)
        let settled = false,
            timer
        const finish = async (settle, result) => {
            if (settled) {
                return
            }
            settled = true
            clearTimeout(timer)
            try {
                await worker.terminate()
            }
            catch (error) {
                reject(error)
                return
            }
            settle(result)
        }
        worker.on('message', result => {
            void finish(resolve, result)
        })
        worker.on('error', error => {
            void finish(reject, error)
        })
        worker.on('exit', code => {
            if (!settled) {
                void finish(
                    reject,
                    new Error(
                        `Command worker exited without a result (${code})`
                    )
                )
            }
        })
        if (timeout) {
            timer = setTimeout(() => {
                void finish(resolve, {
                    status: 'unsafe',
                    code: 504,
                    message: `command worker timed out after ${timeout}ms`
                })
            }, timeout)
        }
        try {
            worker.postMessage(task)
        }
        catch (error) {
            void finish(reject, error)
        }
    })
}
