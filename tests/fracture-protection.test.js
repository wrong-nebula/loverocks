import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {initSync,generate} from '../src/wasm/fjord_engine.js';
import {seeded} from '../src/random.js';
import {fractureRegions,fractureLocks,supportMissingLandmarks,verifyProtection} from '../src/fracture-protection.js';
import {buildLODs} from '../src/lod.js';
initSync({module:fs.readFileSync(new URL('../src/wasm/fjord_engine_bg.wasm',import.meta.url))});
const presets=JSON.parse(fs.readFileSync(new URL('../engine/src/presets.json',import.meta.url)));
function reference(form,resolution=54) {
    const p=presets[form],r=seeded(p.seed);
    const raw=generate(form,p.seed,resolution,new Float32Array([p.weather,p.rounding,.13,.52,0,.48,.57,0,0,r()*37,r()*37,r()*37]));
    const mesh={vertices:raw.vertices(),indices:raw.indices(),bounds:raw.bounds(),featureKind:'fjord-fractures'};raw.free();return mesh;
}
const record=(mesh,i)=>Array.from(mesh.vertices.subarray(i*16,i*16+16)).join(',');
const faceKey=ids=>{const at=ids.indexOf(Math.min(...ids));return [...ids.slice(at),...ids.slice(0,at)].join(',');};
test('strict protection preserves classified faces and their winding, even above budget',async()=>{
    for(const form of [0,1,2,3]) {
        const source=reference(form),copy=structuredClone(source),regions=fractureRegions(source);
        const {levels}=await buildLODs(source,{target:500,fractures:'strict'}),level=levels[1];
        const original=new Map(Array.from({length:source.vertices.length/16},(_,i)=>[record(source,i),i]));
        const remap=Array.from({length:level.vertices.length/16},(_,i)=>original.get(record(level,i)));
        const faces=new Set();for(let i=0;i<level.indices.length;i+=3)faces.add(faceKey(Array.from(level.indices.subarray(i,i+3),x=>remap[x])));
        assert.ok(regions.faces.length>0);
        for(const face of regions.faces)assert.ok(faces.has(faceKey(face)),`form ${form}: protected triangle survived`);
        assert.equal(level.budgetMet,level.stats.triangles<=500);
        assert.ok(level.stats.triangles>500);
        assert.deepEqual(source,copy);
    }
});
test('rim anchors survive reduction unchanged; protection is deterministic',async()=>{
    const source=reference(1,88),regions=fractureRegions(source);
    const a=fractureLocks(source,regions,500,'anchors'),b=fractureLocks(source,regions,500,'anchors');
    assert.deepEqual(a,b);assert.ok(a.stats.lockedVertices>0);
    assert.ok(a.stats.lockedVertices<fractureLocks(source,regions,500,'strict').stats.lockedVertices);
    const {levels}=await buildLODs(source,{target:500,fractures:'anchors'});
    const retained=new Set(Array.from({length:levels[1].vertices.length/16},(_,i)=>record(levels[1],i)));
    for(let i=0;i<a.locks.length;i++)if(a.locks[i])assert.ok(retained.has(record(source,i)),`anchor ${i} survived unchanged`);
});
test('unknown channel semantics and disabled protection never introduce locks',()=>{
    const source=reference(0);
    assert.equal(fractureLocks(source,fractureRegions(source),500,'off').locks,null);
    delete source.featureKind;
    const protection=fractureLocks(source,fractureRegions(source),500,'strict');
    assert.equal(protection.locks,null);assert.equal(protection.stats.supported,false);
});
test('runtime integrity checks reject lost patches and changed face winding',()=>{
    const regions={faces:[[0,1,2]]},protection={locks:new Uint8Array([1,1,1,0]),stats:{mode:'strict'}};
    assert.doesNotThrow(()=>verifyProtection(new Uint16Array([1,2,0]),regions,protection));
    assert.throws(()=>verifyProtection(new Uint16Array([0,1,3]),regions,protection),/patch was lost/);
    assert.throws(()=>verifyProtection(new Uint16Array([0,2,1]),regions,protection),/face changed/);
});

test('landmark support spends vertices only on lost points and verifies supporting faces',()=>{
    const protection={locks:new Uint8Array([1,0,0,1,0,0]),supportPatches:new Map([[0,[0,1,2]],[3,[3,4,5]]]),supportFaces:[],
        stats:{mode:'anchors',anchorVertices:2,lockedVertices:2,supportVertices:0,supportPasses:0}};
    assert.equal(supportMissingLandmarks(new Uint16Array([0,1,3]),protection),false);
    assert.equal(supportMissingLandmarks(new Uint16Array([0,1,2]),protection),true);
    assert.deepEqual(protection.locks,new Uint8Array([1,0,0,1,1,1]));
    assert.equal(protection.stats.supportVertices,2);
    assert.equal(protection.stats.supportPasses,1);
    assert.doesNotThrow(()=>verifyProtection(new Uint16Array([0,1,2,3,4,5]),{faces:[]},protection));
    assert.throws(()=>verifyProtection(new Uint16Array([0,1,2,3,5,4]),{faces:[]},protection),/face changed/);
    assert.equal(supportMissingLandmarks(new Uint16Array([3,4,5]),protection,true),true);
    assert.deepEqual(protection.locks,new Uint8Array([1,1,1,1,1,1]),'bounded fallback supports every original landmark');
});

test('landmark constraints retain their original positions across budgets and source meshes',async()=>{
    for(const form of [0,1,2,3]) {
        const source=reference(form,54),copy=structuredClone(source);
        for(const target of [128,500]) {
            const regions=fractureRegions(source),pins=fractureLocks(source,regions,target,'anchors');
            assert.equal(pins.stats.lockedVertices,pins.stats.anchorVertices,'initial constraints are points');
            const {levels}=await buildLODs(source,{target,fractures:'anchors'}),level=levels[1];
            const retained=new Set(Array.from({length:level.vertices.length/16},(_,i)=>record(level,i)));
            for(let i=0;i<pins.locks.length;i++)if(pins.locks[i])assert.ok(retained.has(record(source,i)),`form ${form}, target ${target}: landmark retained`);
            assert.ok(level.protection.supportPasses<=3,'bounded retry cost');
            assert.equal(level.protection.supportVertices,level.protection.lockedVertices-level.protection.anchorVertices);
            assert.ok(level.qualityMet,'does not relax the selected error limit');
        }
        assert.deepEqual(source,copy,'reference remains immutable');
    }
});
