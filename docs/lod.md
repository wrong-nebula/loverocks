# Portable game-asset LODs

Implemented against `wrong-nebula/loverocks` commit `576547854663b21efedc7e9dc354be16eb712831`, on branch `feat/asset-lods`.

## What changed

Source sampling resolution is separate from the deliverable's triangle budget. The generator builds one canonical, moss-displaced source. A worker reduces that source into three independent levels, retaining the generator's normals, colours, surface masks and geological channels. Budget edits reuse the cached source. Vertex buffers are compacted and reordered after reduction; small meshes use 16-bit indices.

The default targets are 2,000 / 500 / 128 triangles. Actual counts can undershoot a target. Topology constraints can also prevent reaching a target; the interface reports that condition. Quality priority stops at a combined shape/attribute error score. Budget priority relaxes that score and explicitly reports when the chosen tolerance is exceeded. Feature emphasis changes weights on fracture/geological signals. Separate opt-in fracture protection now fixes selected rim/depth landmarks or all classified fracture faces, with runtime retention checks and an active fidelity limit. See [visual quality and fracture protection](visual-quality.md).

Each level has bidirectional sampled nearest-surface distances, separate from the simplifier score. Up to 2,048 triangles per direction contribute a vertex and a centroid sample. `sampledMax` and `p95` describe those samples only; they are **not Hausdorff bounds**. Automatic preview projects sampled maximum distance into physical rendering pixels, using perspective FOV, viewport height and a conservative front-of-bounding-sphere depth. A 15% hysteresis band reduces switching chatter. Near views can use the source. There is no geomorph or crossfade in this version.

The portable bake unwraps the reduced mesh with xatlas, projects atlas texels to the canonical source with a BVH, interpolates its attributes and evaluates the existing procedural material in texture space. It generates sRGB base colour, tangent-space normals, and one shared linear ORM image (R: AO, G: roughness, B: metalness). Chart gutters are dilated before shader evaluation. All images are embedded in each GLB; no custom viewer shader or glTF extension is required.

UV seams increase vertex count without increasing triangle count. The interface reports baked geometry and estimated uncompressed RGBA texture memory including mipmaps. At 512 px, three maps cost about 4 MiB per level in that representation. The ZIP contains three standalone GLBs plus a manifest with the source recipe, reduction settings, counts, sampled deviations and bake projection statistics. Runtime switching belongs in the importing engine.

## Reading that shaped the implementation

These are selected chapters, essays and papers, not claims of having read every book cover to cover. The implementation choices below are our application of the readings.

| Source | Relevant idea and application |
| --- | --- |
| [Pharr, Jakob & Humphreys, *Physically Based Rendering*, 4th ed., §10.1](https://www.pbr-book.org/4ed/Textures_and_Materials/Texture_Sampling_and_Antialiasing) | Texture sampling rate matters. Preserve the original material's derivative-based filtering during the bake; inspect at actual background sizes. |
| [Asirvatham & Hoppe, *GPU Gems 2*, chapter 2](https://developer.nvidia.com/gpugems/gpugems2/part-i-geometric-complexity/chapter-2-terrain-rendering-using-gpu-based-geometry) | View-dependent detail and transition management belong in the design. Use a camera-aware preview and hysteresis. Terrain clipmaps themselves do not fit these isolated rock assets. |
| [Garland & Heckbert, *Surface Simplification Using Quadric Error Metrics*](https://www.cs.cmu.edu/afs/cs.cmu.edu/user/garland/www/quadrics/index.html) | Error-driven reduction provides a practical foundation. Use meshoptimizer's maintained attribute-aware implementation rather than a new decimator. |
| [Hoppe, *Progressive Meshes*](https://hhoppe.com/proj/pm/) | Geometry and appearance need a coherent multi-resolution representation. Keep a common source and coordinate system. This implementation exports discrete meshes, not Hoppe's progressive-mesh encoding. |
| [Jonathan Blow, *Unified Rendering LOD*, part 1](https://number-none.com/product/Unified%20Rendering%20LOD%2C%20Part%201/) | Evaluate detail in the rendering context. Expose physical-pixel tolerance and an actual-size preview instead of an unexplained distance slider. |
| [Hasselgren et al., *Appearance-Driven Automatic 3D Model Simplification*](https://research.nvidia.com/labs/rtr/publication/hasselgren2021diffmodeling/) | Geometry reduction alone does not preserve the rendered asset. Transfer appearance and compare images. The paper's differentiable optimization is not implemented here. |
| [Arseny Kapoulkine, *Billions of triangles redux*](https://zeux.io/2026/09/30/billions-of-triangles-redux/) | Treat reduction, data layout and representation cost together. Compact buffers and report geometry separately from textures. A clustered world renderer is outside this portable asset-authoring slice. |

## Verification

The original reduction corpus covers 26 generated rocks: all 13 default presets at source resolution 88, plus weathered alternate seeds at resolution 32. Every one reached a 500-triangle LOD-1 budget (496–500 triangles). Tests cover source immutability, complete attribute and weather remapping, compact indices, deterministic results, quality stopping, projection/hysteresis and a known-triangle atlas projection.

The default High-resolution overhang in the browser produced **87,016 → 1,974 / 500 / 128 triangles**. Its 500-triangle baked export has 399 vertices after UV seams, about 21.6 KiB of geometry buffers, three 512 px textures, and a 1,058,604-byte GLB. This is 99.4% fewer triangles than that source, not a claim of equal close-up appearance or a measured frame-rate improvement.

The three overhang GLBs and a 496-triangle granite GLB passed Khronos glTF Validator with **zero errors, warnings, infos or hints**. A separate GLTFLoader viewer re-imported the overhang and rendered its albedo, normal, roughness and AO maps. Browser checks covered source/LOD comparisons, silhouette mode, masks after baking, keyboard orbit/zoom, invalid budgets, quality-versus-budget behavior, automatic source fallback, and a 390 px mobile viewport with no horizontal overflow. Production builds and the interface detector pass.

To validate additional exports:

```sh
npm run test:glb -- path/to/rock_LOD0.glb path/to/rock_LOD1.glb
```

With the dev server running, `tests/import-view.html?asset=/path/to/asset.glb` is a separate standard-material re-import check. Files must be served by the same local server.

## Limits and the next quality bar

This is a working asset-authoring implementation, not a proven industry-leading reducer. The new opt-in protection modes and 384-comparison visual suite are described in [visual-quality.md](visual-quality.md). Budget priority can lose openings, thin protrusions or small components; surface sampling can miss narrow features. Nearest-point texture projection may cross a crevice, and finite atlas resolution loses microdetail. Standard PBR does not exactly reproduce the source's custom clearcoat, sheen, mineral specular response or lighting-dependent transmission. All three levels currently use the chosen texture size, so their combined residency cost should be reviewed in the target engine.

For a production quality bar, expand the visual corpus to multiple views, high-fracture and thin-slab cases; extend the feature classifiers and add a cage or normal-aware projection mode; expand the multi-view silhouette, appearance and fracture-depth tests; and validate import, texture compression, switching and residency in the chosen game engine. Runtime crossfades/geomorphs, independent per-level budgets, texture-size ladders, KTX2 compression and impostors remain further work. None is necessary to open the current portable GLBs.
