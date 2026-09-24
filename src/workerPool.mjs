import { AsyncResource } from 'node:async_hooks'
import { EventEmitter } from 'node:events'
import path from 'node:path'
import { Worker } from 'node:worker_threads'
import { WorkerTimeoutError } from './execute-worker.mjs'

class QueryTask extends AsyncResource {
    constructor(task, resolve, reject) {
        super('WorkerPoolTaskInfo')
        this.task = task
        this.resolve = resolve
        this.reject = reject
    }

    done(error, result) {
        if (error) {
            this.runInAsyncScope(this.reject, null, error)
        }
        else {
            this.runInAsyncScope(this.resolve, null, result)
        }
        this.emitDestroy()
    }
}

export default class WorkerPool extends EventEmitter {
    constructor(numThreads, workerFile, initTask) {
        super()
        this.workerFile = path.resolve(workerFile)
        this.initTask = {
            ...initTask,
            req: { ...initTask.req, sources: [...initTask.req.sources] }
        }
        this.workers = new Map()
        this.waiting = []
        this.terminating = new Set()
        this.closed = false
        this.failure = null
        for (let i = 0; i < numThreads; i++) {
            this.addNewWorker()
        }
    }

    addNewWorker() {
        const worker = new Worker(this.workerFile)
        const state = {
            pending: [this.initTask], active: null, query: null, timer: null
        }
        this.workers.set(worker, state)
        worker.on('message', result => {
            clearTimeout(state.timer)
            const query = state.query
            state.active = null
            state.query = null
            if (query) {
                query.done(null, result)
            }
            this.dispatch(worker, state)
        })
        worker.on('error', error => this.workerFailed(worker, error))
        worker.on('exit', code => {
            if (!this.closed && this.workers.has(worker)) {
                this.workerFailed(worker, new Error(`Query worker exited (${code})`))
            }
        })
        this.dispatch(worker, state)
    }

    dispatch(worker, state) {
        if (this.closed || this.failure || state.active) {
            return
        }
        let task = state.pending.shift()
        if (!task) {
            const query = this.waiting.shift()
            if (!query) {
                return
            }
            state.query = query
            task = query.task
        }
        state.active = task
        if (task.name === 'query' && task.timeout > 0) {
            // Allow the isolate to return its timeout response first. The
            // outer deadline also covers host callbacks and message handling.
            const deadline = task.timeout + 250
            state.timer = setTimeout(() => {
                this.workerFailed(worker,
                    new WorkerTimeoutError('query worker', deadline))
            }, deadline)
        }
        worker.postMessage(task)
    }

    workerFailed(worker, error) {
        const state = this.workers.get(worker)
        if (!state) {
            return
        }
        clearTimeout(state.timer)
        this.workers.delete(worker)
        const termination = worker.terminate()
        this.terminating.add(termination)
        termination.then(() => this.terminating.delete(termination))
        if (state.query) {
            state.query.done(error)
            state.query = null
        }
        if (this.closed || this.failure) {
            return
        }
        // A failed source update cannot be skipped: stop publication/use of
        // this pool. Query failures may replace the worker at the current head.
        if (state.active?.name === 'init' || state.active?.name === 'update') {
            this.failure = error
            for (const query of this.waiting.splice(0)) {
                query.done(error)
            }
            this.emit('error', error)
        }
        else if (!this.closed) {
            this.addNewWorker()
        }
    }

    run(name, req, options = {}) {
        if (this.closed || this.failure) {
            return Promise.reject(this.failure || new Error('Query pool closed'))
        }
        return new Promise((resolve, reject) => {
            const task = { name, req, ...options }
            this.waiting.push(new QueryTask(task, resolve, reject))
            for (const [worker, state] of this.workers) {
                this.dispatch(worker, state)
            }
        })
    }

    update(task) {
        this.initTask = {
            ...this.initTask,
            req: {
                ...this.initTask.req,
                sources: [...this.initTask.req.sources, task.req.source],
                meta: task.req.meta
            }
        }
        for (const [worker, state] of this.workers) {
            state.pending.push(task)
            this.dispatch(worker, state)
        }
    }

    memoryUsage() {
        return this.run('memoryUsage', {})
    }

    async close() {
        this.closed = true
        const error = new Error('Query pool closed')
        for (const query of this.waiting.splice(0)) {
            query.done(error)
        }
        await Promise.all([...this.workers].map(async ([worker, state]) => {
            clearTimeout(state.timer)
            await worker.terminate()
            if (state.query) {
                state.query.done(error)
                state.query = null
            }
        }))
        await Promise.all(this.terminating)
        this.workers.clear()
    }
}
