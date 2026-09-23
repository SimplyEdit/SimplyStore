# Administrator recovery

SimplyStore preserves the existing OD-JSONTag data, command-log, status-log and
integrity manifest formats. Integrity verification is mandatory. The command log
defines command order. Commands must
contain every invocation input beyond the dataset; HTTP request context is no
longer supplied to command workers. The fourth handler argument still provides
metadata/index access; the former third request argument is `undefined`.

Use this procedure with the hardened binary. Older binaries understand the file
formats but do not implement the new ownership, ordering, or recovery policy.
Do not run competing versions/writers on one store.

## Configure and initialize

Tools accept a declarative JSON file, not executable server configuration:

```json
{
  "datafile": "/srv/simplystore/data.jsontag",
  "commandLog": "/srv/simplystore/command-log.jsontag",
  "commandStatus": "/srv/simplystore/command-status.jsontag",
  "commandsFile": "/srv/application/commands.mjs",
  "indexFile": "/srv/application/index.mjs",
  "integrityFile": "/srv/simplystore/data.integrity.jsontag"
}
```

Omit `integrityFile` to use the default next to the data file, such as
`data.integrity.jsontag`. Setting it changes the location, not whether hashes
are required. The former `integrity: false` option cannot disable checks.
Relative paths
resolve against the command's working directory, as server paths do. `requiredFiles`
can list additional required files; these are checked at startup and synced before
done. Keep custom artifact paths inside the declared directories or list them
explicitly. Custom hooks must finish all required work before resolving.

For a new store, create an empty destination directory and run:

```sh
node scripts/convert.mjs input.jsontag /srv/new-store/data.jsontag
```

The converter creates empty command/status logs alongside the base, finishes
indexes and the required integrity manifest, and releases ownership after
durable completion.
It refuses to overwrite an existing base/log/manifest. Opening an existing store
never creates missing logs. A bare historical base is not proof of an empty
history: preserve it and its surrounding evidence before deciding on initialization.
An existing store with a complete manifest needs no migration. Stores without
a manifest need the explicit initialization below.

## Initialize integrity for an existing store

Stop the server and run:

```sh
node scripts/recover.mjs init-integrity --store store.json
```

This takes the normal ownership locks, validates the committed history, framing,
record contents, IDs and available indexes, and creates the missing manifest
atomically. It preserves data, indexes and logs and does not run command handlers
or replay commands. Pending/uncertain history, malformed data or stale indexes
must be resolved first. Existing manifests are never replaced, including when
verification fails. Normal startup never initializes or repairs hashes.

Initialization establishes a baseline for the current validated bytes; it cannot
prove that those bytes match their historical contents. Afterwards, changes are
checked against the recorded hashes. An uncertain publication failure retains
ownership for administrator inspection, as with other durable operations.

## Inspect before executing anything

Stop the writer using the deployment's normal service procedure. Then:

```sh
node scripts/recover.mjs inspect --store store.json --quiescent --out plan.json
```

Use `--quiescent` only for a stopped store or immutable copy. Without it, inspection
is diagnostic and the plan is not actionable. Plans must be new files outside the
source directories. Inspection does not import handlers, custom workers, or index
modules, and does not modify the source.

Review `blocks`, the commands in log order, statuses and attempts, existing/missing
files, and the proposed `rerun` list. A complete command log fixes the order even
when an old queue/status sequence disagrees. Actually committed out-of-order
changesets require diagnosis; reordering positional data is not a valid repair.

The tool cannot prove history completeness, original deployment identity, hidden
application inputs, or external effects from the surviving files alone. Use retained
backups, deployment records, application knowledge, and external-system evidence.
A current code hash binds the selected code against changes after preview; it
cannot prove which code ran historically. Missing business inputs are not invented
or injected by the tool. If these matters cannot be established, use a verified
backup or retain the diagnosis; do not claim a safe rerun.

## Deal with ownership after a crash

Each mutable directory has a `.simplystore-lock` during operation. Normal shutdown
drains accepted work before releasing ownership. A crash or storage fault leaves
locks. Neither PID age nor an apparently dead process authorizes automatic stealing.
A hung shutdown can be terminated, but then requires this offline procedure.

After confirming that no writer remains, inspect and explicitly release locks:

```sh
node scripts/recover.mjs unlock --store store.json --confirmed-stopped \
  --operator 'administrator name' --reason 'Writer stopped; reviewed retained evidence' \
  --out unlock-audit.json
```

This preserves lock diagnostics in a new external audit file before removal. It
does not authorize reruns or repair data. Normal startup still rejects unresolved
accepted/active work, missing committed data, and other inconsistent evidence.

An interrupted recovery has an external audit bundle and candidate ownership,
including a parent lock while the candidate is being copied. Review that bundle
before releasing its locks. A candidate that looks complete but lacks its recovery
completion report must be finished with `finish` below, not merely unlocked.

## Apply an approved trailing recovery

For log order A/B/C, B cannot be rerun if C has a dataset—even if C is accepted,
failed, unsafe, or its dataset is corrupt or zero bytes. Status insertion order
cannot make C appear earlier. If the trailing commands have no datasets, the
administrator can approve their execution in log order from a verified prefix.
Absence of a dataset does not prove absence of external effects.

```sh
node scripts/recover.mjs apply --plan plan.json --to /srv/recovered-store \
  --audit-dir /srv/recovery-audit --approve-rerun B,C,D \
  --operator 'administrator name' \
  --reason 'Verified complete history and inputs, original command meaning, and assessed external effects'
```

The approval must exactly match the complete ordered `rerun` list. Source, target,
and audit locations must not overlap; destination directories must be new. The
source must remain quiescent. The tool acquires ownership and rechecks the source
inventory, missing filenames, selected code, and rerun predicate before execution.
A newly appearing later dataset invalidates the plan.

Original store artifacts are copied into the audit bundle. Unrelated files such as
application secrets are not swept into backups; retain deployment evidence separately. Candidate files preserve their
relative layout and permissions; mutable files are copied, never hard-linked.
Commands retain original IDs and logged inputs. Recovery appends existing status
records, preserving the original bytes as a prefix. Authorization/attempt links
live in the external audit, not a new store record format. Required persistence
errors stop work; a possibly committed done is never overwritten with failed.
A retained expected changeset digest is checked before a new digest or done is
written. Without that witness, structural correctness is not independent proof
of byte-identical historical output.

On an interrupted or failed attempt, preserve the candidate and audit. Inspect the
candidate with its configuration from the audit authorization. Completed commands
are reconstructed, not selected again. An active attempt needs fresh effect
assessment and a new plan; existing partial data needs separate diagnosis and is
not automatically deleted to make a rerun eligible. After explicit offline lock
release, apply an eligible plan to another new destination. Do not restart recovery
against an older source while ignoring later candidate evidence.

If all approved commands committed but only completion reporting was interrupted:

```sh
node scripts/recover.mjs finish --audit-dir /srv/recovery-audit --confirmed-stopped \
  --operator 'administrator name' --reason 'Reviewed completed attempts and original authorization'
```

This validates the retained authorization, source, candidate, and approved command
coverage, writes the completion report, and releases ownership without execution.
A missing audit bundle prevents certification of that recovery attempt.

## Consistent backup and restore

Create backups with a stopped writer. The tool acquires ownership, copies canonical
data/log/integrity files, default index artifacts, and explicitly required files, validates reconstruction,
and writes an external completion manifest last:

```sh
node scripts/recover.mjs backup --store store.json --quiescent --to /srv/backup-001
node scripts/recover.mjs restore --backup /srv/backup-001 \
  --to /srv/restored-store --audit-dir /srv/restore-audit
```

A completed backup can be moved or transferred as one directory; restore validates
and rebases its external inventory while preserving canonical bytes. Incomplete
or changed backups are refused. Restore executes no handlers. Optional
`--store damaged-store.json --quiescent` compares backup coverage against a stopped
source under ownership. Review `sameBase`, `missingFromBackup` and the warnings; comparison includes
command bytes, status, and available completed data. Without a
source, loss relative to current history is unknown. A known older backup can be
an explicit rollback with disclosed loss; it is not recovery of all later work.
This first tool restores complete backups; it does not merge arbitrary surviving
changesets, repair malformed logs, or override unknown command inputs.

## Validate and promote

```sh
node scripts/recover.mjs verify --report /srv/recovery-audit/complete.json \
  --out activation-preview.json
```

Verification also rejects changes to the selected recovery code files. Review
the exact candidate configuration and command coverage. Undeclared dependencies
and deployment configuration still require independent review. Stop the old
service, preserve its directory and configuration, and explicitly switch the
service to the candidate configuration. The tool does not change a deployment.
The server validates the selected store before listening. Switching multiple
configured directories is not an atomic filesystem operation. After accepting
new commands, switching back can lose those commands and needs a fresh assessment.
Normal loading does not require the external administrative reports.

## Rebuild is separate

Full changed-code rebuild remains follow-up work. Its retained contract produces a
new dataset and supplies `mode: rebuild`, `sideEffectsAllowed: false` to commands
and hooks. This is a cooperative execution control, not hidden business input or
a sandbox. Ordinary recovery does not suppress effects that might still need to
happen, and has no `--force` escape from the later-dataset rule.
