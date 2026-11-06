#!/usr/bin/env python3
"""Package audited saved state bytes for private review; never run science."""
import argparse
import gzip
import hashlib
import importlib.util
import json
from pathlib import Path
import re


def sha(raw): return hashlib.sha256(raw).hexdigest()
def read(path): return json.loads(Path(path).read_text())
def digest(value): return sha(json.dumps(value, sort_keys=True, separators=(',', ':')).encode())


def checked(row):
    raw = Path(row['path']).read_bytes()
    if len(raw) != row['bytes'] or sha(raw) != row['sha256']: raise ValueError('Changed frozen artifact')
    return raw


def build(site, plan_path, acceptance_path, receipt):
    site = Path(site).resolve(); plan_path = Path(plan_path).resolve()
    plan = read(plan_path); accepted = read(acceptance_path)
    if accepted['status'] != 'passed_saved_output_audit_for_private_preview' or accepted['execution_plan']['sha256'] != sha(plan_path.read_bytes()):
        raise ValueError('Exact completed plan and independent saved-output audit required')
    checked(accepted['completion']); checked(accepted['output_manifest'])
    proposal = json.loads(checked(plan['proposal']))
    registry = json.loads(checked(proposal['inputs']['frozen_registry']))
    if len(registry['models']) != 2000 or proposal['target'] != 'SR215_bmr6366': raise ValueError('Wrong frozen cohort')
    root = Path(plan['output'])
    catalog = read(site/'pooled-overlays.json'); packed = read(site/'packed-assets.json')
    privacy_spec = importlib.util.spec_from_file_location('state_privacy', site/'scripts/check_privacy.py')
    privacy = importlib.util.module_from_spec(privacy_spec); privacy_spec.loader.exec_module(privacy)
    manifest = {}
    def emit(logical, raw, content_type):
        if privacy.inspect(raw, filename=logical): raise ValueError('Public artifact failed privacy inspection: '+logical)
        destination = site/(logical+'.gz'); destination.parent.mkdir(parents=True, exist_ok=True)
        destination.write_bytes(gzip.compress(raw, compresslevel=9, mtime=0))
        packed['files'][logical] = dict(sha256=sha(raw), bytes=len(raw), content_type=content_type)
        manifest[logical+'.gz'] = dict(bytes=destination.stat().st_size, sha256=sha(destination.read_bytes()))
        if content_type == 'application/json':
            (site/logical).write_bytes(raw)
            manifest[logical] = dict(bytes=len(raw), sha256=sha(raw))
        return dict(file=logical, sha256=sha(raw), bytes=len(raw))
    def js(value): return (json.dumps(value, separators=(',', ':'), allow_nan=False)+'\n').encode()
    counts = []
    for case in proposal['cases']:
        rid = case['id']; result = read(root/rid/'complete.json')
        import numpy as np
        with np.load(root/rid/'scores.npz', allow_pickle=False) as z: scores = z['model_to_anchor']
        p = dict(schema_version=2, kind='pooled_tm_state_selection_payload', target=proposal['target'], cohort_id=proposal['cohort'],
                 range_id=rid, construct_residues=139, sequence_sha256=registry['sequence_sha256'],
                 canonical_positions=case['clustering_positions'], tm_positions=case['TM_positions'], tm_threshold=.8,
                 models=registry['models'], source_sha256=[m['original']['sha256'] for m in registry['members']],
                 model_order_sha256=registry['model_order_sha256'], energy=registry['energy'],
                 source_density_sha256=catalog['ranges'][rid]['source_density_sha256'], view_bindings=catalog['ranges'][rid]['view_bindings'],
                 selection_prior=dict(procedure='HDBSCAN', alpha=.5, tau=proposal['sampling']['tau'], cohort_models=2000,
                         subset_size=50, subset_law='product-weight', production_chain=0, production_iteration=10000),
                 bonsai_policy=dict(geometry_scope='method_selected_union', state_highlighting=True),
                 states=[], all_states={}, unassigned_models=len(result['unassigned_indices']), noise_models=case['HDBSCAN_noise_models'],
                 provenance=dict(plan_sha256=sha(plan_path.read_bytes()), adapter_commit=plan['source']['commit'],
                         output_manifest_sha256=accepted['output_manifest']['sha256'], audit_sha256=sha(Path(acceptance_path).read_bytes()),
                         search_stop=result['stop_reason'], physical_population_claim=False))
        def choice(indices):
            if indices != sorted(set(indices)): raise ValueError('Preserve canonical saved model order')
            return dict(indices=indices, models=[p['models'][i] for i in indices], source_sha256=[p['source_sha256'][i] for i in indices],
                        models_count=len(indices), energy_model_metrics_sha256=registry['energy']['model_metrics_sha256'])
        for ordinal, saved in enumerate(result['states']):
            sid = saved['id']; anchor = p['models'].index(saved['representative'])
            state = dict(id=sid, cluster_label=sid, color=['#0080ff','#ff8000','#339933'][ordinal],
                         member_indices=saved['indices'], member_tm_scores=scores[saved['indices'],ordinal].tolist(),
                         model_count=saved['count'], eligible_50=True, representative=dict(index=anchor,model=saved['representative']), selections={})
            for method, selected in saved['methods'].items():
                c = choice(selected['indices'])
                for key, ext, mime in [('ensemble','pdb','chemical/x-pdb'),('session','pse','application/octet-stream')]:
                    a = selected['artifacts']['pdb' if ext=='pdb' else 'pse']
                    c[key] = {**emit(f'hdbscan-ensembles/{p["target"]}/{p["cohort_id"]}/{rid}/{sid}/{method}.{ext}', checked(a), mime), 'models_count':50}
                c['diagnostics'] = saved['diagnostics']; state['selections'][method] = c
            p['states'].append(state)
        for method, tree in result['Bonsai'].items():
            indices = sorted(i for state in p['states'] for i in state['selections'][method]['indices'])
            c = choice(indices)
            descriptor = emit(f'hdbscan-bonsai/{p["target"]}/{p["cohort_id"]}/{rid}/states-{method}.json', checked(tree), 'application/json')
            c['bonsai'] = dict(**descriptor, models_count=len(indices), geometry_scope='method_selected_union',
                              model_order_sha256=digest(c['models']), selected_set_sha256=digest(sorted(c['models'])),
                              source_density_sha256=p['source_density_sha256'], canonical_positions=p['canonical_positions'])
            p['all_states'][method] = c
        descriptor = emit(catalog['ranges'][rid]['file'], js(p), 'application/json')
        catalog['ranges'][rid]['sha256'] = descriptor['sha256']
        counts.append(dict(range=rid, supported_states=len(p['states']), ensemble_models_per_method=50*len(p['states'])))
    catalog['state_selection_mode'] = 'TM0.80_residual_states'; catalog['selections_ready'] = True
    for name, value in [('pooled-overlays.json',catalog),('packed-assets.json',packed)]:
        raw = js(value)
        if privacy.inspect(raw,filename=name): raise ValueError('Catalog privacy failure')
        (site/name).write_bytes(raw); manifest[name]=dict(bytes=len(raw),sha256=sha(raw))
    index = (site/'index.html').read_text()
    for name in ['app.js','hdb_states.js']:
        index = re.sub(r'(src="'+re.escape(name)+r'\?v=)[^"]+',r'\g<1>'+sha((site/name).read_bytes())[:12], index)
    (site/'index.html').write_text(index)
    for name in ['app.js','hdb_states.js','index.html']:
        raw=(site/name).read_bytes()
        if privacy.inspect(raw,filename=name): raise ValueError('Frontend privacy failure')
        manifest[name]=dict(bytes=len(raw),sha256=sha(raw))
    Path(receipt).write_text(json.dumps(dict(status='saved_bytes_packaged_for_private_preview', plan_sha256=sha(plan_path.read_bytes()),
                         ranges=counts, files=manifest, native_calls=0, new_selections=0, new_coordinate_exports=0, published=False),indent=2)+'\n')
    print(json.dumps(dict(status='packaged', ranges=counts, files=len(manifest), published=False)))


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    for name in ['site','plan','acceptance','receipt']: parser.add_argument('--'+name,required=True,type=Path)
    args=parser.parse_args();build(args.site,args.plan,args.acceptance,args.receipt)
