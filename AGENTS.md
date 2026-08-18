# SimplyStore Agent Instructions

This repository uses Spiral Developer as its development methodology.

## Spiral Core

The Spiral Developer process is vendored as a git submodule at:

```text
.spiral-core/
```

Before planning or performing consequential repository-changing work, read:

1. `.spiral-core/AGENTS.md`
2. `.spiral/project-context.md`
3. the specific Spiral docs referenced by `.spiral-core/AGENTS.md` for the work at hand

For initial or reframed brownfield work, also read:

- `.spiral-core/prompts/repository-bootstrap.md`
- `.spiral-core/docs/brownfield-intake.md`
- `.spiral-core/prompts/brownfield-intake.md`
- `.spiral-core/docs/distributed-development.md`

The currently adopted `.spiral-core` version is recorded in `.spiral/project-context.md`.

## Local Adoption State

SimplyStore is a brownfield project. The durable project context exists at:

```text
.spiral/project-context.md
```

The full guided brownfield intake is complete and human-confirmed as of 2026-08-17. Reopen intake only when `.spiral/project-context.md` says it is `Stale` or when the audience, production-readiness target, downstream commitments, or API/disk-format compatibility expectations materially change.

SimplyStore has a governing durability/extensibility direction in:

- `.spiral/sources/SRC-001.md`
- `.spiral/requests/REQ-001.md`
- `.spiral/designs/DES-001.md`

Before proposing a next durability/production-readiness cycle, re-read those durable references, identify the current position in the ordered plan, reconcile the latest evidence with that plan, and state whether the proposal continues, revises, or deliberately deviates from it.

Do not create Spiral artifacts merely to populate folders. Add `.spiral/` artifacts and companion Turtle resources only when they are causally useful for an actual cycle, decision, implementation, evidence, acceptance, or lesson.

## Working Defaults

- Treat `master` as the authoritative branch unless the human states otherwise.
- For ordinary repository-changing Spiral cycle work, create one dedicated branch from the authoritative branch, normally `spiral/CYC-###-short-goal`.
- For new Spiral artifacts after CYC-018, use distributed-safe IDs allocated by `node .spiral-core/bin/spiral.mjs allocate <TYPE>` instead of scanning for the next legacy number. Existing `SRC-001` / `CYC-017` style IDs remain valid historical artifacts and must not be renamed.
- Before allocating a new artifact ID, check `node .spiral-core/bin/spiral.mjs status`. This checkout has worktree-local allocator state under `.git/spiral`; other clones/worktrees will have their own namespace.
- Preserve Git history as evidence. Do not amend, rebase, squash, reset, or force-push causal cycle history.
- Before proposing or merging accepted cycle work, run `node .spiral-core/bin/spiral.mjs validate integration --base <current-master> --head <candidate>`, or rely on a hosting check that validates the exact prospective merged result.
- The Spiral validator requires Python `rdflib` from `.spiral-core/requirements.txt`. Local worktree validation currently sees `.spiral-core`'s own Turtle files because the process is installed as a submodule, so prefer tree/prospective-integration validation until upstream validator behavior excludes nested process repositories.
- Treat planning, evaluation, and ambiguous human suggestions as discourse until there is an explicit commitment. Do not turn tentative comments into scope or architecture merely because they are implementable.
- Treat human confirmation of a sufficiently explicit cycle goal as the commitment boundary for execution within that goal and its non-goals.
- Surface material ambiguity, contradiction, unsupported premise, or alternative framing before commitment when resolving it differently would plausibly change what is built, tested, accepted, or treated as the problem.
- Before consequential product changes from direct human input, present the Spiral checkpoint: **My understanding / Current effective behavior / Evidenced gap / Material assumptions**, then wait for confirmation or correction.
- When a governing multi-cycle plan exists, do not choose the next cycle from the newest discovery alone; explicitly classify the next proposal as `continue`, `revise`, or `deliberate deviation`.
- When risk influences the next cycle, prefer reducing uncertain assumptions with high downstream leverage, high late-discovery cost, and cheap falsifiability. Use blocker/near-term/deferred/existential horizons as disposition metadata, not as a substitute for leverage reasoning.
- Keep brownfield investigation proportional. Learn enough about the relevant behavior before changing it, and separate explicit, evidenced, inferred, and unknown knowledge.
