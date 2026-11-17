import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {initSync,generate,SurfaceIndex} from '../src/wasm/fjord_engine.js';
import {seeded} from '../src/random.js';
import {growMoss,mossVolume} from '../src/moss.js';
import {volcanicPresets} from '../src/volcanic.js';
import {geologyPresets} from '../src/geology.js';
import {buildLODs,chooseLOD,geometryFor,positionsOf,measureDeviation,normalizeSettings,targetsFor,validateMesh} from '../src/lod.js';
import {projectAtlas} from '../src/bake-project.js';
import {MeshBVH} from 'three-mesh-bvh';

initSync({module:fs.readFileSync(new URL('../src/wasm/fjord_engine_bg.wasm',import.meta.url))});
const presets=[...JSON.parse(fs.readFileSync(new URL('../engine/src/presets.json',import.meta.url))),...volcanicPresets,...geologyPresets];
function reference(form,resolution=88,variant=false) {
    const p=presets[form],seed=variant?p.seed+'-lod-stress':p.seed,r=seeded(seed);
    const options=new Float32Array([p.weather,p.rounding,variant?.15:p.fracture,p.carving??.52,0,p.wet??.48,p.lichen??.57,variant?.4:0,variant?.5:0,r()*37,r()*37,r()*37]);
    const raw=generate(form,seed,resolution,options);
    const mesh={vertices:raw.vertices(),indices:raw.indices(),bounds:raw.bounds()};raw.free();
    const elevation=35*Math.PI/180;
    mossVolume(mesh.vertices,mesh.indices,growMoss(mesh.vertices,mesh.indices,{amount:p.moss,years:variant?400:0,seed:Math.floor(seeded(seed+'/moss')()*1e6),
        sun:[Math.cos(p.sun)*Math.cos(elevation),Math.sin(elevation),Math.sin(p.sun)*Math.cos(elevation)]}));
    const normals=new Float32Array(mesh.vertices.length/16*3);
    for(let i=0;i<normals.length/3;i++)normals.set(mesh.vertices.subarray(i*16+3,i*16+6),i*3);
    const surface=new SurfaceIndex(positionsOf(mesh),mesh.indices);
    try{mesh.weather=surface.weather(normals);}finally{surface.free();}
    return mesh;
}
function checkBuffers(source,level) {
    validateMesh(level);
    assert.ok(level.indices instanceof Uint16Array);
    assert.equal(new Set(level.indices).size,level.stats.vertices,'no unreferenced vertices remain');
    assert.equal(level.weather.length,level.stats.vertices*2);
    assert.equal(level.budgetMet,level.stats.triangles<=level.target);
    assert.ok(Number.isFinite(level.deviation.sampledMax));
    assert.ok(level.deviation.sampledMax>=level.deviation.p95);
    // This simplifier retains original vertices. Verify every channel follows
    // the vertex remap, including weather masks stored in a separate buffer.
    const originals=new Map();
    for(let i=0;i<source.vertices.length/16;i++)originals.set(Array.from(source.vertices.subarray(i*16,i*16+16)).join(','),i);
    for(let i=0;i<level.stats.vertices;i++) {
        const old=originals.get(Array.from(level.vertices.subarray(i*16,i*16+16)).join(','));
        assert.notEqual(old,undefined,'all 16 attributes retained together');
        assert.deepEqual(level.weather.subarray(i*2,i*2+2),source.weather.subarray(old*2,old*2+2));
    }
}
test('all 13 presets and weathered alternate seeds produce compact, valid LODs',async t=>{
    for(const [form,p] of presets.entries())await t.test(p.name,async()=>{
        for(const variant of [false,true]) {
            const source=reference(form,variant?32:88,variant),copy=structuredClone(source);
            const result=await buildLODs(source,{target:500});
            assert.deepEqual(source,copy,'canonical mesh is immutable');
            for(const level of result.levels)checkBuffers(source,level);
            const counts=result.levels.map(l=>l.stats.triangles);
            assert.ok(counts[0]>=counts[1]&&counts[1]>=counts[2]);
            assert.ok(result.levels[1].budgetMet,`${p.name}: 500-triangle budget achievable`);
            t.diagnostic(JSON.stringify({name:p.name,variant,source:source.indices.length/3,counts,
                sampledMax:result.levels[1].deviation.sampledMax,reductionMs:Math.round(result.levels.reduce((n,l)=>n+l.reductionMs,0))}));
        }
    });
});
test('quality priority stops early; reduction is deterministic and can reuse source',async()=>{
    const source=reference(0,32);
    const budget=await buildLODs(source,{target:24});
    const quality=await buildLODs(source,{target:24,priority:'quality',tolerance:.001});
    assert.ok(quality.levels[1].stats.triangles>budget.levels[1].stats.triangles);
    assert.ok(!quality.levels[1].budgetMet&&quality.levels[1].qualityMet);
    const repeat=await buildLODs(source,{target:24});
    for(let i=0;i<3;i++) {
        assert.deepEqual(budget.levels[i].vertices,repeat.levels[i].vertices);
        assert.deepEqual(budget.levels[i].indices,repeat.levels[i].indices);
        assert.deepEqual(budget.levels[i].deviation,repeat.levels[i].deviation);
    }
});
test('auto LOD uses physical pixels, projection and hysteresis; near view falls back to source',()=>{
    const levels=[.01,.04,.16].map(sampledMax=>({deviation:{sampledMax}}));
    const args={depth:100,viewportHeight:1000,fov:90,pixelError:1};
    assert.equal(chooseLOD(levels,args),2);
    assert.equal(chooseLOD(levels,{...args,depth:1}),-1);
    assert.equal(chooseLOD(levels,{...args,depth:-1}),-1);
    assert.equal(chooseLOD(levels,{...args,viewportHeight:2000}),1);
    assert.equal(chooseLOD(levels,{...args,fov:45}),1);
    assert.equal(chooseLOD(levels,{...args,depth:80}),1);
    assert.equal(chooseLOD(levels,{...args,depth:80,previous:2}),2);
    assert.equal(chooseLOD(levels,{...args,depth:60,previous:2}),1);
});
test('settings clamp invalid and extreme input',()=>{
    assert.deepEqual(targetsFor({target:500}),[2000,500,128]);
    assert.equal(normalizeSettings({target:NaN}).target,500);
    assert.equal(normalizeSettings({target:0}).target,24);
    assert.equal(normalizeSettings({target:1e8}).target,50000);
});
test('surface distance and atlas projection interpolate the reference triangle',()=>{
    const vertices=new Float32Array(48);
    for(let i=0;i<3;i++)vertices.set([i===1?1:0,i===2?1:0,0,0,0,1,i===0?1:0,i===1?1:0,i===2?1:0,.8,.2,.3,.4,.5,.6,.7],i*16);
    const source={vertices,indices:new Uint16Array([0,1,2]),bounds:new Float32Array(6),weather:new Float32Array([0,1,0,1,0,1])};
    const g=geometryFor(source);g.boundsTree=new MeshBVH(g,{indirect:true});
    assert.ok(measureDeviation(g,source).sampledMax<1e-7);g.dispose();
    const projected=projectAtlas(source,{positions:new Float32Array([0,0,.1,1,0,.1,0,1,.1]),
        normals:new Float32Array([0,0,1,0,0,1,0,0,1]),tangents:new Float32Array([1,0,0,1,1,0,0,1,1,0,0,1]),
        uv:new Float32Array([0,0,1,0,0,1]),indices:source.indices},16);
    assert.ok(Math.abs(projected.maximumDistance-.1)<1e-7);
    assert.ok(projected.coverage>.45&&projected.coverage<.6);
    const o=(3*16+3)*4;
    assert.ok(Math.abs(projected.maps[2][o]-.5625)<1e-6);
    assert.ok(Math.abs(projected.maps[2][o+1]-.21875)<1e-6);
    assert.equal(projected.maps[4][o+1],1);
    for(const map of projected.maps)assert.ok(map.every(Number.isFinite));
});
