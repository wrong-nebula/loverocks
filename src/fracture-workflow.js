import {MeshBVH} from 'three-mesh-bvh';
import {simplifySkeleton} from './fracture-skeleton.js';
import {createOpeningGPUValidator} from './opening-gpu.js';
import {refineFractureMesh,renderedLoss} from './fracture-refine.js';
import {geometryFor,meshStats,measureDeviation} from './lod.js';

export function combineOpeningChecks(development,validation){
    const checks=[development,validation],rows=checks.flatMap(c=>c.rows),failures=checks.flatMap(c=>c.failures);
    return {method:'gpu',viewSet:'development+validation',status:checks.some(c=>c.status==='needs-review')?'needs-review':checks.every(c=>c.status==='passed')?'passed':'not-visible',
        inScope:checks.every(c=>c.inScope),viewingSize:development.viewingSize,cameras:checks.reduce((s,c)=>s+c.cameras,0),
        tested:checks.reduce((s,c)=>s+c.tested,0),failed:failures.length,failures,rows,
        depthP95Px:Math.max(...checks.map(c=>c.depthP95Px??0)),silhouetteIoU:Math.min(...checks.map(c=>c.silhouetteIoU??0)),gapFill:Math.max(...checks.map(c=>c.gapFill??0))};
}
export function budgetStudy(rows){
    const eligible=rows.filter(r=>r.budgetMet&&r.gpu?.inScope&&r.gpu.status==='passed');
    const best=eligible.sort((a,b)=>a.triangles-b.triangles||a.target-b.target)[0];
    return {status:best?'passing-budget-found':'no-passing-budget-found',smallestPassing:best?{requested:best.target,actual:best.triangles}:null,
        testedBudgets:rows.map(r=>r.target),testedActual:rows.map(r=>r.triangles),provenMinimum:false,
        interpretation:best?'Smallest actual passing mesh among the tested candidates; not a proven global minimum.':'No tested candidate both met its budget and passed the fixed checks. This does not prove that the requested budget is impossible.'};
}

export async function completeSurfaceLevel(renderer,source,level,settings,{size=128,steps=8,signal,progress=()=>{}}={}){
    const development=createOpeningGPUValidator(renderer,source,{size}),validation=createOpeningGPUValidator(renderer,source,{size,viewSet:'validation'});
    if(!development||!validation){development?.dispose();validation?.dispose();throw Error('Surface fitting requires fracture labels.');}
    try {
        signal?.throwIfAborted();progress('Comparing fracture-surface seeds…');
        const seeds=[['patches',level]],candidates=[],errors=[];
        try{seeds.push(['skeleton',await simplifySkeleton(source,level.target,settings)]);}catch(error){signal?.throwIfAborted();errors.push({seed:'skeleton',error:String(error)});}
        for(const [name,mesh] of seeds){
            const gpu=await development.measure(mesh,{signal});candidates.push({name,mesh,gpu,score:renderedLoss(gpu),budgetMet:mesh.indices.length/3<=level.target});
        }
        candidates.sort((a,b)=>Number(b.budgetMet)-Number(a.budgetMet)||a.score.failed-b.score.failed||a.score.worst-b.score.worst||a.score.penalty-b.score.penalty);
        const selected=candidates[0],fitted=await refineFractureMesh(source,selected.mesh,development,{steps,target:level.target,signal,progress});
        // Validation angles never participate in seed selection or optimization.
        progress('Checking additional camera angles…');const heldOut=await validation.measure(fitted.mesh,{signal}),gpu=combineOpeningChecks(fitted.gpu,heldOut);
        const mesh={...level,...fitted.mesh};mesh.protection={...mesh.protection,mode:'surfaces',lockedVertices:0,
            seedSelection:{selected:selected.name,errors,candidates:candidates.map(c=>({name:c.name,triangles:c.mesh.indices.length/3,budgetMet:c.budgetMet,...c.score}))},
            surfacePartition:level.protection.surfaces,development:{status:fitted.gpu.status,failed:fitted.gpu.failed,depthP95Px:fitted.gpu.depthP95Px},validation:{status:heldOut.status,failed:heldOut.failed,depthP95Px:heldOut.depthP95Px},gpu};
        const geometry=geometryFor(source);geometry.boundsTree=new MeshBVH(geometry,{indirect:true});
        try{mesh.stats=meshStats(mesh);mesh.deviation=measureDeviation(geometry,mesh);}finally{geometry.dispose();}
        mesh.budgetMet=mesh.stats.triangles<=mesh.target;mesh.qualityMet=gpu.inScope&&gpu.status==='passed';mesh.errorMetric='rendered openings, development and additional views';
        return {level:mesh,gpu};
    }finally{development.dispose();validation.dispose();}
}
