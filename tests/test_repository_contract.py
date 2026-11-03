"""Source-only project layout and pin checks; no scientific engines."""
import ast,hashlib,json,re,tomllib,unittest,subprocess
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]

class Contract(unittest.TestCase):
    def test_single_exact_library_pin(self):
        deps=tomllib.loads((ROOT/'pyproject.toml').read_text())['project']['dependencies']
        self.assertEqual(len(deps),1)
        self.assertRegex(deps[0],r'^structure-clustering @ git\+https://github\.com/benavt/Structure_Clustering\.git@[0-9a-f]{40}$')
    def test_manifest_has_no_unhashed_artifacts(self):
        value=json.loads((ROOT/'config/publication.json').read_text());self.assertEqual(value['renderer'],'saved')
        self.assertTrue(value['files']);names=set()
        for row in value['files']:
            self.assertNotIn(row['path'],names);names.add(row['path']);self.assertRegex(row['sha256'],r'^[0-9a-f]{64}$');self.assertGreaterEqual(row['bytes'],0)
        self.assertIn('index.html',names)
        self.assertEqual(value['source_snapshot']['kind'],'github-commit-zip')
        self.assertRegex(value['source_snapshot']['commit'],r'^[0-9a-f]{40}$')
    def test_source_imports_have_exact_migration_evidence(self):
        value=json.loads((ROOT/'config/source-migration.json').read_text());self.assertFalse(value['scientific_execution'])
        for row in value['files']:
            raw=(ROOT/row['destination']).read_bytes();self.assertEqual(hashlib.sha256(raw).hexdigest(),row['project_sha256'])
            if row['destination'].endswith('.py'):ast.parse(raw)
    def test_scientific_runs_are_unselected(self):
        self.assertEqual(json.loads((ROOT/'config/run-settings.json').read_text())['new_runs'],[])
    def test_tracked_tree_is_source_only(self):
        names=subprocess.check_output(['git','ls-files','-z'],cwd=ROOT).decode().split('\0')
        allowed={'.github','.gitignore','.gitmodules','AGENTS.md','LICENSES','README.md','config','external','pyproject.toml','scripts','site','tests'}
        forbidden={'.cif','.pdb','.pse','.npy','.npz','.sqlite','.sqlite3','.zip','.gz'}
        for name in filter(None,names):
            self.assertIn(name.split('/')[0],allowed)
            self.assertNotIn(Path(name).suffix.lower(),forbidden)
            path=ROOT/name
            if path.is_file():self.assertLessEqual(path.stat().st_size,5*1024**2)
    def test_new_tree_contains_no_generated_site(self):
        self.assertFalse((ROOT/'index.html').exists())
        for p in (ROOT/'scripts').rglob('*.py'):ast.parse(p.read_text())

class CutoverBinding(unittest.TestCase):
    def setUp(self):
        import tempfile,importlib.util
        self.directory=tempfile.TemporaryDirectory();self.addCleanup(self.directory.cleanup)
        self.root=Path(self.directory.name);(self.root/'config').mkdir()
        spec=importlib.util.spec_from_file_location('cutover_readiness',ROOT/'scripts/check_cutover_readiness.py')
        self.module=importlib.util.module_from_spec(spec);spec.loader.exec_module(self.module)
        self.commit='b'*40;self.pin='c'*40;self.url='https://benavt.github.io/ais-casp17-clusters/'
        self.manifest={'source_snapshot':{'repository':'benavt/ais-casp17-clusters','commit':self.commit}}
        self.record={'schema_version':1,'status':'ready','publication_approved':True,
            'published_baseline':'a'*40,'final_publication_commit':self.commit,
            'library_commit':self.pin,'site_url':self.url,
            'checks':{key:'passed'for key in self.module.REQUIRED_CHECKS}}
        self.write_manifest()
        (self.root/'pyproject.toml').write_text('[project]\ndependencies = ["structure-clustering @ git+https://github.com/benavt/Structure_Clustering.git@'+self.pin+'"]\n')
        (self.root/'config/pages-cutover.json').write_text(json.dumps({'site_url':self.url}))
        self.write_record()
    def write_manifest(self):
        path=self.root/'config/publication.json';path.write_text(json.dumps(self.manifest))
        self.record['manifest_sha256']=hashlib.sha256(path.read_bytes()).hexdigest()
    def write_record(self):
        (self.root/'config/ensemble-reconciliation.json').write_text(json.dumps(self.record))
    def test_reviewed_final_selection_passes_but_changed_inputs_need_reconciliation(self):
        self.module.check(self.root)
        for relative in ('config/publication.json','pyproject.toml'):
            path=self.root/relative;old=path.read_bytes()
            if relative.endswith('.json'):path.write_bytes(old+b' ')
            else:path.write_text(path.read_text().replace(self.pin,'d'*40))
            with self.subTest(path=relative),self.assertRaises(ValueError):self.module.check(self.root)
            path.write_bytes(old)
    def test_previous_snapshot_cannot_deploy_as_completed_ensembles(self):
        self.manifest['source_snapshot']['commit']=self.record['published_baseline']
        self.record['final_publication_commit']=self.record['published_baseline']
        self.write_manifest();self.write_record()
        with self.assertRaises(ValueError):self.module.check(self.root)
    def test_green_checks_do_not_replace_publication_approval_or_preserve_changed_url(self):
        self.record['publication_approved']=False;self.write_record()
        with self.assertRaises(ValueError):self.module.check(self.root)
        self.record['publication_approved']=True
        self.record['site_url']='https://example.org/changed/';self.write_record()
        (self.root/'config/pages-cutover.json').write_text(json.dumps({'site_url':self.record['site_url']}))
        with self.assertRaises(ValueError):self.module.check(self.root)

if __name__=='__main__':unittest.main()
