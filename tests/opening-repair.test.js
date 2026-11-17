import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {initSync,generate} from '../src/wasm/fjord_engine.js';
import {fractureSemantics} from '../src/fracture-semantics.js';
import {MeshBVH} from 'three-mesh-bvh';
import {geometryFor,positionsOf} from '../src/lod.js';
import {openingWitnesses,inspectOpenings,constrainOpeningFailures} from '../src/opening-repair.js';
initSync({module:fs.readFileSync(new URL('../src/wasm/fjord_engine_bg.wasm',import.meta.url))});

test('generator metadata is deterministic, separate from material channels, and absent on other specimens',()=>{
    for(let form=0;form<4;form++) {
        const options=new Float32Array([.15,.1,.13,.52,0,.48,.57,0,0]);
        const a=generate(form,'opening-labels',32,options),b=generate(form,'opening-labels',32,options);
        const source={vertices:a.vertices(),indices:a.indices(),fractureTags:a.fracture_tags(),featureKind:'fjord-fractures'};
        assert.deepEqual(source.fractureTags,b.fracture_tags());
        assert.equal(source.fractureTags.length,source.vertices.length/4);
        const semantic=fractureSemantics(source);assert.ok(semantic.features.size>0);
        assert.ok([...semantic.features.values()].some(f=>f.positive.size&&f.negative.size),'opposing wall labels');
        assert.ok([...semantic.features.values()].some(f=>f.mouth.size),'mouth labels');
        source.vertices.fill(0);assert.ok(fractureSemantics(source).features.size>0,'fresh material channel does not drive IDs');
        a.free();b.free();
        options[2]=0;const closed=generate(form,'opening-labels',24,options);
        assert.ok(closed.fracture_tags().every(x=>x===0));closed.free();
    }
    const specimen=generate(4,'basalt',24,[]);assert.equal(specimen.fracture_tags().length,0);specimen.free();
});
test('perspective region witnesses detect closures and cavity flattening independently of simplifier scores',()=>{
    const vertices=[],indices=[],tags=[];
    for(const [x0,y0,x1,y1] of [[-1,-1,1,-.3],[-1,.3,1,1],[-1,-.3,-.3,.3],[.3,-.3,1,.3]]) {
        const start=vertices.length/16;
        for(const [x,y] of [[x0,y0],[x1,y0],[x1,y1],[x0,y1]]) {
            vertices.push(x,y,0,0,0,1,0,0,0,0,0,0,0,0,0,1);tags.push(1,x<0?-1:1,3,.6);
        }
        indices.push(start,start+1,start+2,start,start+2,start+3);
    }
    const source={vertices:new Float32Array(vertices),indices:new Uint32Array(indices),fractureTags:new Float32Array(tags),featureKind:'fjord-fractures'};
    const geometry=geometryFor(source);geometry.boundsTree=new MeshBVH(geometry,{indirect:true});
    const context=openingWitnesses(source,geometry),positions=positionsOf(source);
    assert.equal(inspectOpenings(context,positions,source.indices).status,'passed','reference must pass its own independently raycast constraints');
    const closed=inspectOpenings(context,new Float32Array([-1,-1,0,1,-1,0,1,1,0,-1,1,0]),new Uint32Array([0,1,2,0,2,3]));
    assert.equal(closed.status,'needs-review');assert.ok(closed.openings.some(o=>o.kind==='gap'&&!o.accepted));
    for(let i=2;i<positions.length;i+=3)positions[i]=.2;
    const flattened=inspectOpenings(context,positions,source.indices);
    assert.ok(flattened.openings.some(o=>o.kind==='depth'&&!o.accepted));
    assert.ok(flattened.failures.some(f=>f.faces.length>1),'repair must retain all distinct subpixel reference faces, not just the first hit');
    geometry.dispose();
});
test('selective repair adds local points without pinning whole fracture regions',()=>{
    const vertices=new Float32Array(4*16);vertices.set([0,0,0],0);vertices.set([1,0,0],16);vertices.set([0,1,0],32);vertices.set([1,1,0],48);
    const context={source:{vertices},step:.01,faceVertices:f=>f===0?[0,1,2]:[1,3,2]};
    const protection={locks:new Uint8Array(4),supportPatches:new Map(),supportFaces:[],stats:{lockedVertices:0,repairVertices:0}};
    const failed={id:1,kind:'depth',error:.3,faces:[0],points:[[.01,.01,0]]};
    assert.equal(constrainOpeningFailures(context,{failures:[failed]},protection,0),1);
    assert.deepEqual(protection.locks,new Uint8Array([1,0,0,0]));assert.equal(protection.supportFaces.length,0);
});

test('reduction preserves semantic metadata and the canonical source when repair is disabled',async()=>{
    const {buildLODs}=await import('../src/lod.js');
    const raw=generate(1,'semantic-roundtrip',24,new Float32Array([.15,.1,.13,.52,0,.48,.57,0,0]));
    const source={vertices:raw.vertices(),indices:raw.indices(),bounds:raw.bounds(),fractureTags:raw.fracture_tags(),featureKind:'fjord-fractures'};raw.free();
    const before=structuredClone(source),lookup=new Map();
    for(let i=0;i<source.vertices.length/16;i++)lookup.set(Array.from(source.vertices.subarray(i*16,(i+1)*16)).join(','),Array.from(source.fractureTags.subarray(i*4,i*4+4)));
    const reduced=await buildLODs(source,{target:500,fractures:'anchors',openingRepair:false});
    assert.deepEqual(source,before,'canonical source must remain untouched');
    for(const level of reduced.levels) {
        assert.equal(level.protection.openings.status,'disabled');
        for(let i=0;i<level.vertices.length/16;i++)assert.deepEqual(Array.from(level.fractureTags.subarray(i*4,i*4+4)),lookup.get(Array.from(level.vertices.subarray(i*16,(i+1)*16)).join(',')));
    }
    assert.throws(()=>fractureSemantics({...source,fractureTags:source.fractureTags.subarray(4)}),/Invalid fracture metadata/);
    const invalid=source.fractureTags.slice();invalid[0]=NaN;
    assert.throws(()=>fractureSemantics({...source,fractureTags:invalid}),/Invalid fracture metadata/);
});
