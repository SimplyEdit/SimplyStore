"""Regression tests for historical provenance checks using disposable Git histories."""
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
VALIDATOR = ROOT / 'scripts/validate-spiral-provenance.py'
CORE = ROOT / '.spiral-core'
PREFIXES = '''@prefix p: <urn:test:> .
@prefix s: <https://muze.nl/ns/spiral-developer#> .
@prefix d: <http://purl.org/dc/terms/> .
'''


def artifact(name, reference=''):
    return PREFIXES + f'''p:{name} a s:Design; d:identifier "{name}";
        s:repositoryPath ".spiral/{name}.md" {reference} .
'''


def reference(target, commit, predicate='s:derivedFrom'):
    return f'''; {predicate} [ a s:ArtifactReference;
        s:artifact p:{target}; s:gitCommit "{commit}" ]'''


class ProvenanceTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(prefix='spiral-provenance-test-')
        self.addCleanup(self.tmp.cleanup)
        self.repo = Path(self.tmp.name)
        self.git('init', '-b', 'main')
        self.git('config', 'user.name', 'Spiral test')
        self.git('config', 'user.email', 'spiral-test@example.invalid')
        self.git('config', 'commit.gpgsign', 'false')
        self.git('config', 'core.hooksPath', '/dev/null')
        self.write('A', artifact('A'))
        self.base = self.commit()

    def git(self, *args):
        return subprocess.check_output(['git', '-C', str(self.repo), *args],
                                       stderr=subprocess.PIPE, text=True).strip()

    def write(self, name, text):
        (self.repo / '.spiral').mkdir(exist_ok=True)
        (self.repo / f'.spiral/{name}.ttl').write_text(text)
        (self.repo / f'.spiral/{name}.md').write_text(name)

    def commit(self):
        self.git('add', '.')
        self.git('commit', '-m', 'fixture')
        return self.git('rev-parse', 'HEAD')

    def validate(self, *args, ok=True):
        result = subprocess.run([sys.executable, str(VALIDATOR), '--repo', str(self.repo),
                                 '--core', str(CORE), *args], capture_output=True, text=True)
        data = json.loads(result.stdout)
        self.assertEqual(data['ok'], ok, data)
        self.assertEqual(result.returncode, 0 if ok else 1, data)
        return data

    def assert_code(self, code, *args):
        data = self.validate(*args, ok=False)
        self.assertIn(code, [e['code'] for e in data['errors']], data)
        return data

    def test_valid_vocabulary_and_custom_relation(self):
        self.write('vocabulary', PREFIXES + '''@prefix r: <http://www.w3.org/2000/01/rdf-schema#> .
            p:reason r:subPropertyOf s:derivedFrom .''')
        self.write('B', artifact('B', reference('A', self.base, 'p:reason')))
        self.commit()
        result = self.validate()
        self.assertEqual(result['references'], 1)
        self.validate('--range', self.base + '..HEAD')

    def test_staged_head_reference_allowed(self):
        self.write('B', artifact('B', reference('A', self.base)))
        self.git('add', '.')
        self.validate('--staged')
        self.commit()
        self.validate()

    def test_index_is_independent_of_unstaged_files(self):
        self.write('B', artifact('B', reference('A', self.base)))
        self.git('add', '.')
        self.write('B', 'invalid turtle')
        self.validate('--staged')
        self.git('add', '.')
        self.assert_code('invalid-turtle', '--staged')

    def test_valid_unstaged_repair_does_not_hide_bad_index(self):
        self.write('B', artifact('B', reference('MISSING', self.base)))
        self.git('add', '.')
        self.write('B', artifact('B', reference('A', self.base)))
        self.assert_code('missing-artifact', '--staged')

    def test_short_hash_fails(self):
        self.write('B', artifact('B', reference('A', self.base[:7])))
        self.commit()
        self.assert_code('invalid-hash')

    def test_missing_target_at_exact_version(self):
        self.write('B', artifact('B', reference('C', self.base)))
        self.write('C', artifact('C'))
        self.commit()
        self.assert_code('missing-artifact')

    def test_missing_artifact_path_fails(self):
        (self.repo / '.spiral/A.md').unlink()
        missing = self.commit()
        self.write('B', artifact('B', reference('A', missing)))
        self.commit()
        self.assert_code('missing-artifact-path')

    def test_sibling_commit_is_not_an_ancestor(self):
        self.git('checkout', '-b', 'other')
        self.write('C', artifact('C'))
        sibling = self.commit()
        self.git('checkout', 'main')
        self.write('B', artifact('B', reference('C', sibling)))
        self.commit()
        self.assert_code('not-ancestor')

    def test_unknown_commit_fails(self):
        self.write('B', artifact('B', reference('A', 'f' * 40)))
        self.commit()
        self.assert_code('unresolvable-reference')

    def test_multiple_reference_targets_fail(self):
        ref = reference('A', self.base).replace('p:A;', 'p:A, p:B;')
        self.write('B', artifact('B', ref))
        self.commit()
        self.assert_code('invalid-reference')

    def test_repaired_intermediate_version_still_fails_range(self):
        self.write('B', artifact('B', reference('MISSING', self.base)))
        bad = self.commit()
        self.write('B', artifact('B', reference('A', self.base)))
        self.commit()
        self.validate()
        result = self.assert_code('missing-artifact', '--range', self.base + '..HEAD')
        self.assertEqual(result['errors'][0]['source'], bad)
        self.assert_code('missing-artifact', '--range', 'HEAD')

    def test_deleted_intermediate_version_still_fails_range(self):
        self.write('B', artifact('B', reference('MISSING', self.base)))
        self.commit()
        (self.repo / '.spiral/B.ttl').unlink()
        (self.repo / '.spiral/B.md').unlink()
        self.commit()
        self.validate()
        self.assert_code('missing-artifact', '--range', self.base + '..HEAD')

    def test_merge_versions_are_checked(self):
        self.git('checkout', '-b', 'other')
        self.write('B', artifact('B', reference('A', self.base)))
        self.commit()
        self.git('checkout', 'main')
        self.write('C', artifact('C'))
        self.commit()
        self.git('merge', '--no-ff', 'other', '-m', 'merge fixture')
        self.validate('--range', self.base + '..HEAD')

    def test_process_submodule_not_parsed_as_project(self):
        (self.repo / '.spiral-core').mkdir()
        (self.repo / '.spiral-core/bad.ttl').write_text('invalid turtle')
        self.commit()
        self.validate()

    def test_external_reference_uses_source_core_pin(self):
        core_hash = subprocess.check_output(['git', '-C', str(CORE), 'rev-parse', 'HEAD'],
                                            text=True).strip()
        self.git('update-index', '--add', '--cacheinfo', '160000', core_hash, '.spiral-core')
        self.git('commit', '-m', 'pin process')
        target = 'https://muze.nl/ns/spiral-developer/culture/CUL-MUZE-001'
        ref = reference('A', core_hash, 's:adoptsCulture').replace('p:A;', '<' + target + '>;')
        self.write('B', artifact('B', ref))
        # Do not git add the empty gitlink path: preserve the explicit pin in the index.
        self.git('add', '.spiral')
        self.git('commit', '-m', 'adopt culture')
        self.validate()
        self.write('B', artifact('B', ref.replace(core_hash, 'f' * 40)))
        self.git('add', '.spiral')
        self.assert_code('unresolvable-reference', '--staged')

    def test_external_reference_requires_a_pin(self):
        core_hash = subprocess.check_output(['git', '-C', str(CORE), 'rev-parse', 'HEAD'],
                                            text=True).strip()
        ref = reference('A', core_hash, 's:adoptsCulture').replace(
            'p:A;', '<https://muze.nl/ns/spiral-developer/culture/CUL-MUZE-001>;')
        self.write('B', artifact('B', ref))
        self.commit()
        self.assert_code('unresolvable-reference')


if __name__ == '__main__':
    unittest.main()
