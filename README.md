The cluster explorer groups PCA, UMAP, t-SNE and Bonsai in one collapsible
section with a single shared legend and compact analysis/color controls.

On desktop, two equal-height screens use native proximity scroll snapping.
The upper screen pairs the featured view with the selected cluster medoid or
comparison ensemble. The lower screen groups the other three views on the left
and target context on the right. The all-four-views option and screen-navigation
buttons provide alternatives to scrolling. Promoting a plot returns to the
comparison screen. One Reset plot / Save PNG toolbar follows the featured view.

On narrow phones, plots, structures and notes use a natural stacked layout;
compact view tabs remain available. Reduced-motion preferences disable animated
scrolling and snapping. No custom wheel interception is added. The loading
menus retain their places and stay disabled until the analysis is ready.

Cluster representatives, downloads and supporting figures remain in separate
collapsible sections. Category clicks filter all four views together. Scientific
inputs, projections, scores and saved cluster assignments are unchanged.

Run source checks with `node --test tests/*.test.mjs`. Native browser visual,
scrolling and interaction checks are a separate validation step.

`target-context.json` is the versioned target metadata record. Each entry links
repository references to the frozen analysis sequence hash, records verification
sources/date and source-document digests, and reserves fields for biological relevance, ensemble
interpretation, project citations and a project-record URL. Repository identity
and draft project interpretation are separate; unresolved source annotations
remain explicit review notes.

Update the metadata revision and asset-version hashes with reviewed project
changes, and retain this metadata with future archived site releases. Prior
revisions remain in Git history. Adding a repository link does not add an
experimental structure to the scientific analysis or recompute any result.

This site is generated from the canonical Structure_Clustering renderer [`9c1c4110ce17`](https://github.com/benavt/Structure_Clustering/commit/9c1c4110ce17638e1f0b1ccf6c69d323625a734c), Git tree `08e81db0636691e424b2d091a878ec5efbbce6b7`. Shared explorer behavior is maintained in the canonical repository. The exact renderer, loader and saved-data identities are recorded in `publication-provenance.json`. Set view aligns display models using the clustering residues and preserves the camera/slab while switching clusters; saved coordinate files and downloads stay unchanged.

The explorer offers Primary and HDBSCAN for all five CASP17 targets. SR215 supports canonical residues 1–139, 5–95, and the combined mask 32–47 + 78–99 (38 residues); PaT90 offers canonical 8–91 and the additional saved 24–91 mask (68 residues). Saved computational cluster labels do not establish biological state counts.

ProteinEBM model 6 supplies one optional energy color at the saved default conditioning level **t=0.10**: **55,000 scores, one per model**. This replaces the unavailable template-only refold placeholders. Saved clusters remain the default color. Energies are unnormalized learned scores in arbitrary units, lower-first within a target; they are not calibrated physical energies, confidence scores or trajectory times. Values use each full construct, including PaT90’s 97 residues and SR215’s 139, and stay identical across clustering methods and residue-range selections. Other energy levels are excluded from this site. Existing measured confidence and reference similarities remain available.


The independent **Highlight selection** menu shows saved weighted or uniform 200-model panels, exact categorical visited models, Metropolis–Hastings visited models, or DISCO minimum-energy models. All five targets are covered for Primary and HDBSCAN, including all three SR215 masks: 14 target/range/procedure combinations. The browser reads completed saved model IDs; it never samples, scores or reclusters. Plot colors, cluster inspection and the set camera remain independent. Point clicks inspect the selected point's saved cluster representative.

Each partition has nine saved balance/energy-scale conditions (alpha 0/0.5/1 and tau/IQR 0.5/1/2), with 20 saved unique-panel replicates. ProteinEBM conditioning remains t=0.10; selection tau is a separate within-target scale. Assigned-cluster weights are proportional to exp(-(E-E_min)/tau) divided by cluster size raised to alpha. HDBSCAN preserves aggregate energy-only noise mass across balance settings. DISCO chooses the minimum-energy model per assigned structural cluster and excludes noise; its count varies with the partition. Visited-model rings are distinct memberships, not visit frequencies or 200-model panels.

The fixed-budget MCMC chains have observed mixing limitations. In the additional four-target pilot, matched independent categorical draws had smaller cluster total-variation error in 71 of 72 conditions; one MCMC condition missed a cluster with 2.18% declared target mass. Active MCMC status reports the saved MH and matched-IID cluster errors and unvisited assigned-cluster count. Lower error means closer agreement with the declared target label probabilities. These exploratory chains do not establish convergence or equilibrium populations. Exact categorical draws provide the finite-pool occupancy comparison; weighted unique panels trade energy against structural coverage.

The three SR215 masks retain their saved fine-clustering arrays. Completed
Bonsai and medoid-grid supplements for the third mask are preserved. PaT90's
new 24–91 range includes saved PCA/UMAP/t-SNE, Primary and HDBSCAN labels, and
TM-state selections. Bonsai and selected-cluster ensemble PDB/PyMOL downloads are now available
for both views of that range, alongside complete medoid TM grids and saved distance summaries.
State ensemble downloads are preserved. The older PaT90 8–91 analysis
is preserved separately. Static preparation performs no sampling, scoring,
clustering or structure fitting. No automatic/K=2–20 choices or private residue
planner are published.

## Saved residual TM-state selections

Choose **TM state** (one state or all states) and **State subset** (MCMC50,
DISCO50, or all qualified members). The same saved HDBSCAN-balanced panels
appear on both Primary and HDBSCAN views. Each sampler selects exactly 50
distinct models per supported state. State-colored rings preserve the original
model IDs and cluster colors; Bonsai can highlight only its saved model subset.
Each state offers both full-atom ensemble PDB and native PyMOL PSE downloads
for each sampler. Downloads preserve their original saved bytes and hashes.

Membership requires TM-score ≥ 0.80 to its representative on the listed core.
Energy-independent bounded searches inspect residual models, retain at most
three states with at least 50 members, and reassign models to the best qualified
representative. The searches do not impose the older 90% coverage stop. Reaching
a candidate or three-state cap leaves additional states unresolved. Membership
is representative-relative, not an all-pairs certificate or a biological-state
population estimate. Terminal-candidate trims are operational high-variance
bounds, not confirmed disorder.

| Target / clustering range | Canonical TM core | State sizes | Uncovered |
| --- | --- | --- | ---: |
| BhR2 / 1–107 | 7–84 | 7,650 / 195 / 148 | 3,007 |
| CmR116 / 1–131 | 1–86 | 8,679 / 395 / 437 | 1,489 |
| StR82 / 1–77 | 22–54 | 10,034 / 123 / 518 | 325 |
| SR215 / 1–139 | 15–72 | 10,171 / 110 | 719 |
| SR215 / 5–95 | 15–72 | 10,150 / 110 | 740 |
| SR215 / 32–47 + 78–99 | 32–47 | 1,337 / 147 / 2,176 | 7,340 |
| PaT90 / 8–91 | 8–91 | 1,246 / 704 / 134 | 8,916 |
| PaT90 / 24–91 | 24–91 | 8,006 / 318 / 311 | 2,365 |

The 16-residue SR215 core is a local structural comparison; its membership does
not assess the second clustering segment. The two SR215 15–72 searches remain
independent results with their own representatives and panels.

Saved full-construct ProteinEBM energies remain **t=0.10 only**, with alpha=0.5
and tau=one original-target IQR. MCMC samples product-weight distinct 50-model
subsets with four fixed-budget chains; the displayed production panel is chain 0,
iteration 10,000. DISCO is a different within-state coverage control, using
minimum-energy assigned-group seeds and weighted fill. Saved HDBSCAN noise can
remain eligible within a state. Conditioning t is separate from the sampling
scale; learned energies and equal 50-model quotas are not physical populations.
Diagnostics remain exploratory and do not establish convergence. This release
contains 22 supported states, 44 unchanged ensemble PDBs and 44 unchanged PSEs
across eight target/range options and 16 fine-clustering views.

### Saved figure supplements

The SR215 32–47 plus 78–99 Primary and HDBSCAN views receive their missing
Bonsai trees and complete medoid TM grids through `figure-supplements.json`.
The loader verifies the supplement hash, exact source-view bytes, ordered model
identities and saved medoids before attaching either figure. Raw analysis files
and the existing metric, saved-selection and TM-state bindings remain unchanged.
The supplements record the approved run, source revision, feature hash and residue
scope. Separate ensemble supplements now add coordinate/PSE downloads while
preserving those frozen figure bindings.

### Cluster ensemble completion

All 16 published target/range/clustering views now have Bonsai and cluster
ensemble PDB/PyMOL downloads. These selected cluster ensembles contain at most
five models and are separate from the 50-model MCMC/DISCO state ensembles.
The new sessions passed native atom/coordinate/residue-selection/camera round trips.
Sixteen identical existing ensembles reuse their PDBs and receive palette-only
PyMOL exports matching their HDBSCAN cluster colors. Original saved arrays and
state ensembles are unchanged. Bonsai notes are consolidated under Methods.

Cluster links point to physical gzip artifacts so copied URLs work; ordinary
clicks verify hashes and deliver the original uncompressed PDB/PSE bytes.
The combined scientific and palette provenance is recorded in the supplement
catalog and publication provenance.

### Supplemental figure coverage

All 16 available target/range/clustering configurations include a complete medoid
TM grid, median Cα distances and Cα distance variance. PaT90 24–91 reuses the
approved selected-ensemble medoids and saved 11,000-model distance summaries.
Its 34×34 Primary and 130×130 HDBSCAN grids use mean bidirectional US-align
TM-scores with average-length normalization on canonical residues 24–91.
The published-coverage test requires all figures in every available configuration.

HDBSCAN is the default clustering in every range. UMAP KNN is the alternative
and fallback when a verified HDBSCAN result is unavailable. Explicit saved-view
links keep the requested clustering. This preference changes no scientific data.
# SR215 RPF annotations and pooled comparison

The RPF extension adds source-verified full-construct Recall, Precision and DP
colors for exactly 1,000 AFSample3 and 1,000 BioEMU2 models. Other methods remain
unscored and gray. The same observed color bounds apply across residue masks and
clustering views; RPF and native pTM never enter clustering features or weights.

The SR215 Models selector preserves the original all-method analyses and offers
a separate pooled 2,000-model comparison for all residues, 5–95, and 32–47 + 78–99.
Pooled projections, labels, PCA variance and distance summaries are freshly fit
or calculated for that cohort; original full-cohort metadata are not substituted.
Feature-centroid representatives are labeled explicitly and are not described as
all-model structural medoids.

The comparison panel contains paired method violins and AFSample3 native-pTM
scatter plots. Native printed scores have ties, so scatter circles aggregate exact
positions with area proportional to the coincident model count. No jitter or
confidence substitution changes the values. CSV downloads retain all 2,000 model
records and source identities. Figure downloads provide the reviewed SVG and PNG.

`scripts/build_rpf_overlay.py` is a saved-artifact exporter, not a scientific
runner. It consumes the pinned scalar payload in `config/sr215-rpf-source.json`
and a reviewed manifest of newly generated pooled views, verifies identities,
copies only those selected artifacts, and binds the optional `rpf-overlays.json`
catalog to each original/new view's exact bytes. It refuses differing existing
outputs. Public privacy and full-route checks remain required before publication.
No source-migration cutover, native rerun or automatic publication is triggered.

Focused source checks: `python3 -m unittest discover -s tests -p test_rpf_export.py`
and `node tests/rpf-overlays.test.cjs`, plus the existing clustering-default,
shared-legend and responsive-layout checks. Full saved-data coverage tests run
against the generated reviewed site, not a sparse code-only worktree.


Pooled SR215 model annotations and cluster ensembles

The pooled AFSample3/BioEMU2 views use a dedicated `pooled-overlays.json` catalog.
Source-bound scalar annotations restore ProteinEBM model 6 energy at t=0.10,
native AFSample3 pTM and all-atom mean pLDDT, and the saved fixed-residue 5–95
reference TM score. Missing native confidence remains null for BioEMU2. All
pooled display bounds are fixed over the same 2,000 models across masks, views
and selected-model Bonsai trees; original 11,000-model bounds stay unchanged.

Reduce and phenix.reduce RPF colors have separate keys and preparation identities.
The original Reduce payload and static comparison figures remain unchanged.
Phenix BUILD/nuclear preparation can move heavy atoms, and its saved native RPF
engine also differs; these are descriptive annotations, not a preparation-only
causal comparison or runtime promotion. The comparison panels default to Reduce.
Their shared **Preparation** control changes both method violins and native-pTM
plots, independently of point colors, HDBSCAN subsets and Bonsai. The selection
persists across tabs and views; `?rpf_preparation=phenix` shares the Phenix view.
Both panels retain the full matched model pool. Violin axes span both preparations
and both methods; pTM axes and color limits span both preparations' AFSample3
scores, with unchanged native pTM and no BioEMU2 confidence imputation.
One bubble area-per-model scale is shared across both preparations and all three
pTM panels, so equal model counts retain equal displayed area while toggling.

Violin figure downloads compare both preparations side by side. pTM downloads
follow the selected preparation with matched axes. The four original figure URLs
and both source JSON payloads remain byte-identical. Preparation and scorer both
differ, so this descriptive comparison does not isolate preparation effects.

Manual figure regeneration uses the two exact hash-pinned, source-matched public
JSON payloads; it never prepares coordinates or scores models:

```bash
python3 scripts/render_rpf_preparation_figures.py \
  --baseline metrics/sr215-rpf.json \
  --phenix metrics/sr215-rpf-phenix.json \
  --output PATH_TO_FRESH_OUTPUT_DIRECTORY
```

The renderer requires NumPy and Matplotlib (the reviewed figures used 2.3.5 and
3.10.5, respectively). It validates all 2,000 original IDs/source hashes,
baseline-prepared lineage, native confidence and six experimental-input hashes,
and records preparation/scorer provenance and image hashes in its output manifest.
Rendering is manual; CI does not execute it or install a plotting runtime.

`selections_ready=false` is an explicit colors-only phase. It issues no native
selection/tree fetches and exposes no placeholder ensembles. After independent
review, the saved-artifact exporter can make the narrow pending-to-ready catalog
transition while retaining the same scalar/source bindings. HDBSCAN clusters
remain distinct from legacy TM states and original-cohort selections. Eligible
clusters expose exact saved MCMC50/DISCO50 subsets; clusters below 50 expose one
All members artifact with their actual count. Noise remains in the projections.
MCMC50 uses the saved chain 0 under the fixed-cardinality product-weight law;
DISCO50 uses one minimum-energy seed and energy-weighted sampling without
replacement. PDB/PyMOL exports retain original AIS full-construct coordinates
with rigid alignment on the clustering mask. RPF preparation variants remain
passive per-model annotations, rather than ensemble coordinate sources or scores.

There are six newly fitted method-overview Bonsai trees (three masks × two
methods). Each contains exactly that method's selected-cluster union, including
All members of small clusters. Choosing a cluster changes highlights within that
fixed method geometry; choosing a method changes the saved overview tree. No
old full-cohort tree is substituted or pruned into a new scientific result.

`scripts/build_pooled_overlays.py --colors-only` copies only the reviewed scalar
and Phenix payloads and six existing source bindings. Its full mode admits only
manifest-selected saved native outputs. All 188 PDB/PyMOL artifacts and six
Bonsai JSONs use deterministic gzip and the existing packed registry. The
exporter verifies all 194 uncompressed restore hashes,
preserves every old registry entry, and checks configured site/free-space limits.
HDBSCAN download links use their own busy/route-aware handler with verified
packed fetches and actual-count native filenames; the generic legacy capture
handler skips only explicitly marked app-managed links.
No scoring, sampling, fitting or coordinate conversion occurs in this exporter.

## SR215 focused cohorts

The main atlas includes the 2,000-model AFS3/BioEmu2 cohort and the 2,150-model cohort with the three uploaded 260 ensembles. Both offer four residue subsets, primary and HDBSCAN clustering, accepted MCMC/DISCO panel highlights by supported TM state and repeat, current RPF/DP and Double Recall reports, and representative-to-medoid TM comparisons. Reports are `cohort-2000-analysis.html` and `cohort-analysis.html`; their panel rows link directly to the selected atlas highlights. Uploaded conformers retain stars and their three medoids retain larger stars.

Large new coordinate ensembles, selected-panel PDBs, representative models and Bonsai payloads retain their existing public storage at `https://benavt.github.io/sr215-cohort-atlas/`. Exact per-file transport records live in `external-assets.json` and `packed-assets.json`; bytes and SHA-256 are verified before use or download. Scientific logical paths, memberships, clustering data and scores are unchanged. All five atlas targets and existing historical/current cohorts remain native to this site.

Run `node --test --test-concurrency=2 tests/*.test.cjs tests/*.test.mjs` and `node scripts/test_cohort_sampling.cjs` for atlas, transport and accepted-panel coverage checks.
