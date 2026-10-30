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

This site consumes the canonical Structure_Clustering main release [`c68587076f3b`](https://github.com/benavt/Structure_Clustering/commit/c68587076f3b8cad6ac3df55b02510c8e0fa496c). The actual renderer is `84cc73a5493fc36ef2691fcfb9e0287f88362037`; its complete Git tree matches that release (`1bbdb8f7915aad632db7a29d1f38a9c8a46ac2d3`). Shared explorer behavior is maintained in the canonical repository.

The explorer offers Primary and HDBSCAN for all five CASP17 targets. SR215 supports canonical residues 1–139 and 5–95; PaT90 clustering retains the frozen canonical 8–91 mask. Saved computational cluster labels do not establish biological state counts.
