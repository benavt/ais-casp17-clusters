"""Require completed reconciliation bound to the exact publication and code pin."""
from pathlib import Path
import hashlib,json,re,tomllib

ROOT=Path(__file__).resolve().parents[1]
REQUIRED_CHECKS={'immutable_snapshot','shared_privacy','native_path_hash_parity','frontend'}

def check(root=ROOT):
    record=json.loads((root/'config/ensemble-reconciliation.json').read_text())
    if record.get('schema_version')!=1 or record.get('status')!='ready':
        raise ValueError('Final ensemble publication snapshot has not been reconciled')
    if record.get('publication_approved') is not True:
        raise ValueError('Final publication review is pending')
    checks=record.get('checks',{})
    if not REQUIRED_CHECKS<=checks.keys() or any(checks[key]!='passed'for key in REQUIRED_CHECKS):
        raise ValueError('Final snapshot checks have not all passed')
    manifest=root/'config/publication.json';value=json.loads(manifest.read_text())
    snapshot=value['source_snapshot']
    if snapshot.get('repository')!='benavt/ais-casp17-clusters':
        raise ValueError('Unexpected publication repository')
    commit=record.get('final_publication_commit')
    if not isinstance(commit,str) or not re.fullmatch('[0-9a-f]{40}',commit):
        raise ValueError('An exact final publication commit is required')
    if commit!=snapshot.get('commit') or commit==record.get('published_baseline'):
        raise ValueError('The publication still uses a prior or different snapshot')
    if record.get('manifest_sha256')!=hashlib.sha256(manifest.read_bytes()).hexdigest():
        raise ValueError('Publication manifest differs from the reconciled selection')
    dependencies=tomllib.loads((root/'pyproject.toml').read_text())['project']['dependencies']
    pin='structure-clustering @ git+https://github.com/benavt/Structure_Clustering.git@'+str(record.get('library_commit'))
    if dependencies!=[pin] or not re.fullmatch('[0-9a-f]{40}',str(record.get('library_commit'))):
        raise ValueError('Library pin differs from the reconciled version')
    plan=json.loads((root/'config/pages-cutover.json').read_text())
    if record.get('site_url')!=plan.get('site_url') or record.get('site_url')!='https://benavt.github.io/ais-casp17-clusters/':
        raise ValueError('The existing Pages URL must be preserved')
    return record

if __name__=='__main__':
    try:check()
    except (ValueError,KeyError,TypeError,OSError) as error:
        raise SystemExit('Cutover blocked: '+str(error))
    print('Final ensemble snapshot, manifest, library pin and Pages URL reconciled')
