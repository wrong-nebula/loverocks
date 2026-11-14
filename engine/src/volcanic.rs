use crate::{
    field::Settings,
    math::*,
    mesh::{self, Mesh},
};
use std::f32::consts::TAU;

#[derive(Clone, Copy, Debug)]
pub enum Volcanic {
    Basalt,
    Scoria,
    Obsidian,
}

struct Column {
    center: V,
    normals: [V; 6],
    radii: [f32; 6],
    cap: V,
    height: f32,
    lean: V,
    seams: [f32; 4],
}

struct Bubble {
    center: V,
    stretch: V,
    radius: f32,
    shear: f32,
}

const GRID: usize = 12;
struct Vesicles {
    bubbles: Vec<Bubble>,
    bins: Vec<Vec<usize>>,
}

impl Vesicles {
    fn cell(p: V) -> [usize; 3] {
        [p.0 + 1.8, p.1 + 0.4, p.2 + 1.4].map(|x| ((x * 3.3) as usize).min(GRID - 1))
    }

    fn new(bubbles: Vec<Bubble>) -> Self {
        let mut bins = vec![Vec::new(); GRID * GRID * GRID];
        for (i, bubble) in bubbles.iter().enumerate() {
            let span = V(1.0, 1.0, 1.0) * (bubble.radius * 1.65 + 0.07);
            let [a, b, c] = Self::cell(bubble.center - span);
            let [d, e, f] = Self::cell(bubble.center + span);
            for z in c..=f {
                for y in b..=e {
                    for x in a..=d {
                        bins[(z * GRID + y) * GRID + x].push(i);
                    }
                }
            }
        }
        Self { bubbles, bins }
    }

    fn cut(&self, p: V, widening: f32) -> f32 {
        let [x, y, z] = Self::cell(p);
        let mut cut: f32 = -1.0;
        for &index in &self.bins[(z * GRID + y) * GRID + x] {
            let b = &self.bubbles[index];
            let r = p - b.center;
            let q = V(r.0 + b.shear * r.1, r.1, r.2 - 0.32 * b.shear * r.0).mul(b.stretch);
            cut = cut.max(b.radius + widening - q.length());
        }
        cut
    }
}

struct Scar {
    center: V,
    normal: V,
    radius: f32,
    depth: f32,
}

enum Shape {
    Columns(Vec<Column>),
    Cinder(Vesicles),
    Glass(Vec<Scar>),
}

pub fn generate(kind: Volcanic, seed: &str, resolution: usize, settings: Settings) -> Mesh {
    let mut random = Random::new(seed);
    let offset = V(random.next(), random.next(), random.next()) * 24.0;
    let (shape, min, max) = match kind {
        Volcanic::Basalt => (
            Shape::Columns(columns(&mut random)),
            V(-1.8, -0.23, -1.45),
            V(1.8, 2.84, 1.45),
        ),
        Volcanic::Scoria => (
            Shape::Cinder(vesicles(&mut random)),
            V(-1.54, -0.25, -1.14),
            V(1.54, 1.88, 1.14),
        ),
        Volcanic::Obsidian => (
            Shape::Glass(scars(&mut random)),
            V(-1.50, -0.24, -1.10),
            V(1.51, 1.72, 1.11),
        ),
    };
    let sample = |p: V| shape.sample(p, offset, settings);
    mesh::extract_field(
        min,
        max,
        resolution,
        |p| sample(p).0,
        |p, e| {
            [
                V(1.0, -1.0, -1.0),
                V(-1.0, -1.0, 1.0),
                V(-1.0, 1.0, -1.0),
                V(1.0, 1.0, 1.0),
            ]
            .into_iter()
            .fold(V::default(), |n, v| n + v * sample(p + v * e).0)
            .unit()
        },
        |p, n, cell| {
            let (_, feature) = sample(p);
            let thickness = match kind {
                Volcanic::Obsidian => edge_transmission(p, n, cell, feature, |q| sample(q).0),
                _ => 0.0,
            };
            material(kind, p, n, cell, offset, feature, settings, thickness)
        },
    )
}

// Estimate the optical path through the thin edge by tracing inward through the field.
pub(crate) fn edge_transmission(p: V, n: V, cell: f32, fracture: f32, distance: impl Fn(V) -> f32) -> f32 {
    let trace = |direction: V| {
        let start = (cell * 0.34).clamp(0.003, 0.012);
        let mut path = start;
        if distance(p - direction * path) >= 0.0 {
            path += start;
            if distance(p - direction * path) >= 0.0 {
                return 0.0;
            }
        }
        while path < 0.25 {
            let signed = distance(p - direction * path);
            if signed >= 0.0 {
                return (-11.0 * path).exp();
            }
            path += (0.72 * -signed).clamp(0.009, 0.034);
        }
        0.0
    };
    let mut transmission = trace(n);
    if fracture > 0.48 && transmission < 0.32 {
        // Oblique paths catch glass lips where two fracture faces meet.
        let axis = if n.1.abs() < 0.85 { V::Y } else { V::X };
        let tangent = n.cross(axis).unit();
        for direction in [n + tangent * 0.69, n - tangent * 0.69] {
            transmission = transmission.max(trace(direction.unit()) * 0.75);
        }
    }
    transmission * (0.20 + 0.80 * fracture)
}

fn columns(random: &mut Random) -> Vec<Column> {
    let mut result = Vec::with_capacity(7);
    let yaw = random.vary(0.16);
    for (i, height) in [2.42, 1.92, 2.57, 1.68, 0.86, 1.22, 1.57]
        .into_iter()
        .enumerate()
    {
        let angle = (i as f32 - 1.0) * TAU / 6.0 + yaw;
        let distance = if i == 0 {
            0.0
        } else {
            0.70 + random.vary(0.033)
        };
        let radius = 0.340 + random.vary(0.025);
        let center = V(distance * angle.cos(), 0.0, distance * angle.sin());
        let normals = std::array::from_fn(|j| {
            let a = j as f32 * TAU / 6.0 + yaw + random.vary(0.035);
            V(a.cos(), 0.0, a.sin())
        });
        result.push(Column {
            center,
            normals,
            radii: std::array::from_fn(|_| radius + random.vary(0.014)),
            cap: V(random.vary(0.29), 1.0, random.vary(0.30)).unit(),
            height: height + random.vary(0.105),
            lean: V(0.092 + random.vary(0.027), 0.0, 0.025 + random.vary(0.033)),
            seams: std::array::from_fn(|j| height * (0.23 + 0.192 * j as f32) + random.vary(0.105)),
        });
    }
    result
}

fn cinder_hull(p: V) -> f32 {
    let q = p - V(-0.05, 0.70, 0.0);
    let oval = q.mul(V(0.80, 1.06, 1.04)).length() - 0.91;
    let left = V(-0.83, 0.49, 0.11).unit().dot(q) - 0.83;
    let right = V(0.79, 0.54, 0.04).unit().dot(q) - 0.73;
    smax(smax(oval, left, 0.14), right, 0.12).max(0.015 - p.1)
}

fn vesicles(random: &mut Random) -> Vesicles {
    let mut bubbles = Vec::new();
    for _ in 0..9500 {
        let center = V(
            random.vary(1.22),
            0.72 + random.vary(0.88),
            random.vary(0.93),
        );
        let size = random.next();
        let radius = 0.012 + 0.061 * size.powf(2.9) + 0.051 * smooth(0.94, 1.0, size);
        let region = noise(center * 4.0 + V(11.4, 1.8, 3.9));
        let shell = cinder_hull(center);
        if shell.abs() > radius * 0.82 + 0.018 || center.1 < 0.080 || region < 0.24 {
            continue;
        }
        let stretch = V(
            0.79 + random.next() * 0.51,
            0.86 + random.next() * 0.69,
            0.81 + random.next() * 0.63,
        );
        bubbles.push(Bubble {
            center,
            stretch,
            radius,
            shear: random.vary(0.34),
        });
    }
    Vesicles::new(bubbles)
}

fn scars(random: &mut Random) -> Vec<Scar> {
    let template = [
        (V(-0.44, 1.14, 0.84), V(-0.12, 0.29, 1.0), 1.02, 0.36),
        (V(0.72, 1.45, 0.70), V(0.43, 0.36, 1.0), 0.91, 0.31),
        (V(-1.01, 0.58, 0.42), V(-0.91, 0.12, 0.53), 0.62, 0.27),
        (V(0.21, 0.46, 0.83), V(0.10, -0.12, 1.0), 0.63, 0.27),
        (V(0.75, 0.83, -0.64), V(0.33, 0.27, -1.0), 0.85, 0.34),
        (V(-0.48, 1.16, -0.57), V(-0.20, 0.59, -1.0), 0.73, 0.34),
        (V(0.03, 1.55, 0.05), V(-0.19, 1.0, 0.10), 0.74, 0.30),
    ];
    template
        .into_iter()
        .map(|(center, normal, radius, depth)| Scar {
            center: center + V(random.vary(0.08), random.vary(0.07), random.vary(0.05)),
            normal: normal.unit(),
            radius: radius + random.vary(0.075),
            depth: depth + random.vary(0.034),
        })
        .collect()
}

impl Shape {
    fn sample(&self, p: V, offset: V, s: Settings) -> (f32, f32) {
        let q = p + offset;
        match self {
            Self::Columns(columns) => {
                let mut result = (3.0, 0.0);
                for col in columns {
                    let r = p - col.center - col.lean * p.1;
                    if r.0.abs().max(r.2.abs()) > 0.56 {
                        continue;
                    }
                    let mut sides: f32 = -2.0;
                    let mut next_side: f32 = -2.0;
                    for (&normal, &radius) in col.normals.iter().zip(&col.radii) {
                        let face = r.dot(normal) - radius;
                        next_side = next_side.max(sides.min(face));
                        sides = sides.max(face);
                    }
                    let bevel = (sides - next_side).min(0.10);
                    let chips = (1.0 - smooth(0.016, 0.088, bevel))
                        * smooth(0.46, 0.87, noise(q * 6.1))
                        * 0.045;
                    let top =
                        (r - V(0.0, col.height, 0.0)).dot(col.cap) + (noise(q * 6.0) - 0.5) * 0.032;
                    let gap = 0.006 + s.fracture * 0.35;
                    let bend = noise(q.mul(V(16.0, 1.1, 16.0))) - 0.5;
                    let mut distance = smax(sides + gap + chips, top, 0.009 + s.rounding * 0.105)
                        .max(0.014 - p.1)
                        + bend * (0.010 + s.carving * 0.016 + s.weather * 0.034);
                    let mut seam: f32 = 0.0;
                    for (index, height) in col.seams.iter().enumerate() {
                        let depth = (0.013 + s.fracture * 0.29 + s.frost * 0.019)
                            * if index % 2 == 0 { 1.0 } else { 0.58 };
                        let across = (r.1 - height - r.0 * 0.16 - r.2 * 0.10 - bend * 0.043).abs();
                        let cut = depth * 0.55 - across;
                        seam = seam.max(1.0 - smooth(0.0, depth * 1.4, across));
                        distance = distance.max(cut.min(sides + depth));
                    }
                    if distance < result.0 {
                        result = (
                            distance,
                            seam.max(smooth(-0.012, 0.025, top - sides) * 0.57),
                        );
                    }
                }
                result
            }
            Self::Cinder(vesicles) => {
                let base = cinder_hull(p)
                    + (noise(q * 4.2) - 0.5) * 0.135
                    + (noise(q * 14.0) - 0.5) * (0.049 + s.carving * 0.052);
                let cavity =
                    vesicles.cut(p, s.weather * 0.019 + s.frost * 0.015 + s.fracture * 0.12);
                (
                    smax(base, cavity, 0.009 + s.rounding * 0.14),
                    smooth(-0.027, 0.055, cavity - base),
                )
            }
            Self::Glass(scars) => {
                let r = p - V(-0.03, 0.76, 0.0);
                let mut hull: f32 = -2.0;
                for (n, h) in [
                    (V(0.89, 0.27, 0.13), 1.01),
                    (V(-0.90, 0.26, -0.17), 1.10),
                    (V(0.02, 0.15, 0.99), 0.73),
                    (V(0.05, 0.26, -0.97), 0.64),
                    (V(-0.15, 0.97, -0.14), 0.70),
                    (V(-0.55, 0.69, 0.35), 0.91),
                    (V(0.42, -0.33, 0.84), 0.78),
                    (V(-0.51, -0.28, -0.85), 0.72),
                ] {
                    hull = hull.max(r.dot(n) - h);
                }
                let rind =
                    (noise(q * 11.0) - 0.5) * (0.018 + s.weather * 0.075 + s.carving * 0.025);
                let base = (hull + rind).max(0.021 - p.1);
                let mut cut: f32 = -1.0;
                for scar in scars {
                    let v = p - scar.center;
                    let axial = v.dot(scar.normal);
                    let tangent = v - scar.normal * axial;
                    let radial = tangent.mul(V(0.95, 1.14, 1.02)).length();
                    if radial > scar.radius + 0.08 {
                        continue;
                    }
                    let shell = (radial * radial / (scar.radius * scar.radius)
                        + ((axial - scar.depth * 0.34) / (scar.depth + s.fracture * 0.18)).powi(2))
                    .sqrt();
                    let radial_wave =
                        radial + 0.043 * v.0 - 0.032 * v.1 + 0.009 * (v.0 * 11.0).sin();
                    let rings = (radial_wave * 61.0 + 0.53 * (radial_wave * 23.0).sin()).sin()
                        * smooth(0.035, 0.17, radial)
                        * (1.0 - smooth(scar.radius * 0.68, scar.radius, radial));
                    cut = cut.max(
                        (1.0 - shell) * scar.depth + rings * (0.0012 + 0.0006 * noise(q * 6.0)),
                    );
                }
                (
                    smax(base, cut, 0.007 + s.rounding * 0.15),
                    smooth(-0.018, 0.022, cut - base),
                )
            }
        }
    }
}

fn material(
    kind: Volcanic,
    p: V,
    n: V,
    cell: f32,
    offset: V,
    feature: f32,
    s: Settings,
    thickness: f32,
) -> (V, f32, f32, f32, f32, f32, f32) {
    let q = p + offset;
    let patch = noise(q * 3.1);
    let grit = mix(noise(q * 25.0), 0.5, smooth(0.019, 0.054, cell));
    let wet =
        (s.wet * (0.22 + 0.48 * feature + 0.24 * (1.0 - smooth(0.04, 0.8, p.1)))).clamp(0.0, 1.0);
    let moss = s.moss * smooth(0.53, 0.84, patch + 0.10 * n.1) * (1.0 - feature * 0.85);
    let threshold = 0.82 - 0.88 * s.lichen;
    let lichen = smooth(
        threshold,
        threshold + 0.24,
        0.72 * patch + 0.28 * noise(q * 6.1),
    ) * (1.0 - feature)
        * (1.0 - moss)
        * smooth(0.0, 0.22, s.lichen);
    let (mut color, roughness) = match kind {
        Volcanic::Basalt => {
            let rind = smooth(0.44, 0.80, patch + s.runoff * 0.10 + s.weather * 0.13);
            let striation = noise(q.mul(V(27.0, 3.1, 27.0)));
            let rock = blend(V(0.024, 0.029, 0.031), V(0.086, 0.079, 0.066), rind)
                * (0.90 + 0.20 * striation);
            (
                rock * (0.83 + 0.30 * grit) * (1.0 - 0.32 * feature),
                0.77 + 0.15 * grit,
            )
        }
        Volcanic::Scoria => {
            let oxide = smooth(0.35, 0.82, patch + 0.17 * noise(q * 8.0) + s.runoff * 0.13);
            let rock = blend(V(0.042, 0.032, 0.029), V(0.151, 0.050, 0.034), oxide);
            let minerals = smooth(0.71, 0.90, noise(q * 15.0)) * smooth(0.29, 0.78, patch);
            (
                blend(
                    rock,
                    V(0.236, 0.171, 0.072),
                    minerals * (0.56 + 0.41 * (1.0 - feature)),
                ) * (1.0 - 0.67 * feature),
                0.89 + 0.09 * grit,
            )
        }
        Volcanic::Obsidian => {
            let flow = 0.5 + 0.5 * (p.dot(V(3.0, 18.0, -4.0)) + 0.9 * (p.0 * 3.0).sin()).sin();
            let glass = blend(
                V(0.0038, 0.0048, 0.0042),
                V(0.015, 0.018, 0.012),
                flow * 0.58 + patch * 0.22,
            );
            let rind = blend(
                glass,
                V(0.038, 0.031, 0.021),
                smooth(0.28, 0.86, patch) * 0.72,
            );
            (
                blend(rind, glass, feature),
                mix(0.48 + s.weather * 0.18, 0.068 + s.weather * 0.18, feature),
            )
        }
    };
    color = blend(
        color,
        V(0.152, 0.158, 0.091),
        lichen * smooth(0.64, 0.82, noise(q * 18.0)) * 0.25,
    );
    color = blend(color, V(0.045, 0.062, 0.018), moss) * (1.0 - wet * 0.31);
    (
        color,
        (roughness - wet * 0.12).clamp(0.055, 1.0),
        wet,
        moss,
        lichen,
        feature,
        thickness,
    )
}
