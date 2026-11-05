import importlib.util
import hashlib
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

SCRIPT = Path(__file__).resolve().parents[1] / 'scripts/build_rpf_overlay.py'
spec = importlib.util.spec_from_file_location('rpf_saved_export', SCRIPT)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class SavedRpfExport(unittest.TestCase):
    def test_binding_export_preserves_original_scientific_bytes_and_refuses_changed_inputs(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            site, cohort, config = [root / n for n in ('site', 'cohort', 'config')]
            for path in (site, cohort, config):
                path.mkdir()
            original = site / 'existing-native.pdb'
            original.write_bytes(b'RETAINED SCIENTIFIC BYTES\n')
            identities = [dict(model_id='source-' + str(i), method='afsample3' if i < 1000 else 'bioemu2') for i in range(2000)]
            payload = dict(target=module.TARGET, score_context='independent_single_model', models=identities,
                           provenance={key:'reference' for key in ('rpf_snapshot_sha256', 'scientific_review_sha256', 'native_rpf_binary_sha256')})
            scores = root / 'scores.json';scores.write_text(json.dumps(payload))
            pin = dict(source_payload_sha256=module.sha(scores), **payload['provenance'])
            (config / 'sr215-rpf-source.json').write_text(json.dumps(pin))
            table = root / 'scores.csv';table.write_bytes(b'model_id,dp\n')
            for stem in ('violin', 'ptm'):
                for suffix in ('.svg', '.png'):
                    (root / (stem + suffix)).write_bytes(b'reviewed-figure')
            manifest = {}
            ranges = {}
            for region in module.RANGES:
                views = []
                for view in ('primary', 'density'):
                    data = dict(target=module.TARGET, view_id=view, cohort_id=module.COHORT,
                                clustering_positions=module.POSITIONS[region], models=[r['model_id'] for r in identities])
                    name = f'rpf-sr215/{region}/{view}.json';path=cohort/name;path.parent.mkdir(parents=True,exist_ok=True)
                    path.write_text(json.dumps(data));manifest[name]=dict(sha256=module.sha(path),bytes=path.stat().st_size)
                    old_name=f'old-{region}-{view}.json';(site/old_name).write_text(json.dumps(dict(models=data['models']+['unscored'],range_id=region,view_id=view)))
                    views.append(dict(id=view,data=old_name,available=True))
                ranges[region]=dict(id=region,views=views)
            (site/'view-policy.json').write_text(json.dumps(dict(targets={module.TARGET:dict(ranges=ranges)})))
            selected=root/'cohort-manifest.json';selected.write_text(json.dumps(dict(files=manifest)))
            before={p.name:p.read_bytes() for p in site.iterdir() if p.is_file()}
            with patch.object(module,'ROOT',root):
                result=module.build(site,scores,table,cohort,selected,root/'violin',root/'ptm')
                self.assertEqual(len(result['bindings']),12)
                self.assertEqual(result['cohort']['id'],module.COHORT)
                for name,content in before.items():self.assertEqual((site/name).read_bytes(),content)
                self.assertEqual((site/'metrics/sr215-rpf.json').read_bytes(),scores.read_bytes())
                scores.write_text(scores.read_text()+'\n')
                with self.assertRaisesRegex(ValueError,'reviewed cross-project source'):
                    module.build(site,scores,table,cohort,selected,root/'violin',root/'ptm')

    def test_unsafe_or_overwriting_artifact_paths_are_refused(self):
        with tempfile.TemporaryDirectory() as temporary:
            root=Path(temporary)
            for name in ('../outside','/absolute','nested\\private'):
                with self.assertRaises(ValueError):module.write_new(root,name,b'x')
            module.write_new(root,'new/file.json',b'first')
            with self.assertRaisesRegex(ValueError,'Existing artifact differs'):
                module.write_new(root,'new/file.json',b'changed')
