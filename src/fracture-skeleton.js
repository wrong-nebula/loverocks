import {MeshoptSimplifier,MeshoptEncoder} from 'meshoptimizer';
import {fractureSemantics} from './fracture-semantics.js';

// Build explicit guide paths between labeled mouths, opposing wall patches,
// tips and junctions. A bounded subset guides movable-vertex QEM reduction;
// these are sparse constraints, not a guarantee that every boundary survives.
export function fractureSkeleton(source,target) {
    const semantic=fractureSemantics(source);
    if(!semantic)throw Error('Fracture skeletons require generator labels.');
    const vertices=source.vertices,indices=source.indices,count=vertices.length/16;
    const labels=Uint32Array.from(semantic.ids,(id,i)=>id?id*3+semantic.sides[i]+1:0),edges=new Map();
    const lo=[Infinity,Infinity,Infinity],hi=[-Infinity,-Infinity,-Infinity];
    for(let i=0;i<count;i++)for(let a=0;a<3;a++){lo[a]=Math.min(lo[a],vertices[i*16+a]);hi[a]=Math.max(hi[a],vertices[i*16+a]);}
    const extent=Math.hypot(...hi.map((x,a)=>x-lo[a]));
    if(!Number.isFinite(extent)||extent<=0)throw Error('A fracture skeleton requires a nonzero mesh extent.');
    for(let f=0;f<labels.length;f++)for(let e=0;e<3;e++) {
        const a=indices[f*3+e],b=indices[f*3+(e+1)%3],key=Math.min(a,b)*count+Math.max(a,b);
        const edge=edges.get(key);
        if(edge)edge.labels.add(labels[f]);else edges.set(key,{a,b,labels:new Set([labels[f]])});
    }
    const adjacent=new Map(),boundary=[];
    for(const edge of edges.values())if(edge.labels.size>1) {
        boundary.push(edge);
        for(const [a,b] of [[edge.a,edge.b],[edge.b,edge.a]]){if(!adjacent.has(a))adjacent.set(a,[]);adjacent.get(a).push(b);}
    }
    const candidates=new Set(),paths=[],visited=new Set(),key=(a,b)=>Math.min(a,b)*count+Math.max(a,b);
    const distance=(p,a,b)=>{
        let dot=0,length=0;for(let k=0;k<3;k++){const d=vertices[b*16+k]-vertices[a*16+k];dot+=(vertices[p*16+k]-vertices[a*16+k])*d;length+=d*d;}
        const t=length?Math.max(0,Math.min(1,dot/length)):0;
        return [0,1,2].reduce((n,k)=>n+(vertices[p*16+k]-vertices[a*16+k]-t*(vertices[b*16+k]-vertices[a*16+k]))**2,0);
    };
    const trace=(a,b)=>{
        const path=[a,b];visited.add(key(a,b));
        while(adjacent.get(b)?.length===2){const c=adjacent.get(b).find(x=>x!==a);if(visited.has(key(b,c)))break;visited.add(key(b,c));path.push(c);a=b;b=c;}
        const selected=new Set([0,path.length-1]),stack=[[0,path.length-1]],epsilon=extent*.008;
        while(stack.length){const [start,end]=stack.pop();let split=-1,worst=epsilon**2;for(let i=start+1;i<end;i++){const d=distance(path[i],path[start],path[end]);if(d>worst){worst=d;split=i;}}if(split>=0){selected.add(split);stack.push([start,split],[split,end]);}}
        const coarse=[...selected].sort((a,b)=>a-b).map(i=>path[i]);coarse.forEach(i=>candidates.add(i));paths.push(coarse);
    };
    for(const [a,neighbors] of adjacent)if(neighbors.length!==2)for(const b of neighbors)if(!visited.has(key(a,b)))trace(a,b);
    for(const [a,neighbors] of adjacent)for(const b of neighbors)if(!visited.has(key(a,b)))trace(a,b);
    // Explicit tip/extreme nodes supplement mouths and network junctions.
    for(const feature of semantic.features.values())for(const set of [feature.tips,feature.positive,feature.negative]) {
        const ids=[...set];if(!ids.length)continue;
        for(let a=0;a<3;a++){let min=ids[0],max=min;for(const i of ids){if(vertices[i*16+a]<vertices[min*16+a])min=i;if(vertices[i*16+a]>vertices[max*16+a])max=i;}candidates.add(min);candidates.add(max);}
    }
    const choices=[...candidates],fixed=new Set(),limit=Math.min(choices.length,Math.max(8,Math.min(128,Math.floor(target*.04))));
    const nearest=new Float64Array(choices.length).fill(Infinity);let next=choices[0];
    for(let n=0;n<limit;n++) {
        fixed.add(next);let best=-1,farthest=-1;
        for(let i=0;i<choices.length;i++) {
            if(fixed.has(choices[i]))continue;
            const d=[0,1,2].reduce((sum,a)=>sum+((vertices[choices[i]*16+a]-vertices[next*16+a])/extent)**2,0);
            nearest[i]=Math.min(nearest[i],d);if(nearest[i]>farthest){farthest=nearest[i];best=choices[i];}
        }
        next=best;if(next<0)break;
    }
    return {semantic,labels,paths,fixed,boundaryVertices:new Set(adjacent.keys()),extent};
}

export async function simplifySkeleton(source,target,{tolerance=.03,priority='budget',features=1}={}) {
    await Promise.all([MeshoptSimplifier.ready,MeshoptEncoder.ready]);
    const graph=fractureSkeleton(source,target),map=new Map(),origins=[],originalIndices=new Uint32Array(source.indices.length);
    // Stable first-use ordering keeps tie-breaking independent of unused vertices.
    for(let i=0;i<source.indices.length;i++) {
        const old=source.indices[i];if(!map.has(old)){map.set(old,origins.length);origins.push(old);}
        originalIndices[i]=map.get(old);
    }
    const count=origins.length,basePositions=new Float32Array(count*3),baseAttributes=new Float32Array(count*15),locks=new Uint8Array(count);
    for(let i=0;i<count;i++) {
        const old=origins[i];basePositions.set(source.vertices.subarray(old*16,old*16+3),i*3);
        baseAttributes.set(source.vertices.subarray(old*16+3,old*16+16),i*15);
        baseAttributes[i*15+13]=source.weather?.[old*2]??0;baseAttributes[i*15+14]=source.weather?.[old*2+1]??1;
        locks[i]=graph.fixed.has(old)?1:graph.boundaryVertices.has(old)?2:0;
    }
    let positions,attributes,reduced,error,supportVertices=0;
    for(let attempt=0;attempt<4;attempt++) {
        // The update API mutates all three buffers. Each retry starts afresh.
        positions=basePositions.slice();attributes=baseAttributes.slice();const indices=originalIndices.slice();
        const [length,score]=MeshoptSimplifier.simplifyWithUpdate(indices,positions,3,attributes,15,
            [.05,.05,.05,.03,.03,.03,.008,.01,.03,.02,.15*features,.015*features,.008,.01,.01],locks,
            Math.min(target*3,indices.length),priority==='quality'?tolerance:10,['Permissive','ErrorClamped']);
        reduced=indices.slice(0,length);error=score;const retained=new Set(reduced),missing=[];
        for(let i=0;i<count;i++)if(locks[i]===1&&!retained.has(i))missing.push(i);
        if(!missing.length)break;
        if(attempt===3)throw Error('A fixed fracture guide was lost. Increase the triangle budget.');
        for(const missingVertex of missing) {
            const at=originalIndices.indexOf(missingVertex);if(at<0)throw Error('Fracture guide has no supporting face.');
            const start=Math.floor(at/3)*3;
            for(const vertex of originalIndices.subarray(start,start+3))if(locks[vertex]!==1){locks[vertex]=1;supportVertices++;}
        }
    }
    const [remap,size]=MeshoptEncoder.reorderMesh(reduced,true,false);
    const vertices=new Float32Array(size*16),weather=source.weather?new Float32Array(size*2):null,tags=new Float32Array(size*4);
    let moved=0,movedBoundary=0,retainedFixed=0;
    for(let i=0;i<count;i++) {
        const at=remap[i];if(at===undefined||at===0xffffffff)continue;
        const old=origins[i];vertices.set(positions.subarray(i*3,i*3+3),at*16);vertices.set(attributes.subarray(i*15,i*15+13),at*16+3);
        let normal=Math.hypot(...vertices.subarray(at*16+3,at*16+6));
        if(normal<=1e-10){vertices.set(source.vertices.subarray(old*16+3,old*16+6),at*16+3);normal=Math.hypot(...vertices.subarray(at*16+3,at*16+6));}
        if(normal<=1e-10){vertices.set([0,1,0],at*16+3);normal=1;}
        for(let a=3;a<6;a++)vertices[at*16+a]/=normal;
        for(const a of [6,7,8,9,10,11,12,13,15])vertices[at*16+a]=Math.max(0,Math.min(1,vertices[at*16+a]));
        if(weather)weather.set(Array.from(attributes.subarray(i*15+13,i*15+15),x=>Math.max(0,Math.min(1,x))),at*2);
        // Discrete authoring labels follow the retained source vertex; do not
        // interpolate IDs or pretend to re-evaluate the procedural cut field.
        tags.set(source.fractureTags.subarray(old*4,old*4+4),at*4);
        const changed=[0,1,2].some(a=>Math.abs(positions[i*3+a]-source.vertices[old*16+a])>1e-7);
        if(changed){moved++;if(graph.boundaryVertices.has(old))movedBoundary++;}
        if(locks[i]===1){retainedFixed++;if(changed)throw Error('A fixed fracture skeleton node moved.');}
    }
    return {vertices,indices:size<=65535?new Uint16Array(reduced):reduced,weather,fractureTags:tags,bounds:source.bounds.slice(),
        simplifierError:error,protection:{mode:'skeleton',supported:true,classifier:'generator-v1',namedFractures:graph.semantic.features.size,
            lockedVertices:retainedFixed,supportVertices,skeleton:{paths:graph.paths.length,nodes:graph.fixed.size,boundaryVertices:graph.boundaryVertices.size,movedVertices:moved,movedBoundaryVertices:movedBoundary},
            openings:{status:'not-checked',failed:0}}};
}
