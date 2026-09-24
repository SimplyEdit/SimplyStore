# Engine-selection evidence

These files retain the 2026-09-24 disposable benchmark, including its original
absolute checkout paths. See comparison.md for conditions, measurements and
limitations. Run probes in a disposable directory with the stated dependency
versions; they create data fixtures and result files. They are not the normal
SimplyStore test suite or a production runtime implementation.

The subsequent production-boundary measurement is worker-results.json, generated
by scripts/benchmark-query-runtime.mjs. It includes fresh isolates, host grants,
file reads, serialization and worker messaging; it is distinct from bench.mjs.
