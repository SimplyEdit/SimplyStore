# Spiral provenance validation

The pinned core checks graph coherence and prospective integration. The local
validator adds exact target existence and historical ancestry checks using
Python rdflib from `.spiral-core/requirements.txt`.

Initialize the pinned process with `git submodule update --init .spiral-core`,
then use a Python environment with those requirements installed. The existing
Node entry point delegates to Python; set `PYTHON` if it is not `python3` on PATH.

```sh
python3 scripts/validate-spiral-provenance.py                  # committed HEAD
python3 scripts/validate-spiral-provenance.py --staged         # Git index, pre-commit
python3 scripts/validate-spiral-provenance.py --tree HEAD
python3 scripts/validate-spiral-provenance.py --range master..HEAD
python3 test/spiral-provenance.py
node scripts/validate-spiral-provenance.mjs --staged
```

Default validation inspects committed HEAD, not unstaged edits. Stage a proposed
change before `--staged`; references in new/changed staged Turtle may target HEAD,
which becomes an ancestor when committed. Committed references must point to a
strict ancestor of their source artifact version. Every target must have an
artifact definition and an existing repository path at its exact hash.

The project graph is `.spiral/**/*.ttl`; vocabulary files are valid RDF documents
and the process submodule is not merged into this graph. External Muze culture
and Spiral profile references are resolved through `.spiral-core` at the hash
recorded in the source version's gitlink. That checkout must contain the referenced
objects. No network requests or dependency installation happen during validation.

## Before each semantic causal commit

Run `--staged` and `git diff --cached --check`. An optional local hook does the
first check automatically. Inspect existing hooks/configuration before enabling
it; compose with existing hooks rather than overwriting another workflow.

```sh
git config --get core.hooksPath
# When no existing hook setup needs preserving:
git config core.hooksPath scripts/hooks
```

Ensure rdflib is available to the Python interpreter used by the hook (`PYTHON`
or `python3`). Hook configuration belongs to the local checkout and is not shared.

## Integration and history

CI runs the regression tests, checks all introduced Turtle versions, and validates
the candidate snapshot. The pinned core's branch-aware integration check remains
separate and must still pass immediately before integration. Active cycles must
remain blocked until the human accepts them. Revalidate if the target moves.

To audit all retained history, run `--range HEAD`. It intentionally reports old
violations even after later correction. In particular the seven invalid evidence
references documented in `DEF-20260916-TTZ7C-1` remain historical failures. A green
current snapshot is not a claim of pristine history; there is no allowlist that
silences old invalid references.

The local checker does not infer whether a changed implementation needs new
lineage, confirm human intent/acceptance, or prove runtime claims. Those remain
review responsibilities. The pinned core provides identity/coherence/convergence
checks; no SHACL shapes are shipped in this pinned installation.
