# Experimental fracture surfaces and rendered fitting

Select **Fracture surfaces + fitting** in the budget curve, or **Fracture surfaces · experimental** in Preservation. CLI/MCP use `method: "surfaces"`. This implements three experiments: connected coarse fracture patches, rendered-error refinement under a triangle cap, and sweeps that report the smallest tested passing budget. It does not guarantee a 500-triangle pass.

## Connected patches

Generator labels partition source triangles into connected exterior and opposing-wall patches. Shared edges form mouth, tip and wall-boundary paths; intersections identify junctions. Tiny label fragments of at most four faces may merge into an adjacent larger patch of the same fracture. The source geometry is never changed. Labels describe the generator's sampled footprint, not exact analytic fracture curves.

A quadric reducer simplifies patch interiors while keeping shared topology. Boundary vertices move along compatible edges, multi-patch junctions remain fixed, and every patch retains at least one face. Edge collapses use link and local normal checks. Per-patch source/output triangle counts, path counts and blocked budgets are reported. Preserving this network can prevent the reducer from reaching a small target.

The workflow also constructs a skeleton candidate. Among candidates it prefers one meeting the budget, then fewer failed development checks, lower worst wall-depth error and lower residual penalty. The patch candidate can lose, especially at low budgets. Reports identify the selected seed explicitly. Patch allocation describes the patch candidate even when a skeleton seed wins.

## Rendered fitting

The selected mesh is measured against the canonical source at 16 development cameras. Visible wall-depth mismatches produce geometric witnesses. Up to 32 iterations (eight by default) try source-projected vertex moves, edge flips, local face splits and compensating edge collapses. A split consumes spare budget or pairs with a collapse; accepted edits cannot exceed the requested cap. A constrained seed already above budget stays explicitly marked over budget.

For patch meshes, interior vertices project to their source patch, shared-boundary vertices project to the corresponding source edges, and junctions stay fixed. Newly split vertices inherit their parent patch before projection. Skeleton seeds have no patch partition and project to the source globally; they do not acquire the patch constraints merely by entering this workflow.

An edit is accepted only if total failed checks, failed gaps and maximum wall p95 depth do not increase. It must reduce either failed checks or residual penalty. The comparison is lexicographic: fewer failures may outweigh a higher residual penalty. The history records actual counts and accepted operations. This is a finite local search, not a global solver or a guarantee that every wall improves.

## Independent checks and budget search

After fitting, 16 additional azimuth/elevation combinations are evaluated. They never participate in seed selection or fitting. Both camera sets must pass the unchanged acceptance policy at 128 pixels: gaps of at least four pixels allow at most 20% fill with a one-pixel allowance; walls of at least eight pixels allow at most 10% missing coverage with a two-pixel allowance, and wall p95 depth must be at most two pixels. Sizes 64 and 256 remain diagnostic.

The combined report concatenates per-view observations and failures, uses the larger worst wall error/gap fill and the smaller set-level silhouette overlap. Its aggregate silhouette statistic is conservative, not a pooled 32-view pixel average. Failures count region/view observations, not unique fractures.

`budgetStudy.smallestPassing` is the smallest actual passing mesh among the tested candidates that met their requested budget. It is an upper bound for this source and finite test suite, not a proven minimum. Failed low-budget samples do not establish impossibility. Every budget starts from the same source, and nonmonotonic results remain visible.

## Reproduce and inspect

```sh
npm test
npm run test:surface-workflow
npm run test:surfaces
npm run test:surfaces -- --held-out
```

The study writes JSON and source/skeleton/patch/fitted silhouette, depth and wall-error contact sheets under `output/fracture-surfaces/`. It uses resolution 88, four fitting iterations and budgets 500, 1,000, 2,000, 4,000, 8,000, 16,000 and 32,000. Development cases are overhang/split. Fresh reserved slab/path seeds test transfer. SHA-256 hashes of the four strategy modules are recorded and checked at completion; do not edit those modules during a study. Observational quality failures are reported without failing the runner; browser errors fail it.

The studio fits only background LOD 1 automatically. Near and distant levels retain coarse patch meshes and need their own quality review. Curve measurements can evaluate any requested budget independently. Export waits for the current background result and includes the measurements; portable GLB baking/export stays in the studio.

Local checks do not prove global manifoldness or absence of self-intersections. Some canonical source meshes already contain edges shared by four faces; the reducer reports this and does not collapse those edges. Neither texture baking nor a matching silhouette repairs missing cavity geometry. Finite cameras do not guarantee every view, animation transition, collision mesh or material bake.

The design draws on Garland and Heckbert's quadric error reduction and Lindstrom and Turk's image-driven simplification. Those ideas motivate the objectives; the checks above determine whether this implementation succeeds on a particular asset.

## Frozen study results

Resolution 88, four fitting iterations, unchanged acceptance across 32 cameras. Failures count region/view checks.

| Fixture | Actual at requested 500 | Skeleton failures | Fitted failures | Smallest tested passing actual |
|---|---:|---:|---:|---:|
| overhang | 500 | 117 | 105 | 16,000 |
| split | 482 | 286 | 286 | 31,220 |
| reserved-slab | 498 | 324 | 315 | 32,000 |
| reserved-path | 496 | 633 | 606 | None through 32,000 requested |

None of the four 500-budget candidates passes. Refinement reduced total failures on three fixtures, but stalled on the split rock. These measurements support continuing work on the coarse representation; they do not establish that any requested budget is impossible. The passing split result is the full 31,220-triangle source, so it demonstrates no accepted reduction for that fixture in this sweep.

A separate studio smoke test at source resolution 54 found an 8,000-triangle passing overhang, applied the selected point, and baked/exported a core GLB with no validator errors or warnings. That lower-detail source result must not be substituted for the resolution-88 study.
