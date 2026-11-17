# Generator labels, local opening repair and acceptance

**Update:** the two v3 failures recorded below are now repaired by small-component outlier checks and occluder constraints. The app also reports independent GPU results for LOD 1. See [current curve and fracture validation](budget-curve.md) for the reproduced before/after results and remaining low-budget limits. The v3 measurements below are historical.

## Controls

Choose a Fjord rock, select **Rim landmarks**, set the triangle target and press **Apply budget**. **Opening repair → Check & repair** is the default for this protection mode. Turn repair off to compare the original semantic landmark reduction. **Keep fracture faces** is the more expensive alternative that retains every classified source face.

The requested target remains visible even when constraints require more triangles. Near/background/distant levels are checked at nominal projected sizes of 256/128/64 pixels. Runtime witnesses use a 128-pixel reference grid with size-scaled eligibility/error thresholds; the GPU suite renders actual 64/128/256-pixel captures. The status reports sampled checks, not a universal guarantee. An unresolved status requires inspection or a different budget/protection mode before using the asset. Portable GLB export remains available for deliberate tradeoffs.

## Generator-authored semantics

The Rust generator adds four floats per vertex, separately from render/material attributes:

| Field | Meaning |
| --- | --- |
| ID | 0 means unclassified; 1 is the main joint; 2 + network index identifies an open finite cut. Stable for the same seed/settings. |
| Side | −1/0/+1 relative to that cut's local plane. |
| Role bits | 1 wall, 2 mouth/lip, 4 finite tip or T-junction termination. Roles can overlap. |
| Aperture | Local generator opening width. |

Metadata follows the dominant open cut at each surface-net vertex. Mouth and tip masks use the field footprint and the extraction-cell size. These masks are approximate semantic neighborhoods, not exact topological boundary loops. Closed shader hairlines and veins have no open-cut ID. Other rock families have no Fjord tags. Field evaluation and extracted source geometry are otherwise unchanged.

Worker transfers, cached canonical sources and mesh compaction preserve metadata. Reduction starts from the canonical source on every attempt. Face classification uses the dominant nonzero vertex ID; exact ties choose the smaller ID. Legacy Fjord inputs without tags retain the previous fresh-face classifier, but cannot claim semantic opening checks.

## Repair

A CPU reference pass casts supersampled perspective rays from 16 directions: eight azimuths at each of two elevations. Source labels define connected visible gap regions and separate wall sides. The reducer first keeps a bounded set of landmark points. Failed gap or wall-depth checks add local source constraints; persistent failures retain small source patches and nearby obstruction patches. Every fixed point and supporting triangle is verified after simplification, including winding. No disconnected triangles are pasted into the reduced mesh.

The search tries sparse points first, then an overall detail ladder before adding denser patches around residual failures. It retains every distinct reference triangle hit by the four subpixel rays and targets the worst obstructing hit. After passing, it retries smaller requested budgets with those constraints fixed. The search is bounded. Extra geometry can be necessary, and passing candidates are not proofs of the globally smallest mesh. Quality depends on source resolution, fracture complexity and viewing distance. The UI and manifest retain requested/actual triangle counts, sampled errors, failed-region counts and repair diagnostics. Check the visual report when making a cost/quality decision.

## Separate acceptance and regression gates

The GPU suite captures source and portable baked meshes with matching cameras, lighting and physical image size. It independently renders coverage and camera depth; CPU repair and GPU validation share the definitions of eligible source regions. Categories are resolved by supersample voting, never by averaging IDs.

At the 128-pixel background-asset size:

- A connected opening with at least 4 pixels may fill at most 20%, with a one-pixel allowance.
- A connected wall side with at least 8 pixels may lose at most 10% coverage, with a two-pixel allowance.
- Its p95 camera-depth error must be at most 2 physical pixels.

Each important component must pass. A large good wall cannot hide a damaged small component. Missing semantic measurements fail. These limits are fixed independently of the regression baseline; recording new reference results cannot make a bad opening acceptable. Larger images are useful close-up stress diagnostics, outside this background-size acceptance contract.

```sh
npm test
npm run test:openings
npm run test:visual
npm run test:visual -- --held-out
npm run test:visual -- --validation
```

`--review` writes diagnostics without failing for quality/regression differences; browser errors still fail. Review paired screenshots and actual counts before recording a new regression baseline with `--update-baseline`. That command still fails when absolute opening acceptance fails.

## Export and limits

GLBs remain standard portable assets. Generator tags are authoring data, not custom required GLB attributes. Export metadata includes protection and opening diagnostics, while baked textures retain the existing surface-detail workflow.

Sampling does not prove topology or all-camera visibility. Features smaller than the declared pixel thresholds are outside the acceptance contract. The tests cover static appearance, not engine LOD transitions, collision, or temporal flicker. Texture projection is still closest-surface based; opposite-wall texture contamination is separate work. Complex fracture networks may be incompatible with a 500-triangle budget at the declared viewing size.

## Validation finding

The reserved-seed validation retained two wall-depth failures at the fixed 128-pixel contract: `validation-slab / low-3 / fracture 5` (3.89 px) and `validation-path / low-2 / fracture 5` (3.63 px). The slab passed CPU sampling but failed GPU validation: small rasterization differences changed the component footprint and its p95 statistic. The path also remained flagged by the runtime check. This is why sampled runtime success and GPU acceptance are reported separately. The reserved seeds were not used to tune the selected strategy. These failures remain visible and make the reserved-seed acceptance command exit nonzero.

The original four development fixtures pass all GPU opening checks, reducing 220 failed region/view checks to zero, at 3,998 / 11,816 / 3,988 / 16,580 triangles for overhang / split / slab / weathered. Matched-count unprotected controls retain 2 / 6 / 0 / 0 failures respectively; some gains come from additional detail, and protection is not uniformly superior at equal cost. The 500-triangle quality target remains unresolved for complex fractures.
