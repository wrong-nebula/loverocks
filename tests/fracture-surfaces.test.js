import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {initSync,generate} from '../src/wasm/fjord_engine.js';
import {fractureSurfaceGraph,simplifyFractureSurfaces} from '../src/fracture-surfaces.js';
import {validateMesh} from '../src/lod.js';
import {renderedImprovement} from '../src/fracture-refine.js';
import {budgetStudy,combineOpeningChecks} from '../src/fracture-workflow.js';
import {curveSettingsKey} from '../src/budget-policy.js';
initSync({module:fs.readFileSync(new URL('../src/wasm/fjord_engine_bg.wasm',import.meta.url))});
function source(){const raw=generate(0,'surface-test',24,new Float32Array([.15,.1,.08,.52,0,.48,.57,0,0]));const m={vertices:raw.vertices(),indices:raw.indices(),bounds:raw.bounds(),fractureTags:raw.fracture_tags(),featureKind:'fjord-fractures'};raw.free();return m;}
function openEdges(m){const edges=new Map();for(let i=0;i<m.indices.length;i+=3)for(let j=0;j<3;j++){const a=m.indices[i+j],b=m.indices[i+(j+1)%3],key=a<b?`${a},${b}`:`${b},${a}`;edges.set(key,(edges.get(key)||0)+1);}return [...edges.values()].filter(n=>n===1).length;}
test('wall patches retain connected identities, shared edges and explicit triangle allocation',()=>{
    const mesh=source(),before=structuredClone(mesh),graph=fractureSurfaceGraph(mesh),result=simplifyFractureSurfaces(mesh,500);
    validateMesh(result);assert.deepEqual(mesh,before);assert.equal(graph.facePatches.length,mesh.indices.length/3);
    assert.ok(graph.patches.some(p=>p.side===1));assert.ok(graph.patches.some(p=>p.side===-1));
    assert.equal(result.facePatches.length,result.indices.length/3);assert.equal(result.sourceFaces.length,result.indices.length/3);
    assert.ok(result.facePatches.every(p=>p<graph.patches.length));
    assert.equal(result.protection.surfaces.patches.reduce((s,p)=>s+p.triangles,0),result.indices.length/3);
    assert.equal(result.protection.surfaces.budgetBlocked,result.indices.length/3>500);
    assert.equal(openEdges(result),openEdges(mesh),'patch collapse must not introduce open boundaries');
    assert.deepEqual(simplifyFractureSurfaces(mesh,500),result,'deterministic topology and placement');
});
test('rendered acceptance cannot improve by hiding a worse cavity or closing another gap',()=>{
    const current={failed:12,gaps:2,worst:5,penalty:30};
    assert.equal(renderedImprovement({failed:11,gaps:2,worst:5,penalty:31},current),true);
    assert.equal(renderedImprovement({failed:11,gaps:3,worst:4,penalty:20},current),false);
    assert.equal(renderedImprovement({failed:11,gaps:2,worst:6,penalty:20},current),false);
    assert.equal(renderedImprovement(current,current),false);
});
test('additional cameras and nonmonotonic actual budgets determine measured feasibility',()=>{
    assert.notEqual(curveSettingsKey({method:'surfaces',refineSteps:0}),curveSettingsKey({method:'surfaces',refineSteps:8}));
    const check={status:'passed',inScope:true,viewingSize:128,cameras:16,tested:10,failed:0,failures:[],rows:[],depthP95Px:1,silhouetteIoU:.99,gapFill:0};
    const failed={...check,status:'needs-review',failed:1,failures:[{kind:'wall'}],depthP95Px:3};
    assert.equal(combineOpeningChecks(check,failed).status,'needs-review');assert.equal(combineOpeningChecks(check,failed).cameras,32);
    const rows=[{target:500,triangles:498,budgetMet:true,gpu:failed},{target:1000,triangles:990,budgetMet:true,gpu:check},{target:750,triangles:700,budgetMet:true,gpu:check},
        {target:300,triangles:290,budgetMet:true,gpu:{...check,inScope:false}},{target:200,triangles:220,budgetMet:false,gpu:check}];
    assert.deepEqual(budgetStudy(rows).smallestPassing,{requested:750,actual:700});assert.equal(budgetStudy(rows).provenMinimum,false);
    assert.equal(budgetStudy(rows.slice(0,1)).smallestPassing,null);
});
