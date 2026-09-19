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

The maintainer refined that direction on 2026-09-19 in:

- `.spiral/sources/SRC-20260919-TTZ7C-18.md`
- `.spiral/understandings/UND-20260919-TTZ7C-19.md`
- `.spiral/requests/REQ-20260919-TTZ7C-20.md`

Read this refinement alongside the original direction. It requires an
administrative recovery path, complete logged command inputs, and ordered rerun
eligibility; it records separate new-store rebuild semantics without making
full rebuild tooling part of the current power-loss cycle.

Before proposing a next durability/production-readiness cycle, re-read those durable references, identify the current position in the ordered plan, reconcile the latest evidence with that plan, and state whether the proposal continues, revises, or deliberately deviates from it.

Do not create Spiral artifacts merely to populate folders. Add `.spiral/` artifacts and companion Turtle resources only when they are causally useful for an actual cycle, decision, implementation, evidence, acceptance, or lesson.

## Working Defaults

- Always use braces for control-flow bodies, including single-statement `if`, `else`, and loop bodies. Start block contents on the line after `{`, and put the closing `}` on its own line. This includes empty blocks and callbacks; `else`, `catch`, and `finally` start on the next line after `}`.

- Prefer `if`/`else` to `?:` unless a short conditional expression clearly improves readability.
- Aim for code lines no wider than about 80 characters; allow exceptions when wrapping would reduce readability.
- Prefer named intermediate results over dense chains of operations. Use the existing JAQT library where it makes data selection and projection clearer; keep straightforward operations simple.
- Treat `master` as the authoritative branch unless the human states otherwise.
- For ordinary repository-changing Spiral cycle work, create one dedicated branch from the authoritative branch, normally `spiral/CYC-###-short-goal`.
- For new Spiral artifacts after CYC-018, use distributed-safe IDs allocated by `node .spiral-core/bin/spiral.mjs allocate <TYPE>` instead of scanning for the next legacy number. Existing `SRC-001` / `CYC-017` style IDs remain valid historical artifacts and must not be renamed.
- Before allocating a new artifact ID, check `node .spiral-core/bin/spiral.mjs status`. This checkout has worktree-local allocator state under `.git/spiral`; other clones/worktrees will have their own namespace.
- Preserve Git history as evidence. Do not amend, rebase, squash, reset, or force-push causal cycle history.
- An Active cycle branch must not merge into `master` or another Active cycle branch. Record human acceptance by changing the cycle to `sd:Accepted` before proposing integration.
- Human acceptance closes the cycle and authorizes proposing it for integration; it does not authorize merging it. Treat integration as a separate review and decision boundary. After recording acceptance and validating the accepted commit, stop and present the pull request or equivalent integration proposal unless the human has explicitly authorized the merge. When authorized, integrate with a normal merge commit.
- Before proposing or merging accepted cycle work, run `node .spiral-core/bin/spiral.mjs validate integration --base <current-master> --head <candidate> --base-branch master --head-branch <cycle-branch-name>`, or rely on a hosting check that validates the exact prospective merged result with branch metadata.
- When accepted `master` work is merged into an Active cycle branch, prefer `git merge --no-commit master` if governed artifacts may have changed on both sides. If both parent histories materially changed the same governed artifact, reconcile the merge version and record both immediate predecessor versions with `sd:transforms`.
- Before every semantic causal commit, run `python3 scripts/validate-spiral-provenance.py --staged` (or the Node entry point with `PYTHON` set) and `git diff --cached --check`. The optional hook in `scripts/hooks/pre-commit` runs staged validation; see `docs/spiral-validation.md` before installing it.
- Before integration, also run `python3 scripts/validate-spiral-provenance.py --range <base>..<head>` and `--tree <head>`. This complements the core integration check with target-existence and per-commit historical-reference validation. Old corrected violations must remain visible in raw history audits.
- The Spiral validator requires Python `rdflib` from `.spiral-core/requirements.txt`. Local worktree validation currently sees `.spiral-core`'s own Turtle files because the process is installed as a submodule, so prefer tree/prospective-integration validation until upstream validator behavior excludes nested process repositories.
- Treat planning, evaluation, and ambiguous human suggestions as discourse until there is an explicit commitment. Do not turn tentative comments into scope or architecture merely because they are implementable.
- Treat human confirmation of a sufficiently explicit cycle goal as the commitment boundary for execution within that goal and its non-goals.
- Surface material ambiguity, contradiction, unsupported premise, or alternative framing before commitment when resolving it differently would plausibly change what is built, tested, accepted, or treated as the problem.
- Before consequential product changes from direct human input, present the Spiral checkpoint: **My understanding / Current effective behavior / Evidenced gap / Material assumptions**, then wait for confirmation or correction.
- When a governing multi-cycle plan exists, do not choose the next cycle from the newest discovery alone; explicitly classify the next proposal as `continue`, `revise`, or `deliberate deviation`.
- When risk influences the next cycle, prefer reducing uncertain assumptions with high downstream leverage, high late-discovery cost, and cheap falsifiability. Use blocker/near-term/deferred/existential horizons as disposition metadata, not as a substitute for leverage reasoning.
- Keep brownfield investigation proportional. Learn enough about the relevant behavior before changing it, and separate explicit, evidenced, inferred, and unknown knowledge.
