# Visual quality and fracture protection

## Using protection

The Game asset panel now offers **Off**, **Rim landmarks**, and **Keep fracture faces** for the four Fjord rock types. Other specimens reuse the same vertex channels for different meanings, so protection is disabled for them.

**Rim landmarks** uses generator-authored IDs and role masks for open fracture mouths, opposing walls and tips. Legacy Fjord sources without metadata fall back to the fresh-face signal. It finds rim bends and region extents/interiors, then selects a bounded set of landmarks in position-and-normal space. Nearby opposing walls remain distinguishable. At a 500-triangle target, it selects at most 40 landmarks. Landmarks start as individual fixed points. If simplification makes a point unreferenced, only that point receives a supporting incident triangle and the reducer retries from the canonical source. Two selective retries are followed by a bounded all-support fallback if needed. The displayed fixed-vertex count includes support and repair vertices. Opening repair is enabled by default within landmark mode; it samples visible gaps and wall depth, adds constraints locally where checks fail, and can exceed the requested budget. See [opening repair](opening-repair.md) for the quality contract and limitations. This is a heuristic preservation mode, not a guarantee that every crack remains unchanged.

**Keep fracture faces** fixes every vertex of every classified fracture face. A face is classified from its generator tags. Legacy Fjord sources without tags use a mean fresh-face signal of at least 0.35. The signal includes some spalls and joint faces; closed shader hairlines and faint unmarked fractures are not all included. After simplification, the reducer verifies that every marked triangle and its winding survived. It also checks that every selected landmark and any supporting triangle survived, including triangle winding. An integrity failure stops generation with an error instead of exporting an asset that violates the constraints.

Both protection modes enforce the selected fidelity tolerance, even when the triangle target is lower. Fixing a fracture while collapsing the rest of the object without an error limit can damage the silhouette badly. The interface therefore switches to Preserve quality while protection is enabled, reports actual counts, and flags unmet budgets. Off retains the original budget-oriented workflow. Protection is opt-in because preserving fracture geometry and minimizing background-asset cost are different tradeoffs.

Landmark mode uses a different attribute weighting from Off and Keep fracture faces: normals retain 25% of their previous weight; the fresh-fracture signal retains its full weight; colour, weather and other material channels retain 10%. Portable textures recover those surface details. The error limit itself is unchanged. These weights were selected using paired visual tests; they are not a calibrated perceptual metric. Bake textures before judging final material quality.

The raw rim tolerance only selects candidate landmarks. Subsequent landmark selection means it is not a bound on final rim deviation. Tiny feature components may be ignored in Rim landmarks. Keep fracture faces does not use that small-component filter.

## Running the tests

```sh
npm ci
npx playwright install chromium
npm test
npm run test:visual
```

On a Linux CI machine, use `npx playwright install --with-deps chromium` to install browser system dependencies. The runner starts and closes its own local Vite server and headless Chromium instance. It uses SwiftShader, DPR 1, fixed lights/cameras, 2× supersampling and 512 px bake textures. Browser/shader errors fail the run. Shader programs are retained across repeated bakes to avoid repeatedly compiling the procedural material; atlas textures and projection buffers are released.

The full matrix covers four deterministic fixtures (overhang, open split boulder, thin slab and a weathered alternate seed), eight camera angles, and 64/128/256 physical-pixel bounding-sphere diameters. Each source is compared with five alternatives: unprotected at the 500-triangle request, semantic landmarks without repair, landmarks with opening repair, strict protection, and an unprotected control requested at the repaired mesh's actual count. Actual matched counts can undershoot the request; they are shown explicitly. This produces **480 source/LOD comparisons**, each with colour, silhouette, shading-normal and camera-depth captures. The GPU matrix evaluates LOD 1 at three image sizes; LOD 0 and LOD 2 receive runtime checks rather than this full GPU matrix.

The test adapter is dev-only. It drives the real generator, real source shader and portable UV baker; it is removed from production builds. It renders isolated rocks without a ground plane, fog or cast shadows so those effects do not obscure geometry/material differences. Engine lighting, shadow and LOD-transition testing remain separate work.

Tiny UV charts can have undefined UV derivatives. The baker replaces zero/nonfinite tangents with a deterministic unit frame perpendicular to the surface normal, shared by texture projection and GLB export. This does not change protected geometry. A regression test covers collapsed charts; both example protected GLBs pass the Khronos validator without errors or warnings.

## What is measured

| Metric | Meaning |
| --- | --- |
| Silhouette IoU | Binary intersection-over-union after supersampling. Higher is better. |
| Boundary error | Symmetric Euclidean distance between silhouette-boundary pixels. Reported in physical pixels. |
| Gap fill | Fraction of source-background pixels inside its projected convex hull, near visible fresh faces, filled by the LOD. A visible-opening proxy, not a topology certificate. |
| Fracture depth error | Camera-depth difference on overlapping visible marked-fracture pixels, normalized by source bounding-sphere diameter. Detects cavity flattening even without a through-hole. |
| Lost fracture area | Marked source pixels no longer covered by the candidate. |
| Colour MAE | Mean absolute sRGB channel error after explicit HDR-to-ACES/sRGB output conversion. |
| Shading-normal error | Angular difference in degrees, including the source's procedural bump and the baked tangent-space normal map. |

Colour, depth and normal metrics exclude mixed silhouette-edge pixels. Missing measurements are reported as unavailable, not perfect scores. Empty reference images fail. Metrics are deliberately separate: a single average could hide a closed opening or trade material fidelity against shape without making that choice visible.

`output/visual-quality/index.html` contains the table and contact sheets; `report.json` contains every comparison, renderer metadata and regression failures. The report distinguishes improvements purchased with more triangles from effects of the protection constraints by including the matched-count control. Protection is not expected to win every global image metric at equal cost.

## Regression baseline

`tests/visual/baseline.json` records the reviewed regression matrix. Absolute opening acceptance is a separate gate: a replacement baseline cannot make an unacceptable opening pass. The default command exits nonzero when a metric worsens beyond its explicit slack, a measurement disappears, counts change, a matrix entry is missing/duplicated, or the browser reports an error. The slack allows small raster/numerical variation: 0.005 silhouette IoU, 0.5 boundary pixels, 0.03 gap fill, 0.015 sRGB MAE, 2° mean normal error, 0.002 normalized fracture-depth error and 0.02 lost fracture area. These are regression tolerances, not universal asset-acceptance thresholds.

For a quick repeat of two overhang views at 128 px:

```sh
npm run test:visual -- --quick
```

After an intentional change, inspect the new contact sheets and paired controls before recording a replacement baseline:

```sh
npm run test:visual -- --update-baseline
```

Recording a baseline is never itself evidence of better quality. Unit tests independently inject a closed opening, a shifted silhouette, changed normals/colour and a flattened cavity to verify the metrics detect those failures. They also check that missing/invalid measurements and changed counts fail the regression gate. Geometry tests verify exact retention of fixed patches and marked faces, including winding, against actual generated rocks.

## Development and fresh-seed validation

`npm run test:visual -- --held-out` checks four additional fixed seeds, including the fourth Fjord form (Path stone) and two high-resolution (144) references. It has a separate baseline and report at `output/visual-held-out/`. These cases were unseen during the v2 landmark-weight selection. They are now part of the development/regression corpus, including v3 opening repair. `--validation` uses four separately reserved seeds and writes `output/visual-validation/`; report notes state when those seeds were first evaluated.

## Absolute opening acceptance

`npm run test:openings` checks visible opening components at a 128-pixel projected bounding-sphere diameter, independently of the regression baseline. A gap component of at least four pixels may fill at most 20%, with a one-pixel allowance for small components. A wall component of at least eight pixels may lose at most 10% coverage (two-pixel allowance), and its p95 camera-depth error must be at most two pixels. Each wall side and connected component is tested separately. Missing semantic captures fail the gate.

The source defines eligible regions. CPU raycasts guide repair; GPU renders independently verify the result using shared region definitions. Reports retain failures per fracture ID, component and camera. The 64/256-pixel captures remain diagnostic; passing at 128 pixels is not a promise of close-up quality. `--review` produces diagnostics without enforcing regression or acceptance in the exit code; browser errors still fail. `--update-baseline` records regression measurements but still fails its exit code when absolute acceptance fails.

## Next extensions

Expand seed and source-resolution coverage, light rotations, engine-import comparisons, and explicit texture-memory budgets. Cavity-aware bake projection and compressed texture ladders remain useful next steps. The current suite measures static appearance; it does not certify temporal stability, all possible viewing directions, or visual quality for every generated seed.

## Historical results before the budget refinement

At a 500-triangle request and the balanced 3% fidelity tolerance, the original landmark meshes contain 980 / 1,290 / 940 / 1,496 triangles for overhang / split / slab / weathered fixtures. The strict meshes contain 3,008 / 10,090 / 5,096 / 17,280. These counts are measured for the resolution-88 corpus, not universal limits.

Mean silhouette IoU improved with landmarks from 95.29% to 96.82% (overhang), 95.45% to 97.72% (split), 96.09% to 97.36% (slab), and 92.77% to 96.70% (weathered). The report includes actual matched-count controls because these improvements partly come from retaining more geometry.

Landmarks are not uniformly better: split-boulder gap fill improved from 13.78% to 6.61%, but worst-view fracture-depth p95 increased from 3.44% to 6.79% of the bounding-sphere diameter. Strict protection reduced those values to 3.07% and 0.57%, at much higher cost. The opt-in controls and separate metrics make this tradeoff visible rather than hiding it behind a single quality score.

## Budget refinement

See [landmark budget experiments](landmark-budget.md) for the selected strategy, before/after counts, validation results and remaining tradeoffs. `tests/visual/landmarks-v1.json` preserves the old landmark measurements independently of the current regression baseline.
