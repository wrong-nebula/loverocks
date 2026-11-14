use crate::math::*;
use serde::Deserialize;
use std::sync::OnceLock;

#[derive(Clone, Deserialize)]
pub struct Preset {
    pub size: [f32; 3],
    pub height: f32,
    pub lean: [f32; 2],
    pub pitch: [f32; 2],
    pub facets: [f32; 3],
    pub extra: Vec<[f32; 4]>,
    pub joint: [f32; 4],
    pub reach: [f32; 4],
    pub spalls: [[f32; 4]; 2],
    pub weather: f32,
    pub rounding: f32,
    pub fracture: f32,
    pub moss: f32,
    wedge: Option<Wedge>,
}
#[derive(Clone, Deserialize)]
struct Wedge {
    pivot: [f32; 3],
    rotation: [f32; 3],
    shift: [f32; 3],
}

pub fn presets() -> &'static [Preset] {
    static PRESETS: OnceLock<Vec<Preset>> = OnceLock::new();
    PRESETS.get_or_init(|| serde_json::from_str(include_str!("presets.json")).unwrap())
}

#[derive(Clone, Copy, Default)]
pub struct Plane {
    pub n: V,
    pub offset: f32,
}
impl Plane {
    fn new(a: [f32; 4]) -> Self {
        Self {
            n: V(a[0], a[1], a[2]).unit(),
            offset: a[3],
        }
    }
    fn distance(self, p: V) -> f32 {
        self.n.dot(p) - self.offset
    }
}

#[derive(Clone, Copy)]
pub struct Settings {
    pub weather: f32,
    pub rounding: f32,
    pub fracture: f32,
    pub carving: f32,
    pub moss: f32,
    pub wet: f32,
    pub lichen: f32,
    pub runoff: f32,
    pub frost: f32,
}

pub struct Rock {
    pub planes: Vec<Plane>,
    spalls: [(V, f32); 2],
    joint: Plane,
    reach: Plane,
    seams: [Plane; 2],
    pub offset: V,
    pub fabric: V,
    pub settings: Settings,
    wedge: Option<([V; 3], V)>,
    pub min: V,
    pub max: V,
}
#[derive(Clone, Copy)]
pub struct Sample {
    pub distance: f32,
    pub fresh: f32,
    pub crack: f32,
    pub local: V,
}

fn hull_bounds(planes: &[Plane], margin: f32) -> (V, V) {
    let mut min = V(f32::INFINITY, f32::INFINITY, f32::INFINITY);
    let mut max = -min;
    for (i, a) in planes.iter().enumerate() {
        for (j, b) in planes.iter().enumerate().skip(i + 1) {
            for c in planes.iter().skip(j + 1) {
                let bc = b.n.cross(c.n);
                let det = a.n.dot(bc);
                if det.abs() < 1e-6 {
                    continue;
                }
                let p = (bc * (a.offset + margin)
                    + c.n.cross(a.n) * (b.offset + margin)
                    + a.n.cross(b.n) * (c.offset + margin))
                    / det;
                if planes
                    .iter()
                    .all(|face| face.distance(p) <= margin + 0.00002)
                {
                    min = min.min(p);
                    max = max.max(p);
                }
            }
        }
    }
    (min, max)
}

impl Rock {
    pub fn new(p: &Preset, seed: &str, settings: Settings) -> Self {
        let mut shape = Random::new(&format!("{seed}/shape"));
        let mut surface = Random::new(&format!("{seed}/surface"));
        let [sx, sy, sz] = p.size.map(|v| v * (1.0 + shape.vary(0.09)));
        let [lx, lz] = p.lean.map(|v| v + shape.vary(0.085));
        let [px, pz] = p.pitch.map(|v| v + shape.vary(0.075));
        let mut planes = Vec::with_capacity(25);
        let mut push = |x, y, z, offset| {
            let n = V(
                x / sx - y * px,
                y / sy - x * lx / sx - z * lz / sz,
                z / sz - y * pz,
            );
            let inv = 1.0 / n.length();
            planes.push(Plane {
                n: n * inv,
                offset: (offset + n.1 * p.height) * inv,
            });
        };
        for s in [-1.0, 1.0] {
            push(
                s,
                shape.vary(0.09),
                shape.vary(0.16),
                1.0 + shape.vary(0.12),
            );
            push(
                shape.vary(0.12),
                s,
                shape.vary(0.11),
                1.0 + shape.vary(0.08),
            );
            push(
                shape.vary(0.17),
                shape.vary(0.11),
                s,
                1.0 + shape.vary(0.12),
            );
        }
        for a in [-1.0, 1.0] {
            for b in [-1.0, 1.0] {
                push(
                    a * 0.73,
                    b * 0.70,
                    shape.vary(0.34),
                    p.facets[0] * 1.42 + shape.vary(0.11),
                );
                push(
                    shape.vary(0.30),
                    a * 0.66,
                    b * 0.81,
                    p.facets[1] * 1.43 + shape.vary(0.12),
                );
                push(
                    a * 0.64,
                    shape.vary(0.29),
                    b * 0.81,
                    p.facets[2] * 1.42 + shape.vary(0.12),
                );
                push(a * 0.59, 0.56, b * 0.55, 1.37 + shape.vary(0.16));
            }
        }
        for [x, y, z, d] in &p.extra {
            push(*x, *y, *z, *d + shape.vary(0.035));
        }
        let [x, y, z, d] = p.joint;
        let joint = Plane::new([
            x + shape.vary(0.08),
            y + shape.vary(0.08),
            z + shape.vary(0.08),
            d + shape.vary(if p.wedge.is_some() { 0.075 } else { 0.11 }),
        ]);
        let mut reach = Plane::new(p.reach);
        reach.offset += shape.vary(0.12);
        let spalls = p.spalls.map(|[x, y, z, r]| {
            let point = V(
                x + shape.vary(0.12),
                y + p.height + shape.vary(0.13),
                z + shape.vary(0.11),
            );
            let radius = r * (1.0 + shape.vary(0.21));
            let edge = planes
                .iter()
                .max_by(|a, b| a.distance(point).total_cmp(&b.distance(point)))
                .unwrap();
            (
                point + edge.n * (0.43 * radius - edge.distance(point)).max(0.0),
                radius,
            )
        });
        let offset = V(
            1.0 + surface.next() * 31.0,
            1.0 + surface.next() * 31.0,
            1.0 + surface.next() * 31.0,
        );
        let fabric = V(
            0.21 + surface.next() * 0.24,
            0.90,
            -0.47 + surface.next() * 0.68,
        )
        .unit();
        let seams = [
            Plane {
                n: fabric,
                offset: p.height * 0.75 + shape.vary(0.16),
            },
            Plane {
                n: V(-0.31 + shape.vary(0.2), 0.77, 0.34 + shape.vary(0.17)).unit(),
                offset: p.height * 1.22 + shape.vary(0.16),
            },
        ];
        let margin = settings.weather * 0.54 + 0.012;
        let (mut min, mut max) = hull_bounds(&planes, margin);
        let wedge = p
            .wedge
            .as_ref()
            .filter(|_| settings.fracture > 0.0)
            .map(|w| {
                let mut rng = Random::new(&format!("{seed}/fracture"));
                let opening = settings.fracture / p.fracture;
                let angles = V::from(w.rotation.map(|v| v * (0.84 + 0.32 * rng.next()))) * opening;
                let pivot = V::from(w.pivot);
                let shift = pivot - rotate(pivot, angles)
                    + V::from(w.shift.map(|v| v * (0.83 + 0.34 * rng.next()))) * opening;
                let axes = [V::X, V::Y, V::Z].map(|axis| rotate(axis, angles));
                let mut section = planes.clone();
                section.push(Plane {
                    n: -joint.n,
                    offset: -joint.offset,
                });
                let (a, b) = hull_bounds(&section, margin + 0.15);
                for x in [a.0, b.0] {
                    for y in [a.1, b.1] {
                        for z in [a.2, b.2] {
                            let v = rotate(V(x, y, z), angles) + shift;
                            min = min.min(v);
                            max = max.max(v);
                        }
                    }
                }
                (axes, shift)
            });
        Self {
            planes,
            spalls,
            joint,
            reach,
            seams,
            offset,
            fabric,
            settings,
            wedge,
            min: min - V(0.04, 0.04, 0.04),
            max: max + V(0.04, 0.04, 0.04),
        }
    }

    fn joint_axis(&self, p: V) -> f32 {
        let q = p + self.offset;
        self.joint.distance(p) + 0.107 * smooth(0.36, 0.53, p.1 + p.2 * 0.42)
            - 0.083 * smooth(-0.08, 0.13, p.2 - p.1 * 0.61)
            + 0.058 * (noise(q.mul(V(2.2, 4.4, 2.8))) - 0.5)
            + 0.012 * (noise(q * 11.0) - 0.5)
    }

    fn cracks(&self, p: V, shell: f32, grain: f32, erosion: f32, split: bool) -> f32 {
        let fracture = self.settings.fracture;
        let propagation = fracture
            * self.settings.frost
            * (0.45 + 0.55 * smooth(0.23, 0.73, 0.62 * erosion + 0.38 * grain));
        let mut d: f32 = -1.0;
        if !split {
            let reach = self.reach.distance(p) + 5.5 * propagation;
            if reach > -0.06 {
                let axis = self.joint_axis(p);
                let width = fracture * mix(0.44, 1.20, grain) + 1.10 * propagation;
                d = crack_slot(
                    axis,
                    reach,
                    shell,
                    width,
                    0.09 + 1.20 * fracture + 2.3 * propagation,
                    0.16,
                );
                let along = self.joint.n.cross(self.reach.n).unit();
                let run = p.dot(along) + 0.39;
                let extent =
                    (reach + 0.13).min(run.min(0.73 + 0.16 * erosion + 6.0 * propagation - run));
                let offset = 0.39 * run + 0.019 * (noise((p + self.offset) * 9.0) - 0.5);
                d = d.max(crack_slot(
                    axis - offset,
                    extent,
                    shell,
                    width * 0.61,
                    0.045 + 0.54 * fracture + 1.7 * propagation,
                    -0.13,
                ));
            }
        }
        for (i, seam) in self.seams.iter().enumerate() {
            let axis = seam.distance(p);
            if axis.abs() > 0.22 {
                continue;
            }
            let bed = axis + 0.115 * (erosion - 0.5) + 0.048 * (grain - 0.5);
            let extent = if i == 0 {
                p.2 + 0.62 * p.0 - 0.50
            } else {
                p.2 - 0.73 * p.0 - 0.74
            };
            let reach = extent + 3.7 * propagation;
            let width =
                (fracture * [0.38, 0.24][i] * smooth(0.26, 0.74, 0.62 * erosion + 0.38 * grain)
                    + 0.31 * propagation)
                    * if split { 0.52 } else { 1.0 };
            d = d.max(crack_slot(
                bed,
                reach,
                shell,
                width,
                0.044 + 0.65 * fracture + 1.7 * propagation,
                0.14,
            ));
            let run = if i == 0 { p.0 + 0.36 } else { -p.0 + 0.49 };
            let extent = (reach + 0.09).min(run.min(0.49 + 3.1 * propagation - run));
            d = d.max(crack_slot(
                bed - 0.33 * run,
                extent,
                shell,
                width * 0.79,
                0.035 + 0.43 * fracture + 1.3 * propagation,
                -0.15,
            ));
        }
        d
    }

    fn fragment(&self, p: V, side: f32) -> Sample {
        let settings = self.settings;
        let mut distance = -10.0;
        let mut gradient = V::default();
        for plane in &self.planes {
            let face = plane.distance(p);
            if settings.carving > 0.0 {
                gradient = blend(
                    gradient,
                    plane.n,
                    (0.5 + 0.5 * (face - distance) / settings.rounding).clamp(0.0, 1.0),
                );
            }
            distance = smax(distance, face, settings.rounding);
        }
        let envelope = settings.weather * 0.54 + 0.012;
        let q = p + self.offset;
        let mut joint = -10.0;
        if side != 0.0 {
            let approx = side * self.joint.distance(p);
            if approx > 0.20 {
                return Sample {
                    distance: (distance - envelope).max(approx - 0.16),
                    fresh: 0.0,
                    crack: 0.0,
                    local: p,
                };
            }
            if approx > -0.24 {
                let wet = noise(p.mul(V(3.0, 4.0, 3.0)) + self.offset);
                let opening = 0.15 + 0.06 * wet + settings.frost * (0.23 + 0.38 * wet);
                joint = side * self.joint_axis(p)
                    + settings.fracture * (0.016 + opening * smooth(0.02, 1.32, p.1));
            }
        }
        if distance > envelope + 0.045 {
            return Sample {
                distance: (distance - envelope).max(joint),
                fresh: 0.0,
                crack: 0.0,
                local: p,
            };
        }
        let erosion = noise(q.mul(V(2.05, 2.85, 2.10)) + V(0.7, 0.0, 0.0));
        let grain = noise(q.mul(V(5.9, 7.6, 6.4)));
        let grit = noise(q * 18.0);
        let breakup = 0.31 + 0.69 * smooth(0.28, 0.72, erosion);
        distance += settings.weather
            * (0.74 * (erosion - 0.53) + breakup * (0.20 * (grain - 0.5) + 0.06 * (grit - 0.5)));
        if side < 0.0 {
            distance = smax(
                distance,
                V(0.39, 0.81, 0.44).dot(p) - 1.14 + 0.029 * (erosion - 0.5),
                0.072,
            );
        }
        let shell = (-distance).max(0.0);
        if settings.carving > 0.0 && distance > -0.44 {
            let q = p * 0.29 + self.offset * 0.173;
            let weight = gradient.mul(gradient);
            let recess = erosion_map(q, weight, 3);
            let pocket = smooth(
                0.27,
                0.67,
                noise(p * 1.53 + self.offset + V(17.3, 17.3, 17.3)),
            );
            let edge = 1.0 - smooth(0.77, 0.98, gradient.length());
            let depth = mix(0.019, 0.121, pocket.max(edge * 0.79));
            let cut = settings.carving
                * (depth * recess
                    + settings.runoff
                        * (0.032 * recess + depth * 1.56 * smooth(0.24, 0.83, recess)));
            distance += cut
                * smooth(-0.44, -0.29, distance)
                * if self.wedge.is_some() { 0.64 } else { 1.0 };
        }
        distance +=
            (settings.runoff * 0.037 + settings.frost * 0.024) * smooth(0.32, 0.74, erosion);
        let mut fresh: f32 = 0.0;
        let mut crack = 0.0;
        if settings.fracture > 0.001 && distance > -0.37 {
            let cut = self.cracks(p, shell, grain, erosion, side != 0.0);
            crack = smooth(-0.014, 0.010, cut - distance) * smooth(-0.025, 0.003, cut);
            fresh = 0.60 * crack;
            distance = smax(distance, cut, 0.006);
        }
        for (i, (center, radius)) in self.spalls.iter().enumerate() {
            let s = p - *center;
            let t = 0.16 + 0.28 * hash(self.offset + V(1.0, 1.0, 1.0) * (i as f32 * 4.13));
            let radius = radius + 0.16 * smooth(t, t + 0.48, settings.frost);
            if s.length() * 0.67 - radius < 0.039 {
                let a = s.abs();
                let cut = radius
                    - a.dot(V(0.67, 0.72, 0.59))
                        .max((1.29 * a.1 + 0.16 * s.2).max(a.2 + 0.27 * s.0))
                    - 0.012 * (grain - 0.5);
                fresh = fresh.max(0.64 * smooth(-0.021, 0.021, cut - distance));
                distance = smax(distance, cut, 0.017);
            }
        }
        Sample {
            distance: smax(distance, joint, 0.013),
            fresh: fresh.max(smooth(-0.015, 0.025, joint - distance)),
            crack,
            local: p,
        }
    }

    pub fn sample(&self, p: V) -> Sample {
        match self.wedge {
            None => self.fragment(p, 0.0),
            Some((axes, shift)) => {
                let a = self.fragment(p, 1.0);
                let r = p - shift;
                let b = self.fragment(V(r.dot(axes[0]), r.dot(axes[1]), r.dot(axes[2])), -1.0);
                if a.distance < b.distance { a } else { b }
            }
        }
    }

    pub fn normal(&self, p: V, e: f32) -> V {
        let k = [
            V(1.0, -1.0, -1.0),
            V(-1.0, -1.0, 1.0),
            V(-1.0, 1.0, -1.0),
            V(1.0, 1.0, 1.0),
        ];
        k.iter()
            .fold(V::default(), |n, &v| {
                n + v * self.sample(p + v * e).distance
            })
            .unit()
    }
}

fn crack_slot(axis: f32, extent: f32, shell: f32, width: f32, depth: f32, bias: f32) -> f32 {
    let depth = depth.min(0.34);
    let taper = smooth(0.0, 0.18, extent);
    let mouth = 1.0 - smooth(0.0, depth, shell);
    (width * taper * mix(0.14, 1.0, mouth) - (axis + bias * shell).abs())
        .min((0.72 * extent).min(0.77 * (depth * taper - shell)))
}

pub fn erosion_map(q: V, weight: V, channel: usize) -> f32 {
    const N: usize = 384;
    const MAP: &[u8] = include_bytes!("erosion.rgba");
    let sample = |u: f32, v: f32| {
        let x = u * N as f32 - 0.5;
        let y = v * N as f32 - 0.5;
        let i = x.floor() as isize;
        let j = y.floor() as isize;
        let read = |x: isize, y: isize| {
            MAP[(y.rem_euclid(N as isize) as usize * N + x.rem_euclid(N as isize) as usize) * 4
                + channel] as f32
                / 255.0
        };
        mix(
            mix(read(i, j), read(i + 1, j), x - x.floor()),
            mix(read(i, j + 1), read(i + 1, j + 1), x - x.floor()),
            y - y.floor(),
        )
    };
    (sample(q.2 * 1.23 + q.1 * 0.14, q.1 * 0.72) * weight.0
        + sample(q.0 + q.2 * 0.23, q.2) * weight.1
        + sample(q.0 * 1.13 - q.1 * 0.21, q.1 * 0.74) * weight.2)
        / (weight.0 + weight.1 + weight.2).max(0.001)
}
