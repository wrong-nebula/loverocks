import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {initSync,generate} from '../src/wasm/fjord_engine.js';
import {fractureSkeleton,simplifySkeleton} from '../src/fracture-skeleton.js';
import {fractureSemantics} from '../src/fracture-semantics.js';
import {validateMesh} from '../src/lod.js';
initSync({module:fs.readFileSync(new URL('../src/wasm/fjord_engine_bg.wasm',import.meta.url))});
function source(){const raw=generate(1,'skeleton-topology',32,new Float32Array([.15,.1,.12,.52,0,.48,.57,0,0]));const mesh={vertices:raw.vertices(),indices:raw.indices(),bounds:raw.bounds(),fractureTags:raw.fracture_tags(),featureKind:'fjord-fractures'};raw.free();mesh.weather=new Float32Array(mesh.vertices.length/8).fill(.5);return mesh;}
function boundaries(mesh){
    const ids=new Map(),remap=[],edges=new Map();
    for(let i=0;i<mesh.vertices.length/16;i++){const key=Array.from(mesh.vertices.subarray(i*16,i*16+3),x=>x.toFixed(6)).join(',');if(!ids.has(key))ids.set(key,ids.size);remap.push(ids.get(key));}
    for(let i=0;i<mesh.indices.length;i+=3)for(let k=0;k<3;k++){const a=remap[mesh.indices[i+k]],b=remap[mesh.indices[i+(k+1)%3]],key=[Math.min(a,b),Math.max(a,b)].join(',');edges.set(key,(edges.get(key)??0)+1);}
    return [...edges.values()].filter(n=>n===1).length;
}
test('graph-guided reduction moves free vertices without modifying the source or opening mesh boundaries',async()=>{
    const mesh=source(),copy=structuredClone(mesh),graph=fractureSkeleton(mesh,500);
    assert.ok(graph.paths.length>0);assert.ok(graph.fixed.size<=40);
    const a=await simplifySkeleton(mesh,500),b=await simplifySkeleton(mesh,500);
    validateMesh(a);assert.deepEqual(a,b);assert.deepEqual(mesh,copy);
    assert.ok(a.protection.skeleton.movedVertices>0,'optimal placement must actually move vertices');
    assert.ok(a.indices.length/3<=500);assert.equal(boundaries(a),boundaries(mesh),'no new open edges after welding positions');
    assert.equal(a.weather.length,a.vertices.length/8);assert.equal(a.fractureTags.length,a.vertices.length/4);
    assert.ok(fractureSemantics({...a,featureKind:'fjord-fractures'}).features.size>0,'semantic metadata survives compaction');
    const positions=new Set(Array.from({length:a.vertices.length/16},(_,i)=>Array.from(a.vertices.subarray(i*16,i*16+3)).join(',')));
    for(const id of graph.fixed)assert.ok(positions.has(Array.from(mesh.vertices.subarray(id*16,id*16+3)).join(',')),'fixed guide node must survive');
    for(let i=0;i<a.vertices.length/16;i++)assert.ok(Math.abs(Math.hypot(...a.vertices.subarray(i*16+3,i*16+6))-1)<1e-5,'normals remain unit length');
    const low=await simplifySkeleton(mesh,500,{features:0}),high=await simplifySkeleton(mesh,500,{features:3});
    validateMesh(low);validateMesh(high);
    assert.notDeepEqual(low.vertices,high.vertices,'feature emphasis must affect movable-vertex reduction');
    assert.deepEqual(mesh,copy,'alternate settings must also preserve the canonical source');
});
