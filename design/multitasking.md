# multitasking

Node itself is (almost) a single process. The server must be able to handle multiple requests simultaneously, maximizing cpu core usage.

The query endpoint is the only part that must be multitasking. Instead of using an external system like PM2, the server should use worker threads. Threads use the same memory, but since the query endpoints are all using the immutable dataset only, that is no worry here.

The update endpoint needs a single seperate worker. This allows for the main process to be limited to managing the workers only. This way there is less chance of a problem crashing the whole server.

Each worker starts a single VM, which runs all the code. The isolated-vm package allows for more control than VM2, but also has no easy way to share the immutable dataset. So for now we stick to VM2.
Update: isolated-vm may be able to do this using the [ivm.Reference](https://github.com/laverdet/isolated-vm#class-reference-transferable) function.

https://www.digitalocean.com/community/tutorials/how-to-use-multithreading-in-node-js
https://www.npmjs.com/package/piscina
