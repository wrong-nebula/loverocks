/* tslint:disable */
/* eslint-disable */

export class RockMesh {
    private constructor();
    free(): void;
    [Symbol.dispose](): void;
    bounds(): Float32Array;
    fracture_tags(): Float32Array;
    indices(): Uint32Array;
    vertices(): Float32Array;
}

export class SurfaceIndex {
    free(): void;
    [Symbol.dispose](): void;
    /**
     * First front-facing contact on a finite ray, as position, normal, distance.
     */
    contact(origin: Float32Array, direction: Float32Array, limit: number): Float32Array;
    constructor(positions: Float32Array, indices: Uint32Array);
    /**
     * Pairs of snow coverage and lichen exposure on the indexed mesh.
     */
    weather(normals: Float32Array): Float32Array;
}

export function generate(form: number, seed: string, resolution: number, options: Float32Array): RockMesh;

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly __wbg_surfaceindex_free: (a: number, b: number) => void;
    readonly surfaceindex_contact: (a: number, b: number, c: number, d: number, e: number, f: number) => [number, number];
    readonly surfaceindex_new: (a: number, b: number, c: number, d: number) => [number, number, number];
    readonly surfaceindex_weather: (a: number, b: number, c: number) => [number, number];
    readonly __wbg_rockmesh_free: (a: number, b: number) => void;
    readonly generate: (a: number, b: number, c: number, d: number, e: number, f: number) => [number, number, number];
    readonly rockmesh_bounds: (a: number) => [number, number];
    readonly rockmesh_fracture_tags: (a: number) => [number, number];
    readonly rockmesh_indices: (a: number) => [number, number];
    readonly rockmesh_vertices: (a: number) => [number, number];
    readonly __wbindgen_externrefs: WebAssembly.Table;
    readonly __wbindgen_malloc: (a: number, b: number) => number;
    readonly __wbindgen_realloc: (a: number, b: number, c: number, d: number) => number;
    readonly __externref_table_dealloc: (a: number) => void;
    readonly __wbindgen_free: (a: number, b: number, c: number) => void;
    readonly __wbindgen_start: () => void;
}

export type SyncInitInput = BufferSource | WebAssembly.Module;

/**
 * Instantiates the given `module`, which can either be bytes or
 * a precompiled `WebAssembly.Module`.
 *
 * @param {{ module: SyncInitInput }} module - Passing `SyncInitInput` directly is deprecated.
 *
 * @returns {InitOutput}
 */
export function initSync(module: { module: SyncInitInput } | SyncInitInput): InitOutput;

/**
 * If `module_or_path` is {RequestInfo} or {URL}, makes a request and
 * for everything else, calls `WebAssembly.instantiate` directly.
 *
 * @param {{ module_or_path: InitInput | Promise<InitInput> }} module_or_path - Passing `InitInput` directly is deprecated.
 *
 * @returns {Promise<InitOutput>}
 */
export default function __wbg_init (module_or_path?: { module_or_path: InitInput | Promise<InitInput> } | InitInput | Promise<InitInput>): Promise<InitOutput>;
