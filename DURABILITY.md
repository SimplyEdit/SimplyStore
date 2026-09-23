# Durability contract

SimplyStore retains its existing base, changeset, command/status and
integrity formats. Integrity manifests are required; existing stores without
one use the explicit initialization workflow, without rewriting canonical data.
The command log is authoritative:
acceptance serialization keeps execution in log order, including concurrent
requests and duplicate IDs. A command supplies all inputs beyond its preceding
dataset; handlers receive `undefined` as the third argument and metadata as the
fourth. Audit application commands that previously used request context.

Before returning accepted, SimplyStore completely writes and syncs the command
and acceptance records and their parent directories. Before publishing done, it
finishes the changeset, index hooks and required artifacts, syncs file contents
and published directory entries, and persists terminal status. Short writes are
retried; write, sync, rename and close failures propagate. Uncertain persistence
halts mutation and leaves ownership evidence for inspection.

The tested envelope is one cooperating writer on Linux/ext4, `data=ordered`,
`barrier=1`, with storage honoring flushes. A QEMU guest over a volatile NBD device
model exercises full guest/cache loss and recovery. This is bounded filesystem
and block-model evidence, not physical hardware certification. See the
[reproducible exercise](docs/power-loss-filesystem.md) and
[cycle evidence](.spiral/evidence/EVD-20260919-TTZ7C-27.md).

Startup validates existing canonical files before executing user modules or
changing command status. Complete consistent stores reopen normally. Missing
logs, malformed records, missing/corrupt committed data, or pending/uncertain
commands stop startup for administrator assessment. Upgrading cannot prove that
older writers preserved the whole history. A missing manifest or required entry now stops startup even without explicit
integrity configuration. Creation, commands and recovery persist hashes of
canonical data and present standard indexes before success. Each artifact set
uses one durable manifest append; normal startup never creates a new baseline.

The [administrator guide](docs/recovery.md) provides read-only inspection,
source-bound preview, explicitly approved suffix recovery on a copy, interrupted
recovery handling, consistent backup/restore and deliberate promotion. No later
ever-accepted command may have a dataset when an earlier command is rerun,
including corrupt or unsafe later datasets. Missing files never establish that
external effects did not happen. Recovery cannot invent missing inputs or promise
exactly-once external effects. Changed-code rebuild with cooperative effect
suppression remains a separate follow-up contract.

Ownership locks exclude cooperating server/admin writers across configured
paths. They are not protection against arbitrary filesystem writers or older
binaries. Stale locks require explicit offline assessment, never PID-age stealing.
Custom hooks must await their work; declare additional required artifacts with
`requiredFiles`. Default indexes are reconstructible; custom dependencies need
their own conformance checks. Unsupported directory-sync operations fail rather
than silently weakening the guarantee. Broader filesystems, random/soak testing,
and deployment-specific power-loss testing remain future validation work.

## File-backed readers

The runtime retains ordered file sources instead of shared dataset bytes. Each
worker owns read handles; committed sources remain immutable while the store is
open. Source publication still follows the durable `done` record. Inspection
hashes/scans data with a fixed-size byte buffer, and shutdown waits for readers
to terminate before releasing ownership. See [file-backed data](docs/file-data.md)
for the source contract and memory boundaries. The existing filesystem durability
envelope and recovery restrictions remain in force.
