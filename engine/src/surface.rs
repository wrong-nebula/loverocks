use crate::math::{V, noise, smooth};
use wasm_bindgen::prelude::*;

#[derive(Clone, Copy)]
struct Bounds {
    min: V,
    max: V,
}
impl Bounds {
    fn at(p: V) -> Self {
        Self { min: p, max: p }
    }
    fn include(self, rhs: Self) -> Self {
        Self {
            min: self.min.min(rhs.min),
            max: self.max.max(rhs.max),
        }
    }
    fn distance2(self, p: V) -> f32 {
        let delta = (self.min - p).max(p - self.max).max(V::default());
        delta.dot(delta)
    }
    fn ray(self, origin: V, direction: V, mut far: f32) -> bool {
        let mut near: f32 = 0.0;
        for (axis, (min, max)) in self
            .min
            .array()
            .into_iter()
            .zip(self.max.array())
            .enumerate()
        {
            let o = origin.array()[axis];
            let d = direction.array()[axis];
            if d == 0.0 {
                if o < min || o > max {
                    return false;
                }
            } else {
                let a = (min - o) / d;
                let b = (max - o) / d;
                near = near.max(a.min(b));
                far = far.min(a.max(b));
                if far < near {
                    return false;
                }
            }
        }
        true
    }
}

struct Triangle {
    indices: [usize; 3],
    bounds: Bounds,
    center: V,
    normal: V,
}
struct Node {
    bounds: Bounds,
    start: usize,
    end: usize,
    right: usize,
}
pub struct Hit {
    pub point: V,
    pub normal: V,
    pub distance: f32,
    pub tests: u32,
}

#[wasm_bindgen]
pub struct SurfaceIndex {
    vertices: Vec<V>,
    triangles: Vec<Triangle>,
    nodes: Vec<Node>,
}

#[wasm_bindgen]
impl SurfaceIndex {
    #[wasm_bindgen(constructor)]
    pub fn new(positions: &[f32], indices: &[u32]) -> Result<SurfaceIndex, JsError> {
        Self::build(positions, indices).ok_or_else(|| JsError::new("Invalid triangle mesh"))
    }

    /// Pairs of snow coverage and lichen exposure on the indexed mesh.
    pub fn weather(&self, normals: &[f32]) -> Vec<f32> {
        let width = self.span();
        let eps = width * 0.00012;
        let dirs = [
            V::Y,
            V(0.47, 0.82, 0.0),
            V(-0.47, 0.82, 0.0),
            V(0.0, 0.82, 0.47),
            V(0.0, 0.82, -0.47),
        ];
        let bottom = self.nodes[0].bounds.min.1;
        let height = self.nodes[0].bounds.max.1 - bottom;
        self.vertices
            .iter()
            .zip(normals.chunks_exact(3))
            .flat_map(|(&p, values)| {
                let n = V(values[0], values[1], values[2]).unit();
                let origin = p + n * eps;
                let visible = dirs.map(|d| !self.any_hit(origin, d, eps, width * 2.0));
                let sky = (visible[1..].iter().filter(|&&open| open).count() as f32
                    + 2.0 * visible[0] as u8 as f32)
                    / 6.0;
                let noise = noise(p * 5.7 + V(17.0, 2.0, 11.0));
                let slope = smooth(0.37, 0.84, n.1 + 0.19 * (noise - 0.5));
                let altitude = smooth(0.18, 0.70, (p.1 - bottom) / height.max(eps));
                let snow = slope
                    * (0.18 + 0.82 * altitude)
                    * (0.11 + 0.89 * sky)
                    * if visible[0] { 1.0 } else { 0.07 };
                let lichen = (0.33 + 0.67 * sky) * smooth(-0.75, 0.18, n.1);
                [snow, lichen]
            })
            .collect()
    }

    /// First front-facing contact on a finite ray, as position, normal, distance.
    pub fn contact(&self, origin: &[f32], direction: &[f32], limit: f32) -> Vec<f32> {
        if origin.len() != 3 || direction.len() != 3 || limit <= 0.0 {
            return Vec::new();
        }
        let origin = V(origin[0], origin[1], origin[2]);
        let direction = V(direction[0], direction[1], direction[2]).unit();
        self.ray_hit(origin, direction, 0.0, limit, true)
            .map_or_else(Vec::new, |hit| {
                let [x, y, z] = hit.point.array();
                let [nx, ny, nz] = hit.normal.array();
                vec![x, y, z, nx, ny, nz, hit.distance]
            })
    }
}

impl SurfaceIndex {
    pub fn build(positions: &[f32], indices: &[u32]) -> Option<Self> {
        let vertices: Vec<_> = positions
            .chunks_exact(3)
            .map(|p| V(p[0], p[1], p[2]))
            .collect();
        if positions.len() % 3 != 0
            || indices.len() % 3 != 0
            || indices.is_empty()
            || !positions.iter().all(|x| x.is_finite())
            || indices.iter().any(|&i| i as usize >= vertices.len())
        {
            return None;
        }
        let triangles = indices
            .chunks_exact(3)
            .map(|ids| {
                let indices = [ids[0] as usize, ids[1] as usize, ids[2] as usize];
                let [a, b, c] = indices.map(|i| vertices[i]);
                Triangle {
                    indices,
                    bounds: Bounds::at(a).include(Bounds::at(b)).include(Bounds::at(c)),
                    center: (a + b + c) / 3.0,
                    normal: (b - a).cross(c - a).unit(),
                }
            })
            .collect();
        let mut index = Self {
            vertices,
            triangles,
            nodes: Vec::new(),
        };
        index.partition(0, index.triangles.len());
        Some(index)
    }

    pub fn span(&self) -> f32 {
        let b = self.nodes[0].bounds;
        (b.max - b.min).length().max(0.000001)
    }

    fn partition(&mut self, start: usize, end: usize) -> usize {
        let bounds = self.triangles[start..end]
            .iter()
            .map(|t| t.bounds)
            .reduce(Bounds::include)
            .unwrap();
        let index = self.nodes.len();
        self.nodes.push(Node {
            bounds,
            start,
            end,
            right: 0,
        });
        if end - start > 8 {
            let axes = (bounds.max - bounds.min).array();
            let axis = (0..3).max_by(|&a, &b| axes[a].total_cmp(&axes[b])).unwrap();
            let half = (end - start) / 2;
            self.triangles[start..end].select_nth_unstable_by(half, |a, b| {
                a.center.array()[axis].total_cmp(&b.center.array()[axis])
            });
            self.partition(start, start + half);
            self.nodes[index].right = self.partition(start + half, end);
        }
        index
    }

    fn points(&self, t: &Triangle) -> [V; 3] {
        t.indices.map(|i| self.vertices[i])
    }

    /// A hint may tighten the upper bound if it is an actual point on this mesh.
    pub fn closest(&self, p: V, hint: Option<V>) -> Hit {
        let upper = hint.map_or(f32::INFINITY, |q| (p - q).dot(p - q));
        let mut hit = Hit {
            point: V(f32::NAN, 0.0, 0.0),
            normal: V::default(),
            distance: upper,
            tests: 0,
        };
        self.closest_node(0, p, &mut hit);
        if !hit.point.0.is_finite() {
            hit.distance = f32::INFINITY;
            self.closest_node(0, p, &mut hit);
        }
        hit.distance = hit.distance.sqrt();
        hit
    }

    fn closest_node(&self, index: usize, p: V, hit: &mut Hit) {
        let node = &self.nodes[index];
        if node.bounds.distance2(p) > hit.distance * (1.0 + 2e-6) + 1e-12 {
            return;
        }
        if node.right == 0 {
            for t in &self.triangles[node.start..node.end] {
                let q = closest_triangle(p, self.points(t));
                let d = (p - q).dot(p - q);
                if d <= hit.distance * (1.0 + 2e-6) + 1e-12
                    && (d <= hit.distance || !hit.point.0.is_finite())
                {
                    hit.point = q;
                    hit.normal = t.normal;
                    hit.distance = d;
                }
                hit.tests += 1;
            }
        } else {
            let left = index + 1;
            let right = node.right;
            let [near, far] =
                if self.nodes[left].bounds.distance2(p) <= self.nodes[right].bounds.distance2(p) {
                    [left, right]
                } else {
                    [right, left]
                };
            self.closest_node(near, p, hit);
            self.closest_node(far, p, hit);
        }
    }

    fn any_hit(&self, origin: V, direction: V, near: f32, far: f32) -> bool {
        self.visit_ray(
            0,
            origin,
            direction,
            &mut |t| {
                ray_triangle(origin, direction, self.points(t))
                    .is_some_and(|d| d > near && d <= far)
            },
            far,
        )
    }

    fn visit_ray(
        &self,
        index: usize,
        origin: V,
        direction: V,
        test: &mut impl FnMut(&Triangle) -> bool,
        far: f32,
    ) -> bool {
        let node = &self.nodes[index];
        if !node.bounds.ray(origin, direction, far) {
            return false;
        }
        if node.right == 0 {
            return self.triangles[node.start..node.end].iter().any(test);
        }
        self.visit_ray(index + 1, origin, direction, test, far)
            || self.visit_ray(node.right, origin, direction, test, far)
    }

    pub fn ray_hit(
        &self,
        origin: V,
        direction: V,
        near: f32,
        far: f32,
        front_only: bool,
    ) -> Option<Hit> {
        let mut hit = None;
        let mut best = far;
        self.visit_ray(
            0,
            origin,
            direction,
            &mut |t| {
                if front_only && t.normal.dot(direction) >= 0.0 {
                    return false;
                }
                if let Some(d) = ray_triangle(origin, direction, self.points(t))
                    .filter(|&d| d > near && d <= best)
                {
                    best = d;
                    hit = Some(Hit {
                        point: origin + direction * d,
                        normal: t.normal,
                        distance: d,
                        tests: 0,
                    });
                }
                false
            },
            far,
        );
        hit
    }

    pub fn inside(&self, p: V) -> bool {
        let dir = V(1.0, 0.34717, 0.15973);
        let epsilon = self.span() * 1e-6;
        let mut hits = Vec::new();
        self.visit_ray(
            0,
            p,
            dir,
            &mut |t| {
                if let Some(d) = ray_triangle(p, dir, self.points(t)).filter(|&d| d > epsilon) {
                    hits.push(d);
                }
                false
            },
            f32::INFINITY,
        );
        hits.sort_unstable_by(f32::total_cmp);
        hits.dedup_by(|a, b| (*a - *b).abs() < epsilon);
        hits.len() % 2 != 0
    }
}

fn closest_triangle(p: V, [a, b, c]: [V; 3]) -> V {
    let ab = b - a;
    let ac = c - a;
    let n = ab.cross(ac);
    let denom = n.dot(n);
    if denom > 0.0 {
        let offset = p - a;
        let u = offset.cross(ac).dot(n) / denom;
        let v = ab.cross(offset).dot(n) / denom;
        if u >= 0.0 && v >= 0.0 && u + v <= 1.0 {
            return a + ab * u + ac * v;
        }
    }
    [(a, b), (b, c), (c, a)]
        .into_iter()
        .map(|(a, b)| {
            let line = b - a;
            let length = line.dot(line);
            let t = if length > 0.0 {
                (line.dot(p - a) / length).clamp(0.0, 1.0)
            } else {
                0.0
            };
            a + line * t
        })
        .min_by(|&a, &b| (a - p).dot(a - p).total_cmp(&(b - p).dot(b - p)))
        .unwrap()
}

fn ray_triangle(o: V, d: V, [a, b, c]: [V; 3]) -> Option<f32> {
    let ab = b - a;
    let ac = c - a;
    let h = d.cross(ac);
    let det = ab.dot(h);
    if det.abs() < 1e-12 {
        return None;
    }
    let r = o - a;
    let u = r.dot(h) / det;
    let q = r.cross(ab);
    let v = d.dot(q) / det;
    (u >= 0.0 && v >= 0.0 && u + v <= 1.0).then(|| ac.dot(q) / det)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn triangles_supply_continuous_contacts_and_safely_use_point_bounds() {
        let index = SurfaceIndex::build(&[0., 0., 0., 0., 0., 2., 2., 0., 0.], &[0, 1, 2]).unwrap();
        let q = V(0.4, 3., 0.8);
        let hit = index.closest(q, Some(V::Z));
        assert!((hit.point - V(0.4, 0., 0.8)).length() < 1e-6);
        assert!((hit.distance - 3.0).abs() < 1e-6);
        assert!(index.ray_hit(q, -V::Y, 0., 4., true).is_some());
        assert!(index.ray_hit(q, -V::Y, 0., 2., true).is_none());
        assert!(
            index
                .ray_hit(V(0.4, -3., 0.8), V::Y, 0., 4., true)
                .is_none()
        );
        assert_eq!(index.contact(&[0.4, 3., 0.8], &[0., -1., 0.], 4.).len(), 7);
    }
}
