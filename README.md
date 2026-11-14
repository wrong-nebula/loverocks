# loverocks

**Live demo: [love-rocks.vercel.app](https://love-rocks.vercel.app)**

**Fjord Stone** is a procedural rock studio that runs in the browser. Rust evaluates signed distance fields, cuts joints, carves eroded relief and extracts indexed meshes with surface masks. A Web Worker runs the generator as WebAssembly, and Three.js lights and renders the result in WebGL 2.

It has two modes:

- **Painting scene:** a fixed-camera fjord shoreline with a lake, grass and pebbles under a physically based sky.
- **Specimen:** a single rock you can orbit, chosen from 13 types.

## Rock types

- **Fjord rocks:** overhang, split boulder, upright slab, path stone.
- **Volcanic:** columnar basalt, vesicular scoria, obsidian.
- **Specimens:** cross-bedded sandstone, coarse granite, white marble, slate, conglomerate, mica schist.

Each rock type sets its own shape and its geological features: bedding, cleavage, foliation, crystals, pebbles or vesicles. The mesh carries one smooth value per vertex, such as the bedding coordinate for sandstone or the cleavage coordinate for slate. `src/geology-detail.glsl` resolves the fine structure per pixel from it, so laminae, crystals and mica flakes stay sharp at any mesh detail. The conglomerate pebble field uses the same hash in Rust and GLSL, so each pebble's colour sits on its raised dome.

## Controls

- **Rock type, seed and mesh detail.** The dice button next to the seed rolls a new seed.
- **Randomize** (or the **R** key) rolls a whole new rock. In specimen mode it picks a random rock type. In both modes it sets a new seed, climate, elapsed years and sun angle, with weathering and surface values drawn around that rock type's defaults.
- **Weathering:** elapsed years under a simulated alpine, maritime or continental climate, surface weathering, joint opening and erosion carving.
- **Surface:** moss, moisture, lichen, snow (specimen mode) and ambient occlusion.
- **View:** material, clay, normals, wireframe, and masks for moss, wetness, lichen, snow, roughness and AO.
- **Render 4K PNG** saves the current view with a 3,840-pixel long edge. **Export rock GLB** saves the generated meshes with normals and vertex colours.

In specimen mode, drag to orbit, scroll or pinch to zoom, and right-drag to pan.

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
