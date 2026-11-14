"""CPU reference experiment for Wang et al. arXiv:2611.15320.
Requires NumPy, SciPy and the native surface-bake binary. Mesh input is packed
xyz float32 and triangle uint32, little-endian, or the Poly Haven glTF fixture.
"""
import argparse
import json
from pathlib import Path
import subprocess
from time import perf_counter

import numpy as np
from scipy.spatial import Delaunay, cKDTree
from scipy.spatial.transform import Rotation


class PointIndex:
    """Sequential insertion DAG with a certified grid start from eight corner paths."""
    def __init__(self, points, low, high, cells=8):
        self.points = np.asarray(points, dtype=np.float64)
        self.low, self.high, self.cells = low, high, cells
        self.edges = [[] for _ in points]
        start = 5
        # The first tetrahedra are initialized together. Linking this short
        # prefix exhaustively preserves the same rank-ordered path.
        for j in range(1, start):
            for i in range(j):
                self.edges[i].append(j)
        delaunay = Delaunay(self.points[:start], incremental=True)
        for j in range(start, len(points)):
            delaunay.add_points(self.points[j:j + 1])
            touching = delaunay.simplices[np.any(delaunay.simplices == j, axis=1)]
            for i in np.unique(touching):
                if i != j:
                    self.edges[i].append(j)
        self.edges = [np.asarray(edge, dtype=int) for edge in self.edges]
        axes = [np.linspace(a, b, cells + 1) for a, b in zip(low, high)]
        corners = np.stack(np.meshgrid(*axes, indexing='ij'), axis=-1)
        paths = [set(self.walk(q, 0, True)) for q in corners.reshape(-1, 3)]
        paths = np.array(paths, dtype=object).reshape((cells + 1,) * 3)
        self.grid = np.empty((cells,) * 3, dtype=int)
        for x, y, z in np.ndindex(self.grid.shape):
            common = set.intersection(*paths[x:x+2, y:y+2, z:z+2].flat)
            self.grid[x, y, z] = max(common)

    def walk(self, p, current, trace=False):
        path = [current]
        best = np.sum((self.points[current] - p) ** 2)
        while len(self.edges[current]):
            successors = self.edges[current]
            delta = self.points[successors] - p
            distances = np.einsum('ij,ij->i', delta, delta)
            closer = np.flatnonzero(distances < best)
            if not len(closer):
                break
            first = closer[0]
            current, best = successors[first], distances[first]
            if trace:
                path.append(current)
        return path if trace else current

    def nearest(self, queries, grid=True):
        result = np.empty(len(queries), dtype=int)
        for i, q in enumerate(queries):
            start = 0
            if grid and np.all(q >= self.low) and np.all(q <= self.high):
                cell = (self.cells * (q-self.low)/(self.high-self.low)).astype(int)
                start = self.grid[tuple(np.minimum(cell, self.cells-1))]
            result[i] = self.walk(q, start)
        return result


def read_mesh(args):
    if args.gltf:
        gltf = json.loads(args.gltf.read_text())
        primitive = gltf['meshes'][0]['primitives'][0]
        def accessor(index, shape):
            field = gltf['accessors'][index]
            view = gltf['bufferViews'][field['bufferView']]
            filename = gltf['buffers'][view['buffer']]['uri']
            dtype = {5126:'<f4', 5125:'<u4', 5123:'<u2'}[field['componentType']]
            return np.fromfile(args.gltf.parent / filename, dtype=dtype,
                               count=field['count']*shape, offset=view.get('byteOffset', 0)+field.get('byteOffset', 0))
        return accessor(primitive['attributes']['POSITION'], 3).reshape(-1, 3), accessor(primitive['indices'], 1).reshape(-1, 3)
    return np.fromfile(args.positions, '<f4').reshape(-1, 3), np.fromfile(args.triangles, '<u4').reshape(-1, 3)


def registration(points, tree, rng):
    rotation = Rotation.from_rotvec([.044, -.058, .035]).as_matrix()
    translation = np.array([.027, -.016, .024])
    source = points @ rotation.T + translation
    samples = source[rng.permutation(len(source))[:min(260, len(source))]]
    def solve(query):
        moved = samples.copy()
        for _ in range(32):
            target = points[query(moved)]
            a, b = moved.mean(axis=0), target.mean(axis=0)
            u, _, vt = np.linalg.svd((moved-a).T @ (target-b))
            correction = np.eye(3)
            correction[-1, -1] = np.sign(np.linalg.det(u @ vt))
            step = u @ correction @ vt
            moved = (moved-a) @ step + b
        ground_truth = (samples-translation) @ rotation
        return float(np.sqrt(np.mean(np.sum((moved-ground_truth)**2, axis=1))))
    before = float(np.sqrt(np.mean(np.sum(((samples-translation)@rotation-samples)**2, axis=1))))
    now = perf_counter()
    grid = solve(tree.nearest)
    grid_ms = 1000*(perf_counter()-now)
    exact = cKDTree(points)
    now = perf_counter()
    kd = solve(lambda x:exact.query(x)[1])
    kd_ms = 1000*(perf_counter()-now)
    assert abs(grid-kd)<1e-8, (grid, kd)
    return dict(initial_rms=before, grid_final_rms=grid, kd_final_rms=kd, grid_ms=grid_ms, kd_ms=kd_ms,
                note='Known rigid transform of the same surface samples. Independent scans were not tested.')


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--gltf', type=Path)
    p.add_argument('--positions', type=Path)
    p.add_argument('--triangles', type=Path)
    p.add_argument('--baker', type=Path, required=True)
    p.add_argument('--out', type=Path, required=True)
    args = p.parse_args()
    if not args.gltf and not (args.positions and args.triangles):
        p.error('Provide --gltf or both --positions and --triangles')
    args.out.mkdir(parents=True, exist_ok=True)
    vertices, triangles = read_mesh(args)
    rng = np.random.default_rng(73)
    vertices = np.asarray(vertices, dtype='<f4')
    triangles = np.asarray(triangles, dtype='<u4')
    unique, inverse = np.unique(vertices, axis=0, return_inverse=True)
    referenced = np.unique(triangles)
    surface_points = np.unique(vertices[referenced], axis=0)
    sample = surface_points[rng.permutation(len(surface_points))[:640]].astype(np.float64)
    low, high = vertices.min(axis=0), vertices.max(axis=0)
    low, high = low-(high-low)*.24, high+(high-low)*.24
    now = perf_counter()
    index = PointIndex(sample, low, high)
    build = 1000*(perf_counter()-now)
    axes = [np.linspace(a,b,28) for a,b in zip(low,high)]
    queries = np.stack(np.meshgrid(*axes,indexing='ij'),axis=-1).reshape(-1,3)
    now = perf_counter()
    hinted = index.nearest(queries)
    grid = 1000*(perf_counter()-now)
    now = perf_counter()
    ungridded = index.nearest(queries, grid=False)
    ungridded_ms = 1000*(perf_counter()-now)
    now = perf_counter()
    kd = cKDTree(sample)
    kd_build = 1000*(perf_counter()-now)
    now = perf_counter()
    distances, _ = kd.query(queries)
    kd_ms = 1000*(perf_counter()-now)
    grid_error = float(np.max(np.abs(np.linalg.norm(sample[hinted]-queries,axis=1)-distances)))
    root_error = float(np.max(np.abs(np.linalg.norm(sample[ungridded]-queries,axis=1)-distances)))
    assert max(grid_error, root_error)<1e-8, (grid_error, root_error)
    welded = inverse.reshape(-1)[triangles]
    edges = np.sort(np.concatenate([welded[:,[0,1]],welded[:,[1,2]],welded[:,[2,0]]]),axis=1)
    _, edge_counts = np.unique(edges, axis=0, return_counts=True)
    nonmanifold = int(np.count_nonzero(edge_counts!=2))
    sign = 'unsigned' if nonmanifold else 'signed'
    paths = [args.out/name for name in ('positions.f32','triangles.u32','queries.f32','hints.f32','field.f32')]
    for data,path in zip([vertices,triangles,queries.astype('<f4'),sample[hinted].astype('<f4')],paths):
        data.tofile(path)
    bake = json.loads(subprocess.check_output([str(args.baker), *map(str,paths), sign]))
    field = np.fromfile(paths[-1], '<f4').reshape((28,)*3)
    np.savez_compressed(args.out/'distance-field.npz', values=field, x=axes[0], y=axes[1], z=axes[2], signed=sign=='signed')
    report = dict(triangles=len(triangles), unique_vertices=len(unique), queries=len(queries), indexed_samples=len(sample),
                  grid_resolution=8, field_sign=sign, edges_without_two_incident_faces=nonmanifold,
                  dag_and_grid_build_ms=build, dag_root_batch_ms=ungridded_ms, dag_grid_batch_ms=grid,
                  kd_build_ms=kd_build, kd_batch_ms=kd_ms, exact_point_distance_max_error=grid_error,
                  exact_mesh_bake=bake, point_to_point_icp=registration(sample,index,rng))
    (args.out/'benchmark.json').write_text(json.dumps(report, indent=2)+'\n')
    print(json.dumps(report,indent=2))


if __name__ == '__main__':
    main()
