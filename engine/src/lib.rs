mod ao;
mod field;
mod geology;
pub mod math;
mod mesh;
pub mod surface;
mod volcanic;

use field::{Rock, Settings, presets};
use mesh::Mesh;
use wasm_bindgen::prelude::*;

#[wasm_bindgen]
pub struct RockMesh(Mesh);

#[wasm_bindgen]
impl RockMesh {
    pub fn vertices(&self) -> Vec<f32> {
        self.0.vertices.clone()
    }
    pub fn indices(&self) -> Vec<u32> {
        self.0.indices.clone()
    }
    pub fn bounds(&self) -> Vec<f32> {
        self.0.bounds.to_vec()
    }
}

#[wasm_bindgen]
pub fn generate(
    form: usize,
    seed: &str,
    resolution: usize,
    options: &[f32],
) -> Result<RockMesh, JsError> {
    use geology::Geology;
    use volcanic::Volcanic;
    let rock = presets().get(form);
    let volcanic = match form {
        4 => Some((Volcanic::Basalt, [0.11, 0.065, 0.08, 0.14])),
        5 => Some((Volcanic::Scoria, [0.20, 0.07, 0.028, 0.02])),
        6 => Some((Volcanic::Obsidian, [0.045, 0.025, 0.035, 0.0])),
        _ => None,
    };
    let geology = match form {
        7 => Some((Geology::Sandstone, [0.15, 0.12, 0.046, 0.05])),
        8 => Some((Geology::Granite, [0.13, 0.115, 0.039, 0.06])),
        9 => Some((Geology::Marble, [0.10, 0.16, 0.03, 0.02])),
        10 => Some((Geology::Slate, [0.08, 0.04, 0.05, 0.05])),
        11 => Some((Geology::Conglomerate, [0.14, 0.13, 0.03, 0.04])),
        12 => Some((Geology::Schist, [0.12, 0.07, 0.05, 0.05])),
        _ => None,
    };
    let [weather, rounding, fracture, moss] = match (rock, volcanic, geology) {
        (Some(p), _, _) => [p.weather, p.rounding, p.fracture, p.moss],
        (_, Some((_, defaults)), _) | (_, _, Some((_, defaults))) => defaults,
        _ => return Err(JsError::new("Unknown rock form")),
    };
    let setting = |i: usize, default: f32, max: f32| {
        options
            .get(i)
            .copied()
            .filter(|v| v.is_finite())
            .unwrap_or(default)
            .clamp(0.0, max)
    };
    let settings = Settings {
        weather: setting(0, weather, 0.55),
        rounding: setting(1, rounding, 0.42).max(0.02),
        fracture: setting(2, fracture, 0.19),
        carving: setting(3, 0.52, 1.0),
        moss: setting(4, moss, 1.0),
        wet: setting(5, 0.48, 1.0),
        lichen: setting(6, 0.57, 1.0),
        runoff: setting(7, 0.0, 1.0),
        frost: setting(8, 0.0, 1.0),
    };
    let resolution = resolution.clamp(10, 176);
    let mesh = match (volcanic, geology) {
        (Some((kind, _)), _) => volcanic::generate(kind, seed, resolution, settings),
        (_, Some((kind, _))) => {
            // Shader-shared anchor so per-pixel features (pebbles) match the mesh.
            let anchor = math::V(
                setting(9, 0.0, 1.0e4),
                setting(10, 0.0, 1.0e4),
                setting(11, 0.0, 1.0e4),
            );
            geology::generate(kind, seed, resolution, settings, anchor)
        }
        _ => mesh::extract(&Rock::new(rock.unwrap(), seed, settings), resolution),
    };
    Ok(RockMesh(mesh))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn all_forms_produce_finite_indexed_meshes() {
        for p in presets() {
            let s = Settings {
                weather: p.weather,
                rounding: p.rounding,
                fracture: p.fracture,
                carving: 0.52,
                moss: p.moss,
                wet: 0.48,
                lichen: 0.57,
                runoff: 0.0,
                frost: 0.0,
            };
            let a = mesh::extract(&Rock::new(p, "fjord", s), 28);
            let b = mesh::extract(&Rock::new(p, "fjord", s), 28);
            assert_eq!(a.vertices, b.vertices);
            assert_eq!(a.indices, b.indices);
            assert!(a.vertices.len() > 1400 && a.vertices.iter().all(|v| v.is_finite()));
            assert!(
                a.indices
                    .iter()
                    .all(|&i| (i as usize) < a.vertices.len() / mesh::STRIDE)
            );
        }
    }
}
