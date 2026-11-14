use crate::{
    field::Settings,
    math::*,
    mesh::{self, Mesh},
};

#[derive(Clone, Copy)]
pub enum Geology {
    Sandstone,
    Granite,
    Marble,
    Slate,
    Conglomerate,
    Schist,
}

struct Specimen {
    kind: Geology,
    settings: Settings,
    offset: V,
    scale: V,
    tilt: f32,
    anchor: V,
}

pub fn generate(kind: Geology, seed: &str, resolution: usize, settings: Settings, anchor: V) -> Mesh {
    let mut random = Random::new(seed);
    let rock = Specimen {
        kind,
        settings,
        offset: V(random.next(), random.next(), random.next()) * 31.0,
        scale: V(
            1.0 + random.vary(0.085),
            1.0 + random.vary(0.075),
            1.0 + random.vary(0.11),
        ),
        tilt: random.vary(0.115),
        anchor,
    };
    let (width, height, depth) = match kind {
        Geology::Sandstone => (1.52, 1.68, 1.06),
        Geology::Granite => (1.51, 1.78, 1.08),
        Geology::Marble => (1.48, 1.62, 1.04),
        Geology::Slate => (1.42, 1.66, 1.06),
        Geology::Conglomerate => (1.56, 1.52, 1.04),
        Geology::Schist => (1.52, 1.50, 1.04),
    };
    mesh::extract_field(
        V(-width, -0.18, -depth),
        V(width, height, depth),
        resolution,
        |p| rock.sample(p).0,
        |p, e| {
            [
                V(1., -1., -1.),
                V(-1., -1., 1.),
                V(-1., 1., -1.),
                V(1., 1., 1.),
            ]
            .into_iter()
            .fold(V::default(), |n, v| n + v * rock.sample(p + v * e).0)
            .unit()
        },
        |p, n, cell| {
            let mut m = rock.material(p, n, cell);
            if let Geology::Marble = kind {
                // Calcite scatters light: thin edges glow like the obsidian lips.
                m.6 = crate::volcanic::edge_transmission(p, n, cell, 0.55, |q| rock.sample(q).0);
            }
            m
        },
    )
}

fn box_field(p: V, half: V) -> f32 {
    let q = p.abs() - half;
    q.max(V::default()).length() + q.0.max(q.1).max(q.2).min(0.0)
}

impl Specimen {
    fn local(&self, p: V) -> V {
        V(p.0 + self.tilt * (p.1 - 0.58), p.1, p.2).mul(self.scale)
    }

    fn bedding(&self, p: V, q: V) -> f32 {
        let slope = mix(0.26, -0.24, smooth(0.49, 0.78, p.1 + p.0 * 0.14));
        p.1 + p.0 * slope
            + 0.068 * p.0 * p.0
            + 0.105 * p.2
            + 0.024 * noise(q * 3.2)
            + self.offset.1 * 0.032
    }

    // Cleavage / foliation coordinate. Slate is planar; schist is wavy and
    // crenulated. The shader reads it back to find cleavage faces and layers.
    fn foliation(&self, r: V, q: V) -> f32 {
        match self.kind {
            Geology::Slate => V(0.30, 0.10, 0.95).unit().dot(r) + 0.004 * noise(q * 3.0),
            _ => {
                let wave = 0.045 * (r.0 * 5.3 + 1.6 * noise(q * 1.1)).sin()
                    + 0.014 * (r.0 * 23.0 + r.2 * 6.0 + 2.0 * noise(q * 3.3)).sin();
                V(0.04, 0.98, 0.16).unit().dot(r) + wave
            }
        }
    }

    fn sample(&self, point: V) -> (f32, f32, f32) {
        let p = self.local(point);
        let q = p + self.offset;
        let s = self.settings;
        let broad = noise(q * 4.2) - 0.5;
        let chips = noise(q * 11.7) - 0.5;
        let weather = 0.65 * s.weather + 0.29 * s.runoff + 0.19 * s.frost;
        let (body, cut, smooth_face) = match self.kind {
            Geology::Sandstone => {
                let r = V(p.0 + 0.06, p.1 - 0.60 + p.0 * 0.11, p.2 - p.0 * 0.055);
                let slab = box_field(r, V(1.12, 0.57, 0.65)) - (0.056 + 0.23 * s.rounding);
                let shoulder = V(0.53, 0.83, 0.17).dot(r) - 0.78;
                let heel = V(-0.64, -0.39, 0.37).dot(r) - 0.78;
                // Cross-bed sets erode as irregular ledges at their bounding
                // surfaces; the fine laminae are drawn per pixel in the shader.
                let bed = self.bedding(p, q);
                let set_coord = bed * 3.4 + 0.28 * noise(q * 1.6) + 0.12 * noise(q * 4.3);
                let within = set_coord - set_coord.floor();
                let ledge = smooth(0.0, 0.10, within) * (1.0 - smooth(0.82, 1.0, within));
                let gate = smooth(0.30, 0.70, noise(q * 2.7 + V(4.0, 1.0, 6.0)));
                let ripple = noise(V(bed * 46.0, q.0 * 3.1, q.2 * 3.1)) - 0.5;
                let band_relief = (0.003 + 0.011 * s.carving) * (1.0 - ledge) * (0.25 + 0.75 * gate)
                    + 0.0012 * s.carving * ripple * gate;
                let shelf = V(-0.15, 0.54, 0.83).dot(r) - 0.69;
                let body = smax(slab, shoulder.max(heel).max(shelf), 0.055)
                    + broad * (0.091 + 0.15 * weather)
                    + chips * 0.021
                    + band_relief;
                let trace = p.0 - 0.32 + p.1 * 0.38 + 0.061 * (p.1 * 8.5 + p.2 * 3.7).sin();
                let depth = 0.66 - p.1 + p.0 * 0.05;
                let width = (0.004 + 0.23 * s.fracture + 0.018 * s.frost)
                    * (0.46 + 0.54 * smooth(0.0, 0.38, depth));
                let crack = (width - trace.abs())
                    .min(depth * 0.65)
                    .min((p.2 - 0.40) * 0.74);
                let branch = p.0 - 0.37 + (p.1 - 0.38) * 0.81 + chips * 0.037;
                let branch = (width * 0.52 - branch.abs())
                    .min((p.1 - 0.32) * 0.5)
                    .min((0.59 - p.1) * 0.7)
                    .min((p.2 - 0.55) * 0.62);
                (body, crack.max(branch), 0.0)
            }
            Geology::Granite => {
                let r = V(p.0 + 0.055, p.1 - 0.64 + p.0 * 0.105, p.2);
                let block = box_field(r, V(1.04, 0.50, 0.60)) - (0.071 + 0.24 * s.rounding);
                let top = V(-0.24, 0.94, 0.23).unit().dot(r) - 0.50;
                let corner = V(0.44, 0.14, 0.88).unit().dot(r) - 0.64;
                let back = V(-0.60, 0.36, -0.72).unit().dot(r) - 0.75;
                let shell =
                    block + broad * (0.096 + 0.16 * weather) + chips * (0.042 + 0.028 * s.carving);
                let face =
                    top.max(corner).max(back) + broad * (0.021 + 0.066 * weather) + chips * 0.005;
                let body = smax(shell, face, 0.036);
                let polish = smooth(-0.023, 0.049, face - shell);
                let trace = p.0 + p.1 * 0.37 - 0.64 + broad * 0.20;
                let crack = (0.007 + 0.20 * s.fracture + 0.020 * s.frost - trace.abs())
                    .min((p.2 - 0.41) * 0.74)
                    .min((0.76 - p.1) * 0.62);
                (body, crack, polish)
            }
            Geology::Marble => {
                // Rounded, irregular lump with two broken faces, like the hand specimen.
                let r = V(p.0 + 0.04, p.1 - 0.58, p.2);
                let lump = box_field(r, V(0.94, 0.46, 0.60)) - (0.24 + 0.40 * s.rounding);
                let sugar = noise(q * 23.0) - 0.5;
                let shell = lump + broad * (0.21 + 0.15 * weather) + chips * 0.040 + sugar * 0.007;
                let face = V(0.30, 0.86, 0.40).unit().dot(r) - 0.47 + broad * 0.05 + chips * 0.012;
                let end = V(0.92, 0.10, -0.38).unit().dot(r) - 0.95 + broad * 0.06 + chips * 0.014;
                let body = smax(smax(shell, face, 0.08), end, 0.10);
                (body, -1.0, smooth(-0.02, 0.045, face.max(end) - shell))
            }
            Geology::Slate => {
                // A chunky block dominated by one flat cleavage face, with a
                // bevelled corner, broken ends and a stepped, chipped underside.
                let r = V(p.0, p.1 - 0.66, p.2);
                let u = self.foliation(r, q);
                let block = box_field(r, V(0.98, 0.64, 0.80)) - (0.02 + 0.05 * s.rounding);
                let shell = block + broad * (0.05 + 0.05 * weather) + chips * 0.016;
                let front = u - 0.60 + broad * 0.012 + chips * 0.003;
                let back = -u - 0.62 + broad * 0.03 + chips * 0.006;
                let bevel = V(-0.80, 0.10, 0.59).unit().dot(r) - 0.74 + chips * 0.010;
                let end = V(0.94, -0.08, -0.33).unit().dot(r) - 0.82 + broad * 0.09 + chips * 0.03;
                let top = V(0.06, 0.99, -0.10).unit().dot(r) - 0.52 + broad * 0.08 + chips * 0.018;
                let under = V(0.10, -0.80, 0.59).unit().dot(r) - 0.58 + chips * 0.03
                    + 0.025 * ((u * 7.0 + 0.5 * noise(q * 2.0)).fract() - 0.5);
                let body = smax(shell, front.max(back).max(bevel).max(end).max(top).max(under), 0.022);
                (body, -1.0, 0.0)
            }
            Geology::Conglomerate => {
                // Irregular slab; oval pebbles stand slightly proud of the matrix.
                let r = V(p.0, p.1 - 0.50, p.2);
                let slab = box_field(r, V(1.10, 0.38, 0.52)) - (0.12 + 0.20 * s.rounding);
                let ragged = noise(q * 5.3) - 0.5;
                let (pebble, _) = pebbles(point + self.anchor);
                let dome = smooth(0.0, -0.035, pebble) * 0.014;
                let matrix = 0.004 * smooth(-0.004, 0.02, pebble);
                let body = slab + broad * (0.17 + 0.12 * weather) + ragged * 0.07 + chips * 0.014
                    - dome
                    + matrix;
                (body, -1.0, 0.0)
            }
            Geology::Schist => {
                // Irregular wedge whose top follows the wavy foliation; fissile
                // lamellae split off along the base.
                let r = V(p.0 + 0.03, p.1 - 0.54, p.2);
                let u = self.foliation(r, q);
                let slab = box_field(r, V(1.08, 0.44, 0.62)) - (0.07 + 0.16 * s.rounding);
                let shell = slab + broad * (0.20 + 0.12 * weather) + chips * 0.034;
                let top = V(-0.22, 0.96, 0.14).unit().dot(r) - 0.34 + (u - r.1) * 0.7;
                let body = smax(shell, top + chips * 0.012, 0.07);
                let base = smooth(-0.12, -0.42, r.1);
                let layer = (u * 13.0 + 0.6 * noise(q * 1.7)).floor();
                let body = body + base * hash(V(layer, 8.3, 2.9)) * (0.04 + 0.07 * s.carving);
                (body, -1.0, 0.0)
            }
        };
        (
            body.max(cut).max(0.011 - point.1),
            smooth(-0.020, 0.016, cut - body),
            smooth_face,
        )
    }

    fn material(&self, point: V, n: V, cell: f32) -> (V, f32, f32, f32, f32, f32, f32) {
        let p = self.local(point);
        let q = p + self.offset;
        let (_, fresh, smooth_face) = self.sample(point);
        let s = self.settings;
        let macro_noise = noise(q * 4.2);
        let grain = mix(noise(q * 36.0), 0.5, smooth(0.013, 0.051, cell));
        // The last channel carries a per-vertex signal for the material shader:
        // the bedding coordinate for sandstone, the fracture-face polish for
        // granite. Vertex colours stay a filtered stand-in (used by GLB export).
        let (mut color, mut roughness, signal) = match self.kind {
            Geology::Sandstone => {
                let bed = self.bedding(p, q);
                let bed_noise = noise(q * 2.7 + V(4.0, 1.0, 6.0));
                let iron = smooth(
                    0.22,
                    0.86,
                    0.48 + 0.22 * (bed * 6.3 + 1.1).sin() + 0.46 * (bed_noise - 0.5),
                );
                let red = blend(V(0.43, 0.175, 0.088), V(0.25, 0.082, 0.040), iron);
                let light = blend(V(0.52, 0.285, 0.165), V(0.40, 0.183, 0.098), iron);
                let sand = blend(red, light, 0.35 + 0.45 * bed_noise);
                (sand * (0.92 + 0.16 * grain), 0.86 + 0.08 * grain, bed)
            }
            Geology::Granite => {
                let large = crystal(q, V(6.6, 9.0, 8.0));
                let small = crystal(q + V(5.3, 8.2, 2.5), V(17.0, 20.0, 19.0));
                let feldspar = smooth(0.12, 0.22, large.0) * (1.0 - smooth(0.45, 0.61, large.1));
                let mica = smooth(0.66, 0.78, small.1) * smooth(0.015, 0.085, small.0);
                let quartz = blend(V(0.33, 0.335, 0.345), V(0.66, 0.65, 0.62), small.1);
                let pink = blend(V(0.55, 0.37, 0.33), V(0.70, 0.52, 0.48), large.1);
                let mixed = blend(quartz, V(0.036, 0.034, 0.033), mica * 0.99);
                let facet = smooth_face.max(fresh * 0.69);
                let polished = mix(mix(0.14, 0.22, feldspar), 0.15, mica);
                let weathered = mix(0.74, 0.55, mica);
                (
                    blend(mixed, pink, feldspar * (0.93 - 0.47 * mica))
                        * mix(0.88 + 0.24 * grain, 0.97 + 0.06 * grain, facet),
                    mix(weathered, polished, facet),
                    facet,
                )
            }
            Geology::Marble => (
                blend(V(0.80, 0.79, 0.76), V(0.74, 0.71, 0.69), macro_noise) * (0.95 + 0.08 * grain),
                mix(0.62, 0.42, smooth_face),
                0.0,
            ),
            Geology::Slate => {
                let u = self.foliation(V(p.0, p.1 - 0.66, p.2), q);
                (V(0.050, 0.060, 0.080) * (0.92 + 0.14 * grain), 0.55, u)
            }
            Geology::Conglomerate => {
                let (pebble, id) = pebbles(point + self.anchor);
                let stone = blend(V(0.42, 0.30, 0.20), V(0.38, 0.20, 0.10), id);
                let inside = smooth(0.004, -0.004, pebble);
                (
                    blend(V(0.21, 0.08, 0.045), stone, inside) * (0.92 + 0.14 * grain),
                    mix(0.88, 0.45, inside),
                    0.0,
                )
            }
            Geology::Schist => {
                let u = self.foliation(V(p.0 + 0.03, p.1 - 0.54, p.2), q);
                let rust = smooth(0.55, 0.75, macro_noise);
                (
                    blend(V(0.15, 0.115, 0.045), V(0.20, 0.075, 0.028), rust) * (0.9 + 0.2 * grain),
                    0.5,
                    u,
                )
            }
        };
        let wet = s.wet * (0.16 + 0.48 * fresh + 0.27 * (1.0 - smooth(0.02, 0.62, point.1)));
        let moss = s.moss * smooth(0.54, 0.86, macro_noise + 0.1 * n.1) * (1.0 - fresh);
        let lichen = smooth(0.88 - 0.55 * s.lichen, 0.99 - 0.55 * s.lichen, macro_noise)
            * smooth(0.0, 0.4, s.lichen)
            * (1.0 - fresh)
            * (1.0 - moss);
        color = blend(color, V(0.064, 0.076, 0.029), moss) * (1.0 - 0.44 * wet - 0.16 * fresh);
        roughness = (roughness - 0.21 * wet).clamp(0.18, 1.0);
        (color, roughness, wet, moss, lichen, fresh, signal)
    }
}

// A jittered 3D grain tessellation. The distance to the competing cell
// softens grain boundaries at mesh resolution without introducing seams.
fn crystal(p: V, scale: V) -> (f32, f32) {
    let p = p.mul(scale);
    let cell = p.floor();
    let local = p - cell;
    let mut first: f32 = 9.0;
    let mut second: f32 = 9.0;
    let mut mineral = 0.0;
    for x in -1..=1 {
        for y in -1..=1 {
            for z in -1..=1 {
                let step = V(x as f32, y as f32, z as f32);
                let id = cell + step;
                let delta = step
                    + V(
                        hash(id),
                        hash(id + V(11.7, 3.8, 5.1)),
                        hash(id + V(2.2, 17.1, 7.5)),
                    ) * 0.67
                    + V(0.16, 0.16, 0.16)
                    - local;
                let d = delta.dot(delta);
                if d < first {
                    second = first;
                    first = d;
                    mineral = hash(id + V(6.1, 7.4, 31.3));
                } else {
                    second = second.min(d);
                }
            }
        }
    }
    (second.sqrt() - first.sqrt(), mineral)
}

// The same hash as `rockHash` in geology-detail.glsl, all three channels.
fn hash3(p: V) -> V {
    let p = p.mul(V(0.1031, 0.1030, 0.0973));
    let p = p - p.floor();
    let a = p.dot(V(p.1 + 33.33, p.0 + 33.33, p.2 + 33.33));
    let p = V(p.0 + a, p.1 + a, p.2 + a);
    let f = |v: f32| v - v.floor();
    V(f((p.0 + p.1) * p.2), f((p.0 + p.0) * p.1), f((p.1 + p.0) * p.0))
}

// Rounded, slightly flattened pebbles at two sizes. Returns the signed distance
// to the nearest pebble surface and that pebble's hash. Mirrored per pixel by
// `pebbleField` in geology-detail.glsl so colour and relief line up.
pub fn pebbles(p: V) -> (f32, f32) {
    let mut best = (9.0_f32, 0.0_f32);
    for (scale, salt) in [(3.7_f32, 0.0_f32), (7.6, 17.0)] {
        let s = V(scale, scale * 1.35, scale);
        let x = p.mul(s) + V(salt, salt * 0.5, salt * 0.25);
        let cell = x.floor();
        for i in -1..=1 {
            for j in -1..=1 {
                for k in -1..=1 {
                    let id = cell + V(i as f32, j as f32, k as f32);
                    let h = hash3(id);
                    let centre = id + V(0.5, 0.5, 0.5) + (h - V(0.5, 0.5, 0.5)) * 0.5;
                    if h.0 < 0.03 {
                        continue; // gaps of matrix between pebbles
                    }
                    let radius = mix(0.46, 0.60, h.1);
                    // Oval pebbles: squash each along its own axes.
                    let k = hash3(id + V(4.4, 1.2, 8.6));
                    let squash = V(0.80 + 0.45 * k.0, 0.85 + 0.55 * k.1, 0.80 + 0.45 * k.2);
                    let d = ((x - centre).mul(squash).length() - radius) / (scale * 1.25);
                    if d < best.0 {
                        best = (d, hash3(id + V(9.1, 3.3, 5.7)).0);
                    }
                }
            }
        }
    }
    best
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_geology_form_meshes_cleanly() {
        let settings = Settings {
            weather: 0.12,
            rounding: 0.1,
            fracture: 0.04,
            carving: 0.5,
            moss: 0.05,
            wet: 0.1,
            lichen: 0.1,
            runoff: 0.0,
            frost: 0.0,
        };
        for kind in [
            Geology::Sandstone,
            Geology::Granite,
            Geology::Marble,
            Geology::Slate,
            Geology::Conglomerate,
            Geology::Schist,
        ] {
            let m = generate(kind, "fjord", 28, settings, V(3.0, 7.0, 11.0));
            assert!(m.vertices.len() > 1400 && m.vertices.iter().all(|v| v.is_finite()));
            assert!(m.indices.iter().all(|&i| (i as usize) < m.vertices.len() / mesh::STRIDE));
        }
    }
}
