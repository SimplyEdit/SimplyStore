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

## Local Adoption State

SimplyStore is a brownfield project. The durable project context exists at:

```text
.spiral/project-context.md
```

The full guided brownfield intake has not been completed yet. Before the next normal Spiral development cycle, establish and confirm the missing project frame with the human, then compare that frame with repository/runtime evidence and ask the human to prioritize candidate risks or gaps.

Do not create Spiral artifacts merely to populate folders. Add `.spiral/` artifacts and companion Turtle resources only when they are causally useful for an actual cycle, decision, implementation, evidence, acceptance, or lesson.

## Working Defaults

- Treat `master` as the authoritative branch unless the human states otherwise.
- For ordinary repository-changing Spiral cycle work, create one dedicated branch from the authoritative branch, normally `spiral/CYC-###-short-goal`.
- Preserve Git history as evidence. Do not amend, rebase, squash, reset, or force-push causal cycle history.
- Before consequential product changes from direct human input, present the Spiral checkpoint: **My understanding / Current effective behavior / Evidenced gap / Material assumptions**, then wait for confirmation or correction.
- Keep brownfield investigation proportional. Learn enough about the relevant behavior before changing it, and separate explicit, evidenced, inferred, and unknown knowledge.
