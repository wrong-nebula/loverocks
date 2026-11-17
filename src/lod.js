import {MeshoptSimplifier, MeshoptEncoder} from 'meshoptimizer';
import {BufferGeometry, BufferAttribute, Vector3} from 'three';
import {MeshBVH} from 'three-mesh-bvh';
import {simplifySkeleton} from './fracture-skeleton.js';
import {openingWitnesses,inspectOpenings,constrainOpeningFailures,openingSummary} from './opening-repair.js';
import {fractureRegions,fractureLocks,supportMissingLandmarks,verifyProtection} from './fracture-protection.js';

export const STRIDE=16;
export {LOD_DEFAULTS,normalizeSettings,targetsFor,chooseLOD} from './lod-policy.js';
import {normalizeSettings,targetsFor} from './lod-policy.js';
export function positionsOf(mesh) {
    const p=new Float32Array(mesh.vertices.length/STRIDE*3);
    for(let i=0;i<p.length/3;i++) p.set(mesh.vertices.subarray(i*STRIDE,i*STRIDE+3),i*3);
    return p;
}
export function geometryFor(mesh) {
    const g=new BufferGeometry();
    g.setAttribute('position',new BufferAttribute(positionsOf(mesh),3));
    g.setIndex(new BufferAttribute(mesh.indices,1));
    return g;
}
export function meshStats(mesh) {
    const vertexCount=mesh.vertices.length/STRIDE;
    return {triangles:mesh.indices.length/3,vertices:vertexCount,
        bytes:mesh.vertices.byteLength+mesh.indices.byteLength+(mesh.weather?.byteLength??0)};
}
export function validateMesh(mesh) {
    if(mesh.vertices.length%STRIDE||mesh.indices.length%3||!mesh.indices.length)throw Error('The reducer returned an empty or incomplete mesh.');
    const count=mesh.vertices.length/STRIDE;
    if(mesh.vertices.some(v=>!Number.isFinite(v))||mesh.indices.some(i=>i>=count))throw Error('The reducer returned invalid mesh data.');
    for(let i=0;i<mesh.indices.length;i+=3) {
        const [a,b,c]=mesh.indices.subarray(i,i+3);
        if(a===b||b===c||c===a)throw Error('The reducer returned a collapsed triangle.');
    }
}
// Sample both surfaces against triangle BVHs. This is a measured approximation,
// not a Hausdorff bound; simplifier attribute error is kept separate.
export function measureDeviation(sourceGeometry,reduced,maxSamples=2048) {
    const target=geometryFor(reduced);
    target.boundsTree=new MeshBVH(target,{indirect:true});
    const point=new Vector3(),a=new Vector3(),b=new Vector3(),c=new Vector3();
    const hit={point:new Vector3()};
    const distances=[];
    for(const [from,to] of [[sourceGeometry,target],[target,sourceGeometry]]) {
        const pos=from.getAttribute('position'),index=from.index,triangles=index.count/3;
        const count=Math.min(maxSamples,triangles);
        for(let s=0;s<count;s++) {
            const tri=Math.floor(s*triangles/count)*3;
            a.fromBufferAttribute(pos,index.getX(tri));b.fromBufferAttribute(pos,index.getX(tri+1));c.fromBufferAttribute(pos,index.getX(tri+2));
            // Include vertices as well as face interiors, especially on thin ridges.
            for(const p of [a,point.copy(a).add(b).add(c).multiplyScalar(1/3)]) {
                if(to.boundsTree.closestPointToPoint(p,hit)) distances.push(hit.distance);
            }
        }
    }
    target.dispose();distances.sort((a,b)=>a-b);
    return {sampledMax:distances.at(-1)??0,p95:distances[Math.floor(distances.length*.95)]??0,samples:distances.length};
}
function compact(source,indices) {
    const optimized=indices.slice();
    const [remap,count]=MeshoptEncoder.reorderMesh(optimized,true,false);
    const vertices=new Float32Array(count*STRIDE),weather=source.weather?new Float32Array(count*2):null,fractureTags=source.fractureTags?new Float32Array(count*4):null;
    for(let old=0;old<remap.length;old++) {
        const next=remap[old];if(next===0xffffffff)continue;
        vertices.set(source.vertices.subarray(old*STRIDE,old*STRIDE+STRIDE),next*STRIDE);
        if(weather)weather.set(source.weather.subarray(old*2,old*2+2),next*2);
        if(fractureTags)fractureTags.set(source.fractureTags.subarray(old*4,old*4+4),next*4);
    }
    return {vertices,indices:count<=65535?new Uint16Array(optimized):optimized,weather,fractureTags,bounds:source.bounds.slice()};
}
export async function buildLODs(source,input={},progress=()=>{}, {repairOpenings=true,levels:requestedLevels=[0,1,2]}={}) {
    await Promise.all([MeshoptSimplifier.ready,MeshoptEncoder.ready]);
    validateMesh(source);
    const settings=normalizeSettings({...input,fractures:source.featureKind==='fjord-fractures'?input.fractures:'off'}),positions=positionsOf(source),count=positions.length/3;
    const attributes=new Float32Array(count*15);
    for(let i=0;i<count;i++) {
        attributes.set(source.vertices.subarray(i*STRIDE+3,(i+1)*STRIDE),i*15);
        attributes[i*15+13]=source.weather?.[i*2]??0;
        attributes[i*15+14]=source.weather?.[i*2+1]??1;
    }
    // normals, RGB, rough/wet/moss/lichen, fresh, geological signal, AO, weather.
    const f=settings.features;
    const weights=[.2,.2,.2,.3,.3,.3,.08,.1,.3,.2,.15*f,.15*f,.08,.1,.1];
    // Portable textures recover colour/weather and fine shading. In landmark
    // mode, spend geometry on shape and the fresh fracture signal instead of
    // requiring the low mesh to interpolate every source material attribute.
    // Keep off/strict modes unchanged, including their error interpretation.
    if(settings.fractures==='anchors')for(let i=0;i<weights.length;i++)weights[i]*=i<3?.25:i===10?1:.1;
    const originalIndices=new Uint32Array(source.indices);
    const regions=fractureRegions(source);
    const sourceGeometry=geometryFor(source);
    sourceGeometry.boundsTree=new MeshBVH(sourceGeometry,{indirect:true});
    if(settings.fractures==='anchors'&&settings.openingRepair&&repairOpenings)progress('Sampling fracture openings…');
    const openingContext=(settings.fractures==='skeleton'||settings.fractures==='anchors'&&settings.openingRepair&&repairOpenings)?openingWitnesses(source,sourceGeometry):null;
    const levels=[];
    try {
        for(const [level,target] of targetsFor(settings).entries()) {
            if(!requestedLevels.includes(level))continue;
            progress(`Reducing LOD ${level} to ${target.toLocaleString()} triangles…`);
            const start=performance.now();
            if(settings.fractures==='skeleton') {
                const mesh=await simplifySkeleton(source,target,settings);validateMesh(mesh);
                const check=inspectOpenings(openingContext,positionsOf(mesh),mesh.indices,[256,128,64][level]);
                mesh.protection.openings=openingSummary(check,0);
                const stats=meshStats(mesh),deviation=measureDeviation(sourceGeometry,mesh);
                levels.push({...mesh,level,target,stats,deviation,budgetMet:stats.triangles<=target,qualityMet:mesh.simplifierError<=settings.tolerance,reductionMs:performance.now()-start});
                continue;
            }
            const errorLimit=settings.priority==='quality'?settings.tolerance:10;
            const protection=fractureLocks(source,regions,target,settings.fractures);
            let workingTarget=target;
            const simplify=()=>{
                const raw=()=>MeshoptSimplifier.simplifyWithAttributes(originalIndices,positions,3,attributes,15,weights,protection.locks,
                    Math.min(workingTarget*3,originalIndices.length),errorLimit,['ErrorClamped']);
                let result=raw();
                for(let retry=0;retry<3;retry++) {
                    if(!supportMissingLandmarks(result[0],protection,retry===2))break;
                    result=raw();
                }
                verifyProtection(result[0],regions,protection);
                return result;
            };
            let [indices,error]=simplify();
            const openingSize=[256,128,64][level];
            let openingCheck=inspectOpenings(openingContext,positions,indices,openingSize),repairPasses=0;
            const repairCounts=[];
            const record=kind=>repairCounts.push({kind,target:workingTarget,triangles:indices.length/3,failed:openingCheck.failed});
            const evaluate=kind=>{[indices,error]=simplify();openingCheck=inspectOpenings(openingContext,positions,indices,openingSize);record(kind);};
            const snapshot=()=>({indices,error,openingCheck,workingTarget,protection:structuredClone(protection)});
            const restore=c=>{({indices,error,openingCheck,workingTarget}=c);Object.assign(protection,structuredClone(c.protection));};
            const better=(a,b)=>a.openingCheck.failed<b.openingCheck.failed||a.openingCheck.failed===b.openingCheck.failed&&a.indices.length<b.indices.length;
            record('landmarks');
            // Begin with sparse local constraints at the requested budget.
            if(openingContext)while(openingCheck.failed&&repairPasses<4) {
                progress(`Repairing LOD ${level} fracture openings · pass ${repairPasses+1}…`);
                const added=constrainOpeningFailures(openingContext,openingCheck,protection,repairPasses++);
                if(!added)break;
                evaluate('local-points');
            }
            let best=snapshot();
            // Try unlocked detail before pinning many source triangles. A coarse
            // candidate can otherwise make most of a wall look like a repair site.
            if(openingContext&&openingCheck.failed)for(const multiplier of [1.5,2,3,4,8]) {
                workingTarget=Math.min(Math.ceil(target*multiplier),originalIndices.length/3);
                evaluate('detail');const candidate=snapshot();if(better(candidate,best))best=candidate;
                if(!openingCheck.failed)break;
            }
            restore(best);
            if(openingContext&&openingCheck.failed)for(let pass=4;pass<8;pass++) {
                progress(`Repairing LOD ${level} remaining opening patches · pass ${pass-3}…`);
                const added=constrainOpeningFailures(openingContext,openingCheck,protection,pass);
                if(!added)continue;
                repairPasses++;evaluate('local-patches');const candidate=snapshot();if(better(candidate,best))best=candidate;
                if(!openingCheck.failed)break;
            }
            restore(best);
            // Once the local constraints pass, spend as little global detail as
            // the tested ladder allows. Preserve the passing snapshot if a lower
            // request reintroduces an opening failure or costs more triangles.
            if(openingContext&&!openingCheck.failed&&workingTarget>target) {
                const ceiling=workingTarget;
                for(const multiplier of [1,1.5,2,3,4,6]) {
                    if(target*multiplier>=ceiling)break;
                    workingTarget=Math.ceil(target*multiplier);evaluate('budget-recheck');
                    const candidate=snapshot();if(better(candidate,best))best=candidate;
                    if(!openingCheck.failed)break;
                }
                restore(best);
            }
            if(!openingContext)openingCheck.status=settings.fractures!=='anchors'||!settings.openingRepair||!repairOpenings?'disabled':source.fractureTags?.length?'not-applicable':'unavailable';
            protection.stats.openings={...openingSummary(openingCheck,repairPasses),candidates:repairCounts};
            verifyProtection(indices,regions,protection);
            const mesh=compact(source,indices);validateMesh(mesh);
            const deviation=measureDeviation(sourceGeometry,mesh);
            const stats=meshStats(mesh);
            levels.push({...mesh,level,target,stats,simplifierError:error,deviation,
                protection:protection.stats,
                budgetMet:stats.triangles<=target,qualityMet:error<=settings.tolerance,
                reductionMs:performance.now()-start});
        }
    } finally {sourceGeometry.dispose();}
    return {levels,settings,sourceStats:meshStats(source)};
}
