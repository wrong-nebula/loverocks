# loverocks

**Live demo: [love-rocks.vercel.app](https://love-rocks.vercel.app)**

**Fjord Stone** is a procedural rock studio that runs in the browser. Rust evaluates signed distance fields, cuts joints, carves eroded relief and extracts indexed meshes with surface masks. A Web Worker runs the generator as WebAssembly, and Three.js lights and renders the result in WebGL 2.

You orbit a single rock, chosen from 13 types, under a physically based sky. Meshes build at **Ultra** detail (resolution 224, about 200k triangles) by default; **Maximum** goes to 256.

## Rock types

- **Fjord rocks:** overhang, split boulder, upright slab, path stone.
- **Volcanic:** columnar basalt, vesicular scoria, obsidian.
- **Specimens:** cross-bedded sandstone, coarse granite, white marble, slate, conglomerate, mica schist.

The fjord rocks are broken by a **joint-set fracture network** (`engine/src/field.rs`). Two or three families of roughly parallel fractures follow each rock's bedding seams and main joint, plus a seeded oblique set. Each fracture is a finite elliptical patch: its opening is widest in the middle and closes to sharp tips, its walls are rough and gently curved, and younger fractures stop where they meet an older one. Open joints are cut into the mesh, with mouths widened by weathering and frost. Closed joints and small micro-fractures pass a signed trace distance to the shader, which draws them as crisp hairlines at any mesh detail. **Joint opening** scales the apertures.

Each rock type sets its own shape and its geological features: bedding, cleavage, foliation, crystals, pebbles or vesicles. The mesh carries one smooth value per vertex, such as the bedding coordinate for sandstone or the cleavage coordinate for slate. `src/geology-detail.glsl` resolves the fine structure per pixel from it, so laminae, crystals and mica flakes stay sharp at any mesh detail. The conglomerate pebble field uses the same hash in Rust and GLSL, so each pebble's colour sits on its raised dome.

## Controls

- **Rock type, seed and mesh detail.** The dice button next to the seed rolls a new seed.
- **Randomize** (or the **R** key) rolls a whole new rock: a random rock type, seed, climate, elapsed years and sun angle, with weathering and surface values drawn around that rock type's defaults.
- **Weathering:** elapsed years under a simulated alpine, maritime or continental climate, surface weathering, joint opening and erosion carving.
- **Surface:** moss, moisture, lichen, snow and ambient occlusion. The rock's fine grain relief fades out on smooth, glossy and wet areas and never shows through moss or lichen.
- **Moss** grows rather than being painted on (`src/moss.js`). Each vertex gets a habitat score from where moss thrives: water-catching tops, ledges and the damp base, faces turned away from the sun, sheltered crevices and wet rock. Fresh fracture faces and overhangs stay bare. Spores land on a resolution-independent grid, and colonies spread across the surface by habitat-weighted distance, so moss runs over damp, shaded rock and stops at bare faces. Small satellite colonies scatter around the main ones. **Moss** sets spore density and growth; **Elapsed years** lets colonies grow further. Cushions have real volume: they are thickest at old colony centres, roll over at rounded rims, cast shadows and are included in GLB export. The shader draws a fuzzy fringe, stray young tufts, lighter growth at the margin and a damp, dark contact zone on the rock, over a soft velvet texture in deep to mid green.
- **View:** material, clay, normals, wireframe, and masks for moss, wetness, lichen, snow, roughness and AO.
- **Render 4K PNG** saves the current view with a 3,840-pixel long edge. **Export rock GLB** saves the generated meshes with normals and vertex colours.

Drag to orbit, scroll or pinch to zoom, and right-drag to pan. Mesh detail can be lowered to High, Fine, Detailed or Draft on slower devices; on a recent laptop Ultra builds in about 2–4 seconds.

GLB export keeps vertex colours only, so the per-pixel detail of the specimen stones is not included.

## Run locally

Use Node.js 22.12 or newer.

```sh
npm ci
npm run dev
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
- Sky: lookup tables and shaders adapted from Takram's [`three-geospatial`](https://github.com/takram-design-engineering/three-geospatial) atmosphere package, based on Eric Bruneton's precomputed atmospheric scattering.
- Erosion maps: baked with LibreTerrain.

Third-party licence notices are in `licenses/`.

## Licence

loverocks is open source under the [MIT License](LICENSE). Contributions are welcome: open an issue or a pull request.
