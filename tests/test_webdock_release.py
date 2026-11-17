import importlib.util
import json
from pathlib import Path
import tempfile
import unittest

spec = importlib.util.spec_from_file_location('webdock_release', Path(__file__).parents[1] / 'scripts/webdock-release.py')
release_helper = importlib.util.module_from_spec(spec)
spec.loader.exec_module(release_helper)
FIRST = 'a' * 40 + '-1-1'
SECOND = 'b' * 40 + '-2-1'


class ReleaseTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name).resolve() / 'deploy'

    def build(self, release):
        release_helper.operate(self.root, 'stage', release)
        directory = self.root / 'releases' / release
        (directory / 'index.html').write_text('<html>Built site</html>')
        (directory / 'assets').mkdir()
        (directory / '_deployment.json').write_text(json.dumps({'release': release, 'commit': release.split('-')[0]}))
        return directory

    def test_stage_preserves_live_only_files(self):
        live = self.root / 'legacy-live-site'
        live.mkdir(parents=True)
        (live / 'untracked-upload.txt').write_text('Preserve me')
        (self.root / 'current').symlink_to(live)
        self.build(FIRST)
        self.assertEqual((self.root / 'current').resolve(), live)
        self.assertEqual((live / 'untracked-upload.txt').read_text(), 'Preserve me')

    def test_publish_keeps_previous_and_rollback_restores_it(self):
        first = self.build(FIRST)
        release_helper.operate(self.root, 'publish', FIRST)
        second = self.build(SECOND)
        release_helper.operate(self.root, 'publish', SECOND)
        self.assertEqual((self.root / 'current').resolve(), second)
        self.assertEqual((self.root / 'previous').resolve(), first)
        release_helper.operate(self.root, 'rollback', SECOND)
        self.assertEqual((self.root / 'current').resolve(), first)
        self.assertTrue(second.exists())

    def test_refuses_to_replace_existing_webroot_directory(self):
        self.build(FIRST)
        (self.root / 'current').mkdir()
        original = self.root / 'current' / 'untracked-upload.txt'
        original.write_text('Preserve me')
        with self.assertRaises(ValueError):
            release_helper.operate(self.root, 'publish', FIRST)
        self.assertEqual(original.read_text(), 'Preserve me')

    def test_incomplete_or_mismatched_build_cannot_publish(self):
        release_helper.operate(self.root, 'stage', FIRST)
        with self.assertRaises(ValueError):
            release_helper.operate(self.root, 'publish', FIRST)
        self.assertFalse((self.root / 'current').exists())
        directory = self.build(SECOND)
        (directory / '_deployment.json').write_text(json.dumps({'release': FIRST}))
        with self.assertRaises(ValueError):
            release_helper.operate(self.root, 'publish', SECOND)
        self.assertFalse((self.root / 'current').exists())

    def test_rollback_does_not_overwrite_a_newer_release(self):
        self.build(FIRST)
        self.build(SECOND)
        release_helper.operate(self.root, 'publish', SECOND)
        release_helper.operate(self.root, 'publish', FIRST)
        with self.assertRaises(ValueError):
            release_helper.operate(self.root, 'rollback', SECOND)
        self.assertEqual((self.root / 'current').resolve(), self.root / 'releases' / FIRST)

    def test_rejects_path_traversal_and_duplicate_release_ids(self):
        with self.assertRaises(ValueError):
            release_helper.operate(self.root, 'stage', '../../live')
        self.build(FIRST)
        with self.assertRaises(FileExistsError):
            release_helper.operate(self.root, 'stage', FIRST)

    def test_existing_previous_file_is_preserved(self):
        self.build(FIRST)
        release_helper.operate(self.root, 'publish', FIRST)
        self.build(SECOND)
        (self.root / 'previous').write_text('Preserve me')
        with self.assertRaises(ValueError):
            release_helper.operate(self.root, 'publish', SECOND)
        self.assertEqual((self.root / 'previous').read_text(), 'Preserve me')
        self.assertEqual((self.root / 'current').resolve(), self.root / 'releases' / FIRST)

    def test_first_publish_can_be_rolled_back_without_removing_files(self):
        first = self.build(FIRST)
        release_helper.operate(self.root, 'publish', FIRST)
        release_helper.operate(self.root, 'rollback', FIRST)
        self.assertFalse((self.root / 'current').is_symlink())
        self.assertTrue(first.exists())


if __name__ == '__main__':
    unittest.main()
