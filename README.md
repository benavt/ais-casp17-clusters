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

This site is generated from the reviewed canonical Structure_Clustering default-energy renderer [`75da02c32830`](https://github.com/benavt/Structure_Clustering/commit/75da02c3283071de7305455bf6295f9d2a18cc60), Git tree `9f8f78eb3d7ada58e0073816b6e24010889affdd`. Shared explorer behavior is maintained in the canonical repository. The exact renderer, loader and saved-data identities are recorded in `publication-provenance.json`. Set view aligns display models using the clustering residues and preserves the camera/slab while switching clusters; saved coordinate files and downloads stay unchanged.

The explorer offers Primary and HDBSCAN for all five CASP17 targets. SR215 supports canonical residues 1–139 and 5–95; PaT90 clustering retains the frozen canonical 8–91 mask. Saved computational cluster labels do not establish biological state counts.

ProteinEBM model 6 supplies one optional energy color at the saved default conditioning level **t=0.10**: **55,000 scores, one per model**. This replaces the unavailable template-only refold placeholders. Saved clusters remain the default color. Energies are unnormalized learned scores in arbitrary units, lower-first within a target; they are not calibrated physical energies, confidence scores or trajectory times. Values use each full construct, including PaT90’s 97 residues and SR215’s 139, and stay identical across clustering methods and residue-range selections. Other energy levels are excluded from this site. Existing measured confidence and reference similarities remain available.
