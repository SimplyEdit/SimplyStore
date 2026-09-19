import { Worker } from 'node:worker_threads'

export class WorkerTimeoutError extends Error {
    constructor(workerKind, timeout) {
        super(`${workerKind} timed out after ${timeout}ms`)
        this.name = 'WorkerTimeoutError'
        this.code = 504
        this.timeout = timeout
        this.workerKind = workerKind
    }
}

export function runWorker(
    filename,
    task,
    { timeout = 30000, workerKind = 'worker' } = {}
) {
    return new Promise((resolve, reject) => {
        const worker = new Worker(filename)
        let settled = false
        let timer
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
                        `${workerKind} exited without a result (${code})`
                    )
                )
            }
        })
        if (timeout) {
            timer = setTimeout(() => {
                const error = new WorkerTimeoutError(workerKind, timeout)
                void finish(reject, error)
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

export async function executeWorker(filename, task, timeout = 30000) {
    try {
        return await runWorker(filename, task, {
            timeout,
            workerKind: 'command worker'
        })
    }
    catch (error) {
        if (!(error instanceof WorkerTimeoutError)) {
            throw error
        }
        return {
            status: 'unsafe',
            code: error.code,
            message: error.message
        }
    }
}
