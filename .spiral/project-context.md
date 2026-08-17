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

Spiral core source: `.spiral-core/`, git submodule for `https://github.com/muze-labs/spiral-developer.git`, currently checked out at `9958f0e296e84169c21c02aa478ac4aae5a06a41`.

Current active Spiral cycle: `.spiral/cycles/CYC-010.md` (`Command Update Crash Matrix And Reconstruction Oracle`). Latest accepted Spiral cycle: `.spiral/cycles/CYC-009.md` (`Spiral Core Guardrail Update`).

## Intake State

Status: **Complete**

Human-confirmed complete on: 2026-08-17

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

Future work should reopen intake as `Stale` if SimplyStore's audience, production-readiness target, downstream commitments, or API/disk-format compatibility expectations materially change.

## Intended Users

Primary audience: developers using or extending SimplyStore.

Secondary audience: end users interacting with systems built on SimplyStore, including query/command UI users where relevant.

Tertiary audience: operators running SimplyStore-backed systems.

Known from existing README: SimplyStore is a Node.js/Express library for serving in-memory datasets through a derived API and JavaScript query endpoint.

Current known downstream project: `slonl/curriculum-store`, described publicly as a SimplyStore server with curriculum data. Human context says this is part of the SLO OpenData curriculum system at `https://opendata.slo.nl/curriculum/`. Public lookup confirmed the repository and OpenData page exist on 2026-08-17; the exact runtime dependency relationship has not been inspected.

## Current Direction

SimplyStore should become more production ready and less experimental while keeping its focus on simplicity. Production readiness is currently aimed primarily at developers evaluating SimplyStore, secondarily at the `curriculum-store` environment, and later at proposed changes coming from that downstream use.

Known from existing README/roadmap: the project is experimental, should not be treated as production-ready by default, and has a known direction to replace VM2 with a safer isolate-based query runtime.

The first production-readiness priority is proving more of SimplyStore's ACID claims, specifically durability. The durability goal is for SimplyStore to survive crashes at any point in its update cycle and recover, or fail instead of silently using corrupted data.

The current durability/extensibility source is `.spiral/sources/SRC-001.md`. The first ordered slice is baseline archaeology, followed by a crash/fault-injection harness, an independent reconstruction oracle, adversarial storage tests, retry/idempotency hardening, after-change handler contracts, handler failure evidence, optional integrity roots, integrity acceptance tests, property/randomized durability tests, destructive soak tests, a minimal post-commit extension seam, a demonstration derived store, and `DURABILITY.md`.

A later/secondary direction is adding more options for including SimplyStore as part of a larger system. This should happen through minimal lifecycle seams, not by implementing Kafka, queues, topics, consumer groups, webhooks, a message bus, or an event-sourcing framework in SimplyStore core before evidence requires it.

## Project Goals And Important Outcomes

| Outcome / metric | Why it matters | Desired/acceptable level | Current evidence / unknown |
|---|---|---|---|
| Production readiness | Current human direction | Improve materially from experimental posture while preserving simplicity; current first bar is developer evaluation confidence for bounded durability claims | Human input / explicit |
| Developer evaluation confidence | Primary production-readiness audience | Developers should be able to evaluate SimplyStore's limited durability claims from invariants, executable tests, evidence artifacts, explicit failure behavior, and documented known gaps | Human input, `REQ-001`, `DES-001`, current durability tests / explicit and evidenced |
| Curriculum-store support | Known downstream context | SimplyStore changes should consider `curriculum-store` as a real environment, without letting it silently define all project priorities | Human input and public lookup / explicit and evidenced |
| Simplicity | Current human direction and project identity | Must remain a shaping constraint while production readiness improves; do not add database/message-bus/event-sourcing machinery without evidence | Human input, README, completed intake / explicit and evidenced |
| Durability proof for ACID claims | First production-readiness priority | Survive crashes at any point in the update cycle and recover, or fail instead of silently using corrupted data; first work is baseline evidence and crash/fault-injection testing | Human input, README roadmap, `SRC-001` / explicit and evidenced |
| Integration into larger systems | Secondary direction after durability | Add minimal lifecycle seams for derived stores and post-commit observers; do not add broad messaging/event machinery without evidence | Human input, `SRC-001` / explicit |
| Usable self-describing API over simple datasets | Stated project purpose | Preserve existing public behavior unless a cycle explicitly justifies and evaluates a breaking change | README, completed intake |
| JSONTag-based semantic data support | Central differentiator | Preserve compatibility expectations unless a cycle explicitly justifies and evaluates a breaking change | README, completed intake |
| Safe query execution | JavaScript queries run against provided data | VM2 is known unsafe; target replacement pending | README |
| Dataset scale expectations | README states a test goal around 1GB in memory | Unknown; not a current intake driver | README |

## Project Posture

Brownfield reusable Node.js library moving from experimental toward developer-evaluable production readiness. It is not yet an established production service; the current hardening focus is bounded durability evidence and minimal extensibility while preserving simplicity.

## Important Invariants And Commitments

| Invariant / commitment | Practical meaning | Source/confidence |
|---|---|---|
| Simplicity remains central | Production readiness should not turn SimplyStore into a conventional database, event-sourcing framework, message bus, or broad data platform | Human input / explicit |
| Durable on-disk format must not silently change | Any on-disk format change needs an explicit cycle that treats migration, compatibility, and failure behavior as part of the work | Human input / explicit |
| JavaScript query API must not silently change | Query API compatibility matters to developers and downstream users; breaking changes need explicit justification and evaluation | Human input / explicit |
| REST API must not silently change | REST behavior is part of the public integration surface; breaking changes need explicit justification and evaluation | Human input / explicit |
| Existing public data behavior should be preserved by default | Behavior changes need a cycle-level reason and evidence, especially where `curriculum-store` or other downstream users may depend on it | Human input / explicit |
| Durability claims require executable evidence | SimplyStore should survive crashes at any update point and recover, or fail instead of silently using corrupted data | Human input / explicit |
| Production safety must not be overclaimed | VM2 and other known risks remain relevant until explicitly addressed | README, human direction / evidenced |

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
| In-memory data model | Shapes scale, persistence, query behavior, and failure modes | Unknown | README / evidenced |
| JavaScript query interface | Core user-facing capability and security concern | Unknown | README / evidenced |
| JSONTag support | Core semantic-data representation | Unknown | README / evidenced |
| VM2 currently used for sandboxing | Known security issue and migration pressure | Intended to replace; exit cost unknown | README, `package.json` / evidenced |
| ACID/durability claims should be proven before broader production confidence | Current first priority | Must cover crashes at any point in update cycle; exact scenario ordering pending human input | Human input, README roadmap / explicit and evidenced |
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
| `CUL-MUZE-001` — Muze Engineering Culture | `.spiral-core/cultures/muze-engineering.md` at submodule commit `9958f0e296e84169c21c02aa478ac4aae5a06a41` | Broad SimplyStore engineering choices | SimplyStore is a Muze-owned software project; principles such as simplicity, correctable boundaries, inspectability, and replaceability match the durability direction | Apply as defeasible preference, not hidden requirement |
| `CUL-MUZE-LIB-001` — Muze Library Stewardship Culture | `.spiral-core/cultures/muze-library-stewardship.md` at submodule commit `9958f0e296e84169c21c02aa478ac4aae5a06a41` | Reusable library/package stewardship | SimplyStore is an `@muze-nl` reusable Node package moving toward production readiness | Apply only where library stewardship concerns fit; do not let package maturity override evidence |

## Active Warning Profiles

| Warning profile | Version/source | Applicability here | Why active here | Local deviations |
|---|---|---|---|---|
| `WPF-HUMAN-001` — Human Impact and Epistemic Warning Profile | `.spiral-core/warning-profiles/human-impact-and-epistemic.md` at submodule commit `9958f0e296e84169c21c02aa478ac4aae5a06a41` | Consequential design, durability, evidence, access, and confidence claims | Durability work depends on evidence quality and avoiding overclaiming production readiness | Apply significance gate; surface concise operational warnings only when material |

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

## Known / Tolerated Problems And Risks

| Concern | Current disposition | Evidence/source | Notes |
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

- Continue guided brownfield intake as concrete durability, security, API, and downstream questions arise.
- Add a developer/operator script for resetting or cleaning local/example datasets after explicit recovery failures.
- Decide later whether SimplyStore should ever attempt durable artifact recovery/repair, or only provide inspection and reset tooling.
- Characterize the VM2 replacement risk as a candidate early Spiral cycle.
- Extend process-level fault tests around command acceptance, changeset write, status append, and restart recovery.
- Define larger-system integration options after the durability priority is better bounded.
- Produce `DURABILITY.md` only when executable evidence supports the documented claims.

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
- Baseline archaeology evidence: `.spiral/evidence/EVD-001.md`
- Durable artifact corruption classification evidence: `.spiral/evidence/EVD-005.md`
- Process crash fault harness evidence: `.spiral/evidence/EVD-006.md`
- Accepted command replay safety evidence: `.spiral/evidence/EVD-007.md`
- Command crash matrix evidence: `.spiral/evidence/EVD-009.md`
