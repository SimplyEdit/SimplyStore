# Query execution with isolated-vm

SimplyStore runs each JavaScript query in a fresh V8 isolate using isolated-vm.
It supplies `root`, path-selected `data`, `request`, `meta.index.id.get/has`,
`meta.schema`, JSONTag and the existing JAQT helpers. Standard JavaScript objects
and array methods remain available. Queries are synchronous; Promise results
are rejected.

Queries have no `import` resolver, `require`, `process`, `Buffer`, `fetch`,
filesystem, database, or networking API. Both static and dynamic imports fail,
including imports constructed with `Function`. WebAssembly and shared-memory
APIs are not exposed. A query cannot change the globals or prototypes seen by
another query.

## Data and grants

The trusted Node worker owns file handles, the indexed od-jsontag parser and
the configured access module. Queries see read-only object/array views. Private
callbacks return copied values and view descriptions; they never return Node
objects, functions, file descriptors, raw record bytes, parser internals or
isolated-vm references. Grants apply on the host to reads, enumeration,
descriptors and property existence. Access modules can keep their trusted Node
imports and closures.

Record numbers and property paths let the host resolve views without pinning
every scanned record in memory. Schema objects may be shared or cyclic, so the
host numbers them once per schema and resolves views by that private handle.
One stored object is one view within a query: `===` holds across paths, and
JSONTag responses link shared objects using the schema file's ids. Each view
reads a property from the host once per query. Tagged scalar values are copied
into the guest; changes to such copies do not modify stored data. Object and
array mutations throw. Committed source updates still serialize with queries,
and replacement workers initialize at the current committed head.

This differs from the initial engine benchmark's raw-record bridge. Keeping the
existing parser and grants on the host avoids moving authority into the hostile
query realm. This integration uses od-jsontag 0.5.0 through its Node entry point
(`src/node.mjs`) for file-descriptor input. The package's portable parser is not
loaded into the query isolate.

## Limits

Pass these options when opening SimplyStore:

| Option | Default | Meaning |
|---|---:|---|
| `timeout` | 1,000 ms | Normal query execution and serialization deadline |
| `slowTimeout` | 10,000 ms | Slow-query deadline |
| `queryMemoryLimit` | 64 MiB | isolated-vm memory budget, minimum 8 |
| `maxQueryResultBytes` | 10 MiB | Maximum UTF-8 response body and individual bridge value, minimum 256 bytes |

Values must be positive safe integers, respecting the listed minima. Query
limits cannot be disabled. The pool allows 250 ms beyond the selected deadline
for timeout reporting, then terminates/replaces a stuck worker. An isolate is
disposed after every query. Execution/serialization/size/memory failures normally
return code 422; an outer worker timeout is code 504. Error messages are bounded.
Real storage-read failures return code 500 and stop mutation, even if query code
catches the read exception. Query-thrown storage flags have no such authority.

Large property values or key enumerations may reach the bridge limit before
serialization. Result serialization itself runs under the execution deadline,
including user getters and `toJSON` methods. UTF-8 size is checked before the
result is copied from the isolate.

The isolate memory budget is not a hard total-process RSS limit. Native V8,
Node worker state, indexes and trusted data reads have additional costs. The
worker threads share the server process; this change does not provide a separate
OS-process crash boundary or certify public internet exposure. Keep deployment
access controls appropriate to the existing operating envelope.

## Installation and startup

Use Node 22 or newer with an isolated-vm-compatible V8 version; this integration
was tested on Node 24.7.0 with isolated-vm 6.2.0. The addon needs a compatible
prebuilt native binary or the compiler prerequisites documented by
[isolated-vm](https://github.com/laverdet/isolated-vm#requirements).
Follow its startup requirement:

```sh
node --no-node-snapshot myApp.mjs
```

The supplied npm start/test scripts and example start script include that flag.
It disables Node's startup snapshot; SimplyStore does not create isolate
snapshots. The pure query helper bundle is compiled once per worker by esbuild.
The guest receives the compiled JavaScript, with no module loading available.

## Verification and performance

`npm test` includes query compatibility and hostile-query checks.
Run the actual worker-path benchmark with:

```sh
node --no-node-snapshot scripts/benchmark-query-runtime.mjs
```

It creates disposable datasets and checks every result. It includes fresh
isolates, access callbacks, lazy file reads, serialization and worker messaging.
Its warm filesystem cache and small synthetic datasets do not establish physical
disk throughput, total memory use, concurrent capacity, or universal speedups.
The initial [engine comparison](../benchmark/query-engines/comparison.md) retains
the separate raw-parser experiment that motivated engine selection.
