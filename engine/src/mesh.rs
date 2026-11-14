use crate::{
    ao,
    field::{Rock, erosion_map},
    math::*,
};

pub const STRIDE: usize = 16;

pub struct Mesh {
    pub vertices: Vec<f32>,
    pub indices: Vec<u32>,
    pub bounds: [f32; 6],
}

// Surface nets place one vertex at the mean of the zero crossings in each
// active cell, then join the four adjacent cells around each crossing edge.
pub fn extract(rock: &Rock, resolution: usize) -> Mesh {
    extract_field(
        rock.min,
        rock.max,
        resolution,
        |p| rock.sample(p).distance,
        |p, e| rock.normal(p, e),
        |p, n, cell| surface(rock, p, n, cell),
    )
}

pub fn extract_field(
    min: V,
    max: V,
    resolution: usize,
    distance: impl Fn(V) -> f32,
    normal: impl Fn(V, f32) -> V,
    material: impl Fn(V, V, f32) -> (V, f32, f32, f32, f32, f32, f32),
) -> Mesh {
    let span = max - min;
    let cell = span.0.max(span.1).max(span.2) / resolution as f32;
    let [nx, ny, nz] = span.array().map(|s| (s / cell).ceil() as usize + 2);
    let origin = min - V(cell, cell, cell) * 0.5;
    let vertex_index = |x, y, z| (z * (ny + 1) + y) * (nx + 1) + x;
    let cell_index = |x, y, z| (z * ny + y) * nx + x;
    let point = |x, y, z| origin + V(x as f32, y as f32, z as f32) * cell;
    let mut field = vec![0.0; (nx + 1) * (ny + 1) * (nz + 1)];
    for z in 0..=nz {
        for y in 0..=ny {
            for x in 0..=nx {
                field[vertex_index(x, y, z)] = distance(point(x, y, z));
            }
        }
    }
    let radius = span.0.max(span.1).max(span.2) * 0.10;
    // Use the same trilinearly filtered distance grid that produced the mesh.
    let distance_at = |p: V| {
        let coords = ((p - origin) / cell).array();
        let dimensions = [nx, ny, nz];
        if coords
            .iter()
            .zip(dimensions)
            .any(|(&v, size)| v < 0.0 || v >= size as f32)
        {
            return radius + cell;
        }
        let [x, y, z] = coords.map(|v| v as usize);
        let [u, v, w] = coords.map(f32::fract);
        let layer = |z| {
            let row = |y| {
                mix(
                    field[vertex_index(x, y, z)],
                    field[vertex_index(x + 1, y, z)],
                    u,
                )
            };
            mix(row(y), row(y + 1), v)
        };
        mix(layer(z), layer(z + 1), w)
    };
    let mut vertices = Vec::new();
    let mut indices = Vec::new();
    let mut cells = vec![u32::MAX; nx * ny * nz];
    let corner = [
        [0, 0, 0],
        [1, 0, 0],
        [0, 1, 0],
        [1, 1, 0],
        [0, 0, 1],
        [1, 0, 1],
        [0, 1, 1],
        [1, 1, 1],
    ];
    let edges = [
        (0, 1),
        (2, 3),
        (4, 5),
        (6, 7),
        (0, 2),
        (1, 3),
        (4, 6),
        (5, 7),
        (0, 4),
        (1, 5),
        (2, 6),
        (3, 7),
    ];
    for z in 0..nz {
        for y in 0..ny {
            for x in 0..nx {
                let values = corner.map(|[a, b, c]| field[vertex_index(x + a, y + b, z + c)]);
                let negatives = values.iter().filter(|&&d| d < 0.0).count();
                if negatives == 0 || negatives == 8 {
                    continue;
                }
                let mut sum = V::default();
                let mut count = 0.0;
                for (a, b) in edges {
                    if (values[a] < 0.0) == (values[b] < 0.0) {
                        continue;
                    }
                    let u = V::from(corner[a].map(|v| v as f32));
                    let v = V::from(corner[b].map(|v| v as f32));
                    sum = sum + blend(u, v, values[a] / (values[a] - values[b]));
                    count += 1.0;
                }
                let p = point(x, y, z) + sum * (cell / count);
                let n = normal(p, (cell * 0.16).clamp(0.002, 0.014));
                let (color, roughness, wet, moss, lichen, fresh, thickness) = material(p, n, cell);
                cells[cell_index(x, y, z)] = (vertices.len() / STRIDE) as u32;
                vertices.extend_from_slice(&p.array());
                vertices.extend_from_slice(&n.array());
                vertices.extend_from_slice(&color.array());
                let ao = ao::visibility(p, n, cell, radius, distance_at);
                vertices.extend_from_slice(&[roughness, wet, moss, lichen, fresh, thickness, ao]);
            }
        }
    }

    let mut quad = |corners: [u32; 4], forward: bool| {
        if corners.contains(&u32::MAX) {
            return;
        }
        let [a, b, c, d] = corners;
        if forward {
            indices.extend_from_slice(&[a, b, c, a, c, d]);
        } else {
            indices.extend_from_slice(&[a, c, b, a, d, c]);
        }
    };
    for z in 1..nz {
        for y in 1..ny {
            for x in 1..nx {
                let id = |x, y, z| cells[cell_index(x, y, z)];
                let negative = field[vertex_index(x, y, z)] < 0.0;
                if negative != (field[vertex_index(x + 1, y, z)] < 0.0) {
                    quad(
                        [
                            id(x, y - 1, z - 1),
                            id(x, y, z - 1),
                            id(x, y, z),
                            id(x, y - 1, z),
                        ],
                        negative,
                    );
                }
                if negative != (field[vertex_index(x, y + 1, z)] < 0.0) {
                    quad(
                        [
                            id(x - 1, y, z - 1),
                            id(x - 1, y, z),
                            id(x, y, z),
                            id(x, y, z - 1),
                        ],
                        negative,
                    );
                }
                if negative != (field[vertex_index(x, y, z + 1)] < 0.0) {
                    quad(
                        [
                            id(x - 1, y - 1, z),
                            id(x, y - 1, z),
                            id(x, y, z),
                            id(x - 1, y, z),
                        ],
                        negative,
                    );
                }
            }
        }
    }
    Mesh {
        vertices,
        indices,
        bounds: [min.0, min.1, min.2, max.0, max.1, max.2],
    }
}

fn surface(rock: &Rock, p: V, n: V, footprint: f32) -> (V, f32, f32, f32, f32, f32, f32) {
    let hit = rock.sample(p);
    let settings = rock.settings;
    let q = hit.local + rock.offset;
    let wide = noise(q * 2.45);
    let mottling = noise(q * 7.6);
    let flake = mix(noise(q * 21.0), 0.5, smooth(0.016, 0.075, footprint));
    let grain = mix(noise(q * 69.0), 0.5, smooth(0.006, 0.026, footprint));
    let mineral = (0.04 + 0.71 * wide + 0.18 * flake + 0.12 * grain).clamp(0.0, 1.0);
    let band = (rock.fabric.dot(hit.local) * 47.0 + 2.0 * mottling).sin();
    let lamination =
        1.0 - 0.14 * smooth(0.68, 0.98, band) * (1.0 - smooth(0.018, 0.045, footprint));
    let mut stone = blend(V(0.040, 0.041, 0.029), V(0.210, 0.184, 0.130), mineral)
        * ((0.82 + 0.30 * mottling) * (0.89 + 0.22 * grain) * lamination);
    let rust = smooth(
        0.55,
        0.76,
        noise(q * 4.8 + V(13.2, 13.2, 13.2)) * 0.76 + flake * 0.24,
    );
    stone = blend(
        stone,
        V(0.207, 0.112, 0.053),
        (0.51 + 0.21 * settings.runoff) * rust,
    );
    let weight = n.mul(n);
    let channels = smooth(
        0.21,
        0.58,
        erosion_map(
            hit.local * 0.46 + rock.offset * 0.173,
            weight.mul(weight),
            1,
        ),
    );
    let base = 1.0 - smooth(0.01, 0.55, p.1);
    let ledge = smooth(0.07, 0.72, n.1);
    let porous = 0.30 + 0.43 * flake + 0.23 * mottling;
    let retention = (0.76 * hit.crack)
        .max(channels * (0.58 + 0.42 * wide))
        .max(base * 0.72);
    let wet = (settings.wet
        * (0.14 + 0.32 * porous + 0.78 * retention + 0.24 * wide * ledge)
        * (1.0 - 0.42 * (1.0 - smooth(-0.47, -0.04, n.1))))
    .clamp(0.0, 1.0);
    let shelter = (base * 0.92).max(ledge * (1.0 - 0.68 * wide) * 0.74);
    let moss_patch = noise(q * 2.15 + V(6.72, 6.72, 6.72));
    let tuft = noise(q * 23.0);
    let islands = 0.58 * moss_patch
        + 0.17 * mottling
        + 0.07 * flake
        + 0.09 * tuft
        + 0.42 * shelter
        + 0.13 * wet;
    let threshold = 0.84 - 0.54 * settings.moss;
    let moss = smooth(threshold, threshold + 0.11, islands)
        * smooth(0.0, 0.13, settings.moss)
        * (0.33 + 0.67 * shelter)
        * (1.0 - 0.92 * hit.fresh)
        * (1.0 - 0.82 * hit.crack);
    let moss_color = blend(
        V(0.026, 0.038, 0.010),
        V(0.128, 0.137, 0.036),
        0.65 * tuft + 0.35 * flake,
    );
    let habitat = 0.70 * noise(q * 2.65 + V(14.1, 14.1, 14.1)) + 0.19 * wide + 0.11 * mottling;
    let threshold = 0.81 - 0.57 * settings.lichen;
    let lichen = smooth(threshold, threshold + 0.19, habitat)
        * (1.0 - moss * 0.94)
        * (1.0 - hit.fresh * 0.98)
        * (1.0 - hit.crack * 0.84)
        * (1.0 - base * 0.72)
        * smooth(0.0, 0.20, settings.lichen);
    let baked_lichen = lichen * smooth(0.64, 0.78, noise(q * 18.0));
    stone = blend(stone, V(0.245, 0.239, 0.163), baked_lichen * 0.36);
    let fracture = blend(
        V(0.066, 0.067, 0.051),
        V(0.170, 0.155, 0.109),
        0.65 * wide + 0.35 * grain,
    );
    stone = blend(stone, fracture, hit.fresh) * (1.0 - 0.23 * hit.crack);
    let albedo = blend(
        stone * (1.0 - 0.62 * wet),
        moss_color * (1.0 - 0.40 * wet),
        moss,
    );
    let roughness = mix(
        0.63 + 0.28 * porous - 0.19 * wet,
        0.87 + 0.09 * tuft - 0.11 * wet,
        moss,
    );
    (albedo, roughness, wet, moss, lichen, hit.fresh, 0.0)
}
