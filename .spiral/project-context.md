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

Spiral core source: `.spiral-core/`, git submodule for `https://github.com/muze-labs/spiral-developer.git`.

Current active Spiral cycle: none. Latest accepted Spiral cycle: `.spiral/cycles/CYC-003.md` (`Startup Recovery Repair`).

## Intended Users

Pending guided brownfield intake.

Known from existing README: SimplyStore is a Node.js/Express library for serving in-memory datasets through a derived API and JavaScript query endpoint.

## Current Direction

SimplyStore should become more production ready and less experimental while keeping its focus on simplicity.

Known from existing README/roadmap: the project is experimental, should not be treated as production-ready by default, and has a known direction to replace VM2 with a safer isolate-based query runtime.

The first production-readiness priority is proving more of SimplyStore's ACID claims, specifically durability. The durability goal is for SimplyStore to survive crashes at any point in its update cycle and recover, or fail instead of silently using corrupted data.

The current durability/extensibility source is `.spiral/sources/SRC-001.md`. The first ordered slice is baseline archaeology, followed by a crash/fault-injection harness, an independent reconstruction oracle, adversarial storage tests, retry/idempotency hardening, after-change handler contracts, handler failure evidence, optional integrity roots, integrity acceptance tests, property/randomized durability tests, destructive soak tests, a minimal post-commit extension seam, a demonstration derived store, and `DURABILITY.md`.

A later/secondary direction is adding more options for including SimplyStore as part of a larger system. This should happen through minimal lifecycle seams, not by implementing Kafka, queues, topics, consumer groups, webhooks, a message bus, or an event-sourcing framework in SimplyStore core before evidence requires it.

## Project Goals And Important Outcomes

| Outcome / metric | Why it matters | Desired/acceptable level | Current evidence / unknown |
|---|---|---|---|
| Production readiness | Current human direction | Improve materially from experimental posture; exact acceptance pending intake | Human input / explicit |
| Simplicity | Current human direction and project identity | Must remain a shaping constraint while production readiness improves; exact boundaries pending intake | Human input, README / explicit and evidenced |
| Durability proof for ACID claims | First production-readiness priority | Survive crashes at any point in the update cycle and recover, or fail instead of silently using corrupted data; first work is baseline evidence and crash/fault-injection testing | Human input, README roadmap, `SRC-001` / explicit and evidenced |
| Integration into larger systems | Secondary direction after durability | Add minimal lifecycle seams for derived stores and post-commit observers; do not add broad messaging/event machinery without evidence | Human input, `SRC-001` / explicit |
| Usable self-describing API over simple datasets | Stated project purpose | Pending intake | README |
| JSONTag-based semantic data support | Central differentiator | Pending intake | README |
| Safe query execution | JavaScript queries run against provided data | VM2 is known unsafe; target replacement pending | README |
| Dataset scale expectations | README states a test goal around 1GB in memory | Pending intake | README |

## Project Posture

Brownfield library moving from experimental toward production-ready. It should remain simple by design rather than becoming a general-purpose data platform. More precise current posture is pending guided intake.

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
| JSONTag | JSON enhancement that adds metadata with HTML-like tags | README / evidenced |
| JAQT | Query helper library used by SimplyStore examples | README, `package.json` / evidenced |
| Dataspace | Object or array containing the data SimplyStore serves | README / evidenced |

## Active Engineering Culture

| Culture/profile | Version/source | Applicability here | Why active here | Local deviations |
|---|---|---|---|---|
| None explicitly adopted yet | Pending intake | Unknown | Spiral requires explicit adoption | Unknown |

## Active Warning Profiles

| Warning profile | Version/source | Applicability here | Why active here | Local deviations |
|---|---|---|---|---|
| None explicitly adopted yet | Pending intake | Unknown | Spiral requires explicit adoption | Unknown |

## Intake Risk-Discovery Profiles

| Profile / custom lens | Use / exclude / defer | Applicability here | Why |
|---|---|---|---|
| `.spiral-core/profiles/risk-discovery/brownfield-general.md` | Candidate for intake | Likely relevant | Existing project adopting Spiral |
| `.spiral-core/profiles/risk-discovery/user-facing-interaction.md` | Candidate for intake | Possibly relevant | Query UI and API behavior exist |

## Intake Metric Profiles

| Profile / custom metric lens | Use / exclude / defer | Applicability here | Why |
|---|---|---|---|
| `.spiral-core/profiles/metrics/exploratory-product.md` | Candidate for intake | Likely relevant | README describes project as experimental |
| `.spiral-core/profiles/metrics/established-service.md` | Defer unless human says this is service-like | Unknown | Current posture not confirmed |

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
| Command lifecycle commit boundaries are implicit | Investigate | `EVD-001` | Current accepted/done/status/changeset ordering needs executable fault evidence |
| `runNextCommand()` has likely dead worker-termination branch | Defer | Human/code review during `CYC-003` | Final `mainResolve(false)` appears correct; redundant branch should be cleaned in a later behavior-preserving slice |
| Larger-system inclusion options are underdefined | Defer | Human input, `SRC-001` | Secondary direction after durability proof; should start with minimal lifecycle seams |
| Full Spiral intake not complete | Investigate | Current adoption state | Needed before first normal Spiral cycle |

## Reliable Feedback / Reality Sources

| Source | What it can tell us | Limits / freshness |
|---|---|---|
| Automated tests | Current intended behavior covered by tests | Coverage unknown |
| README and docs | Stated public intent and usage | May be stale |
| Example app | Demonstrable usage behavior | Representativeness unknown |
| Human maintainer | Purpose, priorities, constraints, and tolerated risks | Needs guided intake |

## Areas Needing Affinity / Human Guidance

| Area | What is poorly understood | Useful people/sources |
|---|---|---|
| Security posture and VM2 migration | Required replacement strategy and acceptable interim risk | Human maintainer, tests, dependency docs |
| Durability behavior and ACID claim boundary | Which update-cycle phases can crash, how recovery behaves, and how corrupted data is detected or rejected | Human maintainer, tests, code, runtime probes |
| Larger-system integration options | Whether this means embedding, middleware, lifecycle hooks, adapters, package API, deployment modes, or something else | Human maintainer, examples, downstream usage |
| API compatibility expectations | What downstream users depend on | Human maintainer, issues, package consumers |
| Dataset scale/performance expectations | Whether README's 1GB target is current | Human maintainer, benchmarks if present |

## Known Legacy Areas

| Area/capability | Confidence | Notes |
|---|---|---|
| Server runtime and query endpoint | Opaque | Not yet characterized under Spiral |
| Data loading/persistence and command handling | Opaque | Roadmap indicates existing behavior, not yet traced |
| Access control | Opaque | Roadmap marks support complete, details not yet characterized |

## Later Possibilities

- Complete guided brownfield intake.
- Decide whether to adopt a Muze culture profile locally.
- Decide whether to adopt a warning profile.
- Characterize the VM2 replacement risk as a candidate early Spiral cycle.
- Characterize and prove durability behavior as the likely first production-readiness cycle.
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
