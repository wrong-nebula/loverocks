# Landmark mode near 500 triangles

The 500-triangle request now produces **498 / 484 / 492 / 500 triangles** for the overhang / split / slab / weathered test fixtures, compared with 980 / 1,290 / 940 / 1,496 previously. These results use source resolution 88 and the balanced 3% fidelity setting; they are not universal budget guarantees.

## What changed

Landmarks begin as fixed points. The reducer adds an incident triangle only when a point becomes unreferenced, then retries from the original mesh. Two selective retries precede a final all-support fallback, so the retry cost is bounded and no promised landmark is silently dropped. All fixed points and supporting triangles are checked after reduction; triangle winding must survive. Strict face protection and unprotected reduction are unchanged.

This removes redundant tiny patches around points that already survive. The four fixtures now retain 42 / 42 / 44 / 44 fixed vertices, versus 117 / 120 / 120 / 120. The same 40 selected landmarks are retained.

For landmark mode, normal weights are multiplied by 0.25, colour/weather and other material weights by 0.1, and the fresh-fracture signal retains its full weight. This allocates geometry to shape while the existing portable texture baker recovers surface appearance. It does not relax the requested error limit. Inspect the baked preview when judging material quality.

The approach uses meshoptimizer's positional locks and attribute-aware simplification; see the [library documentation](https://meshoptimizer.org/#attribute-aware-simplification). Locks and tolerance can still stop reduction above budget. An individual landmark does not preserve an entire rim or cavity.

## How visual tests selected the change

Four experiment rounds compared attribute weights, 20/40/60 landmarks, fixed patches and selective support. The same source shader, portable baker, lighting and cameras were used throughout. Early screening used eight views at 128 pixels; finalists were checked at 128 and 256 pixels, then the selected implementation at 64/128/256 pixels.

Retaining less fracture emphasis looked acceptable in aggregate silhouette scores but flattened part of the split boulder: worst-view fracture-depth p95 reached 9.50% of bounding-sphere diameter at the intermediate weight. Restoring the full fracture weight reduced that result to 2.58% in the two-size experiment. This was a reason to reject that candidate, not average its defect away.

The final three-size matrix contains 384 comparisons, including unprotected meshes at both the requested and actual landmark triangle counts. Historical landmark measurements remain in `tests/visual/landmarks-v1.json`; the new regression baseline was recorded only after reviewing the comparisons. The count changes deliberately invalidate the old baseline. Off and strict controls showed no regressions against it.

## Before and after

| Rock | Previous triangles | New triangles | Reduction | Silhouette IoU: previous → new |
| --- | ---: | ---: | ---: | ---: |
| overhang | 980 | 498 | 49.2% | 96.82% → 97.79% |
| split | 1,290 | 484 | 62.5% | 97.72% → 97.00% |
| slab | 940 | 492 | 47.7% | 97.36% → 97.69% |
| weathered | 1,496 | 500 | 66.6% | 96.70% → 95.51% |

Compared with unprotected meshes at the same 500-triangle request, the new mode improves mean silhouette overlap and worst-view fracture-depth p95 on all four tuning fixtures. Gap fill improves on three; the weathered rock worsens slightly, from 14.14% to 15.46% of eligible gap pixels.

This is a budget-quality tradeoff, not identical preservation at one-third of the cost. Against the previous, denser landmark meshes, the slab and weathered rock lose cavity fidelity. Weathered fracture-depth p95 rises from 4.75% to 6.70%, and its gap-fill measure rises from 4.09% to 15.46%. Use higher budgets or **Keep fracture faces** when those features matter at the intended viewing distance. The nearest-surface bake can also mix details across narrow crevices; that remains separate work.

## Reproduce

```sh
npm ci
npx playwright install chromium
npm test
npm run test:visual
npm run test:visual -- --held-out
```

The unseen-seed set includes all four Fjord forms, two source-resolution-144 references, and weathering. It was evaluated after choosing the strategy and is retained as a separate regression suite. The baseline tolerances have not been loosened. Both suites output all measurements and contact sheets, including unfavorable views.

## Unseen-seed results and limits

The four additional seeds produced 498 / 498 / 520 / 498 triangles (overhang / split / slab / path). The first two use source resolution 144. Mean silhouette overlap improved over the unprotected 500-triangle request on all four. Worst-view cavity-depth p95 improved on three; the weathered slab worsened from 11.56% to 13.66% of bounding-sphere diameter.

Gap fill worsened on all four unseen seeds: 2.33% → 16.28%, 8.67% → 16.07%, 7.00% → 8.96%, and 9.98% → 15.28%. This metric concerns a small, view-dependent subset of pixels, but the increases are a real limitation: sparse points do not constrain an entire opening. These cases were retained, not used to retune the weights or excluded from the report. Choose strict protection or increase the budget for critical open joints.

The default High-detail studio overhang and split exports both reached exactly 500 triangles. Their distant LODs stopped at 290 and 376 against a 128 request because the fidelity constraint remains active. These are honest early stops, not silent relaxation of protection.
