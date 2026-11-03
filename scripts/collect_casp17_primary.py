#!/usr/bin/env python3
"""Collect selected, already-public Primary artifacts without scientific execution.

The clean deployment tree and its packed inventory bind every input. Packed
artifacts are decompressed losslessly into a new immutable delivery. Historical
view lists remain inside the byte-identical Primary JSON; they are not traversed.
The presentation policy is responsible for making those views inaccessible.
"""
from __future__ import annotations

import argparse
from collections import Counter
from datetime import datetime, timezone
import gzip
import hashlib
import json
import math
import os
from pathlib import Path, PurePosixPath
import subprocess
import urllib.request


PUBLIC_REPOSITORY = 'https://github.com/benavt/ais-casp17-clusters'
PUBLIC_COMMIT = 'f8ce7932bd9515f24d704fc04edccceb4ac20c6f'
TARGETS = ('SR215_bmr6366', 'CmR116_bmr17022', 'PaT90_bmr7191',
           'StR82_bmr15386', 'BhR2_bmr6717')
VENDORS = ('assets/plotly.min.js', 'assets/3Dmol-min.js', 'assets/3Dmol-LICENSE')
PATH_FIELDS = {'file', 'scope_file', 'ensemble_file', 'ensemble_pse',
               'membership_file', 'violin_interactive', 'violin_pdf', 'csv'}
SKIP_FIELDS = {'views', 'count_review', 'provenance'}


def sha(payload):
    return hashlib.sha256(payload).hexdigest()


def relative_name(value):
    if not isinstance(value, str) or not value or any(ord(c) < 32 for c in value):
        raise ValueError('Artifact path must be a nonempty local relative name')
    path = PurePosixPath(value)
    if path.is_absolute() or '\\' in value or ':' in value or '?' in value or '#' in value:
        raise ValueError('Artifact path must be a local relative name: ' + value)
    if any(part in {'', '.', '..'} for part in value.split('/')):
        raise ValueError('Unsafe artifact path: ' + value)
    return value


def _git(root, *args, check=True):
    result = subprocess.run(['git', '--no-lazy-fetch', '-C', str(root), *args], check=check,
                            stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                            env={**os.environ, 'GIT_NO_LAZY_FETCH': '1'})
    return result.stdout


def _blob_oid(payload, algorithm='sha1'):
    digest = hashlib.new(algorithm)
    digest.update(b'blob ' + str(len(payload)).encode() + b'\0' + payload)
    return digest.hexdigest()


class PublicInputs:
    """Read only reviewed Git blobs; optional transport fetches selected files."""

    def __init__(self, source, *, expected_commit=PUBLIC_COMMIT, fetch_missing=False):
        self.source = Path(source).absolute()
        if not self.source.is_dir() or any(p.is_symlink() for p in [self.source, *self.source.parents]):
            raise ValueError('Public source must be an existing non-symlink directory')
        self.commit = expected_commit
        self.fetch_missing = fetch_missing
        self.check_clean()
        origin = _git(self.source, 'remote', 'get-url', 'origin').decode().strip()
        if origin.removesuffix('.git').rstrip('/') != PUBLIC_REPOSITORY:
            raise ValueError('Unexpected public repository origin')
        self.object_format = _git(self.source, 'rev-parse', '--show-object-format').decode().strip()
        if self.object_format not in {'sha1', 'sha256'}:
            raise ValueError('Unsupported Git object format')
        self.tree = {}
        for record in _git(self.source, 'ls-tree', '-r', '-z', self.commit).split(b'\0'):
            if not record:
                continue
            metadata, name = record.split(b'\t', 1)
            mode, kind, oid = metadata.decode().split()
            if kind == 'blob':
                self.tree[name.decode()] = {'mode': mode, 'oid': oid}
        self.records = {}
        self.cache = {}
        self.embedded = {}
        manifest = self.read('packed-assets.json')
        packed = json.loads(manifest)
        if packed.get('schema_version') != 1 or not isinstance(packed.get('files'), dict):
            raise ValueError('Unsupported packed artifact inventory')
        self.packed = packed['files']
        self.packed_manifest_sha256 = sha(manifest)

    def check_clean(self):
        if _git(self.source, 'rev-parse', 'HEAD').decode().strip() != self.commit:
            raise ValueError('Public source HEAD differs from the selected commit')
        if _git(self.source, 'status', '--porcelain', '--untracked-files=normal').strip():
            raise ValueError('Public source has local changes; preserve them before collection')

    def _transport(self, name):
        name = relative_name(name)
        entry = self.tree.get(name)
        if not entry or entry['mode'] not in {'100644', '100755'}:
            raise ValueError('Artifact is not a regular file in the frozen public Git tree: ' + name)
        path = self.source / name
        if any(p.is_symlink() for p in [path, *path.parents]):
            raise ValueError('Symlink artifact: ' + name)
        if path.is_file():
            payload, transport = path.read_bytes(), 'existing_worktree_file'
        else:
            # NO_LAZY_FETCH keeps a partial clone from silently hydrating its
            # remote. Only an explicit --fetch-missing permits public transport.
            local = subprocess.run(['git', '--no-lazy-fetch', '-C', str(self.source), 'cat-file', 'blob', entry['oid']],
                                   stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                                   env={**os.environ, 'GIT_NO_LAZY_FETCH': '1'})
            if local.returncode == 0:
                payload, transport = local.stdout, 'existing_local_git_blob'
            elif self.fetch_missing:
                from urllib.parse import quote
                url = ('https://raw.githubusercontent.com/benavt/ais-casp17-clusters/'
                       + self.commit + '/' + quote(name, safe='/'))
                with urllib.request.urlopen(url, timeout=60) as response:
                    payload = response.read()
                transport = 'selected_public_commit_URL'
            else:
                raise ValueError('Selected public blob is absent locally; use --fetch-missing: ' + name)
        if _blob_oid(payload, self.object_format) != entry['oid']:
            raise ValueError('Public transport differs from the frozen Git blob: ' + name)
        return payload, entry['oid'], transport

    def read(self, name):
        name = relative_name(name)
        if name in self.cache:
            return self.cache[name]
        if name in self.embedded:
            payload, proof = self.embedded[name]
            self.records[name] = {'path': name, 'bytes': len(payload), 'sha256': sha(payload),
                                  'transport': 'existing_Primary_embedded_bytes',
                                  'decompressed': False, **proof}
            return payload
        packed = getattr(self, 'packed', {}).get(name)
        stored = name + '.gz' if packed else name
        raw, oid, transport = self._transport(stored)
        try:
            payload = gzip.decompress(raw) if packed else raw
        except (OSError, EOFError) as error:
            raise ValueError('Invalid packed public artifact: ' + stored) from error
        if packed and (len(payload) != packed['bytes'] or sha(payload) != packed['sha256']):
            raise ValueError('Decompressed artifact differs from the packed inventory: ' + name)
        self.records[name] = {'path': name, 'bytes': len(payload), 'sha256': sha(payload),
                              'source_path': stored, 'source_blob_oid': oid,
                              'source_bytes': len(raw), 'source_sha256': sha(raw),
                              'transport': transport, 'decompressed': bool(packed)}
        if name.endswith('.json') or name in VENDORS:
            self.cache[name] = payload
        return payload

    def expected(self, name):
        name = relative_name(name)
        if name in self.packed:
            row = self.packed[name]
            if type(row.get('bytes')) is not int or row['bytes'] < 0 or not isinstance(row.get('sha256'), str):
                raise ValueError('Invalid packed artifact identity: ' + name)
            stored = name + '.gz'
            if stored not in self.tree or self.tree[stored]['mode'] not in {'100644', '100755'}:
                raise ValueError('Packed artifact missing from frozen tree: ' + stored)
            return {'path': name, 'bytes': row['bytes'], 'sha256': row['sha256']}
        self.read(name)
        return {key: self.records[name][key] for key in ['path', 'bytes', 'sha256']}

    def register_embedded(self, name, text, parent, field, declared_sha256=None):
        """Copy existing saved text for a dangling file reference, never convert."""
        name = relative_name(name)
        if name in self.packed or name in self.tree:
            return
        if not isinstance(text, str) or not text:
            return
        payload = text.encode()
        if declared_sha256 is not None and sha(payload) != declared_sha256:
            raise ValueError('Embedded original coordinate hash differs: ' + name)
        proof = {key: self.records[parent][key] for key in
                 ['source_path', 'source_blob_oid', 'source_bytes', 'source_sha256']}
        proof.update(parent_Primary_sha256=sha(self.cache[parent]), embedded_json_field=field,
                     copied_saved_text_without_conversion=True)
        if name in self.embedded and self.embedded[name][0] != payload:
            raise ValueError('Conflicting embedded saved files: ' + name)
        self.embedded[name] = (payload, proof)


def _references(value):
    if isinstance(value, dict):
        for key, child in value.items():
            if key in SKIP_FIELDS or key.endswith('_text'):
                continue
            if key in PATH_FIELDS and isinstance(child, str) and child:
                yield relative_name(child)
            elif isinstance(child, (dict, list)):
                yield from _references(child)
    elif isinstance(value, list):
        for child in value:
            yield from _references(child)


def _cohort(data, target, model_count, method_count, models_per_method):
    models, methods, clusters = (data.get(key) for key in ['models', 'methods', 'clusters'])
    if data.get('target') != target or data.get('view_id') != 'primary':
        raise ValueError('Expected the exact target Primary payload: ' + target)
    if not all(isinstance(x, list) and len(x) == model_count for x in [models, methods, clusters]):
        raise ValueError('Primary cohort shape differs: ' + target)
    if any(not isinstance(x, str) or not x for x in [*models, *methods, *clusters]) or len(set(models)) != model_count:
        raise ValueError('Primary model identities/labels are invalid: ' + target)
    counts = Counter(methods)
    if len(counts) != method_count or set(counts.values()) != {models_per_method}:
        raise ValueError('Primary method cohort differs: ' + target)
    for method in ['pca', 'umap', 'tsne']:
        xy = data.get('projections', {}).get(method, {}).get('xy')
        if not isinstance(xy, list) or len(xy) != model_count or any(
                not isinstance(row, list) or len(row) != 2 or any(
                    isinstance(v, bool) or not isinstance(v, (int, float)) or not math.isfinite(v) for v in row) for row in xy):
            raise ValueError('Invalid saved Primary projection: ' + target + '/' + method)
    for scheme in data.get('schemes', []):
        if not isinstance(scheme.get('values'), list) or len(scheme['values']) != model_count:
            raise ValueError('Primary coloring cohort differs: ' + target)
    representatives = data.get('representatives', [])
    rep_labels = [row.get('cluster') for row in representatives]
    if len(rep_labels) != len(set(rep_labels)) or set(rep_labels) != set(clusters):
        raise ValueError('Primary representatives do not cover the exact saved groups: ' + target)
    population = Counter(clusters)
    for row in representatives:
        if row.get('count') != population[row['cluster']] or row.get('model') not in set(models):
            raise ValueError('Primary representative identity/count differs: ' + target)
        index = models.index(row['model'])
        if clusters[index] != row['cluster'] or methods[index] != row.get('method'):
            raise ValueError('Primary representative is outside its saved cluster: ' + target)
    provenance = data.get('provenance', {})
    if provenance.get('model_count', model_count) != model_count or provenance.get('method_counts', dict(counts)) != dict(counts):
        raise ValueError('Primary provenance cohort differs: ' + target)
    return {'id': target, 'models': model_count, 'method_counts': dict(counts),
            'clusters': len(representatives), 'view_id': 'primary',
            'model_order_sha256': sha(json.dumps(models, separators=(',', ':')).encode())}


def inventory_primary(inputs, *, targets=TARGETS, model_count=11000,
                      method_count=11, models_per_method=1000):
    atlas = json.loads(inputs.read('atlas.json'))
    entries = atlas.get('targets', [])
    if [row.get('id') for row in entries] != list(targets):
        raise ValueError('The source atlas differs from the exact five-target selection')
    selected, summaries = set(VENDORS), []
    for target in targets:
        primary = target + '/primary.json'
        payload = inputs.read(primary)
        data = json.loads(payload)
        summary = _cohort(data, target, model_count, method_count, models_per_method)
        for index, representative in enumerate(data['representatives']):
            if representative.get('file') and representative.get('coordinate_text'):
                inputs.register_embedded(representative['file'], representative['coordinate_text'],
                    primary, f'representatives[{index}].coordinate_text', representative.get('sha256'))
            if representative.get('ensemble_file') and representative.get('ensemble_text'):
                inputs.register_embedded(representative['ensemble_file'], representative['ensemble_text'],
                    primary, f'representatives[{index}].ensemble_text')
        summary.update(data=primary, primary_sha256=sha(payload),
                       legacy_view_lists_preserved_but_not_followed=True,
                       embedded_count_review_preserved_but_not_followed=bool(data.get('count_review')))
        summaries.append(summary)
        selected.add(primary)
        selected.update(_references(data))
    pending = sorted(selected)
    inspected = set()
    while pending:
        name = pending.pop()
        inputs.expected(name)
        if not name.endswith('.json') or name in inspected:
            continue
        inspected.add(name)
        for dependency in _references(json.loads(inputs.read(name))):
            if dependency not in selected:
                selected.add(dependency)
                pending.append(dependency)
    rows = [inputs.expected(name) for name in sorted(selected)]
    inputs.check_clean()
    return {'schema_version': 1, 'kind': 'selected-public-Primary-collection-plan',
            'source_repository': PUBLIC_REPOSITORY, 'source_commit': inputs.commit,
            'packed_inventory_sha256': inputs.packed_manifest_sha256,
            'targets': summaries, 'selected_files': rows,
            'selected_file_count': len(rows),
            'uncompressed_selected_bytes': sum(row['bytes'] for row in rows),
            'scientific_execution': False, 'scientific_calls': 0,
            'publication': False, 'automatic_retries': 0}


def collect_primary(source, output, *, expected_commit=PUBLIC_COMMIT,
                    fetch_missing=False, targets=TARGETS, model_count=11000,
                    method_count=11, models_per_method=1000):
    inputs = PublicInputs(source, expected_commit=expected_commit, fetch_missing=fetch_missing)
    plan = inventory_primary(inputs, targets=targets, model_count=model_count,
                             method_count=method_count, models_per_method=models_per_method)
    output = Path(output).absolute()
    if output.exists() or any(p.is_symlink() for p in [output, *output.parents]):
        raise ValueError('Collection output must be a new non-symlink directory')
    output.mkdir(parents=True, exist_ok=False)
    delivery = output / 'delivery'
    delivery.mkdir()
    (output / 'collection-plan.json').write_text(json.dumps(plan, indent=2) + '\n')
    try:
        for row in plan['selected_files']:
            payload = inputs.read(row['path'])
            if len(payload) != row['bytes'] or sha(payload) != row['sha256']:
                raise ValueError('Selected artifact changed after inventory: ' + row['path'])
            path = delivery / row['path']
            path.parent.mkdir(parents=True, exist_ok=True)
            with path.open('xb') as stream:
                stream.write(payload)
        atlas = {'targets': [{'id': target, 'data': target + '/primary.json'} for target in targets]}
        payload = (json.dumps(atlas, indent=2) + '\n').encode()
        (delivery / 'atlas.json').write_bytes(payload)
        rows = [*plan['selected_files'], {'path': 'atlas.json', 'bytes': len(payload), 'sha256': sha(payload)}]
        inputs.check_clean()
        (output / 'delivery-manifest.json').write_text(json.dumps({'files': sorted(rows, key=lambda r:r['path'])}, indent=2) + '\n')
        receipt = {**plan, 'kind': 'selected-public-Primary-collection', 'status': 'complete',
                   'completed_at': datetime.now(timezone.utc).isoformat(),
                   'source_checkout': str(inputs.source), 'output': str(output),
                   'delivery_manifest_sha256': sha((output / 'delivery-manifest.json').read_bytes()),
                   'delivery_files': len(rows), 'delivery_bytes': sum(row['bytes'] for row in rows),
                   'source_reads': [inputs.records[name] for name in sorted(inputs.records)],
                   'source_files_modified': 0, 'Primary_payloads_byte_identical': True}
    except BaseException as error:
        (output / 'collection-failure.json').write_text(json.dumps({'status': 'failed',
            'error': str(error), 'automatic_retries': 0, 'scientific_execution': False}, indent=2) + '\n')
        raise
    (output / 'collection-receipt.json').write_text(json.dumps(receipt, indent=2) + '\n')
    return receipt


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('source', type=Path)
    parser.add_argument('output', type=Path, nargs='?')
    parser.add_argument('--fetch-missing', action='store_true',
                        help='Read only selected missing blobs from the exact public commit URL.')
    parser.add_argument('--inventory', action='store_true', help='List selected artifacts and bytes without creating a delivery.')
    parser.add_argument('--inventory-file', type=Path, help='Save the full inventory to a NEW local metadata file.')
    args = parser.parse_args(argv)
    if args.inventory:
        inputs = PublicInputs(args.source, fetch_missing=args.fetch_missing)
        result = inventory_primary(inputs)
    else:
        if args.output is None:
            parser.error('output is required unless --inventory is selected')
        result = collect_primary(args.source, args.output, fetch_missing=args.fetch_missing)
    if args.inventory_file:
        with args.inventory_file.open('x') as stream:
            json.dump(result, stream, indent=2)
            stream.write('\n')
    print(json.dumps({key: value for key, value in result.items() if key not in {'selected_files', 'source_reads'}}, indent=2))


if __name__ == '__main__':
    main()
