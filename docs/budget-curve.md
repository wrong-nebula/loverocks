# Custom quality–budget curves and fracture skeletons

## Authoring controls

The curve is measured on the current canonical source, not fitted to a preset table. Open **Game asset → Quality vs budget**, enter 1–12 integer budgets between 24 and 50,000, and choose a method. Commas, spaces and semicolons are accepted; duplicates are removed and budgets are sorted. Invalid entries produce an error rather than silently changing the request.

- Methods: fracture skeleton, landmarks without repair, landmarks with repair, all fracture faces, or unprotected reduction.
- Priority: meet budget or preserve quality. Landmark and all-face methods require quality priority, shown as a disabled quality selection. Skeleton and unprotected modes support both.
- Tolerance and feature emphasis come from Preservation settings. Budget priority may exceed the simplifier tolerance.
- Viewing size: 64, 128 or 256 physical pixels. Only 128 pixels is the acceptance contract; other sizes are diagnostics.
- Plot: worst per-wall p95 depth error, silhouette overlap or failed region checks. The x-axis uses actual triangles; the table also retains requested budgets.

Each point is reduced independently from the source in a terminable worker and measured on the GPU from 16 cameras. Cancel stops pending work and retains completed points. Editing comparison settings or changing the source invalidates old measurements. Applying a selected point reuses the source and generates the full near/background/distant LOD set. Settings are saved in local storage after starting a valid comparison. Reset budgets restores the default budget list only.

**Export measurements** saves source identity, settings, actual counts, CPU estimates, GPU observations and the fixed acceptance policy. Partial exports are marked incomplete. Changing the plotted metric only changes the display, not the measured data. Curves do not measure bake fidelity, texture memory, runtime performance or LOD-transition flicker.

## Sparse fracture guides with movable vertices

`fracture-skeleton.js` traces transitions between generator-authored fracture/wall labels into paths, simplifies those paths and adds wall/tip extrema as guide candidates. Spatial sampling selects a bounded set: 20 guide nodes at a requested 500 triangles, up to 128 at higher budgets. These nodes remain fixed; neighboring support triangles are added only if a guide would otherwise disappear.

Meshoptimizer's `simplifyWithUpdate` performs quadric reduction with movable free vertices. Source positions, attributes and indices are copied before every attempt because the API mutates its inputs. First-use vertex ordering makes tie-breaking repeatable. Compaction retains weather and authoring labels, normalizes normals and clamps bounded material channels. Feature emphasis scales the fracture/geological attribute weights.

The guides are sparse, not a retained fracture network: the reducer may move boundary vertices, omit small branches, or flatten/close openings. Discrete labels follow retained source vertices; they are provenance, not a new evaluation of the procedural cut field after movement. The mode remains experimental and its opening measurements must be inspected. Dense seam constraints and paired-wall experiments were less useful at the tested budgets; they are not shipped.

Design references: [Garland and Heckbert's quadric error work](https://www.cs.cmu.edu/~garland/quadrics/quadrics.html), and [meshoptimizer's simplifier implementation](https://github.com/zeux/meshoptimizer/blob/master/src/simplifier.cpp). Quadric error supplies a practical reduction objective; independent image checks expose fracture damage that this objective alone does not prevent.

## Independent rendered acceptance

`opening-gpu.js` renders reference labels/coverage/depth and candidate coverage/depth independently of the CPU repair estimate. The application checks background LOD 1 automatically for protected Fjord meshes. Other LODs are explicitly described as CPU estimates; export waits for the current LOD 1 GPU result and includes it in metadata. A GPU failure cannot be displayed as a pass merely because CPU sampling succeeded.

The fixed 128-pixel policy is unchanged: connected gaps of at least 4 pixels allow at most 20% fill with a one-pixel allowance; wall components of at least 8 pixels allow at most 10% missing coverage with a two-pixel allowance, and p95 depth error must stay within 2 pixels. Every eligible component must pass. Finite camera sampling is not an all-view guarantee.

The two previous regression failures are now repaired. For small wall components, CPU repair also considers the maximum sampled error so a single outlier cannot disappear below p95 when rasterization changes the component's size. Later repair passes constrain the actual occluding triangle instead of repeatedly pinning an already-exact wall behind it.

| Fixture | Before triangles | After triangles | GPU failed regions before → after | Worst wall p95 before → after |
|---|---:|---:|---:|---:|
| validation-slab | 21,086 | 20,572 | 1 → 0 | 3.89 → 0.91 px |
| validation-path | 25,720 | 25,960 | 1 → 0 | 3.63 → 1.13 px |

Those reproduction cases use the original eight-camera suite. The shipped curve and automatic application check use 16 cameras. The old reserved cases are now development regressions, not fresh holdouts.

## Measured low-budget limits

Final corrected results use source resolution 88 and the 16-camera GPU validator. Counts below are failed region/view checks, not unique fractures. The reserved seeds were not used to tune the selected strategy.

| Fixture | Requested budget | Landmarks without repair | Skeleton | Skeleton actual triangles |
|---|---:|---:|---:|---:|
| split | 500 | 165 | 142 | 482 |
| split | 750 | 141 | 106 | 730 |
| split | 1,000 | 114 | 86 | 988 |
| split | 2,000 | 47 | 49 | 1,946 |
| reserved split | 500 | 189 | 170 | 492 |
| reserved split | 1,000 | 129 | 89 | 996 |
| reserved split | 2,000 | 45 | 37 | 1,994 |
| reserved path | 500 | 118 | 103 | 486 |
| reserved path | 1,000 | 73 | 61 | 970 |
| reserved path | 2,000 | 31 | 24 | 1,984 |

The skeleton reaches the requested low budgets and usually reduces failed checks in this small sample, but it is not uniformly superior. Worst wall depth can increase even when fewer regions fail. None of these low-budget points meets the strict opening contract. The 500-triangle quality goal remains unresolved; quality-preserving repaired meshes still cost many thousands of triangles.

## Reproduction

```sh
npm ci
npx playwright install chromium
npm test
npm run build
npm run test:budget
npm run test:budget -- --held-out
npm run test:fracture-cases
npm run test:glb -- /path/to/export.glb
```

Budget runs write JSON and source/LOD silhouette, depth and wall-error contact sheets into `output/fracture-skeleton/budget-check/` and `budget-held-out/`. These are observational sweeps: quality failures remain in the report and do not themselves fail the command. Browser errors do fail. `test:fracture-cases` fails if either repaired fixture fails CPU or GPU acceptance; its frozen v3 repair fixture lives under `tests/fixtures/opening-v3/`.

Unit tests cover immutable sources, deterministic reduction, retained fixed guides, unit normals, compacted metadata, feature-emphasis behavior and no new open edges on the tested mesh. These checks are not a general proof of manifold topology. The existing broader baked-material visual suite remains separate; its v3 baseline is not silently replaced by these measurements.
