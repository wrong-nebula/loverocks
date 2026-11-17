import {fractureSemantics} from './fracture-semantics.js';
// The 'fresh' channel means something different on specimen stones. Only
// meshes explicitly tagged by the fjord generator may use this classifier.
export function fractureRegions(source) {
    const v=source.vertices,index=source.indices,count=v.length/16;
    const empty={supported:false,count,faces:[],rims:[],components:[],extent:0};
    if(source.featureKind!=='fjord-fractures')return empty;
    const semantic=fractureSemantics(source);
    const parent=new Int32Array(count).fill(-1),faces=[],edges=new Map();
    const min=[Infinity,Infinity,Infinity],max=[-Infinity,-Infinity,-Infinity];
    for(let i=0;i<count;i++)for(let a=0;a<3;a++){min[a]=Math.min(min[a],v[i*16+a]);max[a]=Math.max(max[a],v[i*16+a]);}
    const extent=Math.max(...max.map((x,a)=>x-min[a]));
    function root(i){while(parent[i]!==i){parent[i]=parent[parent[i]];i=parent[i];}return i;}
    function join(a,b){if(parent[a]<0)parent[a]=a;if(parent[b]<0)parent[b]=b;const x=root(a),y=root(b);if(x!==y)parent[Math.max(x,y)]=Math.min(x,y);}
    for(let i=0;i<index.length;i+=3) {
        const ids=Array.from(index.subarray(i,i+3));
        if(semantic?!semantic.ids[i/3]:ids.reduce((n,id)=>n+v[id*16+13],0)/3<.35)continue;
        faces.push(ids);join(ids[0],ids[1]);join(ids[1],ids[2]);
        for(let a=0;a<3;a++) {
            const x=Math.min(ids[a],ids[(a+1)%3]),y=Math.max(ids[a],ids[(a+1)%3]),key=x*count+y;
            const e=edges.get(key);if(e)e.uses++;else edges.set(key,{a:x,b:y,uses:1});
        }
    }
    const groups=new Map();
    for(let i=0;i<count;i++)if(parent[i]>=0){const r=root(i);if(!groups.has(r))groups.set(r,[]);groups.get(r).push(i);}
    const components=Array.from(groups.values()).map(ids=>{
        const lo=[Infinity,Infinity,Infinity],hi=[-Infinity,-Infinity,-Infinity];
        for(const i of ids)for(let a=0;a<3;a++){lo[a]=Math.min(lo[a],v[i*16+a]);hi[a]=Math.max(hi[a],v[i*16+a]);}
        return {ids,span:Math.hypot(...hi.map((x,a)=>x-lo[a]))};
    });
    return {supported:true,count,extent,faces,components,semantic,rims:Array.from(edges.values()).filter(e=>e.uses===1).map(e=>[e.a,e.b])};
}
function distanceToSegment(v,p,a,b) {
    let dot=0,length=0;
    for(let k=0;k<3;k++){const d=v[b*16+k]-v[a*16+k];dot+=(v[p*16+k]-v[a*16+k])*d;length+=d*d;}
    const t=length?Math.max(0,Math.min(1,dot/length)):0;
    let d2=0;for(let k=0;k<3;k++)d2+=(v[p*16+k]-v[a*16+k]-t*(v[b*16+k]-v[a*16+k]))**2;
    return d2;
}
function pinPath(path,vertices,tolerance,locks) {
    locks[path[0]]=locks[path.at(-1)]=1;
    const stack=[[0,path.length-1]];
    while(stack.length) {
        const [a,b]=stack.pop();let worst=tolerance*tolerance,split=-1;
        for(let i=a+1;i<b;i++){const d=distanceToSegment(vertices,path[i],path[a],path[b]);if(d>worst){worst=d;split=i;}}
        if(split>=0){locks[path[split]]=1;stack.push([a,split],[split,b]);}
    }
}
export function fractureLocks(source,regions,target,mode='off') {
    const locks=new Uint8Array(regions.count),v=source.vertices,supportPatches=new Map(),supportFaces=[];
    const stats={mode,supported:regions.supported,classifier:regions.semantic?'generator-v1':'fresh-fallback',namedFractures:regions.semantic?.features.size??0,eligibleVertices:regions.components.reduce((n,c)=>n+c.ids.length,0),lockedVertices:0,
        retainedComponents:0,ignoredSmallComponents:0,rimTolerance:0,anchorVertices:0,candidateAnchorVertices:0,supportVertices:0,supportPasses:0};
    if(mode==='off'||!regions.supported)return {locks:null,stats};
    if(mode==='strict') {
        // Every vertex of every classified face is fixed. Without pruning,
        // those triangles cannot disappear through an edge collapse.
        for(const face of regions.faces)for(const id of face)locks[id]=1;
        stats.retainedComponents=regions.components.length;
    }else {
        const eligible=new Uint8Array(regions.count);
        const tolerance=regions.extent*Math.max(.005,Math.min(.04,.01*Math.sqrt(500/target)));
        stats.rimTolerance=tolerance;
        for(const component of regions.components) {
            if(component.ids.length<8||component.span<regions.extent*.035){stats.ignoredSmallComponents++;continue;}
            stats.retainedComponents++;
            for(const id of component.ids)eligible[id]=1;
            // Keep region extents and a sheltered interior point as well as
            // rim bends; a mouth alone does not describe a crack's depth.
            let sheltered=component.ids[0];
            for(let axis=0;axis<3;axis++) {
                let lo=component.ids[0],hi=lo;
                for(const id of component.ids){if(v[id*16+axis]<v[lo*16+axis])lo=id;if(v[id*16+axis]>v[hi*16+axis])hi=id;}
                locks[lo]=locks[hi]=1;
            }
            for(const id of component.ids)if(v[id*16+15]<v[sheltered*16+15])sheltered=id;
            locks[sheltered]=1;
        }
        const adjacent=new Map(),visited=new Set();
        const key=(a,b)=>Math.min(a,b)*regions.count+Math.max(a,b);
        for(const [a,b] of regions.rims)if(eligible[a]&&eligible[b]) {
            if(!adjacent.has(a))adjacent.set(a,[]);if(!adjacent.has(b))adjacent.set(b,[]);
            adjacent.get(a).push(b);adjacent.get(b).push(a);
        }
        const walk=(a,b)=>{
            const path=[a,b];visited.add(key(a,b));
            while(adjacent.get(b).length===2) {
                const next=adjacent.get(b).find(id=>id!==a);
                if(visited.has(key(b,next)))break;
                visited.add(key(b,next));path.push(next);a=b;b=next;
            }
            pinPath(path,v,tolerance,locks);
        };
        // Start at branches/endpoints, then consume remaining closed loops.
        for(const [a,neighbors] of adjacent)if(neighbors.length!==2) {
            locks[a]=1;for(const b of neighbors)if(!visited.has(key(a,b)))walk(a,b);
        }
        for(const [a,neighbors] of adjacent)for(const b of neighbors)if(!visited.has(key(a,b)))walk(a,b);
        // Start with point constraints. Supporting every point with a fixed
        // triangle spends most of a low LOD's vertices on tiny source patches.
        // Keep incident patches available for islands that lose a point.
        if(regions.semantic)for(const feature of regions.semantic.features.values()) {
            for(const set of [feature.positive,feature.negative,feature.mouth,feature.tips]) {
                const ids=[...set];if(!ids.length)continue;
                for(let axis=0;axis<3;axis++) {
                    let lo=ids[0],hi=lo;
                    for(const id of ids){if(v[id*16+axis]<v[lo*16+axis])lo=id;if(v[id*16+axis]>v[hi*16+axis])hi=id;}
                    locks[lo]=locks[hi]=1;
                }
            }
        }
        const candidates=Array.from({length:locks.length},(_,i)=>i).filter(i=>locks[i]);
        stats.candidateAnchorVertices=candidates.length;
        const limit=Math.max(12,Math.min(256,Math.floor(target*.08)));
        // A dense sampled rim can consume the whole game-asset budget. Select
        // a bounded set of landmarks in position + normal space. Opposing
        // walls remain distinct even when they are spatially close.
        if(candidates.length>limit) {
            locks.fill(0);
            let next=candidates.reduce((best,id)=>v[id*16+15]<v[best*16+15]?id:best,candidates[0]);
            const distance=new Float64Array(candidates.length).fill(Infinity);
            for(let selected=0;selected<limit;selected++) {
                locks[next]=1;let farthest=-1,max=-1;
                for(let i=0;i<candidates.length;i++) {
                    const id=candidates[i];if(locks[id]){distance[i]=0;continue;}
                    let d=0,dot=0;
                    for(let axis=0;axis<3;axis++){d+=((v[id*16+axis]-v[next*16+axis])/regions.extent)**2;dot+=v[id*16+3+axis]*v[next*16+3+axis];}
                    distance[i]=Math.min(distance[i],d+.02*Math.max(0,1-dot));
                    if(distance[i]>max){max=distance[i];farthest=id;}
                }
                next=farthest;if(next<0)break;
            }
        }
        const anchors=locks.slice();stats.anchorVertices=anchors.reduce((s,x)=>s+x,0);
        stats.retainedComponents=regions.components.filter(c=>c.ids.some(id=>anchors[id])).length;
        const best=new Map();
        for(let i=0;i<source.indices.length;i+=3) {
            const face=Array.from(source.indices.subarray(i,i+3));if(!face.some(id=>anchors[id]))continue;
            const ab=[0,1,2].map(a=>v[face[1]*16+a]-v[face[0]*16+a]),ac=[0,1,2].map(a=>v[face[2]*16+a]-v[face[0]*16+a]);
            const area=(ab[1]*ac[2]-ab[2]*ac[1])**2+(ab[2]*ac[0]-ab[0]*ac[2])**2+(ab[0]*ac[1]-ab[1]*ac[0])**2;
            for(const id of face)if(anchors[id]&&(!best.has(id)||area>best.get(id).area))best.set(id,{face,area});
        }
        for(const [anchor,{face}] of best)supportPatches.set(anchor,face);
    }
    stats.lockedVertices=locks.reduce((sum,x)=>sum+x,0);
    return {locks,stats,supportPatches,supportFaces};
}

// Locked points on tiny disconnected islands can still become unreferenced.
// Add a full incident patch only for those points, then rerun from the source.
// The final retry may support all anchors; the original landmarks never change.
export function supportMissingLandmarks(indices,protection,all=false) {
    if(protection.stats.mode!=='anchors'||!protection.locks)return false;
    const retained=new Set(indices),missing=[];
    for(let i=0;i<protection.locks.length;i++)if(protection.locks[i]&&!retained.has(i))missing.push(i);
    if(!missing.length)return false;
    const anchors=all?[...protection.supportPatches.keys()]:missing;
    for(const anchor of anchors) {
        const face=protection.supportPatches.get(anchor);
        if(!face)throw Error('A supporting fracture patch was lost. Increase source detail or disable fracture protection.');
        if(!protection.supportFaces.includes(face))protection.supportFaces.push(face);
        for(const id of face)protection.locks[id]=1;
    }
    const before=protection.stats.lockedVertices;
    protection.stats.lockedVertices=protection.locks.reduce((sum,x)=>sum+x,0);
    protection.stats.supportVertices+=protection.stats.lockedVertices-before;
    protection.stats.supportPasses++;
    return true;
}

export function verifyProtection(indices,regions,protection) {
    if(!protection.locks)return;
    const retained=new Set(indices);
    for(let i=0;i<protection.locks.length;i++)if(protection.locks[i]&&!retained.has(i))throw Error('A protected surface patch was lost. Increase source detail or disable fracture protection.');
    if(protection.stats.mode==='strict'||protection.supportFaces?.length) {
        const key=face=>{const at=face.indexOf(Math.min(...face));return [face[at],face[(at+1)%3],face[(at+2)%3]].join(',');};
        const faces=new Set();for(let i=0;i<indices.length;i+=3)faces.add(key(Array.from(indices.subarray(i,i+3))));
        for(const face of protection.stats.mode==='strict'?regions.faces:protection.supportFaces)if(!faces.has(key(face)))throw Error('A marked fracture face changed. Increase source detail or disable fracture protection.');
    }
}
