use crate::math::{V, mix};

/// Four-tap SDF wall correction from the Archive experiment.
/// Distances are in rock units and Y is up.
pub fn visibility(p: V, n: V, cell: f32, radius: f32, distance: impl Fn(V) -> f32) -> f32 {
    let offset = cell * 0.55;
    let bias = cell * 0.22;
    let mut taps = [0.0; 4];
    for (tap, fraction) in taps.iter_mut().zip([1.0, 3.0, 5.0, 7.0]) {
        let r = radius * fraction / 7.0;
        *tap = (1.0 - (distance(p + n * (offset + r)) + bias) / r).clamp(0.0, 1.0);
    }
    let vertical = 1.0 - n.1.abs().clamp(0.0, 1.0);
    let far_support = 0.40 + 0.60 * taps[0].max(taps[1]);
    let original = [1.0, 0.8166667, 0.6333333, 0.45];
    let corrected = [0.46, 0.24, 0.21 * far_support, 0.16 * far_support];
    let occlusion: f32 = (0..4)
        .map(|i| taps[i] * mix(0.92 * original[i] / 2.9, corrected[i], vertical))
        .sum();
    (1.0 - occlusion).clamp(0.0, 1.0)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn open_faces_stay_bright_and_near_contact_outweighs_distant_blockers() {
        let p = V::default();
        let r = 0.35;
        let plane = visibility(p, V::X, 0.01, r, |q| q.0);
        let gap = |q: V| q.0.min(0.045 - q.0);
        let contact = visibility(p, V::X, 0.01, r, gap);
        let distant = visibility(p, V::X, 0.01, r, |q| q.0.min(0.34 - q.0));
        assert_eq!(plane, 1.0);
        assert!(contact < 0.3 && distant > 0.8);
    }
}
