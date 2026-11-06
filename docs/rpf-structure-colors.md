# RPF structure colors

The structure color selector uses the existing RPF viewer conventions. Model DP,
Recall and Precision use Viridis, with bounds from the selected state ensemble;
ties share a color, negative DP is retained, and unavailable values are gray.
The preparation selector keeps Reduce and phenix.reduce observations separate.
These are saved independent full-construct scores, including when the structure
is clipped to a smaller clustering residue range.

Residue heat, precision violations, short violations and shortest unsupported
distance reuse the RPF native QP projection. The heat colors are exact saved
native RGB values, not a linear approximation of its thresholds. Unassigned
residues are unavailable. These diagnostics are not residue-wise Recall,
Precision or DP fractions. Each report comes from a previously scored single
model, not an ensemble-averaged diagnostic assigned to individual conformers.
Only models with matching original and prepared-coordinate identities can use a
report. Missing reports stay gray; nothing is inferred from B factors.

`assets/rpf_structure.js` is the unchanged public RPF viewer component from the
reviewed outputs-only site (reference commit
`12936f5df3c955fdba6390b74c29d1d15be1b3d4`). This site reuses its `colors` API;
it never mounts the RPF backend viewer. The regression suite pins the component
SHA-256 and checks its palettes and native-color behavior. `structure_metrics.js`
is the thin adapter for verified CASP17 frame IDs, controls and legends.

The selected state PDB is verified before loading. Each GLModel is bound to the
saved frame order and original source hash. Annotation changes, isolation and
opacity do not alter coordinates, saved state selections or download bytes.
Ensembles start opaque, matching the RPF viewer. Coloring preserves the camera.
Unbound legacy comparison ensembles cannot inherit per-model annotations.

`scripts/build_structure_residue_metrics.py` reads a verified selected collection
of saved QP reports, the matching prepared PDBs and experimental shifts, and a
pinned RPF checkout. It calls the existing `rpf_browser.residue_metrics` parser.
It performs no scoring, model selection, alignment or coordinate export. Its
compressed annotation output and source catalog belong to the frozen publication
snapshot, alongside existing generated data. They are not scientific rerun hooks.

The current private SR215 snapshot covers all 267 distinct models in the six
MCMC50/DISCO50 state ensembles across the three ranges. Residue diagnostics use
Reduce preparation; both saved preparations have model-level scores. Publication
remains a separate reviewed action.
