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
TM-state selections. Fine-cluster representative coordinates, Bonsai and medoid
grids were not generated for that new range and are explicitly unavailable;
its state ensemble downloads remain available. The older PaT90 8–91 analysis
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
scope; coordinate ensemble/PSE availability remains that of the original result.

## Source and data

This site is a static snapshot generated by the Structure_Clustering library's
explorer renderer. Raw model data is being deposited on Zenodo, one record per
target; DOIs are pending and will be added here when published.
