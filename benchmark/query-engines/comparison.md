# isolated-vm versus QuickJS: portable od-jsontag benchmark

2026-09-24. The results favour isolated-vm: about 4.8–5.0× faster indexed scans, 4.6–5.0× faster result serialization, and 25–27× faster for the arithmetic loop. These gains include the host data and text encoding bridges and do not require snapshots.

## Configuration

- Node v24.7.0, Linux x64, Intel Core i7-1195G7, isolated-vm 6.2.0, quickjs-emscripten 0.32.0.
- Actual working-tree portable od-jsontag Parser bundled with esbuild 0.25.12. Same bundle and default 256-record cache in both engines. Guest execution is synchronous, with a 10-second timeout/interrupt deadline and a configured 64 MiB runtime limit. The limits are not equivalent total-process memory bounds.
- Identical generated UTF-8 data files with 1,000 records (158,610 bytes) and 10,000 records (1,623,374 bytes), containing numbers, booleans and Unicode strings. Byte-for-byte equality of engine fixtures was checked.
- The guest receives synchronous source reads bound to one host-opened dataset. Every range is validated against its index; it receives copied bytes. It receives no path, file descriptor, Node module, filesystem API, database API, or network API.
- Both engines use host TextEncoder/TextDecoder callbacks. Both use the same JSON-escaped string transport to preserve NUL, BOM, supplementary characters and lone surrogates across the QuickJS boundary. Checks against host encoding results passed. These are minimal adapters for the parser, not complete Web API implementations.
- isolated-vm uses Callback, which copies arguments/results, not guest-visible Reference objects. QuickJS uses its normal synchronous host-function API.
- Engines run sequentially. Each workload has three initial/warmup executions followed by nine measured executions. Timings include guest evaluation, file reads, parsing, callbacks, and returning the scalar or JSON string to the host. Correctness checks occur outside the timing window. All outputs were checked against native host expectations.
- File pages are warm in the OS cache. Fixtures and library bundling are prepared outside query timings. This measures engine/bridge/parser cost, not physical-disk throughput or a dataset larger than RAM.

## Query measurements

Milliseconds: median (minimum–maximum) across nine measured executions. All isolated-vm query measurements use an ordinary isolate without a snapshot.

| Workload | Records | QuickJS ms | isolated-vm ms | Speedup |
|---|---:|---:|---:|---:|
| return_one | 1,000 | 0.006 (0.006–0.014) | 0.004 (0.004–0.004) | 1.56× |
| compute_million | 1,000 | 48.008 (46.464–52.414) | 1.942 (1.566–2.172) | 24.72× |
| scan | 1,000 | 253.232 (245.589–262.188) | 51.300 (50.382–60.338) | 4.94× |
| filter_sort_project | 1,000 | 277.797 (266.395–281.503) | 55.926 (52.856–59.153) | 4.97× |
| serialize_1000 | 1,000 | 253.887 (245.191–260.196) | 50.786 (46.852–52.695) | 5.00× |
| cached_lookup_1000 | 1,000 | 5.262 (5.082–5.332) | 0.920 (0.798–1.070) | 5.72× |
| return_one | 10,000 | 0.005 (0.004–0.005) | 0.004 (0.003–0.005) | 1.27× |
| compute_million | 10,000 | 47.482 (45.791–48.624) | 1.783 (1.414–1.904) | 26.62× |
| scan | 10,000 | 2549.732 (2511.493–2723.231) | 531.327 (521.024–549.788) | 4.80× |
| filter_sort_project | 10,000 | 4170.410 (4114.597–4212.484) | 646.141 (607.173–668.639) | 6.45× |
| serialize_1000 | 10,000 | 250.031 (243.741–256.129) | 54.260 (50.452–58.081) | 4.61× |
| cached_lookup_1000 | 10,000 | 5.257 (5.132–5.321) | 0.809 (0.771–1.894) | 6.50× |

`scan` sums a property across all records. `filter_sort_project` filters active records in the upper half of the value range, sorts descending, and returns the first 50 names/values as JSON. `serialize_1000` reads and serializes 1,000 records' names, values and notes. `cached_lookup_1000` repeatedly accesses a single cached record. `compute_million` sums integers from zero through 999,999. Return values and result strings match the expected outputs.

Read counts and bytes match exactly for the measured non-sort workloads. A 10,000-record scan performs 10,001 indexed source reads in both engines; the root record also needs rereading after cache eviction. A repeated 1,000-record serialization performs 1,001 source reads. Cached lookups perform none.

### Sorting difference

The sorted query is the same JavaScript and returns the same result, but the engines' sorting behaviour differs. A separate diagnostic run split the 10,000-record query into phases. Both filtered 1,667 records with 10,000 source reads. V8 sorted them with 1,666 comparator calls and 1,667 additional reads; QuickJS made 15,851 comparator calls and 6,294 reads. The result projection made zero additional reads in V8 and 50 in QuickJS. This explains why that query's speedup exceeds the scan speedup: the different access order and comparator count interact with od-jsontag's bounded cache. It is a workload-dependent benefit, not a general sorting speed guarantee.

## Startup

Fresh runtime/context, encoding bridge, portable library, 1,000-record offset index, and root parsing. Seven samples per configuration, within an already running Node process after engine module loading. These figures exclude Node process launch and engine module/WASM initialization.

| Engine | Snapshot | Median ms | Range ms |
|---|---|---:|---:|
| quickjs | no | 14.115 | 12.258–37.106 |
| ivm | no | 5.053 | 4.651–6.238 |
| ivm | yes | 4.238 | 3.864–4.325 |

One initial engine module load took 13.96 ms for QuickJS (including WASM initialization) and 4.00 ms for isolated-vm. These are single observations, not medians. The isolated-vm snapshot took 7.91 ms to build and occupied 513,743 bytes. It contains trusted library/bootstrap code only, with callbacks and dataset bound afterwards.

Snapshot initialization worked, but the maintainer [currently advises against createSnapshot due to instability](https://github.com/laverdet/isolated-vm#ivmisolatecreatesnapshotscripts-warmup_script). Its small startup saving is unnecessary for the performance recommendation here.

## Capability and timeout checks

- A bare isolated-vm context has no `process`, `require`, `fetch`, TextEncoder or TextDecoder. Encoding APIs are explicitly supplied by the embedding.
- Static import is rejected in script execution; dynamic import rejects with `Not supported`. Dynamic import constructed through `Function()` also rejects.
- An infinite loop was interrupted at approximately 100 ms when configured with a 100 ms timeout. A subsequent `1 + 2` returned 3. The benchmark also exercised a 10-second timeout.
- These are smoke checks of the intended embedding, not a security audit, memory-exhaustion test, or proof of complete query/grant isolation. Production integration must keep host callbacks limited to authorized data and results.

## Scope and recommendation

Use isolated-vm for the next engine integration trial. Its advantage is substantial for the actual portable parser and synchronous lazy-source design, including before warmup: inspect the raw `first` values for first-query measurements. Snapshots are unnecessary.

This does not yet exercise SimplyStore's complete request path, JAQT library, authorization rules, concurrent workers, cancellation across host callbacks, full Web API compatibility, or production result-size limits. The library is native and version-sensitive; its maintainer recommends keeping isolate execution in a different process from critical infrastructure. See the [isolated-vm documentation](https://github.com/laverdet/isolated-vm#security). Heap limits were configured, but RSS and OOM behaviour were not benchmarked.

## Reproduction and artifacts

Run from this directory with the existing portable od-jsontag checkout and its installed dependencies:

```sh
npm ci --no-audit --no-fund
node --no-node-snapshot bench.mjs ivm > ivm-run.log 2>&1
node --no-node-snapshot bench.mjs quickjs > quickjs-run.log 2>&1
node --no-node-snapshot sort-trace.mjs ivm
node --no-node-snapshot sort-trace.mjs quickjs
node --no-node-snapshot guard-checks.mjs
python3 make-report.py
```

Run the two benchmark engines sequentially to avoid CPU contention. The benchmark imports esbuild and QuickJS from `/home/auke/git/slonl/spiral/od-jsontag/node_modules`; adjust the `repo` path/imports if relocating it.

- [Benchmark source](bench.mjs)
- [QuickJS raw results](quickjs-results.json)
- [isolated-vm raw results](ivm-results.json)
- [Sort diagnostic source](sort-trace.mjs)
- [QuickJS sort trace](quickjs-sort-trace.json)
- [isolated-vm sort trace](ivm-sort-trace.json)
- [Capability-check source](guard-checks.mjs)
- [Capability-check results](guard-results.json)
