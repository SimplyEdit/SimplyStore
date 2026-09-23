---
id: CTX-001
---

# Project Context

## Purpose

Durable local context for using Spiral Developer in the SimplyStore repository.

## Project

Name: SimplyStore

Repository/baseline: `https://github.com/simplyedit/simplystore`, local authoritative branch currently expected to be `master`.

Project causal-graph namespace: `https://github.com/simplyedit/simplystore/spiral#`

Spiral core source: `.spiral-core/`, git submodule for `https://github.com/muze-labs/spiral-developer.git`, currently checked out at `8d4b2c738a413abd4cccca740ce958f486e5f7af`.

Active cycle: CYC-20260923-TTZ7C-44, File-backed dataset runtime, on
spiral/CYC-20260923-TTZ7C-44-file-backed. The maintainer authorized replacing
shared-memory data after reviewing od-jsontag hardening. This continues the
file-only roadmap direction, prioritized ahead of rebuild. SRC-45, UND-48,
REQ-46 and DES-47 (20260923-TTZ7C namespace) retain the commitment. Implementation
uses ordered file sources, bounded clean-record caches, worker-owned handles,
streamed framing/hash scans and file-backed administrative replay. Persisted
offset/ID sidecars are loaded and validated against canonical framing and
record headers, with derived fallback. The maintainer verified example-folder
operation and required this persisted-index completion in the same version. EVD-20260923-TTZ7C-49 records 155 passing tests, clean lint, a fresh-package
installation and large-file/real-data probes. Human acceptance remains pending. Client-visible version metadata and audit
trails follow this migration; no such feature is implemented by this cycle.

Latest accepted cycle: CYC-20260919-TTZ7C-42, Updated Roadmap And Planning
Context. Accepted on 2026-09-23 and integrated through PR #24 at dbb0703.

Previously accepted and integrated cycle: CYC-20260919-TTZ7C-36, Reliable Runtime Contracts And Readable
Workflows, on spiral/CYC-20260919-TTZ7C-36-runtime-contracts. The maintainer
confirmed this cycle after independent review found three regressions in the
accepted runtime refactor. It deliberately precedes remaining randomized/soak
work to repair shutdown completion, storage-failure acceptance and duplicate-ID
compatibility, and clarify inspection/recovery coordinators. Source SRC-37,
understanding UND-38, request REQ-39 and design DES-40 use the full
20260919-TTZ7C namespace. The maintainer accepted the evaluated branch tip
061571e48c453e5f3d7086a33af0d94926b2f7ea on 2026-09-19. It was integrated through
PR #23 into master at b482053bdf0d3b3fc8902cce3169408d31ed9f6e.
Implementation and acceptance are complete:
118 regression tests and focused lint pass; EVD-20260919-TTZ7C-41 records six
new regression cases and the restored contracts. The production change adds
18 net lines across runtime, inspection and administrative recovery.

Previously accepted Spiral cycle: `.spiral/cycles/CYC-20260919-TTZ7C-31.md` (`Readable
Store Runtime And Dependency Maintenance`), opened on
`spiral/CYC-20260919-TTZ7C-31-runtime-boundaries` from `master` at
`e31e07c9bc8d4fc6458da1d213609dbf1aa4a7a2`. It deliberately precedes the
remaining randomized/soak roadmap work to correct the central runtime boundary
exposed by the accepted durability cycle. Its source, understanding, request and
design are `SRC-20260919-TTZ7C-28`, `UND-20260919-TTZ7C-29`,
`REQ-20260919-TTZ7C-30` and `DES-20260919-TTZ7C-32`. The maintainer accepted the
cycle on 2026-09-19. The accepted branch was integrated locally into `master` at
`0d23ed0354fb9f1285d9bc3b15c0a1089583d65b`; the correction cycle above is also
accepted and integrated.

Accepted-cycle outcome: `IMP-20260919-TTZ7C-33` moves
opened-store state and lifecycle into one cohesive `StoreRuntime`, leaving
Express and process policy in the server shell. It preserves authoritative
command-log ordering and the accepted durability/recovery behavior. The
maintainer authorized correcting the ineffective slow-query timeout; normal and
slow GET and POST tasks now pass the selected configured duration through the
worker's `timeout` property. `IMP-20260919-TTZ7C-34` aligns supported root and
example dependencies. Storage failure reporting is now explicitly optional,
without an empty default callback; failure state and mutation refusal remain
mandatory. Store inspection, recovery application, backup restoration and
offline lock release now expose story-level coordinating methods on cohesive
module-local workflow objects while retaining their public functions and safety
semantics. `EVD-20260919-TTZ7C-35` records 112 passing regression tests, clean
focused lint and audit results, and successful package/example verification.
The maintainer explicitly accepted the completed cycle.

Previously accepted and integrated Spiral cycle: `.spiral/cycles/CYC-20260919-TTZ7C-17.md` (`Power-Loss Durability And Administrative Recovery`), committed by the maintainer on 2026-09-19 and opened on `spiral/CYC-20260919-TTZ7C-17-power-loss-recovery` from `master` at `44ea91717a328ad7b5e049c6c0845b5e3bcc1718`. The maintainer accepted the cycle on 2026-09-19 after running tests and the example. The accepted branch was integrated locally into `master` at `fd40b0a23066ee8b37261dea1ba89cc64bbd4cc8`. Its source, understanding, and acceptance matrix are `SRC-20260919-TTZ7C-18`, `UND-20260919-TTZ7C-19`, and `REQ-20260919-TTZ7C-20`.

Earlier accepted and integrated cycle: `.spiral/cycles/CYC-20260917-TTZ7C-4.md` (`Persisted Offset Indexes`), explicitly accepted on 2026-09-18 and merged into `master` at `0444094`. Conversion and command changesets finalize offsets from their serialized bytes through the configured index module, with a default fallback for existing wrappers. The earlier integrity runtime slice was accepted on 2026-08-19; its compliance correction in `DEF-20260916-TTZ7C-1`, verified by `EVD-20260916-TTZ7C-3`, was explicitly accepted on 2026-09-16 and merged at `e59c6f1`.

Accepted-cycle outcome on 2026-09-19: `IMP-20260919-TTZ7C-26` implements the corrected `DES-20260919-TTZ7C-24/25` following explicit authorization to complete the whole cycle. Existing command/status/integrity and dataset formats remain unchanged, with no migration. Durable complete-write and file/directory barriers, ownership, log-authoritative serial acceptance/execution, command-only workers, strict startup assessment, and source-bound administrator recovery/backup/restore are implemented. `EVD-20260919-TTZ7C-27` records 101 passing regression tests plus 22 expanded administrator tests (three additional cases), direct CLI checks, and a passing four-scenario ext4/QEMU power-cut exercise with device/filesystem negative controls and latency. `DURABILITY.md` and `docs/recovery.md` define the bounded behavior and runnable procedure. Historical baseline gaps remain at `EVD-20260919-TTZ7C-23`; PL15/16 expectations were corrected by the maintainer, not silently weakened. Full rebuild remains a documented separate contract. The cycle is Accepted and integrated into local `master`. Broader filesystem/hardware and randomized testing, undeclared custom dependencies and historical input/effect uncertainty remain explicit limits. Two unchanged legacy index `load` methods have pre-existing undefined-meta lint errors outside this write-path cycle.

Acceptance-review refinements: explicit multiline blocks, selective JAQT queries, fewer ternaries, and lines near 80 columns now improve the cycle code’s readability. Short conditional choices and long literals remain where clearer. The latest full relevant regression suite passes 106/106; EVD-27 records preserved ordering, backup coverage and plain-data report contracts. The example now uses `npm run build` for explicit initialization; conversion of its tagged URLs is fixed and build/start/query smoke verification passes. The maintainer explicitly accepted the cycle after confirming that tests and the example run.

## Intake State

Status: **Complete**

Human-confirmed complete on: 2026-08-17

Targeted frame refresh: the 2026-09-19 roadmap interview clarifies UI audiences,
file-backed-only storage direction, remote versus internal API compatibility,
and a conditional public-query target. SRC-20260919-TTZ7C-43 retains the answers.
These are future outcomes, not claims that deployment readiness has changed.
Other intake commitments remain in force; reopen specific topics when a concrete
cycle exposes missing requirements.

| Required topic | Disposition | Notes / source |
|---|---|---|
| Purpose, users/stakeholders, goals | Covered | Intended users and current direction sections; human input on production-readiness audience and durability priority |
| Current posture | Covered | Brownfield reusable Node.js library moving from experimental toward developer-evaluable production readiness; not yet an established production service |
| Important outcomes / metrics | Covered with unknowns | Project goals table; concrete thresholds remain unknown where stated |
| Consequential prior decisions / reversibility | Covered with unknowns | Consequential prior decisions table; reversibility remains unknown for several legacy choices |
| Invariants / commitments | Covered | Simplicity, durable format stability, JavaScript query API stability, REST API stability, MIT licensing, non-goals, and durability fail-safe direction are recorded |
| Known / tolerated problems | Covered | Known/tolerated problems and risks table |
| Reliable feedback / reality sources | Covered | Reliable feedback / reality sources table |
| Knowledge gaps / affinity needs | Covered | Areas needing affinity / human guidance table |
| Relevant future direction | Covered | Current direction and later possibilities sections |
| Risk-discovery / metric-profile disposition | Covered | Intake risk-discovery and metric-profile tables |
| Integration context / pre-merge Spiral validation | Covered with unknowns | Spiral integration context section; GitHub check added, required-branch protection/merge queue status unknown |

Future work should reopen intake as `Stale` if SimplyStore's audience, production-readiness target, downstream commitments, or API/disk-format compatibility expectations materially change.

## Spiral Integration Context

Authoritative integration branch/ref: `master`.

Review/integration boundary: normal pull request or equivalent human review, followed by a history-preserving merge commit. Squash and rebase merges are not appropriate for Spiral cycle history because semantic commit hashes are causal evidence.

Pre-merge Spiral validation boundary: before integrating an accepted cycle branch, validate the actual candidate against the current `master` target with:

```text
node .spiral-core/bin/spiral.mjs validate integration --base master --head <candidate> --base-branch master --head-branch <cycle-branch-name>
```

or use a hosting/CI check that validates the exact prospective merged or merge-queue result with branch metadata where available. Active cycle branches must not merge outward; human acceptance should be recorded as `sd:Accepted` before proposing integration. When accepted `master` work is merged into an Active cycle branch, any merge version that combines parallel material revisions of the same governed artifact must explicitly preserve both immediate predecessor lineages with `sd:transforms`. `.github/workflows/spiral-integration.yml` was added in CYC-018 as the repository adapter for pull requests and GitHub merge groups. Repository hosting settings still need to make the check required if it is meant to block merges.

Local validator dependency: the current Spiral CLI requires Python `rdflib` from `.spiral-core/requirements.txt`. This local environment can run validation with a temporary virtual environment whose `bin` directory is first on `PATH`. CI installs the dependency explicitly.

Local validator limitation: `node .spiral-core/bin/spiral.mjs validate` currently scans the `.spiral-core` submodule's own Turtle files and reports duplicate legacy artifact identifiers. Use prospective tree/integration validation for SimplyStore until upstream validator behavior excludes nested process repositories.

Historical-reference validation: `scripts/validate-spiral-provenance.py` uses rdflib and complements the pinned core. Run `--staged` before semantic commits, and `--range <base>..<head>` plus `--tree <head>` for integration. The Node entry point delegates to the same implementation. CI covers both introduced versions and the candidate snapshot. See `docs/spiral-validation.md` for the optional local hook and explicit external process-repository resolution.

Known historical defects: `DEF-20260916-TTZ7C-1` records seven evidence links that originally named artifacts before their creation. Current references are corrected prospectively; raw history audits must continue reporting the invalid old versions.

Local vocabulary: `.spiral/vocabulary.ttl` carries the minimal Spiral relation hierarchy needed for tree-based validation of this consuming repository. Without it, integration validation sees the `.spiral-core` submodule only as a Git gitlink and cannot derive `sd:causalReference` subproperties from the core ontology.

Artifact allocation: new Spiral artifacts after CYC-018 should use distributed-safe IDs allocated by:

```text
node .spiral-core/bin/spiral.mjs allocate <TYPE>
```

Legacy sequential artifact IDs remain valid and should not be renamed. CYC-018 itself was opened with the legacy sequential ID before this core update was adopted. Allocator state is private to each checkout under `.git/spiral`; inspect it with `spiral status`. The historical `09ZEF` artifacts keep their IDs. This checkout allocated the 2026-09-16 corrections in namespace `TTZ7C`; neither namespace is actor identity.

## Intended Users

Primary audience: developers evaluating, using and extending SimplyStore.
For the redesigned UI, first serve developers testing queries and exploring data,
then administrators checking status and performing maintenance. Next support
schema/command work, grants/accounts and audit inspection by developers/admins.
Downstream systems must be able to extend or overhaul the UI simply.

End users of downstream systems remain relevant in their own project contexts.
The roadmap's configurable anonymous query access is a future target requiring
sandbox evaluation, not an assertion of current public deployment safety.

Known downstream project: `slonl/curriculum-store`. Its schema implementation
is the starting point for shared schema information. During the roadmap interview,
local inspection of `data/schema.jsontag`, `src/import.merge.mjs` and
`scripts/tojsontag.mjs` found types, properties, relationships, labels, constraints
and import-time structural checks. Generalizing them requires investigation of
other datasets; this is not evidence of comprehensive validation.

## Current Direction

[ROADMAP.md](../ROADMAP.md), based on the maintainer interview retained in
[SRC-20260919-TTZ7C-43](sources/SRC-20260919-TTZ7C-43.md), is the current broad
product direction. Its order is presentational; **Spiral risk analysis selects
the actual next task**. No implementation cycle was selected in the interview.

The listed outcomes are:

1. Full-history rebuild into a separate dataset, then discoverable Unix-style
   administrative CLI operations with useful help.
2. File-backed retrieval as the sole approach and evaluation of a replacement
   query sandbox. Preserve the remote API; internal data access may change.
3. Recursive per-object history, including deletion and restoration under the
   same ID, with command, author and message information.
4. UI redesign around developer query/exploration tasks, with maintenance and
   grant-controlled administration, and simple downstream customization.
5. UI/file-based schema authoring, personal query/visualization fixtures, and
   in-UI conversation using the user's own AI.
6. Temporary shared workspaces, conflict resolution and optional instance-level
   merge approval by listed accounts.

This is a **revision** of the old immediate sequence. Broader randomized/soak
and filesystem testing, availability improvements, a command IDE, published
fixtures, authoring AI, MCP and automation remain later options. Risk analysis
may bring forward an investigation that reduces important downstream uncertainty.
Keep the project's simplicity constraint central, including future change cost.

SRC-001 / REQ-001 / DES-001 retain the original durability rationale and
invariants. SRC-20260919-TTZ7C-18 / REQ-20260919-TTZ7C-20 refined power-loss and
administrative recovery; that implementation is accepted. DURABILITY.md states
its bounded filesystem evidence. Do not read earlier requests for baseline tests
or recovery implementation as proof that this work is still missing.

Ordinary recovery requires administrator authorization and no later accepted
command with a dataset before an earlier command may rerun. Missing files do
not prove effects did not happen. Preserve original evidence and deliberate
promotion. Full-history rebuilding with selected code and suppressed effects is
separate, still future work. Logged commands must contain all required inputs.

Workspaces must prohibit external effects during workspace execution; accepted
merges may perform them. Actual merge execution versus publication of a validated
replay remains a design investigation, judged by simplicity now and later.
QuickJS/V8 selection, schema generalization and bring-your-own-AI connections
also remain open. The roadmap does not authorize file-format migrations.

Before proposing a cycle, read the roadmap and applicable durability references,
reconcile current effective behavior and accepted evidence, and classify the
proposal as continue, revise or deliberate deviation. Prioritize uncertainty,
downstream leverage, late-discovery cost and cheap falsifiability. Horizon labels
are disposition metadata, not a scoring model or fixed task queue.

Treat unresolved planning suggestions as discourse. Confirm a concrete goal and
an evidenced gap before consequential product changes. The roadmap establishes
direction, not blanket implementation or integration authorization.

## Project Goals And Important Outcomes

| Outcome / metric | Why it matters | Desired/acceptable level | Current evidence / unknown |
|---|---|---|---|
| Production readiness | Current human direction | Improve materially from experimental posture while preserving simplicity; current first bar is developer evaluation confidence for bounded durability claims | Human input / explicit |
| Developer evaluation confidence | Primary production-readiness audience | Developers should be able to evaluate SimplyStore's limited durability claims from invariants, executable tests, evidence artifacts, explicit failure behavior, and documented known gaps | Human input, `REQ-001`, `DES-001`, current durability tests / explicit and evidenced |
| Curriculum-store support | Known downstream context | SimplyStore changes should consider `curriculum-store` as a real environment, without letting it silently define all project priorities | Human input and public lookup / explicit and evidenced |
| Simplicity | Current human direction and project identity | Must remain a shaping constraint while production readiness improves; do not add database/message-bus/event-sourcing machinery without evidence | Human input, README, completed intake / explicit and evidenced |
| Durability proof for ACID claims | Preserve the accepted foundation while extending the system | Retain acknowledged-state, ordering and recovery guarantees within the documented envelope; broader testing is long range | DURABILITY.md, accepted EVD-27/EVD-41, SRC-20260919-TTZ7C-43 |
| Integration into larger systems | Secondary direction after durability | Add minimal lifecycle seams for derived stores and post-commit observers; do not add broad messaging/event machinery without evidence | Human input, `SRC-001` / explicit |
| Usable self-describing API over simple datasets | Stated project purpose | Preserve existing public behavior unless a cycle explicitly justifies and evaluates a breaking change | README, completed intake |
| JSONTag-based semantic data support | Central differentiator | Preserve compatibility expectations unless a cycle explicitly justifies and evaluates a breaking change | README, completed intake |
| Safe query execution | JavaScript queries run against provided data | VM2 is known unsafe; target replacement pending | README |
| Dataset scale expectations | Larger datasets with reduced memory use | File-backed-only direction; exact scale/latency targets remain to be measured | SRC-20260919-TTZ7C-43; maintainer reports favorable tests, not reproduced here |

## Project Posture

Brownfield reusable Node.js library moving from experimental toward
developer-evaluable production readiness. The roadmap builds on accepted bounded
durability evidence while preserving simplicity. Internet-facing queries are a
future evaluation target, not a current deployment-safety claim.

## Important Invariants And Commitments

| Invariant / commitment | Practical meaning | Source/confidence |
|---|---|---|
| Simplicity remains central | Production readiness should not turn SimplyStore into a conventional database, event-sourcing framework, message bus, or broad data platform | Human input / explicit |
| Durable on-disk format must not silently change | Any on-disk format change needs an explicit cycle that treats migration, compatibility, and failure behavior as part of the work | Human input / explicit |
| Remote API compatibility | Preserve the remote interface; internal data-access APIs may change where needed for file-backed retrieval/runtime independence. Do not infer authorization for unrelated public behavior changes. | SRC-20260919-TTZ7C-43 / explicit |
| REST API must not silently change | REST behavior is part of the public integration surface; breaking changes need explicit justification and evaluation | Human input / explicit |
| Existing public data behavior should be preserved by default | Behavior changes need a cycle-level reason and evidence, especially where `curriculum-store` or other downstream users may depend on it | Human input / explicit |
| Durability claims require executable evidence | SimplyStore should survive crashes at any update point and recover, or fail instead of silently using corrupted data | Human input / explicit |
| Production safety must not be overclaimed | VM2 and other known risks remain relevant until explicitly addressed | README, human direction / evidenced |
| Handler phases must not stay implicit | Future after-change handlers, derived stores, and integrity finalizers need explicit mutation permissions and commit semantics | `DES-002` / evidenced |

## Developer Evaluation Readiness Bar

For the current production-readiness phase, a developer evaluating SimplyStore should be able to:

- find the bounded durability invariants and understand what SimplyStore is and is not claiming;
- run focused durability tests locally with ordinary project commands;
- see explicit recovery failures for malformed, missing, truncated, or inconsistent durable artifacts covered so far;
- trace each durability claim to evidence artifacts and code locations;
- see known gaps called out plainly, especially remaining process crash boundaries, filesystem sync assumptions, idempotent retry behavior, VM2 security posture, and larger-system extension seams.

This is not yet a claim that SimplyStore is production-safe for all workloads. It is a claim that production-readiness work is becoming legible and falsifiable to developers.

## Consequential Prior Decisions

| Decision / commitment | Why it still matters | Reversibility / exit cost | Source/confidence |
|---|---|---|---|
| Node.js/Express library | Defines integration surface and runtime | Unknown | `package.json`, README / evidenced |
| Existing in-memory/shared-memory model | Historical implementation; roadmap replaces it with file-backed retrieval only | Internal data access may change; preserve remote API and durability | SRC-20260919-TTZ7C-43 / explicit future direction |
| JavaScript query interface | Core user-facing capability and security concern | Unknown | README / evidenced |
| JSONTag support | Core semantic-data representation | Unknown | README / evidenced |
| VM2 currently used for sandboxing | Known security issue and migration pressure | Intended to replace; exit cost unknown | README, `package.json` / evidenced |
| ACID/durability claims need bounded evidence | Still governs confidence as roadmap features change the runtime | Preserve the documented envelope; risk analysis selects further evidence work | SRC-001, DURABILITY.md, SRC-20260919-TTZ7C-43 |
| Do not add machinery until an invariant or demonstrated use case requires it | Preserves simplicity while adding production evidence | High-level principle; local application must be justified per cycle | `SRC-001` / explicit |

## Core Concepts / Vocabulary

| Term | Meaning | Source/confidence |
|---|---|---|
| SimplyStore | Backend storage server/library with a derived API over in-memory data | README / evidenced |
| curriculum-store | Downstream SimplyStore server with curriculum data, part of the SLO OpenData curriculum context according to human input | Human input, public GitHub/OpenData lookup / explicit and evidenced |
| JSONTag | JSON enhancement that adds metadata with HTML-like tags | README / evidenced |
| JAQT | Query helper library used by SimplyStore examples | README, `package.json` / evidenced |
| Dataspace | Object or array containing the data SimplyStore serves | README / evidenced |

## Active Engineering Culture

| Culture/profile | Version/source | Applicability here | Why active here | Local deviations |
|---|---|---|---|---|
| `CUL-MUZE-001` — Muze Engineering Culture | `.spiral-core/cultures/muze-engineering.md` at submodule commit `8d4b2c738a413abd4cccca740ce958f486e5f7af` | Broad SimplyStore engineering choices | SimplyStore is a Muze-owned software project; principles such as simplicity, correctable boundaries, inspectability, and replaceability match the durability direction | Apply as defeasible preference, not hidden requirement |
| `CUL-MUZE-LIB-001` — Muze Library Stewardship Culture | `.spiral-core/cultures/muze-library-stewardship.md` at submodule commit `8d4b2c738a413abd4cccca740ce958f486e5f7af` | Reusable library/package stewardship | SimplyStore is an `@muze-nl` reusable Node package moving toward production readiness | Apply only where library stewardship concerns fit; do not let package maturity override evidence |

## Active Warning Profiles

| Warning profile | Version/source | Applicability here | Why active here | Local deviations |
|---|---|---|---|---|
| `WPF-HUMAN-001` — Human Impact and Epistemic Warning Profile | `.spiral-core/warning-profiles/human-impact-and-epistemic.md` at submodule commit `8d4b2c738a413abd4cccca740ce958f486e5f7af` | Consequential design, durability, evidence, access, and confidence claims | Durability work depends on evidence quality and avoiding overclaiming production readiness | Apply significance gate; surface concise operational warnings only when material |

## Intake Risk-Discovery Profiles

| Profile / custom lens | Use / exclude / defer | Applicability here | Why |
|---|---|---|---|
| `.spiral-core/profiles/risk-discovery/brownfield-general.md` | Use | Relevant | Existing project adopting Spiral with important legacy behavior and weak characterization |
| `.spiral-core/profiles/risk-discovery/user-facing-interaction.md` | Use, narrowed to API/query/command interaction | Relevant | Query UI and API behavior exist; durability failures can create hard-to-recover user-visible states |

## Intake Metric Profiles

| Profile / custom metric lens | Use / exclude / defer | Applicability here | Why |
|---|---|---|---|
| `.spiral-core/profiles/metrics/exploratory-product.md` | Candidate for intake | Likely relevant | README describes project as experimental |
| `.spiral-core/profiles/metrics/established-service.md` | Defer | Not current posture | SimplyStore is currently being made developer-evaluable, not treated as an established production service |

## Important Current Constraints

| Constraint | Source | Why it matters |
|---|---|---|
| Do not assume production safety | README | VM2 security warning and experimental status affect risk posture |
| Contributions must be MIT licensed | README, LICENSE | Affects accepted external code |

## Important Dependencies / External Systems

| Dependency | Role | Replaceability/constraint | Review scope |
|---|---|---|---|
| Express | HTTP application framework | Unknown | Runtime/API behavior |
| VM2 | Current JavaScript sandbox | Known security concern; planned replacement | Security, query behavior |
| JSONTag packages | Data format support | Core dependency | Parsing/serialization behavior |
| JAQT | Query helper library | Unknown | Query examples and behavior |

## Historical Risk Register — Revalidate Before Selection

The rows below retain earlier investigation snapshots. Several were addressed
by later accepted cycles, particularly durability and recovery. They are not a
current task queue or proof of an outstanding defect. Use current code,
DURABILITY.md, accepted evidence and ROADMAP.md to reassess them before selection.

| Concern | Disposition when recorded | Evidence/source | Historical notes |
|---|---|---|---|
| VM2 has known security issues | Investigate | README | README says to keep SimplyStore away from public access until replacement |
| Durability claims are not yet sufficiently proven | Investigate | Human input, README roadmap, `SRC-001`, `EVD-001` | Active first Spiral cycle area; target is recovery after crashes at any update point or explicit failure rather than silent corrupted-data use |
| Command lifecycle commit boundaries are implicit | Investigate | `EVD-001`, `EVD-006` | First process-level fault boundary is covered; remaining accepted/write/done/status boundaries still need executable fault evidence |
| Durable append promises are no longer fire-and-forget in the command path | Monitor | `IMP-002`, `EVD-006` | Command acceptance and command outcome appends are awaited; deeper filesystem/directory fsync assumptions remain future work |
| Durable artifact corruption classes are only partly classified | Investigate | `DES-001`, `EVD-005` | Status/log parse and required-field failures are explicit; other inconsistency classes remain future work |
| Dirty example/development datasets can now fail startup after missing committed changesets | Defer | Human example test after `CYC-006` | Need a future reset/clean script, and possibly explicit recovery tooling if the project chooses to support repair rather than fail-only behavior |
| Accepted commands can become restart-loop risks when they repeatedly crash during automatic replay | Monitor | `IMP-003`, `EVD-007` | Active command attempts are now recorded durably; after the configured crash threshold, the command is marked `unsafe` and no longer replayed automatically |
| `runNextCommand()` has likely dead worker-termination branch | Defer | Human/code review during `CYC-003` | Final `mainResolve(false)` appears correct; redundant branch should be cleaned in a later behavior-preserving slice |
| Larger-system inclusion options are underdefined | Defer | Human input, `SRC-001` | Secondary direction after durability proof; should start with minimal lifecycle seams |
| Spiral intake can become stale | Monitor | Completed intake, CYC-009 | Reopen if audience, production-readiness target, downstream commitments, or API/disk-format compatibility expectations materially change |
| Command update crash matrix is incomplete | Monitor | Critical review before CYC-010, `DES-001`, `IMP-004`, `EVD-009` | Main process crash matrix now covers acceptance, active, changeset, done, duplicate log, unsafe replay, and normal restart boundaries; filesystem/power-loss and adversarial storage risks remain |
| Non-durability ACID claims lack focused evidence | Monitor | ACID planning check before CYC-011, `design/acid.md`, `IMP-005`, `EVD-010` | Smoke-level tests now cover atomicity, isolation, narrow consistency, and normal duplicate command ID idempotency; broad/domain consistency remains out of scope |
| Corrupted or altered OD-JSONTag durable data can undermine recovery confidence | Monitor | Human direction before CYC-012, `DES-001`, `IMP-006`, `EVD-011` | Malformed/truncated OD-JSONTag record framing in base and committed changeset files now fails explicitly; malformed-framing uncommitted changesets are ignored; full syntax validation and well-formed tampering need future integrity metadata |
| Retried command IDs can mislead clients or enqueue duplicate transitions | Monitor | Original durability order in `SRC-001`, `DES-001`, `IMP-007`, `EVD-012` | Retries during active/done/recovered/unsafe states now return the current command status and do not enqueue duplicate transitions in the tested paths; duplicate payload mismatch semantics remain future API work |
| Legacy index hooks have implicit mutation and external-write semantics | Investigate | `DES-002`, CYC-015 characterization | Current `index.update()` can mutate canonical state, blocks commit on failure, and can leave external derived files behind when it writes before throwing |
| Command and load worker timeouts can leave progress ambiguous without a process crash | Monitor | `DES-003`, `IMP-011`, `EVD-018` | CYC-017 added parent-side command/load worker timeouts. Hanging commands become terminal `unsafe`, duplicate command IDs return that status, later queued commands can commit, and hanging load fails startup explicitly. Timeout defaults and documentation remain future polish. |
| Spiral integration validation is not yet known to be required by repository hosting | Monitor | CYC-018 process update | `.github/workflows/spiral-integration.yml` exists after CYC-018, but branch protection/required-check settings are outside the repository tree and remain unknown. |

## Reliable Feedback / Reality Sources

| Source | What it can tell us | Limits / freshness |
|---|---|---|
| Automated tests | Current intended behavior covered by tests | Coverage unknown |
| README and docs | Stated public intent and usage | May be stale |
| Example app | Demonstrable usage behavior | Representativeness unknown |
| Human maintainer | Purpose, priorities, constraints, and tolerated risks | Intake completed on 2026-08-17; future changes can make it stale |
| `slonl/curriculum-store` | Real downstream usage and proposed integration pressure | Dependency/runtime relationship not yet inspected |
| SLO OpenData curriculum page | Public context for downstream system | Only page existence/context verified; operational details unknown |

## Areas Needing Affinity / Human Guidance

| Area | What is poorly understood | Useful people/sources |
|---|---|---|
| Security posture and VM2 migration | Required replacement strategy and acceptable interim risk | Human maintainer, tests, dependency docs |
| Durability behavior and ACID claim boundary | Which update-cycle phases can crash, how recovery behaves, and how corrupted data is detected or rejected | Human maintainer, tests, code, runtime probes |
| Larger-system integration options | Whether this means embedding, middleware, lifecycle hooks, adapters, package API, deployment modes, or something else | Human maintainer, examples, downstream usage |
| curriculum-store integration | Which SimplyStore guarantees and extension points matter to the known downstream project | Human maintainer, `slonl/curriculum-store`, SLO OpenData context |
| API compatibility expectations | What downstream users depend on | Human maintainer, issues, package consumers |
| Dataset scale/performance expectations | Whether README's 1GB target is current | Human maintainer, benchmarks if present |

## Known Legacy Areas

| Area/capability | Confidence | Notes |
|---|---|---|
| Server runtime and query endpoint | Opaque | Not yet characterized under Spiral |
| Data loading/persistence and command handling | Opaque | Roadmap indicates existing behavior, not yet traced |
| Access control | Opaque | Roadmap marks support complete, details not yet characterized |

## Later Possibilities

Use ROADMAP.md for current later options and scope. Broader testing and
availability, a command IDE, published fixtures, authoring AI, MCP and automation
remain longer range. Existing minimal post-commit/derived-store ideas may support
concrete integration needs without requiring a broad event framework.

## Durable Non-Goals

- Do not turn SimplyStore into a conventional database.
- Do not turn SimplyStore into a general event-sourcing framework.
- Do not implement Kafka, queues, topics, consumer groups, distributed transactions, global schema registry, saga framework, arbitrary transaction manager, or PostgreSQL-like ACID machinery unless future evidence explicitly changes the project direction.
- Do not claim suitability for workloads outside SimplyStore's intended operating envelope.

## Links

- Spiral core instructions: `.spiral-core/AGENTS.md`
- Spiral repository bootstrap prompt: `.spiral-core/prompts/repository-bootstrap.md`
- Brownfield intake docs: `.spiral-core/docs/brownfield-intake.md`
- Durability/extensibility source: `.spiral/sources/SRC-001.md`
- Durability understanding: `.spiral/understandings/UND-001.md`
- Durability request: `.spiral/requests/REQ-001.md`
- Durability invariant design: `.spiral/designs/DES-001.md`
- After-change handler contract direction: `.spiral/designs/DES-002.md`
- Baseline archaeology evidence: `.spiral/evidence/EVD-001.md`
- Durable artifact corruption classification evidence: `.spiral/evidence/EVD-005.md`
- Process crash fault harness evidence: `.spiral/evidence/EVD-006.md`
- Accepted command replay safety evidence: `.spiral/evidence/EVD-007.md`
- Command crash matrix evidence: `.spiral/evidence/EVD-009.md`
- ACID baseline evidence: `.spiral/evidence/EVD-010.md`
- Malformed OD-JSONTag record-framing evidence: `.spiral/evidence/EVD-011.md`
- Retry/idempotency status evidence: `.spiral/evidence/EVD-012.md`
- Spiral core plan-continuity update evidence: `.spiral/evidence/EVD-013.md`
- Legacy index handler lifecycle evidence: `.spiral/evidence/EVD-014.md`
