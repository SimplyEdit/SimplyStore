# SimplyStore Roadmap

Updated from the maintainer interview on 2026-09-19. This records intended
outcomes and open investigations; it does not claim the features exist.
The [retained interview](.spiral/sources/SRC-20260919-TTZ7C-43.md) preserves
the decisions and their clarifications.

## How to select the next task

The order below is the agreed presentation of direction, **not a fixed delivery
queue**. Spiral Developer risk analysis determines the actual next task and
cycle. Reconcile this roadmap with current code, accepted evidence, dependencies
and user needs. Consider uncertainty, downstream leverage, the cost of discovering
an incorrect assumption late, and the cheapest useful way to test it.

State whether a proposed cycle continues, revises or deliberately deviates from
this direction. An earlier investigation may be justified by a later feature's
risk; early UI task analysis need not wait for all backend work. Agree a concrete
cycle goal before product implementation. This roadmap selects no next cycle.

Keep SimplyStore simple. Compare approaches by their immediate conceptual cost
and how simply they allow future enhancements. Prefer useful boundaries and
existing capabilities over speculative framework machinery.

## Current foundation

The accepted durability/recovery work provides log-authoritative execution,
durable acceptance and completion, explicit startup inspection, administrative
recovery, and consistent backup/restore tooling. The accepted runtime correction
cycle repaired shutdown completion, acceptance failure checks and duplicate-ID
compatibility while improving workflow readability.

These are bounded claims. [DURABILITY.md](DURABILITY.md) describes the tested
Linux/ext4 power-loss envelope and its limitations; the
[administrator guide](docs/recovery.md) documents the existing tools. Preserve
these contracts as the architecture evolves. A new sandbox, storage approach or
UI must be evaluated against them where relevant.

## 1. Resilience: rebuilding and usable CLI operations

### Full-history rebuild

Provide a deliberate way to rebuild a separate dataset from the complete
command history, including when command code has changed. The first version
processes the full history; choosing a stopping command is not required.

- Use the authoritative command order and complete logged inputs.
- Communicate a rebuild mode that tells commands and hooks to suppress external
  effects and update only the rebuilt data.
- Preserve the original store and keep validation and deliberate promotion
  distinct from building the new dataset.
- Make the operation available through the administrative CLI.

Rebuilding is distinct from ordinary recovery. Missing output never proves
that an external effect did not happen. Ordinary recovery retains administrator
authorization and the rule that no later accepted command may have a dataset
when an earlier command is rerun.

The existing suppression contract is cooperative. Evaluate the actual command
and hook behavior before claiming a rebuild is free of external effects.
Define treatment of failed, unsafe and pending history, required starting data,
and changed-code failures during the rebuild design; do not silently interpret
full history as replaying every attempt or only current done records.

### Discoverable Unix-style CLI

Make existing inspection, recovery, backup/restore and the new rebuild operations
easy to find and run, with useful help. Favor conventional command naming,
`--help`, clear usage and examples, meaningful exit status, and understandable
diagnostics. Choose a coherent entry point during design; no new CLI framework
is prescribed.

The near-term need is usability of these operations. Broader failure testing
and availability improvements remain long-range work.

## 2. File-backed retrieval and sandbox replacement

### File-backed retrieval as the sole approach

Read data from files to support larger datasets with lower memory use and remove
shared memory as a requirement for alternative JavaScript runtimes. Do not retain
a separately supported in-memory mode.

Preserve the remote API. Internal data-access APIs may change where necessary;
the roadmap does not require synchronous transparent object access or a specific
cache/mapping mechanism. File-format changes are not automatically authorized.

The maintainer reports performance tests with no noticeable slowdown. Retain
that as supporting experience, not a reproduced benchmark or a universal
performance guarantee. Verify representative query/command performance and
memory use, including data larger than RAM, when choosing the implementation.
Preserve consistent views, authoritative ordering and durability behavior.

### Replace VM2; evaluate QuickJS and V8 isolates

Replace the existing VM2 sandbox with an execution boundary whose isolation and
performance can support consideration of an internet-facing query interface.
QuickJS and V8 isolates are candidates to investigate, not selected dependencies
or a commitment to replace the whole server runtime.

Required query behavior:

- Anonymous or authenticated access, configurable per instance.
- Read-only dataset access under the applicable grants.
- No arbitrary filesystem or network access; dataset reads go through a
  controlled boundary.
- Enforced execution-time, memory and result-size limits.

Evaluate candidate isolation, termination, resource enforcement, compatibility
and performance against realistic and hostile queries. Choosing an engine alone
does not establish that public access is safe. File-backed retrieval should
help remove shared-memory coupling without exposing arbitrary files to queries.

## 3. Object versioning and audit trails

Allow a JavaScript query to find a specific object's previous version, then
follow previous versions recursively. Each version gives access to its command,
author and message. The purpose is a UI-readable audit trail.

- Deleted objects remain discoverable by ID and retain their history.
- Deletion remains a visible step in the version chain.
- Explicitly using an existing or previously deleted ID creates a new version
  of the same object, including when restoring it after deletion.
- Restoration preserves the intervening deleted version in its history.

Choose the history-access API and representation during design. The earlier
whole-dataset time-travel UI proposal is replaced by this object-history scope;
it is not an implicit requirement for this milestone. Do not assume versioning
requires the earlier proposed linked dataspace/index layout.

## 4. UI redesign: querying, exploration and maintenance

### Start with tasks and audiences

The current UI was a quick placeholder. Analyze what users should be able to do
and do easily before choosing the redesigned interaction and component structure.

Audience order:

1. Developers testing queries and exploring the dataset.
2. Administrators checking status and performing standard maintenance.
3. Developers/administrators managing schema, commands, grants and accounts,
   and inspecting audit trails.

Use Metro, SimplyFlow, Helene and other Muze libraries where they make sense.
Determine their roles from the tasks and fit. Keep the UI simple for downstream
systems to extend, replace individual displays, or overhaul entirely.

### Landing page and navigation

Provide a simple introduction to the system and dataset, with links to the
query interface and browsable exploration. Put other operations in a menu
according to the user's access grants. When read access is protected, an
unauthenticated first request shows only a login form.

The landing page is not an elaborate operations dashboard. Give status,
maintenance, account/grant administration and audit inspection appropriate views
and navigation. Enforce authorization at the operation boundary as well as in
the visible menu. The exact maintenance controls need task analysis.

### Querying and exploration

Support writing and testing JavaScript queries and inspecting results. Provide
browsing without writing code: find objects through search or lists, inspect
properties, follow relationships and access object history.

Default displays should be reasonably readable and can remain technical.
Make it easy for extending systems to override presentation for their own data.

### Command documentation first

Document available commands and how to use them. The initial scope does not
require an in-browser command runner or editor. A command creation/testing IDE
is a later investigation.

## 5. Schema editing, personal fixtures and conversational AI

### Schema information

Use curriculum-store's schema implementation as the starting point. It includes
types, properties, relationships, labels and constraints, with schema-informed
structural checks in import code. Investigate requirements from other users and
datasets before selecting which extensions SimplyStore should support.

Authorized users must be able to create and edit schema information through the
UI. Externally authored schema files must also be usable as supplied; the UI
must not become the only authoring route.

Design the relationship between file-supplied and UI-edited schema, and determine
which validation and presentation semantics belong in the reusable system.
Do not assume that every curriculum-specific rule becomes a SimplyStore rule,
or that existing checks already provide comprehensive schema validation.

### Personal query fixtures

A fixture is a saved query paired with its chosen output visualization, ready
to reopen and run. It is not a regression-test input/expected-output fixture.
Start with personal fixtures. Publishing fixtures into a workspace or the main
dataset is a later addition. Visualization choices and extension points should
follow the UI task analysis rather than a prescribed charting framework.

### Conversation over the query interface

First provide an in-UI conversational interface that lets AI explore the data
and answer natural-language questions through the query interface. Users bring
their own AI; provider, account and credential integration require investigation.

The assistant uses the current user's data-access grants and the read-only,
resource-limited query boundary. It does not gain extra privileges through its
provider connection. Query/result inspectability is a design consideration so
users can assess answers; the exact interaction remains to be designed.

Later, explore AI assistance with authoring queries, visualizations, schema and
commands. Investigate MCP after the conversational UI; it is not the first
integration target.

## 6. Temporary workspaces and merge approval

Let people create a temporary workspace, change it without affecting main, and
share it with other accounts using read-only or read-write access. A workspace
can be deleted or merged into main.

- Workspace commands must not cause external side effects.
- A merge is eligible only when its commands can be replayed on current main.
- When conflicts exist, apply current main to the workspace, resolve conflicts,
  and then attempt the merge again.
- Merge approval is optional and configured per SimplyStore instance, with a
  list of accounts permitted to accept merge requests.
- An accepted merge may trigger the intended external effects.

The merge execution mechanism remains open. Investigate replaying commands on
main with effects enabled after validation/approval, alongside alternatives
that publish a validated replay result and arrange effects separately. Choose
the least added complexity, accounting for future enhancements as well as the
initial implementation. Neither alternative is a committed design.

During design, resolve how changes to main invalidate validation or approval,
how conflicts are represented/resolved, how workspace effect restrictions are
upheld, and how partial failures involving external effects are handled. Do not
assume database-style rollback can undo arbitrary external actions.

Workspace URLs, on-disk layout and history integration are design decisions.
The earlier roadmap's folder moves and rebase-like mechanism are not mandatory.
Workspace isolation, object history, rebuild behavior and sandbox restrictions
should share concepts where that simplifies their contracts.

## Long-range options

- Broader resilience evidence: randomized/adversarial campaigns, soak testing,
  additional filesystems/storage environments and deployment-specific power loss.
- Availability improvements beyond the current failure/recovery behavior.
- A command IDE for creating and testing implementations.
- Fixtures published into workspaces or main.
- AI assistance with query, visualization, schema and command authoring; MCP.
- Automation, including scheduled commands and incoming/outgoing webhooks.

Keep automation and larger-system integration small. Earlier ideas for minimal
post-commit/derived-store seams remain possible enabling work, not an obligation
to build a messaging platform. Risk analysis determines when these investigations
are justified; their presence here is not implementation authorization.

## Continuity and evidence

This roadmap revises priority and scope from the earlier roadmap and durability
sequence. It preserves the invariants in
[DES-001](.spiral/designs/DES-001.md) and the ordinary recovery restrictions in
[REQ-20260919-TTZ7C-20](.spiral/requests/REQ-20260919-TTZ7C-20.md).
The [current project context](.spiral/project-context.md) and executable evidence
remain necessary when forming a concrete cycle. Open investigations here must
not silently become implementation commitments.
