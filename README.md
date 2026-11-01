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

This site is generated from the reviewed canonical Structure_Clustering saved-selection renderer [`c517b0058d37`](https://github.com/benavt/Structure_Clustering/commit/c517b0058d378fb2dd695bb5c10850c7b5834572), Git tree `32ecdc6ce9658a0e8e6e84bdfab07d1f9e691721`. Shared explorer behavior is maintained in the canonical repository. The exact renderer, loader and saved-data identities are recorded in `publication-provenance.json`. Set view aligns display models using the clustering residues and preserves the camera/slab while switching clusters; saved coordinate files and downloads stay unchanged.

The explorer offers Primary and HDBSCAN for all five CASP17 targets. SR215 supports canonical residues 1–139, 5–95, and the combined mask 32–47 + 78–99 (38 residues); PaT90 clustering retains the frozen canonical 8–91 mask. Saved computational cluster labels do not establish biological state counts.

ProteinEBM model 6 supplies one optional energy color at the saved default conditioning level **t=0.10**: **55,000 scores, one per model**. This replaces the unavailable template-only refold placeholders. Saved clusters remain the default color. Energies are unnormalized learned scores in arbitrary units, lower-first within a target; they are not calibrated physical energies, confidence scores or trajectory times. Values use each full construct, including PaT90’s 97 residues and SR215’s 139, and stay identical across clustering methods and residue-range selections. Other energy levels are excluded from this site. Existing measured confidence and reference similarities remain available.


The independent **Highlight selection** menu shows saved weighted or uniform 200-model panels, exact categorical visited models, Metropolis–Hastings visited models, or DISCO minimum-energy models. All five targets are covered for Primary and HDBSCAN, including all three SR215 masks: 14 target/range/procedure combinations. The browser reads completed saved model IDs; it never samples, scores or reclusters. Plot colors, cluster inspection and the set camera remain independent. Point clicks inspect the selected point's saved cluster representative.

Each partition has nine saved balance/energy-scale conditions (alpha 0/0.5/1 and tau/IQR 0.5/1/2), with 20 saved unique-panel replicates. ProteinEBM conditioning remains t=0.10; selection tau is a separate within-target scale. Assigned-cluster weights are proportional to exp(-(E-E_min)/tau) divided by cluster size raised to alpha. HDBSCAN preserves aggregate energy-only noise mass across balance settings. DISCO chooses the minimum-energy model per assigned structural cluster and excludes noise; its count varies with the partition. Visited-model rings are distinct memberships, not visit frequencies or 200-model panels.

The fixed-budget MCMC chains have observed mixing limitations. In the additional four-target pilot, matched independent categorical draws had smaller cluster total-variation error in 71 of 72 conditions; one MCMC condition missed a cluster with 2.18% declared target mass. Active MCMC status reports the saved MH and matched-IID cluster errors and unvisited assigned-cluster count. Lower error means closer agreement with the declared target label probabilities. These exploratory chains do not establish convergence or equilibrium populations. Exact categorical draws provide the finite-pool occupancy comparison; weighted unique panels trade energy against structural coverage.

The third SR215 mask retains its completed representative-only stage. Saved PCA/UMAP/t-SNE projections, variance labels, distance summaries and representative PDBs are included; Bonsai, complete medoid grids and coordinate ensembles/PSE exports for that mask are explicitly unavailable. Existing complete figures and exports for the other twelve views are preserved. Selection runs are completed and frozen; static-page preparation performs no further sampling, clustering, scoring or coordinate export. No automatic/K=2–20 clustering choices or private residue-planning controls are published.
