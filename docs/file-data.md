# File-backed datasets

SimplyStore reads its base and committed changeset files through od-jsontag.
The runtime and its workers exchange file paths and index metadata; they no
longer retain or transfer the dataset as SharedArrayBuffers. Remote query and
command APIs and the existing OD-JSONTag/log formats are unchanged.

## Opening and reading a store

Startup inspects command-log order and the committed prefix, as before. It loads
`index.offset.json` and `index.id.json` for the base, followed by
`index.offset.<command-id>.json` and `index.id.<command-id>.json` for committed
changesets only. Existing index hooks continue writing these files.

Normal loading trusts committed offset and ID indexes. It checks their JSON
structure, ordered nonoverlapping offset ranges, file bounds and
record numbers, then combines them in committed order without reconstructing
framing or scanning record
tags. A changeset first removes mappings for every record it replaces, then
applies its new IDs. This handles renames, ID removal and ID swaps. Duplicate
IDs on distinct records are errors; updating the same record may retain its ID.

A 64 KiB byte buffer hashes canonical bytes without interpreting their framing.
Missing offset indexes are reconstructed by scanning framing. If only an ID index
is missing, the loader reads leading JSONTag headers at the stored offsets.
Present malformed indexes fail loading rather than silently being replaced.

Store options support deliberate maintenance:

- `validateIndexes: true` compares offsets with canonical framing and IDs with
  record headers, failing on mismatches or duplicate IDs.
- `rebuildIndexes: true` ignores both persisted indexes and reconstructs them in
  memory. This takes precedence over validation.

Both options are also accepted by `loadFileData()`. Loading never rewrites data
or sidecars. Normal loading assumes committed indexes are correct, including
completeness; use explicit validation after external changes. There is no legacy
index compatibility path. Record bodies remain lazy except for opening the root
and the unusual reconstruction fallback for reference-only records. Configured
integrity checks cover canonical data and present standard index files using the
existing SHA-256 manifest. Index hashes cover the exact bytes parsed. With
integrity enabled, every present standard index requires a manifest entry;
missing indexes can reconstruct from verified data. Explicit rebuild ignores
sidecar hashes as well as contents, while still checking canonical data hashes.
Hash mismatches fail opening; normal loading never repairs them automatically.

Each query worker opens its own read-only descriptors and registers the ordered
base/changeset sources with its parser. ID lookups use the complete record
catalog, including objects not yet read. The parser retains at most 256 clean
record bodies by default; evicted bodies are read again when needed.

Canonical source files must remain immutable while the store is open. Opening a
source checks its device, inode, size and modification/change timestamps against
the hashed identity. Store ownership and immutable publication are still the
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

ID indexes are prepared from final serialization after mutation hooks. Duplicate
IDs are rejected before canonical publication. JSONTag ID-only edits are detected
on materialized records before and after the update hook, without reading
untouched objects. The core finalization boundary awaits custom finalization,
then durably writes the ID sidecar and returns the updated ID map. Conversion
uses the same preparation/finalization rules. Empty commands write an empty ID
sidecar. A failed ID write prevents success. With integrity enabled, conversion,
commands and administrative replay append hashes of final standard index files
after finalization and before success or durable `done`. Custom finalizers may
omit offsets; absent files are not fingerprinted. Hashing detects later file
changes; it does not independently prove a custom index was generated correctly.

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
Lazy read/decode/reference failures are recorded in host-owned parser state.
Even if a command or query catches the error, publication is refused and the
runtime stops accepting mutations. Query code cannot forge this state by throwing
an object with a `storageFailure` property.

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
Use `loadDataSource()` to load persisted offsets (or `scanDataFile()` to
explicitly reconstruct them) and `FileDataset` to own the parser and handles. Custom hook signatures are unchanged. Custom finalizers can still
replace offset finalization; core ID publication always runs after them.
Default index loaders accept `load(meta, uuid)`.

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

Startup still reads canonical bytes for hashing and snapshot checks. With
complete indexes, neither inspection nor loading reconstructs offsets or IDs.
Missing-index fallback and explicit maintenance read headers instead of fully
decoding record bodies. Offset catalogs and ID maps still scale with the data.

A generated 328,877,813-byte / 20,000-record store with persisted indexes opened
and answered an ID lookup with a 48 MB JavaScript heap limit. One local run
measured approximately 1.07 seconds open and 99 ms query (including worker
readiness), with 9.0 MB parent heap and 24.5 MB query-worker heap. Retained byte
buffers were approximately 25 KiB and 58 KiB respectively. These are warm local
measurements, not a cold-storage, physical-RAM or total-process-memory bound.
Direct index loading removes framing and ID reconstruction. Existing snapshot
hashing still reads the files; this run does not establish a startup speedup.

Reproduce the disposable-fixture probe with:

```sh
node --expose-gc --max-old-space-size=48 scripts/benchmark-file-data.mjs
```

Pass `--indexes=missing` to exercise reconstruction without sidecars.

The dependency is pinned to reviewed od-jsontag Git commit
`24f47eb616c3a24391487197496804ed1c56837b`, because its file-backed API has not
received a new npm version. Installation therefore requires Git access to its
public repository. Replacing that pin with a published release is separate
release work.
