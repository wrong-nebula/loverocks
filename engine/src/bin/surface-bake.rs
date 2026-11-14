use fjord_engine::{math::V, surface::SurfaceIndex};
use std::{
    env, fs,
    io::{BufWriter, Write},
    time::Instant,
};

fn words(path: &str) -> Vec<u32> {
    let data = fs::read(path).expect("read input");
    assert_eq!(data.len() % 4, 0, "input must contain packed 32-bit values");
    data.chunks_exact(4)
        .map(|s| u32::from_le_bytes(s.try_into().unwrap()))
        .collect()
}
fn floats(path: &str) -> Vec<f32> {
    words(path).into_iter().map(f32::from_bits).collect()
}
fn vector(values: &[f32]) -> V {
    V(values[0], values[1], values[2])
}

fn main() -> std::io::Result<()> {
    let args: Vec<_> = env::args().collect();
    assert_eq!(
        args.len(),
        7,
        "usage: surface-bake positions.f32 triangles.u32 queries.f32 hints.f32 output.f32 signed|unsigned"
    );
    let positions = floats(&args[1]);
    let indices = words(&args[2]);
    let queries = floats(&args[3]);
    let hints = floats(&args[4]);
    assert_eq!(queries.len(), hints.len());
    assert_eq!(queries.len() % 3, 0);
    assert!(args[6] == "signed" || args[6] == "unsigned");
    let now = Instant::now();
    let surface = SurfaceIndex::build(&positions, &indices).expect("valid mesh");
    let build = now.elapsed().as_secs_f64() * 1000.0;
    let now = Instant::now();
    let baseline: Vec<_> = queries
        .chunks_exact(3)
        .map(|p| surface.closest(vector(p), None))
        .collect();
    let baseline_ms = now.elapsed().as_secs_f64() * 1000.0;
    let now = Instant::now();
    let seeded: Vec<_> = queries
        .chunks_exact(3)
        .zip(hints.chunks_exact(3))
        .map(|(p, h)| surface.closest(vector(p), Some(vector(h))))
        .collect();
    let seeded_ms = now.elapsed().as_secs_f64() * 1000.0;
    let mut max_error: f32 = 0.0;
    let mut file = BufWriter::new(fs::File::create(&args[5])?);
    let now = Instant::now();
    for ((a, b), p) in baseline.iter().zip(&seeded).zip(queries.chunks_exact(3)) {
        max_error = max_error.max((a.distance - b.distance).abs());
        let sign = if args[6] == "signed" && surface.inside(vector(p)) {
            -1.0
        } else {
            1.0
        };
        file.write_all(&(b.distance * sign).to_le_bytes())?;
    }
    file.flush()?;
    assert!(
        max_error < surface.span() * 1e-6,
        "hinted and unhinted results diverged"
    );
    println!(
        "{{\"bvh_build_ms\":{build:.3},\"unseeded_ms\":{baseline_ms:.3},\"seeded_ms\":{seeded_ms:.3},\"sign_and_write_ms\":{:.3},\"unseeded_triangle_tests\":{},\"seeded_triangle_tests\":{},\"max_distance_difference\":{max_error}}}",
        now.elapsed().as_secs_f64() * 1000.0,
        baseline.iter().map(|h| h.tests as u64).sum::<u64>(),
        seeded.iter().map(|h| h.tests as u64).sum::<u64>()
    );
    Ok(())
}
