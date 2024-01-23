import { AsyncResource } from 'async_hooks'
import { EventEmitter } from 'events'
import path from 'path'
import { Worker } from 'worker_threads'

const kTaskInfo = Symbol('kTaskInfo');
const kWorkerFreedEvent = Symbol('kWorkerFreedEvent');

class WorkerPoolTaskInfo extends AsyncResource {
  constructor(callback) {
    super('WorkerPoolTaskInfo');
    this.callback = callback;
  }

  done(err, result) {
    this.runInAsyncScope(this.callback, null, err, result);
    this.emitDestroy();  // `TaskInfo`s are used only once.
  }
}

//@TODO: only create new workers when needed, not immediately
//@TODO: allow initialization of newly created workers

export default class WorkerPool extends EventEmitter {
  constructor(numThreads, workerFile, initTask) {
    super()
    this.numThreads  = numThreads
    this.workerFile  = workerFile
    this.initTask    = initTask
    this.workers     = []
    this.freeWorkers = []

    for (let i = 0; i < numThreads; i++)
      this.addNewWorker();
  }

  addNewWorker() {
    const worker = new Worker(path.resolve(this.workerFile));
    worker.on('message', (result) => {
      // In case of success: Call the callback that was passed to `runTask`,
      // remove the `TaskInfo` associated with the Worker, and mark it as free
      // again.
      worker[kTaskInfo].done(null, result);
      worker[kTaskInfo] = null;
      this.freeWorkers.push(worker);
      this.emit(kWorkerFreedEvent);
    });
    worker.on('error', (err) => {
      // In case of an uncaught exception: Call the callback that was passed to
      // `runTask` with the error.
      if (worker[kTaskInfo])
        worker[kTaskInfo].done(err, null);
      else
        this.emit('error', err);
      // Remove the worker from the list and start a new Worker to replace the
      // current one.
      this.workers.splice(this.workers.indexOf(worker), 1);
      this.addNewWorker();
    });
    this.workers.push(worker);
    worker[kTaskInfo] = new WorkerPoolTaskInfo(() => {
    });
    worker.postMessage(this.initTask);
  }

  async run(name, req) {
    return new Promise((resolve, reject) => {
      this.runTask({name,req}, (error, result) => {
        if (error) {
          console.log('worker error response')
          return reject(error)
        }
        console.log('worker result')
        return resolve(result)
      })
    })
  }

  runTask(task, callback) {
    if (this.freeWorkers.length === 0) {
      // No free threads, wait until a worker thread becomes free.
      console.log('no free worker.. waiting')
      this.once(kWorkerFreedEvent, () => this.runTask(task, callback));
      return;
    }
    const worker = this.freeWorkers.pop();
    worker[kTaskInfo] = new WorkerPoolTaskInfo(callback);
    console.log('run task',task)
    worker.postMessage(task);
  }

  runInit() {
    // re-init all workers when they become available
    // or move current workers to stoplist and terminate them when they become free
    // and start new workers, with the initTask?
  }

  close() {
    for (const worker of this.workers) worker.terminate();
  }
}