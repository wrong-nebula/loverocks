# loverocks

**Live demo: [love-rocks.vercel.app](https://love-rocks.vercel.app)**

**Fjord Stone** is a procedural rock studio that runs in the browser. Rust evaluates signed distance fields, cuts joints, carves eroded relief and extracts indexed meshes with surface masks. A Web Worker runs the generator as WebAssembly, and Three.js lights and renders the result in WebGL 2.

You orbit a single rock, chosen from 13 types, under a physically based sky. A canonical high-poly source builds at **Maximum** detail (resolution 256) by default and is shown directly in the viewport. When you ask for game-asset optimization, an attribute-aware reducer generates three compact LODs on demand (with a default **500-triangle budget** for the background mesh, reporting actual counts and any quality compromise).

## Rock types

- **Fjord rocks:** overhang, split boulder, upright slab, path stone.
- **Volcanic:** columnar basalt, vesicular scoria, obsidian.
- **Specimens:** cross-bedded sandstone, coarse granite, white marble, slate, conglomerate, mica schist.

The fjord rocks are broken by a **joint-set fracture network** (`engine/src/field.rs`). Two or three families of roughly parallel fractures follow each rock's bedding seams and main joint, plus a seeded oblique set. Each fracture is a finite elliptical patch: its opening is widest in the middle and closes to sharp tips, its walls are rough and gently curved, and younger fractures stop where they meet an older one. Open joints are cut into the mesh, with mouths widened by weathering and frost. Closed joints and small micro-fractures pass a signed trace distance to the shader, which draws them as crisp hairlines at any mesh detail. Weathering works along every crack: the surface sags into shallow, rounded troughs with chipped lips, a paler iron-tinged rind lines the cracks, dark seep streaks run down steep faces below open cracks, and the damp crack zone attracts moss. About a third of the closed fractures are healed quartz veins, drawn as pale lines. **Joint opening** scales the apertures; **Surface weathering**, frost and runoff (from **Elapsed years** and **Climate**) deepen the erosion.

Each rock type sets its own shape and its geological features: bedding, cleavage, foliation, crystals, pebbles or vesicles. The mesh carries one smooth value per vertex, such as the bedding coordinate for sandstone or the cleavage coordinate for slate. `src/geology-detail.glsl` resolves the fine structure per pixel from it, so laminae, crystals and mica flakes stay sharp at any mesh detail. The conglomerate pebble field uses the same hash in Rust and GLSL, so each pebble's colour sits on its raised dome.

## Controls

- **Rock type, seed and source detail.** The dice button next to the seed rolls a new seed.
- **Randomize** (or the **R** key) rolls a whole new rock: a random rock type, seed, climate, elapsed years and sun angle, with weathering and surface values drawn around that rock type's defaults.
- **Weathering:** elapsed years under a simulated alpine, maritime or continental climate, surface weathering, joint opening and erosion carving.
- **Surface:** moss, moisture, lichen, snow and ambient occlusion. The rock's fine grain relief fades out on smooth, glossy and wet areas and never shows through moss or lichen.
- **Moss** grows rather than being painted on (`src/moss.js`). Each vertex gets a habitat score from where moss thrives: water-catching tops, ledges and the damp base, faces turned away from the sun, sheltered crevices and wet rock. Fresh fracture faces and overhangs stay bare. Spores land on a resolution-independent grid, and colonies spread across the surface by habitat-weighted distance, so moss runs over damp, shaded rock and stops at bare faces. Small satellite colonies scatter around the main ones. **Moss** sets spore density and growth; **Elapsed years** lets colonies grow further. Cushions have real volume: they are thickest at old colony centres, roll over at rounded rims, cast shadows and are included in GLB export. The shader draws a fuzzy fringe, stray young tufts, lighter growth at the margin and a damp, dark contact zone on the rock, over a soft velvet texture in deep to mid green.
- **View:** material, clay, normals, wireframe, and masks for moss, wetness, lichen, snow, roughness and AO.
- **Render 4K PNG** saves the current view with a 3,840-pixel long edge. **Export GLB** unwraps and bakes the selected LOD into portable standard PBR. **LOD pack** saves three GLBs and a manifest with settings, counts and sampled surface deviations. When previewing Source, **Source GLB** retains the original vertex-colour export.

Drag to orbit, scroll or pinch to zoom, and right-drag to pan. Source detail controls the reference surface, independently of the export triangle budget. Lower it on slower devices.

## Game asset workflow

1. Choose the source type, seed and surface settings.
2. Set the **Triangle budget** for LOD 1. LOD 0 targets four times that budget; LOD 2 targets roughly one quarter. **Reduce LODs** (then **Apply budget**) builds the three levels on demand from the cached canonical source.
3. Choose **Meet budget** to allow additional error, or **Preserve quality** to stop at the selected combined geometry/attribute tolerance. For Fjord rocks, **Rim landmarks** and **Keep fracture faces** enforce the fidelity tolerance and can exceed the triangle target. The experimental **Fracture skeleton** fixes sparse guides and allows other vertices to move; it supports either priority. Actual counts and fixed vertices are reported. The tolerance percentage is a simplifier score, not a surface-distance guarantee.
4. Inspect the **split view**, **silhouettes**, wireframe and masks. **Viewing size** frames the source bounding sphere at a chosen number of physical render pixels. **Automatic** uses sampled surface deviation, projection and 15% hysteresis; it can fall back to Source up close.
5. **Bake & preview** transfers source detail to a UV atlas with base colour, tangent-space normals and packed occlusion/roughness/metalness. Pick 256, 512 or 1024 px. Geometry and uncompressed texture memory are reported separately.
6. Export the selected baked GLB or the complete LOD pack. Each GLB is independent and shares the source coordinates. Set up switching in your game engine: core glTF has no automatic LOD switching.

The source shader includes lighting-dependent transmission, sheen and clearcoat; standard metallic-roughness PBR approximates these. Low budgets can visibly change silhouettes, fractures and disconnected details. The nearest-surface bake can mix detail across narrow crevices, and texture resolution limits close-up detail. Treat this as an asset-authoring implementation, not a certified perceptual-error bound. See [implementation and research notes](docs/lod.md).

## Visual quality tests

Run `npx playwright install chromium`, then `npm run test:visual`. The suite generates paired source/LOD colour, silhouette, normal and depth comparisons across four fractured-rock fixtures, eight angles and three background sizes. It includes matched-count controls, a versioned regression baseline, and a local HTML report with contact sheets. Landmark mode uses selective supporting triangles and bake-oriented attribute weights to spend more of the budget on shape. `npm run test:visual -- --held-out` checks four additional seeds and higher source resolutions. `npm run test:visual -- --quick` runs a smaller smoke subset.

See [fracture protection and visual testing](docs/visual-quality.md) for metrics, commands and limitations.

### Customize the quality–budget curve

Open **Game asset → Quality vs budget**. Enter up to 12 budgets, choose a reduction method, priority and viewing size, then compare. Select wall depth error, silhouette overlap or failed regions as the plotted metric. The horizontal axis uses actual triangle counts. Select a point to apply its budget, or export the measurements as JSON. Comparison settings are remembered locally; changing the source clears stale measurements. See [curve controls, skeleton reduction and validation results](docs/budget-curve.md).

The application independently checks rendered LOD 1 openings from 16 cameras at 128 pixels. Other levels retain CPU estimates. Low-budget skeleton meshes can still fail opening quality; a met triangle budget is not a quality pass. Run `npm run test:budget` for the measured sweep, `npm run test:budget -- --held-out` for reserved seeds, and `npm run test:fracture-cases` for the two repaired visual regressions.

### CLI and MCP

Run `node automation/cli.js curve --budgets 300,600,1200 --method skeleton` for a JSON comparison, or replay a UI export with `--input curve.json`. Start the stdio MCP server with `node automation/mcp.js`; it exposes `rock_catalog` and `rock_budget_curve`. Both share the studio's source generation and rendered quality checks. Install Chromium first with `npx playwright install chromium`. See [CLI/MCP setup, options and examples](docs/cli-mcp.md).

## Run locally

Use Node.js 22.12 or newer.

```sh
npm ci
npm run dev
npm test
```

To serve a production build:

```sh
npm run build
npm start        # serves dist/ on http://127.0.0.1:4173/
```

The repository includes the compiled WebAssembly module and its JavaScript bindings in `src/wasm/`, so building the site needs only Node.js.

## Deploy

`dist/` is a static site with relative asset paths and needs no server-side code. Serve `.wasm` files as `application/wasm`.

The live demo is hosted on [Vercel](https://vercel.com). `vercel.json` sets the Vite build (`npm ci`, `npm run build`, output `dist/`), so importing the repository into Vercel, or running `vercel --prod`, deploys it as is.

## Change the Rust engine

Install Rust with [rustup](https://rustup.rs). The toolchain and wasm target are pinned in `rust-toolchain.toml`.

```sh
cargo install wasm-bindgen-cli --version 0.2.114 --locked
cargo test --manifest-path engine/Cargo.toml
npm run build:wasm
npm run build
```

`build:wasm` remaps absolute build paths so the compiled module doesn't embed your local directory names.

## Surface baking tool

`engine/src/bin/surface-bake.rs` and `tools/scan-benchmark.py` are an offline experiment for surface distance and ambient occlusion queries on scanned meshes. It needs NumPy and SciPy.

```sh
cargo build --release --locked --manifest-path engine/Cargo.toml --bin surface-bake
python tools/scan-benchmark.py --gltf /path/to/mesh.gltf \
  --baker engine/target/release/surface-bake --out benchmark-results
```

## Credits

- Rendering: [Three.js](https://threejs.org).
- Reduction: [meshoptimizer](https://github.com/zeux/meshoptimizer); projection and deviation queries: [three-mesh-bvh](https://github.com/gkjohnson/three-mesh-bvh).
- UV atlases: [xatlas](https://github.com/jpcy/xatlas), via xatlasjs and xatlas-three; ZIP export: fflate.
- Portable export validation: Khronos glTF Validator.
- Sky: lookup tables and shaders adapted from Takram's [`three-geospatial`](https://github.com/takram-design-engineering/three-geospatial) atmosphere package, based on Eric Bruneton's precomputed atmospheric scattering.
- Erosion maps: baked with LibreTerrain.

Third-party licence notices are in `licenses/`.

## Licence

loverocks is open source under the [MIT License](LICENSE). Contributions are welcome: open an issue or a pull request.

### Fracture opening repair

Fjord meshes now carry generator-authored fracture IDs, opposing-wall sides, and mouth/tip role masks. In **Rim landmarks**, **Opening repair → Check & repair** adds local constraints when sampled gaps close or cavities flatten. Requested and actual triangle counts remain separate; unresolved checks stay visible. The portable GLB manifest includes repair diagnostics. See [opening repair](docs/opening-repair.md) and [visual quality](docs/visual-quality.md).
