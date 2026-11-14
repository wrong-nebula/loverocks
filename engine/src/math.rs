use std::ops::{Add, Div, Mul, Neg, Sub};

#[derive(Clone, Copy, Debug, Default)]
pub struct V(pub f32, pub f32, pub f32);

impl V {
    pub const X: Self = Self(1.0, 0.0, 0.0);
    pub const Y: Self = Self(0.0, 1.0, 0.0);
    pub const Z: Self = Self(0.0, 0.0, 1.0);

    pub fn dot(self, v: Self) -> f32 {
        self.0 * v.0 + self.1 * v.1 + self.2 * v.2
    }
    pub fn cross(self, v: Self) -> Self {
        Self(
            self.1 * v.2 - self.2 * v.1,
            self.2 * v.0 - self.0 * v.2,
            self.0 * v.1 - self.1 * v.0,
        )
    }
    pub fn length(self) -> f32 {
        self.dot(self).sqrt()
    }
    pub fn unit(self) -> Self {
        self / self.length().max(1e-10)
    }
    pub fn abs(self) -> Self {
        Self(self.0.abs(), self.1.abs(), self.2.abs())
    }
    pub fn floor(self) -> Self {
        Self(self.0.floor(), self.1.floor(), self.2.floor())
    }
    pub fn mul(self, v: Self) -> Self {
        Self(self.0 * v.0, self.1 * v.1, self.2 * v.2)
    }
    pub fn min(self, v: Self) -> Self {
        Self(self.0.min(v.0), self.1.min(v.1), self.2.min(v.2))
    }
    pub fn max(self, v: Self) -> Self {
        Self(self.0.max(v.0), self.1.max(v.1), self.2.max(v.2))
    }
    pub fn array(self) -> [f32; 3] {
        [self.0, self.1, self.2]
    }
}
impl From<[f32; 3]> for V {
    fn from(a: [f32; 3]) -> Self {
        Self(a[0], a[1], a[2])
    }
}
impl Add for V {
    type Output = Self;
    fn add(self, v: Self) -> Self {
        Self(self.0 + v.0, self.1 + v.1, self.2 + v.2)
    }
}
impl Sub for V {
    type Output = Self;
    fn sub(self, v: Self) -> Self {
        Self(self.0 - v.0, self.1 - v.1, self.2 - v.2)
    }
}
impl Mul<f32> for V {
    type Output = Self;
    fn mul(self, s: f32) -> Self {
        Self(self.0 * s, self.1 * s, self.2 * s)
    }
}
impl Div<f32> for V {
    type Output = Self;
    fn div(self, s: f32) -> Self {
        self * (1.0 / s)
    }
}
impl Neg for V {
    type Output = Self;
    fn neg(self) -> Self {
        self * -1.0
    }
}

pub fn mix(a: f32, b: f32, t: f32) -> f32 {
    a + (b - a) * t
}
pub fn blend(a: V, b: V, t: f32) -> V {
    a + (b - a) * t
}
pub fn smooth(a: f32, b: f32, x: f32) -> f32 {
    let t = ((x - a) / (b - a)).clamp(0.0, 1.0);
    t * t * (3.0 - 2.0 * t)
}
pub fn smax(a: f32, b: f32, k: f32) -> f32 {
    let h = (1.0 - (a - b).abs() / k).max(0.0);
    a.max(b) + 0.25 * k * h * h
}
pub fn hash(p: V) -> f32 {
    let p = p.mul(V(0.1031, 0.1030, 0.0973));
    let p = p - p.floor();
    let a = p.dot(V(p.1 + 33.33, p.0 + 33.33, p.2 + 33.33));
    let h = (p.0 + p.1 + 2.0 * a) * (p.2 + a);
    h - h.floor()
}
pub fn noise(p: V) -> f32 {
    let i = p.floor();
    let f = p - i;
    let f = f.mul(f).mul(V(3.0, 3.0, 3.0) - f * 2.0);
    let low = mix(
        mix(hash(i), hash(i + V::X), f.0),
        mix(hash(i + V::Y), hash(i + V::X + V::Y), f.0),
        f.1,
    );
    let i = i + V::Z;
    let high = mix(
        mix(hash(i), hash(i + V::X), f.0),
        mix(hash(i + V::Y), hash(i + V::X + V::Y), f.0),
        f.1,
    );
    mix(low, high, f.2)
}

pub struct Random(u32);
impl Random {
    pub fn new(seed: &str) -> Self {
        Self(
            seed.chars()
                .fold(2166136261, |h, c| (h ^ c as u32).wrapping_mul(16777619)),
        )
    }
    pub fn next(&mut self) -> f32 {
        self.0 = self.0.wrapping_add(0x6d2b79f5);
        let mut t = (self.0 ^ (self.0 >> 15)).wrapping_mul(self.0 | 1);
        t ^= t.wrapping_add((t ^ (t >> 7)).wrapping_mul(t | 61));
        ((t ^ (t >> 14)) as f64 / 4294967296.0) as f32
    }
    pub fn vary(&mut self, amplitude: f32) -> f32 {
        (self.next() * 2.0 - 1.0) * amplitude
    }
}

pub fn rotate(v: V, angles: V) -> V {
    let (sx, cx) = angles.0.sin_cos();
    let (sy, cy) = angles.1.sin_cos();
    let (sz, cz) = angles.2.sin_cos();
    let a = V(v.0, cx * v.1 - sx * v.2, sx * v.1 + cx * v.2);
    let b = V(cy * a.0 + sy * a.2, a.1, -sy * a.0 + cy * a.2);
    V(cz * b.0 - sz * b.1, sz * b.0 + cz * b.1, b.2)
}
