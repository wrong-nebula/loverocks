import {Vector3,Ray,Triangle,FrontSide} from 'three';
import {MeshBVH} from 'three-mesh-bvh';
import {geometryFor,validateMesh} from './lod.js';
import {openingRegions} from './opening-acceptance.js';
import {fractureSurfaceGraph} from './fracture-surfaces.js';

const position=(m,i)=>new Vector3().fromArray(m.vertices,i*16);
const face=(m,i)=>Array.from(m.indices.subarray(i*3,i*3+3));
const copy=m=>({...m,vertices:m.vertices.slice(),indices:m.indices.slice(),weather:m.weather?.slice(),fractureTags:m.fractureTags?.slice(),facePatches:m.facePatches?.slice(),sourceFaces:m.sourceFaces?.slice()});
const normal=(m,f)=>{const [a,b,c]=f.map(i=>position(m,i));return b.sub(a).cross(c.sub(a));};
function validChange(before,after){
    try{validateMesh(after);}catch{return false;}
    const sameTopology=before.indices.length===after.indices.length&&before.indices.every((v,j)=>v===after.indices[j]);
    for(let i=0;i<after.indices.length/3;i++){const nn=normal(after,face(after,i));if(nn.lengthSq()<1e-18)return false;if(sameTopology){const n=normal(before,face(before,i));if(n.dot(nn)<=.1*Math.sqrt(n.lengthSq()*nn.lengthSq()))return false;}}
    return true;
}
export function renderedLoss(gpu){
    const openings=gpu.rows.flatMap(r=>r.acceptance.openings);let penalty=0;
    for(const o of openings){if(o.kind==='wall'){penalty+=Math.max(0,(o.depthP95Px??100)/2-1)**2;penalty+=10*Math.max(0,o.missingPixels/Math.max(2,Math.floor(o.pixels*.1))-1)**2;}
        else penalty+=10*Math.max(0,o.filledPixels/o.allowedFilledPixels-1)**2;}
    return {failed:gpu.failed,gaps:gpu.failures.filter(f=>f.kind==='opening').length,worst:gpu.depthP95Px??Infinity,penalty};
}
export function renderedImprovement(candidate,current){
    if(candidate.gaps>current.gaps||candidate.worst>current.worst+1e-5||candidate.failed>current.failed)return false;
    return candidate.failed<current.failed||candidate.penalty<current.penalty-1e-6;
}
function topology(m){const edges=new Map(),incident=Array.from({length:m.vertices.length/16},()=>[]);for(let f=0;f<m.indices.length/3;f++){const v=face(m,f);for(let j=0;j<3;j++){incident[v[j]].push(f);const a=v[j],b=v[(j+1)%3],key=a<b?`${a},${b}`:`${b},${a}`;if(!edges.has(key))edges.set(key,{a,b,faces:[]});edges.get(key).faces.push(f);}}return {edges,incident};}
function compact(m,indices,patches,sourceFaces){
    const map=new Map(),origins=[];indices=indices.map(v=>{if(!map.has(v)){map.set(v,map.size);origins.push(v);}return map.get(v);});
    const out={...m,vertices:new Float32Array(map.size*16),indices:new Uint32Array(indices),weather:m.weather?new Float32Array(map.size*2):null,fractureTags:new Float32Array(map.size*4),facePatches:patches?new Uint32Array(patches):undefined,sourceFaces:sourceFaces?new Uint32Array(sourceFaces):undefined};
    origins.forEach((v,i)=>{out.vertices.set(m.vertices.subarray(v*16,v*16+16),i*16);out.fractureTags.set(m.fractureTags.subarray(v*4,v*4+4),i*4);if(out.weather)out.weather.set(m.weather.subarray(v*2,v*2+2),i*2);});return out;
}
function collapse(m,edge){
    if(edge.faces.length!==2)return null;
    const {a,b}=edge,{incident}=topology(m),neighbors=v=>new Set(incident[v].flatMap(f=>face(m,f)).filter(i=>i!==v));
    const an=neighbors(a),bn=neighbors(b),opposite=new Set(edge.faces.flatMap(f=>face(m,f)).filter(v=>v!==a&&v!==b));
    if(opposite.size!==2||[...an].filter(v=>bn.has(v)).some(v=>!opposite.has(v)))return null;
    if(m.facePatches){const pa=new Set(incident[a].map(f=>m.facePatches[f])),pb=new Set(incident[b].map(f=>m.facePatches[f]));if(pa.size!==1||pb.size!==1||[...pa][0]!==[...pb][0])return null;}
    const moved=copy(m),p=position(m,a).add(position(m,b)).multiplyScalar(.5);p.toArray(moved.vertices,a*16);
    const indices=[],patches=[],sourceFaces=[];
    for(let i=0;i<m.indices.length/3;i++){if(edge.faces.includes(i))continue;const old=face(m,i),next=old.map(v=>v===b?a:v),n=normal(m,old),nn=normal(moved,next);if(n.dot(nn)<=.1*Math.sqrt(n.lengthSq()*nn.lengthSq()))return null;indices.push(...next);if(m.facePatches)patches.push(m.facePatches[i]);if(m.sourceFaces)sourceFaces.push(m.sourceFaces[i]);}
    return compact(moved,indices,m.facePatches?patches:null,m.sourceFaces?sourceFaces:null);
}
function flip(m,edge){
    if(edge.faces.length!==2)return null;const [f,g]=edge.faces;
    if(m.facePatches&&m.facePatches[f]!==m.facePatches[g])return null;
    const v=face(m,f),i=v.findIndex((a,j)=>a===edge.a&&v[(j+1)%3]===edge.b),a=i>=0?edge.a:edge.b,b=i>=0?edge.b:edge.a;
    const c=v.find(x=>x!==a&&x!==b),d=face(m,g).find(x=>x!==a&&x!==b);if(c===d)return null;
    if([...topology(m).edges.values()].some(e=>e.a===c&&e.b===d||e.a===d&&e.b===c))return null;
    const out=copy(m),first=[c,d,b],second=[d,c,a],n=normal(m,v).add(normal(m,face(m,g)));
    for(const tri of [first,second])if(normal(out,tri).dot(n)<=0)return null;
    out.indices.set(first,f*3);out.indices.set(second,g*3);return validChange(m,out)?out:null;
}

// Geometry is fitted only with development cameras. Validation cameras are
// never supplied to this optimizer. Every accepted edit is independently
// rendered; equal-budget split/collapse pairs cannot silently add triangles.
export async function refineFractureMesh(source,initial,validator,{steps=8,target=initial.indices.length/3,signal,progress=()=>{}}={}) {
    if(!Number.isInteger(steps)||steps<0||steps>32)throw Error('Refinement steps must be between 0 and 32.');
    const sourceGeometry=geometryFor(source);sourceGeometry.boundsTree=new MeshBVH(sourceGeometry,{indirect:true});
    sourceGeometry.computeBoundingSphere();const maxMove=sourceGeometry.boundingSphere.radius*.06;
    const graph=initial.facePatches?fractureSurfaceGraph(source):null,patchGeometry=new Map(),boundaryEdges=new Map();
    if(graph)for(const edge of graph.edges.values()){const ids=[...new Set(edge.faces.map(f=>graph.facePatches[f]))].sort((a,b)=>a-b);if(ids.length<2)continue;const key=ids.join(',');if(!boundaryEdges.has(key))boundaryEdges.set(key,[]);boundaryEdges.get(key).push(edge);}
    const sourceHit={point:new Vector3()},bary=new Vector3();
    function project(mesh,vertex,p){
        let f,weights;
        if(graph&&mesh.facePatches){
            const ids=[...new Set(Array.from({length:mesh.indices.length/3},(_,i)=>i).filter(i=>face(mesh,i).includes(vertex)).map(i=>mesh.facePatches[i]))].sort((a,b)=>a-b);
            if(ids.length>=3)return; // network junctions remain fixed
            if(ids.length===2){
                const edges=boundaryEdges.get(ids.join(','));if(!edges?.length)return;
                let best=null;
                for(const edge of edges){const a=position(source,edge.a),b=position(source,edge.b),d=b.sub(a),t=Math.max(0,Math.min(1,p.clone().sub(a).dot(d)/(d.lengthSq()||1))),point=a.addScaledVector(d,t),distance=point.distanceToSquared(p);if(!best||distance<best.distance)best={point,distance,t,edge};}
                sourceHit.point.copy(best.point);f=[best.edge.a,best.edge.b];weights=[1-best.t,best.t];
            }else if(ids.length===1){
                const id=ids[0];if(!patchGeometry.has(id)){const indices=new Uint32Array(graph.patches[id].faces.flatMap(i=>face(source,i))),g=geometryFor({...source,indices});g.boundsTree=new MeshBVH(g,{indirect:true});patchGeometry.set(id,g);}
                patchGeometry.get(id).boundsTree.closestPointToPoint(p,sourceHit);f=face(source,graph.patches[id].faces[sourceHit.faceIndex]);
            }
        }
        if(!f){sourceGeometry.boundsTree.closestPointToPoint(p,sourceHit);f=face(source,sourceHit.faceIndex);}
        if(!weights){Triangle.getBarycoord(sourceHit.point,...f.map(i=>position(source,i)),bary);weights=bary.toArray();}
        sourceHit.point.toArray(mesh.vertices,vertex*16);
        for(let c=3;c<16;c++)mesh.vertices[vertex*16+c]=f.reduce((sum,v,i)=>sum+source.vertices[v*16+c]*weights[i],0);
        const n=new Vector3().fromArray(mesh.vertices,vertex*16+3);if(n.lengthSq())n.normalize().toArray(mesh.vertices,vertex*16+3);
        if(mesh.weather)for(let c=0;c<2;c++)mesh.weather[vertex*2+c]=f.reduce((sum,v,i)=>sum+source.weather[v*2+c]*weights[i],0);
        const closest=f[weights.indexOf(Math.max(...weights))];mesh.fractureTags.set(source.fractureTags.subarray(closest*4,closest*4+4),vertex*4);
    }
    async function observe(mesh,witnesses=false){
        const geometry=witnesses?geometryFor(mesh):null;if(geometry)geometry.boundsTree=new MeshBVH(geometry,{indirect:true});const samples=[];
        try {
            const gpu=await validator.measure(mesh,{signal,onFrame:witnesses?(view,frames)=>{
                const regions=openingRegions(frames.source,view.width,view.width),forward=new Vector3();view.camera.getWorldDirection(forward);
                for(const region of regions.walls){if(region.pixels.length<8)continue;
                    const all=region.pixels.filter(i=>frames.candidate.silhouette[i*4]>250).map(i=>({i,error:Math.abs(frames.source.depth[i]-frames.candidate.depth[i])*128})).filter(p=>p.error>.25).sort((a,b)=>b.error-a.error);
                    const pixels=all.filter((_,i)=>i<3||i%Math.max(1,Math.floor(all.length/6))===0).slice(0,9);
                    for(const {i,error} of pixels){const x=i%view.width,y=Math.floor(i/view.width),direction=new Vector3((x+.5)/view.width*2-1,(y+.5)/view.width*2-1,.5).unproject(view.camera).sub(view.camera.position).normalize(),ray=new Ray(view.camera.position.clone(),direction),hit=geometry.boundsTree.raycastFirst(ray,FrontSide);
                        if(!hit)continue;const wanted=ray.at((frames.source.depth[i]*view.diameter+view.front)/direction.dot(forward),new Vector3()),ids=face(mesh,hit.faceIndex);Triangle.getBarycoord(hit.point,...ids.map(v=>position(mesh,v)),bary);
                        samples.push({face:hit.faceIndex,ids,weights:bary.toArray(),target:wanted.clone(),delta:wanted.sub(hit.point),error});}
                }
            }:()=>{}});return {gpu,score:renderedLoss(gpu),samples};
        }finally{geometry?.dispose();}
    }
    let mesh=copy(initial),current,history=[];
    try {
        current=await observe(mesh,true);history.push({operation:'initial',triangles:mesh.indices.length/3,...current.score});
        for(let step=0;step<steps&&current.gpu.failed;step++){
            signal?.throwIfAborted();progress(`Fitting fracture surfaces · ${step+1}/${steps}`);
            const deltas=new Map(),faceErrors=new Map();
            for(const sample of current.samples){faceErrors.set(sample.face,(faceErrors.get(sample.face)||0)+sample.error);const den=sample.weights.reduce((s,w)=>s+w*w,0)||1;
                sample.ids.forEach((v,i)=>{if(!deltas.has(v))deltas.set(v,{sum:new Vector3(),weight:0,error:0});const d=deltas.get(v),w=sample.weights[i];d.sum.addScaledVector(sample.delta,w/den);d.weight++;d.error+=sample.error*w;});}
            const ranked=[...deltas].sort((a,b)=>b[1].error-a[1].error),proposals=[];
            for(const fraction of [1,.5,.25]){const moved=copy(mesh);for(const [v,d] of ranked.slice(0,12)){const delta=d.sum.clone().multiplyScalar(fraction/d.weight).clampLength(0,maxMove);project(moved,v,position(mesh,v).add(delta));}if(validChange(mesh,moved))proposals.push({mesh:moved,operation:`project-${fraction}`});}
            for(const [v,d] of ranked.slice(0,3))for(const fraction of [1,.5]){const moved=copy(mesh),delta=d.sum.clone().multiplyScalar(fraction/d.weight).clampLength(0,maxMove);project(moved,v,position(mesh,v).add(delta));if(validChange(mesh,moved))proposals.push({mesh:moved,operation:'project-vertex'});}
            const {edges}=topology(mesh),rankedEdges=[...edges.values()].map(e=>({...e,error:e.faces.reduce((s,f)=>s+(faceErrors.get(f)||0),0)})).sort((a,b)=>b.error-a.error);
            for(const edge of rankedEdges.slice(0,4)){const changed=flip(mesh,edge);if(changed)proposals.push({mesh:changed,operation:'edge-flip'});}
            const hot=[...faceErrors].sort((a,b)=>b[1]-a[1])[0]?.[0];
            if(hot!==undefined&&mesh.indices.length/3<=target){
                const ids=face(mesh,hot),split=copy(mesh),v=mesh.vertices.length/16;
                split.vertices=new Float32Array(mesh.vertices.length+16);split.vertices.set(mesh.vertices);split.fractureTags=new Float32Array(mesh.fractureTags.length+4);split.fractureTags.set(mesh.fractureTags);
                if(mesh.weather){split.weather=new Float32Array(mesh.weather.length+2);split.weather.set(mesh.weather);}
                const witnesses=current.samples.filter(s=>s.face===hot),sum=witnesses.reduce((s,w)=>s+w.error,0);
                const wanted=sum?witnesses.reduce((p,w)=>p.addScaledVector(w.target,w.error/sum),new Vector3()):ids.reduce((p,i)=>p.add(position(mesh,i)),new Vector3()).multiplyScalar(1/3);
                const indices=Array.from(mesh.indices);indices.splice(hot*3,3,ids[0],ids[1],v,ids[1],ids[2],v,ids[2],ids[0],v);split.indices=new Uint32Array(indices);
                for(const key of ['facePatches','sourceFaces'])if(mesh[key]){const values=Array.from(mesh[key]);values.splice(hot,1,values[hot],values[hot],values[hot]);split[key]=new Uint32Array(values);}
                // Install the parent patch before projection so a new wall
                // vertex cannot snap onto the opposing fracture surface.
                project(split,v,wanted);
                const parentNormal=normal(mesh,ids),splitValid=[0,1,2].every(i=>normal(split,face(split,hot+i)).dot(parentNormal)>0);
                if(splitValid&&split.indices.length/3<=target&&validChange(mesh,split))proposals.push({mesh:split,operation:'split-within-budget'});
                const coldCost=e=>(deltas.get(e.a)?.error??0)+(deltas.get(e.b)?.error??0)+position(split,e.a).distanceToSquared(position(split,e.b))*10;
                const coldEdges=splitValid?[...topology(split).edges.values()].filter(e=>e.a!==v&&e.b!==v&&!ids.includes(e.a)&&!ids.includes(e.b)).sort((a,b)=>coldCost(a)-coldCost(b)):[];let paired=0;
                for(const edge of coldEdges.slice(0,24)){const reduced=collapse(split,edge);if(reduced&&reduced.indices.length<=mesh.indices.length&&validChange(mesh,reduced)){proposals.push({mesh:reduced,operation:'split-collapse'});if(++paired===3)break;}}
            }
            let best=null;
            for(const proposal of proposals){signal?.throwIfAborted();if(proposal.mesh.indices.length/3>target)continue;const observed=await observe(proposal.mesh);if(renderedImprovement(observed.score,best?.observed.score??current.score))best={...proposal,observed};}
            if(!best){history.push({operation:'stalled',attempted:proposals.length,triangles:mesh.indices.length/3,...current.score});break;}
            mesh=best.mesh;current=await observe(mesh,true);history.push({operation:best.operation,triangles:mesh.indices.length/3,...current.score});
        }
        mesh.protection={...mesh.protection,refinement:{cameraSet:'development',requestedSteps:steps,acceptedEdits:history.filter(h=>!['initial','stalled'].includes(h.operation)).length,history}};
        return {mesh,gpu:current.gpu};
    }finally{sourceGeometry.dispose();for(const geometry of patchGeometry.values())geometry.dispose();}
}
