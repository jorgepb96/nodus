"""Small, real reaction-index builds; no ORD download or user's index is required."""
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

from rdkit import Chem
import zstandard
import build_index as B


class BuilderRegressions(unittest.TestCase):
    def test_bad_mapping_rows_do_not_crash_worker_initialization(self):
        with tempfile.TemporaryDirectory() as tmp:
            maps = Path(tmp, 'maps.jsonl')
            rows = [None, [], {'key': [], 'mapped': 'CC>>CO'},
                    {'key': 'bad', 'mapped': 'CC>>CO', 'confidence': None},
                    {'key': 'bad', 'mapped': 'CC>>CO', 'confidence': 'NaN'},
                    {'key': 'below', 'mapped': 'CC>>CO', 'confidence': 0.1},
                    {'key': 'good', 'mapped': 'CC>>CO', 'confidence': 0.8}]
            maps.write_text('broken JSON\n' + '\n'.join(json.dumps(row) for row in rows))
            self.assertEqual(B._load_extra_mapped(str(maps), 0.4), {'good': 'CC>>CO'})

    def test_repaired_template_must_recover_every_contributor(self):
        retro = '[C:1](=[O:2])[O:3][C:4]>>[C:1](=[O:2])[OH:3].[CH3:4][OH]'
        product = '[CH3:5][C:1](=[O:2])[O:3][CH3:4]'
        wrong = '[CH3:5][C:1](=[O:2])[OH:3].[CH3:6][CH2:4]O'
        right = '[CH3:5][C:1](=[O:2])[OH:3].[CH3:4]O'
        self.assertFalse(B._template_reproduces(retro, wrong, product),
                         'a correct acid cannot validate the wrong alcohol')
        self.assertTrue(B._template_reproduces(retro, right, product))
        self.assertTrue(B._template_reproduces(retro, right + '.Cl.[Na+]', product),
                        'spectators do not need to be regenerated')
        self.assertFalse(B._template_reproduces('invalid', right, product))

    def test_checkpoint_changes_for_map_content_and_confidence(self):
        with tempfile.TemporaryDirectory() as tmp:
            source = Path(tmp, 'source.rsmi')
            source.write_text('unchanged source')
            maps = Path(tmp, 'maps.jsonl')
            maps.write_text('first maps')
            B.configure_mapping(None, 0.0)
            unmapped = B.part_name(str(source), 0)
            B.configure_mapping(str(maps), 0.0)
            mapped = B.part_name(str(source), 0)
            self.assertNotEqual(unmapped, mapped)
            B.configure_mapping(str(maps), 0.5)
            self.assertNotEqual(mapped, B.part_name(str(source), 0))
            maps.write_text('corrected maps')
            B._FILE_DIGESTS.pop(str(maps), None)  # a new build process starts with an empty cache
            B.configure_mapping(str(maps), 0.0)
            self.assertNotEqual(mapped, B.part_name(str(source), 0))

    def test_checkpoint_discovery_and_workers_use_the_same_configuration(self):
        with tempfile.TemporaryDirectory() as tmp:
            source = Path(tmp, 'source.rsmi')
            source.write_text('source')
            maps = Path(tmp, 'maps.jsonl')
            maps.write_text('{}\n')
            B._TEMPLATE_THRESHOLD = 87
            B.configure_mapping(str(maps), 0.4)
            expected = B.part_name(str(source), 2)
            digests = dict(B._FILE_DIGESTS)
            code = ('import build_index as B; '
                    f'B.init_worker({tmp!r}, 87, {digests!r}, extra_mapped={str(maps)!r}, map_floor=0.4); '
                    f'print(B.part_name({str(source)!r}, 2))')
            actual = subprocess.check_output([sys.executable, '-c', code],
                                             cwd=Path(B.__file__).parent, text=True).strip()
            self.assertEqual(actual, expected)

    def test_real_rebuild_reacts_to_added_maps_and_preserves_the_legacy_reader(self):
        with tempfile.TemporaryDirectory() as tmp:
            source = Path(tmp, 'fixture.rsmi')
            source.write_text('ReactionSmiles\tPatentNumber\tParagraphNum\n'
                              + 'CCO>>CC=O\tfixture\t1\n' * 5)
            out = Path(tmp, 'index')
            maps = Path(tmp, 'maps.jsonl')
            key = hashlib.sha1(b'CCO>>CC=O').hexdigest()[:32]
            maps.write_text(json.dumps({'key': key, 'mapped': '[CH3:1][CH2:2][OH:3]>>[CH3:1][CH:2]=[O:3]',
                                        'confidence': 1.0}) + '\n')
            args = [sys.executable, B.__file__, '--root', tmp, '--rsmi', str(source),
                    '--out', str(out), '--workers', '1', '--no-fp', '--interval', '0.05']

            def build(extra=()):
                subprocess.run(args + list(extra), check=True, capture_output=True, text=True, timeout=60)
                return json.loads((out / 'manifest.json').read_text())

            def lines(name):
                with zstandard.ZstdDecompressor().stream_reader(open(out / name, 'rb')) as stream:
                    return stream.read().decode().splitlines()

            first = build()
            self.assertEqual(first['extraMappedUsed'], 0)
            self.assertEqual(lines('retro-templates.tsv.zst'), [])
            second = build(['--extra-mapped', str(maps)])
            self.assertEqual(second['extraMappedUsed'], 5)
            rows = lines('retro-templates.tsv.zst')
            self.assertTrue(rows)
            # This is the installed plugin's existing three-way split, including its SMARTS parse.
            for row in rows:
                count, rdchiral, smarts = row.split('\t', 2)
                self.assertEqual((int(count), int(rdchiral)), (5, 5))
                self.assertIsNotNone(Chem.MolFromSmarts(smarts.split('>>')[0]))
            radii = dict(row.split('\t', 1)[::-1] for row in lines('template-radii.tsv.zst'))
            self.assertTrue(all(row.split('\t', 2)[2] in radii for row in rows))
            self.assertEqual(second['templateColumns'], ['count', 'rdchiral', 'smarts'])
            self.assertEqual(second['extraMappedSha256'], hashlib.sha256(maps.read_bytes()).hexdigest())
            self.assertIn('template-radii.tsv.zst', second['files'])
            self.assertTrue(lines('forward-templates.tsv.zst'))
            third = build(['--extra-mapped', str(maps), '--map-confidence', '1.1'])
            self.assertEqual(third['extraMappedUsed'], 0)
            self.assertEqual(lines('retro-templates.tsv.zst'), [])
            parts = set(os.listdir(out / 'parts'))
            self.assertEqual(len(parts), 3)
            build(['--extra-mapped', str(maps), '--map-confidence', '1.1'])
            self.assertEqual(set(os.listdir(out / 'parts')), parts, 'identical inputs reuse checkpoints')


if __name__ == '__main__':
    unittest.main()
