# Power-loss failure matrix and baseline

The historical matrix below records the first evidence slice against runtime
`44ea91717a328ad7b5e049c6c0845b5e3bcc1718`, preserved by
[EVD-23](../.spiral/evidence/EVD-20260919-TTZ7C-23.md). That baseline had ten
violated invariant assertions. It is not a description of the hardened runtime.

## Run and interpret

```sh
npm run test:power-loss
npm run test:power-loss:strict
npm run test:recovery
```

The current power-loss suite checks corrected invariants with no TODO allowances;
both power-loss commands must pass. Tests need localhost ports and use disposable
storage. Administrative policy cases now live in `test/admin-recovery.mjs`.
PL15's old request-retention expectation was superseded by the maintainer's
command-only contract: the replacement proves the request is unavailable and
logged JSONTag values survive. PL16 now compares both live execution and restart
with the authoritative command log, fixing the old queue order instead of
preserving it. Historical observations remain evidence of the original defects.

Current coverage includes full-write loops, file/directory barriers and errors,
missing canonical files, no automatic effect repetition, concurrent acceptance
and duplicates, and recovery/backup policy. See [the current durability
contract](../DURABILITY.md), [administrator guide](recovery.md), and [filesystem
exercise](power-loss-filesystem.md) for the implemented behavior and its bounds.

## Historical persistence boundaries

| Artifact | Baseline writer / barrier | Required role |
|---|---|---|
| Base dataset | Converter uses `writeFileSync` | Durable starting state before operating or backing up a store; untested conversion publication remains open |
| Command log | `appendFile` then `datasync` | Complete inputs before accepted; persist first-created filename |
| Command status | `appendFile` then `datasync` | Accepted/active/done ordering; persist first-created filename; distinguish sync error from guaranteed rollback |
| Changeset | `write-file-atomic`: file sync then rename | Complete bytes and durable filename before done |
| Final offset index | `write-file-atomic`: file sync then rename | Current startup reconstructs without it; custom consumers still need an explicit contract |
| ID index | `writeFileSync` | Current startup reconstructs without it; no universal custom-index conclusion |
| Integrity manifest | Append then `datasync` | Ordered metadata for integrity-enabled stores; dedicated power-loss cases remain open |

File sync and directory sync are distinct barriers. The namespace-loss model
uses this distinction from the [Linux fsync contract](https://man7.org/linux/man-pages/man2/fsync.2.html).
It does not assert that every tested filesystem would actually lose an entry.

## Historical baseline matrix

| Test | Fault or question | Observed baseline | Requirement disposition |
|---|---|---|---|
| PL01 | Instrumented normal commit, then process crash | Existing log contents sync; changeset temp file sync precedes rename; restart equals external expected state | Passing control, not physical power-loss proof |
| PL02 | Drop newly created status filename lacking a directory barrier after observed done | Startup serves empty base state despite external completion evidence | P2 violated: silent loss |
| PL03 | Drop newly created command-log filename after observed accepted | Server starts with pending status but no reconstructible command task | P1 violated: accepted inputs lost |
| PL04 | Drop renamed changeset filename lacking directory barrier after observed done | Startup refuses with missing changeset | P2 durability violated; explicit failure is preferable to silent state |
| PL05 | Remove default ID/offset sidecars from copied store | Startup reconstructs expected canonical state | Current default recovery does not require persisted sidecars |
| PL06 | Append a malformed status tail to a copied store | Startup refuses; original store preserved | Passing corruption classification; administrator path remains absent |
| PL07 | Changeset file fsync throws EIO | Command fails, no done or query update | Passing bounded error propagation |
| PL08 | Changeset rename throws EIO | Command fails, no done or query update | Passing bounded error propagation |
| PL09 | Changeset write throws ENOSPC | Command fails, no done or query update | Passing bounded error propagation |
| PL10 | Callback write succeeds with only half the changeset bytes | Command becomes done and live query looks correct; restart refuses truncated data | P3 violated: short write is not retried/validated |
| PL11 | Done-status datasync throws EIO | Server exits; unsynced done bytes remain visible in the file | Passing conservative termination; failure is not proof of rollback |
| PL12 | Pause before done sync, lose unsynced status tail and unpublished changeset name | Restart repeats an external side-effect witness, then commits one dataset transition | P7 violated: dataset idempotency is insufficient |
| PL13 | B accepted/missing; later accepted C has real dataset, with current status accepted or done | Recovery queues B in both cases | Two P6 violations: later-dataset guard absent |
| PL14 | JSONTag command with date, nested data, false/zero/null and Unicode | Logged/reconstructed body preserves the input | Passing body-completeness control |
| PL15 | Configured worker uses request query parameter | Normal execution uses it; log/reconstructed task omits it | P8 violated for this supported worker configuration |
| PL16 | A log sync completes but its acceptance is gated; B accepted while a blocker runs | External acceptance and original waiting queue B/A; command log A/B; restart executes A/B | P4/P6 violated: recovery order differs from waiting-queue order |
| PL17 | Active A and done C with missing C dataset | Startup appends accepted for A before refusing C; old records remain intact | P7 violated: uncertain active work reclassified without review |
| PL18 | Command-log datasync error | HTTP 500, no accepted response or query mutation | Passing acceptance barrier |
| PL19 | Accepted-status datasync error | HTTP 500, no accepted response or query mutation | Passing acceptance barrier |
| PL20 | Error reported after command-log close | HTTP 500, no accepted response or query mutation | Passing conservative close-error propagation |
| PL21 | Test custom finalizer explicitly syncs the parent directory | Trace observes the barrier; loss model preserves filenames; restart matches independent expectation | Positive control for directory tracing and loss-model discrimination |

PL02/03/04/12 alter a stopped copy and leave the source store and observer files
untouched. PL06 is deliberate corruption, not cache loss. PL13 and PL17 are
synthetic policy/startup inputs, not claims that a power cut produced those
exact histories. PL15/16 use actual HTTP calls and the configured/default worker
paths respectively. Concurrent PL16 uses a controlled gate instead of a race.

## Independent observations and model limits

Each fixture has a store directory and a separate observer directory. Client
issued commands, acceptance responses, and polled completion responses go into
an external journal. Expected fixture values are derived from those inputs and
observations, not the store's command log/status. Actual data reconstruction
still uses OD-JSONTag parsing, so format decoding is not an independent parser.

An explicitly loaded test-only preload traces promises FileHandle append/sync/
close operations and callback open/write/fsync/rename/close used by the current
runtime and installed atomic-write dependency. Worker threads inherit it.
It records synchronized fixture-log bytes and observed namespace publication.
The loss model can drop a new filename only if no later directory sync appears
in the trace. PL12 restores the last completed status sync in a controlled
single-writer interval. It never removes acknowledged synced content arbitrarily.

This is a bounded permitted-outcome model, not a general virtual filesystem:
it does not intercept every Node/native/custom I/O API or enumerate every
possible persistence ordering. The observer is assumed outside the failed
storage domain. It does not model sector corruption of earlier synced records,
hardware lies about flushes, real filesystem mount behavior, or external systems.
The external-effect witness proves repeated invocation only, not exactly-once
behavior of any real email/payment/network service.

## Current evaluation

Implementation and current test/VM results are recorded separately in
[EVD-27](../.spiral/evidence/EVD-20260919-TTZ7C-27.md). The bounded preload model
and a real ext4 guest over a volatile block-device model provide complementary
evidence. Neither is physical hardware certification or an exhaustive campaign.
Full changed-code rebuild tooling remains follow-up work under the recorded
side-effect-suppression contract.
