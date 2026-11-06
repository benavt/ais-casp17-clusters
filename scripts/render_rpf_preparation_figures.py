#!/usr/bin/env python3
"""Render paired saved SR215 RPF observations; never scores or prepares models."""
import argparse
from collections import Counter
import hashlib
import json
import math
from pathlib import Path
import sys

BASELINE_SHA = 'bd09553a7e06bf1a8ed21d901ea36a1303d4706b39ff972928c30300e701a4b4'
PHENIX_SHA = '327731fe2820e57f868b29e5833aa872ecbc8d5dcd89d32146b17cf7c6432248'
TARGET = 'SR215_bmr6366'
METHODS = [('afsample3', 'AFSample3'), ('bioemu2', 'BioEMU2')]
METRICS = [('recall', 'Recall'), ('precision', 'Precision'), ('dp', 'DP')]
PREPARATIONS = [('reduce', 'Reduce', '#356EA0'), ('phenix', 'phenix.reduce', '#D28C22')]
BANDWIDTH = .005
NOTE = 'Both preparation and native scorer differ between runs; the comparison does not isolate preparation effects.'


def sha(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def load_pair(baseline, phenix):
    if sha(baseline) != BASELINE_SHA or sha(phenix) != PHENIX_SHA:
        raise ValueError('Require the exact reviewed Reduce and Phenix source payloads')
    old, new = [json.loads(Path(p).read_bytes()) for p in (baseline, phenix)]
    assert old['target'] == new['target'] == TARGET
    assert old['sequence_sha256'] == new['sequence_sha256']
    assert old['score_context'] == new['score_context'] == 'independent_single_model'
    assert new['scoring_residues'] == 139
    assert new['preparation']['arguments'] == ['-BUILD', '-NUClear']
    assert new['preparation']['heavy_atoms_may_move'] is True
    assert new['comparison_context']['reduce_baseline_native_binary_sha256'] == old['provenance']['native_rpf_binary_sha256']
    assert new['comparison_context']['phenix_variant_native_binary_sha256'] == new['native_RPF_engine']['binary_sha256']
    assert new['comparison_context']['source_or_runtime_promotion'] is False
    experimental = {Path(name).name: value for name, value in old['provenance']['experimental_files_sha256'].items()}
    assert len(experimental) == 6 and new['experimental_input_sha256'] == experimental
    a, b = ({r['model_id']: r for r in payload['models']} for payload in (old, new))
    assert len(old['models']) == len(new['models']) == len(a) == len(b) == 2000 and a.keys() == b.keys()
    paired = {'reduce': [], 'phenix': []}
    for r in old['models']:
        p = b[r['model_id']]
        for key in ['model_id', 'target', 'method', 'ordinal', 'seed', 'sample', 'source_frame', 'source_sha256']:
            assert r[key] == p[key], (r['model_id'], key)
        assert p['baseline_prepared_sha256'] == r['prepared_sha256']
        assert len(p['prepared_sha256']) == 64
        for key, _ in METRICS:
            assert all(isinstance(v[key], (int, float)) and not isinstance(v[key], bool) and math.isfinite(v[key]) for v in (r, p))
        assert (r['method'] == 'bioemu2' and r['ptm'] is None) or (r['method'] == 'afsample3' and isinstance(r['ptm'], (int, float)) and 0 <= r['ptm'] <= 1)
        paired['reduce'].append(r)
        paired['phenix'].append({**p, 'ptm': r['ptm'], 'ptm_source_sha256': r['ptm_source_sha256']})
    for method, _ in METHODS:
        assert sorted(r['ordinal'] for r in paired['reduce'] if r['method'] == method) == list(range(1000))
    return paired, old, new


def render(baseline, phenix, output):
    import numpy as np
    import matplotlib
    matplotlib.use('Agg')
    import matplotlib.pyplot as plt
    from matplotlib.patches import Patch, Rectangle
    from matplotlib.lines import Line2D

    rows, old, new = load_pair(baseline, phenix)
    output = Path(output)
    output.mkdir(exist_ok=False)
    plt.rcParams.update({'font.family': 'DejaVu Sans', 'font.size': 10,
                         'axes.spines.top': False, 'axes.spines.right': False,
                         'axes.labelcolor': '#293440', 'text.color': '#293440',
                         'xtick.color': '#465364', 'ytick.color': '#465364',
                         'svg.fonttype': 'none', 'svg.hashsalt': BASELINE_SHA + PHENIX_SHA})
    grouped = {prep: {m: [r for r in rr if r['method'] == m] for m, _ in METHODS} for prep, rr in rows.items()}
    stats, densities, ranges = {}, {}, {}
    for key, _ in METRICS:
        stats[key], densities[key] = {}, {}
        for prep, _, _ in PREPARATIONS:
            stats[key][prep] = {}
            for method, _ in METHODS:
                values = np.asarray([r[key] for r in grouped[prep][method]])
                low, high = float(values.min()), float(values.max())
                q1, median, q3 = map(float, np.quantile(values, [.25, .5, .75]))
                stats[key][prep][method] = dict(n=len(values), minimum=low, q1=q1, median=median, q3=q3,
                                                maximum=high, mean=float(values.mean()))
                if low == high:
                    densities[key][prep, method] = None
                    continue
                grid = np.linspace(low, high, 512)
                z = (grid[:, None] - values[None, :]) / BANDWIDTH
                density = np.exp(-.5 * z * z).mean(axis=1) / (BANDWIDTH * math.sqrt(2 * math.pi))
                density /= np.trapezoid(density, grid)
                densities[key][prep, method] = (grid, density)
        all_values = [r[key] for rr in rows.values() for r in rr]
        low, high = min(all_values), max(all_values)
        pad = max(.005, (high - low) * .15)
        ranges[key] = [low - pad, high + pad]

    def save(fig, name, description):
        for ext in ['png', 'svg']:
            metadata = {'Description': description}
            if ext == 'svg':
                metadata['Date'] = None
            fig.savefig(output / (name + '.' + ext), dpi=190, metadata=metadata)
        plt.close(fig)

    fig, axes = plt.subplots(2, 3, figsize=(13.8, 8.5))
    for col, (key, label) in enumerate(METRICS):
        scale = max(float(d.max()) for pair in densities[key].values() if pair is not None for d in [pair[1]])
        for row, (method, method_label) in enumerate(METHODS):
            ax = axes[row, col]
            labels = []
            for x, (prep, prep_label, color) in enumerate(PREPARATIONS):
                s = stats[key][prep][method]
                pair = densities[key][prep, method]
                if pair is not None:
                    grid, density = pair
                    width = .35 * density / scale
                    ax.fill_betweenx(grid, x - width, x + width, facecolor=color, edgecolor=color, alpha=.73, linewidth=1.15)
                ax.plot([x, x], [s['minimum'], s['maximum']], color='#293440', linewidth=.85, zorder=3)
                ax.add_patch(Rectangle((x - .055, s['q1']), .11, s['q3'] - s['q1'], facecolor='white', edgecolor='#293440', linewidth=1.1, zorder=4))
                ax.plot([x - .068, x + .068], [s['median'], s['median']], color='#1c2733', linewidth=1.8, zorder=5)
                labels.append(prep_label + '\nMedian ' + format(s['median'], '.3f'))
            ax.set_xticks([0, 1], labels, fontsize=9)
            ax.set_xlim(-.55, 1.55)
            ax.set_ylim(ranges[key])
            ax.set_title(method_label + ' · ' + label, fontsize=12.5, pad=10)
            ax.set_ylabel('RPF score')
            ax.grid(axis='y', color='#dce3e8', linewidth=.65)
            ax.set_axisbelow(True)
    fig.suptitle('SR215 · Reduce versus phenix.reduce RPF scores', fontsize=16, y=.982)
    fig.text(.5, .945, 'Same 1,000 original models per method · full 139-residue scores · higher is better', ha='center', fontsize=10.5)
    fig.legend(handles=[Patch(facecolor=c, edgecolor=c, label=l, alpha=.73) for _, l, c in PREPARATIONS], loc='upper center', bbox_to_anchor=(.5, .925), ncol=2, frameon=False)
    fig.text(.5, .090, 'White box: interquartile range · dark line: median · whisker: observed range · matched y scales within each score', ha='center', fontsize=9)
    fig.text(.5, .061, 'KDE h = 0.005, limited to each observed range; native scores are printed at 0.01 precision. n = 1,000 per violin.', ha='center', fontsize=9)
    fig.text(.5, .030, NOTE, ha='center', fontsize=9, color='#4b5665')
    fig.subplots_adjust(left=.065, right=.985, top=.835, bottom=.165, wspace=.30, hspace=.50)
    save(fig, 'sr215-rpf-preparation-violin', 'Matched SR215 source-model distributions, 1000 per method/preparation. ' + NOTE)

    ptm_summaries, ptm_ranges = {}, {}
    af = {prep: grouped[prep]['afsample3'] for prep, _, _ in PREPARATIONS}
    x = [r['ptm'] for r in af['reduce']]
    x_range = [max(0, min(x) - .01), min(1, max(x) + .01)]
    for key, _ in METRICS:
        y = [r[key] for rr in af.values() for r in rr]
        pad = max(.001, (max(y) - min(y)) * .09)
        ptm_ranges[key] = [min(y) - pad, max(y) + pad]
    for prep, prep_label, color in PREPARATIONS:
        fig, axes = plt.subplots(1, 3, figsize=(13.8, 5.5))
        ptm_summaries[prep] = {}
        for ax, (key, label) in zip(axes, METRICS):
            counts = Counter((r['ptm'], r[key]) for r in af[prep])
            pairs = sorted(counts)
            ax.scatter([p[0] for p in pairs], [p[1] for p in pairs], s=[1.35 * counts[p] for p in pairs], facecolor=color, alpha=.67, edgecolor='#293440', linewidth=.45)
            ax.set_xlim(x_range)
            ax.set_ylim(ptm_ranges[key])
            ax.set_xlabel('Native AFSample3 pTM (0–1)')
            ax.set_ylabel('RPF ' + label)
            ax.set_title(label + ' · ' + str(len(pairs)) + ' exact positions', fontsize=12)
            ax.grid(color='#dce3e8', linewidth=.6)
            ax.set_axisbelow(True)
            ptm_summaries[prep][key] = dict(n=sum(counts.values()), exact_positions=len(pairs), maximum_coincident_models=max(counts.values()))
        fig.suptitle('SR215 · AFSample3 native pTM versus RPF · ' + prep_label, fontsize=15, y=.98)
        fig.text(.5, .925, 'Same 1,000 AFSample3 models · exact native pTM · full 139-residue scores', ha='center', fontsize=10)
        proxies = [Line2D([], [], linestyle='', marker='o', markersize=math.sqrt(1.35 * n), markerfacecolor=color, markeredgecolor='#293440', markeredgewidth=.45, alpha=.67, label=str(n)) for n in [1, 25, 100, 200]]
        fig.legend(handles=proxies, title='Models at identical coordinates · circle area ∝ count', loc='lower center', bbox_to_anchor=(.5, .10), ncol=4, frameon=False, fontsize=9, title_fontsize=9)
        fig.text(.5, .066, 'No jitter. Identical axes across both preparations; BioEMU2 has no native pTM and is excluded.', ha='center', fontsize=9)
        fig.text(.5, .025, NOTE, ha='center', fontsize=9, color='#4b5665')
        fig.subplots_adjust(left=.065, right=.985, top=.83, bottom=.28, wspace=.30)
        suffix = 'reduce-matched' if prep == 'reduce' else 'phenix'
        save(fig, 'sr215-afsample3-ptm-rpf-' + suffix, 'Native pTM and exact printed RPF values; area counts without jitter; matched axes. ' + NOTE)

    provenance = dict(reduce=dict(native_RPF_engine=dict(binary_sha256=old['provenance']['native_rpf_binary_sha256']),
                                 coordinate_preparation=old['provenance']['coordinate_preparation'], frozen_source_provenance=old['provenance']),
                      phenix=dict(preparation=new['preparation'], native_RPF_engine=new['native_RPF_engine'],
                                  comparison_context=new['comparison_context'], frozen_source_provenance=new['provenance']),
                      native_ptm=dict(role=old['provenance']['confidence_source_role'], source_payload_sha256=BASELINE_SHA,
                                      source_field='models[].ptm; models[].ptm_source_sha256',
                                      join='Reuse exact baseline-native AFSample3 pTM by matched original model ID/SHA for both preparations',
                                      AFSample3_native_count=1000, BioEMU2_missing_count=1000))
    manifest = dict(schema_version=1, target=TARGET, score_context='independent_single_model', source_hashes=dict(reduce=BASELINE_SHA, phenix=PHENIX_SHA), model_pairs=2000, provenance=provenance,
                    source_join='Exact original ID/SHA, method, ordinal, seed/sample/frame and baseline-prepared lineage', counts_per_method=1000,
                    no_new_scientific_calls=True, script_sha256=sha(__file__), summaries=stats, violin_ranges=ranges, ptm_ranges=ptm_ranges, ptm_x_range=x_range, ptm_summaries=ptm_summaries,
                    smoothing=dict(kernel='Gaussian', h=BANDWIDTH, support='Each group observed range, truncated and renormalized', width='Common density-to-width mapping over four groups within each metric', points=512),
                    interpretation=NOTE, renderer=dict(numpy=np.__version__, matplotlib=matplotlib.__version__, python=sys.version.split()[0]),
                    files={p.name: dict(bytes=p.stat().st_size, sha256=sha(p)) for p in sorted(output.iterdir())})
    with (output / 'manifest.json').open('x') as f:
        json.dump(manifest, f, indent=2, allow_nan=False)
        f.write('\n')
    return manifest


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--baseline', type=Path, required=True)
    p.add_argument('--phenix', type=Path, required=True)
    p.add_argument('--output', type=Path, required=True)
    args = p.parse_args()
    m = render(args.baseline, args.phenix, args.output)
    print(json.dumps(dict(model_pairs=m['model_pairs'], files=m['files'])))


if __name__ == '__main__':
    main()
