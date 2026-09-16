#!/usr/bin/env python3
"""Validate versioned Spiral references without forgiving invalid old history."""
import argparse
from functools import lru_cache
import json
from pathlib import Path
import re
import subprocess
import sys

try:
    from rdflib import Graph, Literal, Namespace, URIRef
    from rdflib.namespace import DCTERMS, RDF, RDFS
except ImportError:
    sys.exit('rdflib is required; install .spiral-core/requirements.txt with your Python interpreter')

SD = Namespace('https://muze.nl/ns/spiral-developer#')
EXTERNAL_PREFIXES = (
    'https://muze.nl/ns/spiral-developer/culture/',
    'https://muze.nl/projects/spiral-developer/',
)


class Repository:
    def __init__(self, path):
        self.path = Path(path).resolve()

    @lru_cache(maxsize=None)
    def git(self, *args):
        result = subprocess.run(['git', '-C', str(self.path), *args],
                                capture_output=True, text=True)
        if result.returncode:
            raise ValueError(result.stderr.strip() or 'git command failed')
        return result.stdout

    def commit(self, ref):
        return self.git('rev-parse', '--verify', '--end-of-options', ref + '^{commit}').strip()

    def ancestor(self, older, newer):
        result = subprocess.run(['git', '-C', str(self.path), 'merge-base',
                                 '--is-ancestor', older, newer], capture_output=True)
        if result.returncode not in (0, 1):
            raise ValueError(result.stderr.decode().strip())
        return result.returncode == 0

    def paths(self, revision, external=False):
        if revision == ':':
            paths = self.git('ls-files', '-z').split('\0')
        else:
            paths = self.git('ls-tree', '-r', '--name-only', '-z', revision).split('\0')
        return sorted(p for p in paths if p.endswith('.ttl') and
                      (external or p.startswith('.spiral/')) and
                      'node_modules' not in Path(p).parts)

    def read(self, revision, path):
        return self.git('show', f'{revision.rstrip(":")}:{path}')

    @lru_cache(maxsize=None)
    def graph(self, revision, external=False):
        graph = Graph()
        for path in self.paths(revision, external):
            # Parse documents separately so blank-node IDs cannot collide across files.
            graph += Graph().parse(data=self.read(revision, path), format='turtle',
                                   publicID='urn:spiral:file:' + path)
        return graph

    def exists(self, revision, path):
        # Repository paths must remain repository-relative; fragments are symbols.
        path = path.split('#', 1)[0]
        if not path or Path(path).is_absolute() or '..' in Path(path).parts:
            return False
        try:
            self.git('cat-file', '-e', f'{revision}:{path}')
            return True
        except ValueError:
            return False


class Validator:
    def __init__(self, repo, core):
        self.repo = repo
        self.core = Repository(core)
        self.ontology = Graph().parse(self.core.path / 'ontology/spiral-developer.ttl',
                                      format='turtle')
        self.errors = []
        self.references = 0
        self.documents = 0

    def error(self, code, path, source, message, **details):
        self.errors.append(dict(code=code, path=path, source=source,
                                message=message, **details))

    def properties(self, graph):
        properties = {SD.historicalReference}
        hierarchy = list(self.ontology.subject_objects(RDFS.subPropertyOf))
        hierarchy += list(graph.subject_objects(RDFS.subPropertyOf))
        while True:
            expanded = properties | {child for child, parent in hierarchy if parent in properties}
            if expanded == properties:
                return properties
            properties = expanded

    def core_pin(self, source, staged):
        if staged:
            entry = self.repo.git('ls-files', '--stage', '--', '.spiral-core').strip()
        else:
            entry = self.repo.git('ls-tree', source, '--', '.spiral-core').strip()
        fields = entry.split()
        if not fields or fields[0] != '160000':
            raise ValueError('source version has no pinned .spiral-core gitlink')
        return fields[1] if staged else fields[2]

    def document(self, path, text, source, properties, staged=False):
        self.documents += 1
        try:
            graph = Graph().parse(data=text, format='turtle', publicID='urn:spiral:file:' + path)
        except Exception as exc:
            self.error('invalid-turtle', path, source, str(exc))
            return
        for subject, predicate, node in graph:
            if predicate not in properties:
                continue
            self.references += 1
            targets = list(graph.objects(node, SD.artifact))
            hashes = list(graph.objects(node, SD.gitCommit))
            details = dict(artifact=str(subject), relation=str(predicate))
            if ((node, RDF.type, SD.ArtifactReference) not in graph or
                    len(targets) != 1 or not isinstance(targets[0], URIRef) or
                    len(hashes) != 1 or not isinstance(hashes[0], Literal)):
                self.error('invalid-reference', path, source,
                           'Expected an ArtifactReference with exactly one artifact IRI and Git hash', **details)
                continue
            target, commit = targets[0], str(hashes[0])
            details.update(target=str(target), commit=commit)
            if not re.fullmatch(r'(?:[0-9a-f]{40}|[0-9a-f]{64})', commit):
                self.error('invalid-hash', path, source, 'Expected a full Git hash', **details)
                continue
            external = str(target).startswith(EXTERNAL_PREFIXES)
            target_repo = self.core if external else self.repo
            try:
                resolved = target_repo.commit(commit)
                if resolved != commit:
                    raise ValueError('Hash does not identify the commit itself')
                bound = self.core_pin(source, staged) if external else source
                admissible = target_repo.ancestor(commit, bound)
                if not admissible or (not external and not staged and commit == source):
                    self.error('not-ancestor', path, source,
                               'Target must precede the source (external targets must be in its pinned core)', **details)
                    continue
                historical = target_repo.graph(commit, external=external)
                if not list(historical.objects(target, DCTERMS.identifier)):
                    self.error('missing-artifact', path, source,
                               'Target artifact does not exist at the referenced commit', **details)
                    continue
                locations = list(historical.objects(target, SD.repositoryPath))
                if not locations or any(not target_repo.exists(commit, str(p)) for p in locations):
                    self.error('missing-artifact-path', path, source,
                               'Target artifact has no existing repositoryPath at its commit', **details)
            except Exception as exc:
                self.error('unresolvable-reference', path, source, str(exc), **details)

    def snapshot(self, revision, staged=False):
        revision = ':' if staged else self.repo.commit(revision)
        head = self.repo.commit('HEAD')
        # Validate union syntax before deriving custom relation properties.
        try:
            properties = self.properties(self.repo.graph(revision))
        except Exception as exc:
            self.error('invalid-turtle', '.spiral/', revision, str(exc))
            return
        for path in self.repo.paths(revision):
            text = self.repo.read(revision, path)
            changed = False
            if staged:
                try:
                    changed = text != self.repo.read(head, path)
                except ValueError:
                    changed = True
            if changed:
                source = head
            else:
                source = self.repo.git('log', '-1', '--format=%H', head if staged else revision,
                                       '--', path).strip()
            self.document(path, text, source, properties, staged=changed)

    def history(self, revision_range):
        if '...' in revision_range:
            raise ValueError('Use base..head, not the symmetric-difference base...head range')
        if '..' in revision_range:
            base, head = revision_range.split('..', 1)
            selection = self.repo.commit(base) + '..' + self.repo.commit(head)
        else:
            selection = self.repo.commit(revision_range)
        commits = self.repo.git('rev-list', '--reverse', '--topo-order', selection, '--').splitlines()
        for commit in commits:
            changed = set(self.repo.git('diff-tree', '--root', '-m', '--no-commit-id',
                                       '--name-only', '-r', '-z', commit, '--', '.spiral').split('\0'))
            paths = changed.intersection(self.repo.paths(commit))
            if not paths:
                continue
            try:
                properties = self.properties(self.repo.graph(commit))
            except Exception as exc:
                self.error('invalid-turtle', '.spiral/', commit, str(exc))
                continue
            for path in sorted(paths):
                self.document(path, self.repo.read(commit, path), commit, properties)
        return len(commits)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--repo', default='.')
    parser.add_argument('--core', help='Pinned core checkout; defaults to <repo>/.spiral-core')
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument('--tree', default=None, help='Committed snapshot (default HEAD)')
    mode.add_argument('--staged', action='store_true', help='Validate the Git index before committing')
    mode.add_argument('--range', dest='revision_range', help='Audit base..head, or all history reachable from head')
    args = parser.parse_args()
    try:
        repo = Repository(args.repo)
        repo = Repository(repo.git('rev-parse', '--show-toplevel').strip())
        validator = Validator(repo, args.core or repo.path / '.spiral-core')
        count = None
        if args.revision_range:
            count = validator.history(args.revision_range)
        else:
            validator.snapshot(args.tree or 'HEAD', staged=args.staged)
        result = dict(ok=not validator.errors, scope='range' if args.revision_range else
                      'staged' if args.staged else 'snapshot', documents=validator.documents,
                      references=validator.references, errors=validator.errors)
        if count is not None:
            result['commits'] = count
    except Exception as exc:
        result = dict(ok=False, errors=[dict(code='validation-unavailable', message=str(exc))])
    print(json.dumps(result, indent=2))
    return 0 if result['ok'] else 1


if __name__ == '__main__':
    sys.exit(main())
