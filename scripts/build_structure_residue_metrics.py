"""Project already scored, independent-model QP diagnostics into public annotations.

No scoring, fitting, selection or coordinate export. Requires a pinned RPF source
checkout and a hash-verified, selected diagnostic collection from its saved run.
"""
from pathlib import Path
import argparse,base64,gzip,hashlib,json,sys


def sha(value):return hashlib.sha256(value).hexdigest()

def build(collection, results, rpf_source):
    # Import the existing viewer's strict native parser, not a target-specific formula.
    sys.path.insert(0,str(rpf_source/'src'))
    from rpf_browser.residue_metrics import build_layers, residue_mapping
    from rpf_pilot.chemistry import ONE
    original=json.loads((results/'model-results.json').read_text())
    assert original['score_context']=='independent_single_model'
    rows={r['model_id']:r for r in original['rows']}
    public={'schema_version':1,'kind':'independent_model_residue_diagnostics','target':'SR215_bmr6366',
        'sequence_sha256':'7ab896059b4577bbcfc7cf9db00493b1bc9cea4bee282239195085658fe77f13',
        'score_context':'independent_single_model','preparation_variant':'reduce','scientific_calls':0,
        'provenance':{'rpf_results_sha256':sha((results/'model-results.json').read_bytes()),
            'chemical_shifts_sha256':sha((results/'inputs/input6Q/sr215.bmrb').read_bytes()),
            'native_projection_source_sha256':sha((rpf_source/'src/rpf_browser/residue_metrics.py').read_bytes()),
            'mapping':'Canonical polymer order, verified sequence and scored single-model prepared SHA-256; no ensemble-averaged report is reused.',
            'scope':'Residue precision diagnostics from previously scored individual full-construct models. No local Recall/Precision/DP fractions are inferred.'},'layers':[],'models':[]}
    source=json.loads(gzip.decompress(collection.read_bytes()));assert source['scientific_calls']==0
    shifts=(results/'inputs/input6Q/sr215.bmrb').read_text()
    for record in source['reports']:
        mid=record['model_id'];r=rows[mid]
        assert r['source_sha256']==record['source_sha256'] and r['native_archive_sha256']==record['archive_sha256']
        pdb=(results/'prepared'/f'{mid}.pdb').read_text()
        assert sha(pdb.encode())==r['prepared_sha256']==record['prepared_sha256']
        qp=base64.b64decode(record['qp_base64']);assert sha(qp)==record['qp_sha256']
        mapping=residue_mapping(pdb);assert len(mapping)==139
        ordered=sorted(mapping);sequence=''.join(mapping[p]['residue'] for p in ordered)
        assert sha(sequence.encode())==public['sequence_sha256']
        layers=build_layers(qp.decode(),pdb,shifts,run_id=original.get('snapshot_sha256'))['layers']
        if not public['layers']:
            public['layers']=[{k:v for k,v in layer.items() if k not in ['values','shared_across_models','scope_label','source_file','native_model_context','domain']} for layer in layers]
            for layer in public['layers']:layer.update(scope='model',scope_label='Independent single-model diagnostic')
            public['layers'][0]['domain']=[0,370];public['layers'][3]['domain']=[1,5]
        canonical=[]
        for layer in layers:
            by_id={(v['chain'],v['resi'],v.get('icode','')):v for v in layer['values']}
            values=[by_id[(mapping[p]['chain'],mapping[p]['resi'],mapping[p].get('icode',''))] for p in ordered]
            assert len(values)==139
            canonical.append(values)
        public['models'].append({'model_id':mid,'source_sha256':r['source_sha256'],'prepared_sha256':r['prepared_sha256'],
            'qp_sha256':record['qp_sha256'],'native_archive_sha256':record['archive_sha256'],
            'values':[[v['value'] for v in values] for values in canonical],
            'heat_colors':[v['color'] for v in canonical[0]]})
    assert len({r['model_id'] for r in public['models']})==len(public['models'])
    return public

if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--collection',type=Path,required=True);p.add_argument('--results',type=Path,required=True);p.add_argument('--rpf-source',type=Path,required=True);p.add_argument('--site',type=Path,required=True);a=p.parse_args()
    payload=build(a.collection,a.results,a.rpf_source)
    data=gzip.compress(json.dumps(payload,separators=(',',':'),allow_nan=False).encode(),mtime=0)
    out=a.site/'metrics/sr215-residue-metrics.json.gz';out.write_bytes(data)
    (a.site/'metrics/sr215-residue-catalog.json').write_text(json.dumps({'file':out.relative_to(a.site).as_posix(),'sha256':sha(data),'bytes':len(data),'models':len(payload['models'])},indent=2)+'\n')
    print(json.dumps({'models':len(payload['models']),'compressed_bytes':len(data),'scientific_calls':0}))
