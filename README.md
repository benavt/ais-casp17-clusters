
The current display adapts plot dimensions, legends, tables and controls to phone,
tablet and laptop viewports. Heat maps retain square cells and use horizontal color
scales. The projections share one interactive color legend above the plots. Category clicks
filter all three projections together. Each plot provides touch-sized reset and
PNG controls; projection captions and zoom buttons are omitted. Saved numerical
arrays and scientific artifacts are unchanged by responsive formatting.

Run the source-level responsive regression checks with
`node --test tests/*.test.mjs`. Browser visual and interaction checks
are a separate validation step.
