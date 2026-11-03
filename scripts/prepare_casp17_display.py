#!/usr/bin/env python3
"""Prepare a curated private five-target viewer from verified saved deliveries.

This is a presentation adapter: it never fits, scores, regenerates coordinates,
merges source or publishes. An incomplete analysis cannot become release-ready.
"""
import argparse
import copy
import hashlib
import json
from pathlib import Path
import sys

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT))
from src.analysis.atlas_presentation import prepare


def read(path):
    return json.loads(Path(path).read_text())


def policy_from_recipe(recipe,sources):
    policy={'schema_version':1,'targets':copy.deepcopy(recipe['targets'])}
    for target,entry in policy['targets'].items():
        for ident,region in entry['ranges'].items():
            spans=region.pop('canonical_ranges')
            if (not isinstance(spans,list)or not spans
                    or any(not isinstance(span,list)or len(span)!=2
                           or any(type(value)is not int for value in span)
                           or not 1<=span[0]<=span[1] for span in spans)):
                raise ValueError('Invalid canonical range recipe')
            positions=[p for start,end in spans for p in range(start,end+1)]
            if positions!=sorted(set(positions)) or any(type(p)is not int or p<1 for p in positions):
                raise ValueError('Invalid canonical range recipe')
            region['canonical_positions']=positions
            views=[]
            for view in region['views']:
                if view['source'] not in sources:
                    if view['id']=='primary':
                        raise ValueError('Missing saved Primary delivery: '+target+'/'+ident)
                    view={'id':'density','available':False,
                          'status':'Awaiting verified target HDBSCAN results'}
                views.append(view)
            region['views']=views
    return policy


def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--primary-delivery',type=Path,required=True)
    p.add_argument('--workflow-root',type=Path,required=True)
    p.add_argument('--sr215-full-delivery',type=Path,required=True)
    p.add_argument('--sr215-regional-delivery',type=Path,required=True)
    p.add_argument('--density-root',type=Path)
    p.add_argument('--output',type=Path,required=True)
    p.add_argument('--recipe',type=Path,default=ROOT/'config/casp17_display_recipe.json')
    p.add_argument('--projection-metadata',type=Path)
    p.add_argument('--supplementary-metadata',type=Path)
    p.add_argument('--metric-overlays',type=Path)
    p.add_argument('--require-figure-parity',action='store_true',help='Reject incomplete HDBSCAN analyses before preparing a release review.')
    p.add_argument('--residue-planner',action='store_true',help='Add a private draft-only SR215 residue-range chooser')
    a=p.parse_args()
    if a.output.exists() or any(x.is_symlink()for x in [a.output,*a.output.parents]):
        raise ValueError('Use a new non-symlink presentation output')
    recipe=read(a.recipe)
    additional={'sr215-full':a.sr215_full_delivery,'res5-95':a.sr215_regional_delivery}
    manifests,reports={},{}
    for target in recipe['targets']:
        paths=list((a.workflow_root/target/'workflow').glob('*/manifest.json'))
        if len(paths)!=1:
            raise ValueError('Expected one frozen target workflow manifest: '+target)
        manifests[target]=paths[0]
        parent=read(paths[0]);report=parent.get('cluster_ensembles',{}).get('report')
        if report:
            path=Path(report)
            if not path.is_absolute():path=paths[0].parent/path
            if path.is_file():reports[target]=path
        if not target.startswith('SR215') and a.density_root:
            output=a.density_root/target
            if (output/'complete.json').is_file() and (output/'delivery-manifest.json').is_file():
                additional[target.split('_')[0].lower()+'-hdbscan']=output/'delivery'
    policy=policy_from_recipe(recipe,{'primary':a.primary_delivery,**additional})
    parity=True
    for target,entry in policy['targets'].items():
        for region in entry['ranges'].values():
            for view in region['views']:
                if view.get('available')is False:
                    parity=False;continue
                root=a.primary_delivery if view['source']=='primary' else additional[view['source']]
                data=read(root/view['data'])
                if view['id']=='density' and (not data.get('bonsai')or not data.get('medoid_tm')):
                    parity=False
    if a.require_figure_parity and not parity:
        raise ValueError('Release review requires all five HDBSCAN deliveries with Bonsai and complete medoid grids')
    a.output.mkdir(parents=True)
    policy_path=a.output/'input-view-policy.json'
    policy_path.write_text(json.dumps(policy,indent=2)+'\n')
    receipt=prepare(a.primary_delivery,a.output/'overlay',view_policy=policy_path,
                    target_manifests=manifests,target_region_reports=reports,
                    additional_deliveries=additional,projection_metadata=a.projection_metadata,
                    supplementary_metadata=a.supplementary_metadata,metric_overlays=a.metric_overlays,
                    residue_planner=a.residue_planner)
    result={'status':'private_review_prepared','scientific_execution':False,'publication':False,
            'figure_parity_complete':parity,'overlay':str(a.output/'overlay'),
            'recipe_sha256':hashlib.sha256(a.recipe.read_bytes()).hexdigest(),
            'view_policy_sha256':hashlib.sha256(policy_path.read_bytes()).hexdigest(),
            'source_renderer':receipt['renderer']}
    (a.output/'assembly-receipt.json').write_text(json.dumps(result,indent=2)+'\n')
    print(json.dumps({key:value for key,value in result.items()if key!='source_renderer'},indent=2))


if __name__=='__main__':main()
