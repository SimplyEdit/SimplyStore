# File-backed datasets

SimplyStore reads its base and committed changeset files through od-jsontag.
The runtime and its workers exchange file paths and index metadata; they no
longer retain or transfer the dataset as SharedArrayBuffers. Remote query and
command APIs and the existing OD-JSONTag/log formats are unchanged.

## Opening and reading a store

Startup inspects command-log order and the committed prefix, as before. A
64 KiB byte buffer scans each canonical data file's framing and SHA-256 digest.
That scan derives exact record offsets, including sparse changesets and UTF-8
payloads. Stored offset/ID sidecars remain produced by the index hooks, but
startup derives its authoritative indexes from data files, so absent or stale
sidecars cannot redirect reads. Inspection does not import custom index modules.
The loader reconstructs the ID map from the final live records.

Each query worker opens its own read-only descriptors and registers the ordered
base/changeset sources with its parser. ID lookups use the complete record
catalog, including objects not yet read. The parser retains at most 256 clean
record bodies by default; evicted bodies are read again when needed.

Canonical source files must remain immutable while the store is open. Opening a
source checks its device, inode, size and modification/change timestamps against
the scanned identity. Store ownership and immutable publication are still the
operational boundary; this is not protection against another process editing an
already-open file in place. Use the existing stopped-store recovery workflow for
administrative changes.

## Commands and publication

Each command worker opens the exact committed source list in a fresh mutable
session. Touched objects and uncommitted edits remain available until that
session ends. Custom `update` and `finalize` hooks retain their existing calls.
The changeset is temporarily serialized to an ordinary Buffer for finalization,
then published using the existing complete-write, file-sync, rename and
directory-sync sequence. Finalization must leave canonical bytes unchanged.

The worker returns the new file's descriptor and metadata. The runtime publishes
that source to query workers only after the required files and `done` status
have been synchronized. Empty/no-op changesets are valid sources. Query pools
finish pending updates before dispatching another query. Replacement workers
initialize at the current committed head.

Workers own their file handles. Session reinitialization and failure close them;
worker termination also closes descriptors opened through Node's tracked file
APIs. Runtime shutdown waits for both pools to terminate before releasing store
ownership. A failed source update makes the pool unavailable and stops further
command acceptance rather than allowing the worker to skip an update.

Administrative replay opens file sources too. `inspectStore()` now returns a
plain `sources` array instead of live `data` proxies and retained `buffers`.
Callers that need to read an inspected snapshot can use a `FileDataset` inside a
`try`/`finally` and call `close()` when finished. Proxies are valid only while
their owning session remains open.

## Internal integration changes

Custom worker implementations need to adopt these messages:

| Boundary | Input/output |
| --- | --- |
| Loader result | `{ sources, meta }` |
| Query initialization | `req.sources`, `req.meta`, `req.access` |
| Query update | `req.source`, `req.meta` |
| Command initialization | `sources`, `meta`, existing command/configuration fields |
| Successful command result | `source`, `meta`, existing result/status fields |

A source contains `file`, `offsets`, `identity`, `size` and `digest`; it contains
neither bytes nor an open descriptor. It is an internal trusted worker contract.
Use `scanDataFile()` to construct one and `FileDataset` to own the parser and
handles. Existing custom index modules need no changes. Default index loaders
now correctly accept `load(meta, uuid)`.

The query parser prepares read-only arrays with an immutable undefined
`constructor` before wrapping them. This matches vm2's existing safe array-species
case, allowing `map`, `filter` and JAQT operations without permitting temporary
writes through the dataset proxy. This compatibility adapter does not replace
or establish a new security assessment of the query sandbox.

## Memory and startup costs

File-backed operation does not imply constant total memory. Record offsets,
source catalogs and ID maps scale with the dataset. Each worker keeps one open
handle per source file. Mutable sessions retain touched records; large individual
records, query results, command output and custom hooks can require substantial
memory. Command/status logs and schemas are still read into memory. Backup/copy
utilities still temporarily buffer individual files when copying them; this
cycle changes dataset retrieval and replay, not their copy algorithm.

Startup still reads all canonical bytes for validation and decodes live records
to reconstruct IDs. It trades startup work for lazy subsequent reads. A generated
328,877,813-byte / 20,000-record store opened and answered an ID lookup with a
48 MB JavaScript heap limit. One local run measured approximately 17.5 seconds
open and 93 ms query (including worker readiness), with 8.9 MB parent heap and
24.4 MB query-worker heap. Retained byte buffers were approximately 25 KiB and
58 KiB respectively. These are warm local measurements, not a cold-storage,
physical-RAM or total-process-memory bound.

Reproduce the disposable-fixture probe with:

```sh
node --expose-gc --max-old-space-size=48 scripts/benchmark-file-data.mjs
```

The dependency is pinned to reviewed od-jsontag Git commit
`24f47eb616c3a24391487197496804ed1c56837b`, because its file-backed API has not
received a new npm version. Installation therefore requires Git access to its
public repository. Replacing that pin with a published release is separate
release work.
