import {fractureSemantics} from './fracture-semantics.js';

const sub=(a,b)=>a.map((v,i)=>v-b[i]);
const dot=(a,b)=>a.reduce((s,v,i)=>s+v*b[i],0);
const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
const normal=(a,b,c)=>cross(sub(b,a),sub(c,a));
const edgeKey=(a,b)=>a<b?`${a},${b}`:`${b},${a}`;
function plane(q,n,d,w){const p=[...n,d];let k=0;for(let a=0;a<4;a++)for(let b=a;b<4;b++)q[k++]+=p[a]*p[b]*w;}
function error(q,p){const [x,y,z]=p;return Math.max(0,q[0]*x*x+2*q[1]*x*y+2*q[2]*x*z+2*q[3]*x+q[4]*y*y+2*q[5]*y*z+2*q[6]*y+q[7]*z*z+2*q[8]*z+q[9]);}
function optimum(q){
    const a=q[0],b=q[1],c=q[2],d=q[4],e=q[5],f=q[7],x=-q[3],y=-q[6],z=-q[8];
    const det=a*(d*f-e*e)-b*(b*f-c*e)+c*(b*e-c*d);
    if(Math.abs(det)<1e-12*Math.max(1,(a+d+f)**3))return null;
    return [(x*(d*f-e*e)-b*(y*f-z*e)+c*(y*e-z*d))/det,
        (a*(y*f-z*e)-x*(b*f-c*e)+c*(b*z-c*y))/det,
        (a*(d*z-e*y)-b*(b*z-c*y)+x*(b*e-c*d))/det];
}
class Heap {
    values=[];
    push(v){const a=this.values;let i=a.length;a.push(v);while(i){const p=(i-1)>>1;if(a[p].cost<=v.cost)break;a[i]=a[p];i=p;}a[i]=v;}
    pop(){const a=this.values,first=a[0],last=a.pop();if(a.length){let i=0;while(i*2+1<a.length){let c=i*2+1;if(c+1<a.length&&a[c+1].cost<a[c].cost)c++;if(a[c].cost>=last.cost)break;a[i]=a[c];i=c;}a[i]=last;}return first;}
}

// Connected components retain separate opposing walls even when a feature ID
// appears on several disconnected pieces. Boundaries are shared mesh edges.
export function fractureSurfaceGraph(source,{mergeFragments=true}={}) {
    const semantics=fractureSemantics(source);if(!semantics)throw Error('Fracture surfaces require generator labels.');
    const positions=Array.from({length:source.vertices.length/16},(_,i)=>Array.from(source.vertices.subarray(i*16,i*16+3)));
    const faces=Array.from({length:source.indices.length/3},(_,i)=>Array.from(source.indices.subarray(i*3,i*3+3)));
    const edges=new Map(),adj=faces.map(()=>[]),labels=source.surfaceLabels??Uint32Array.from(semantics.ids,(id,i)=>id?id*3+semantics.sides[i]+1:0);
    faces.forEach((face,i)=>face.forEach((a,j)=>{const b=face[(j+1)%3],key=edgeKey(a,b);if(!edges.has(key))edges.set(key,{a,b,faces:[]});edges.get(key).faces.push(i);}));
    for(const edge of edges.values())if(edge.faces.length===2){const [a,b]=edge.faces;if(labels[a]===labels[b]){adj[a].push(b);adj[b].push(a);}}
    const facePatches=new Int32Array(faces.length).fill(-1),patches=[];
    for(let start=0;start<faces.length;start++)if(facePatches[start]<0){
        const id=patches.length,queue=[start];facePatches[start]=id;let area=0;
        for(let j=0;j<queue.length;j++){const f=queue[j],v=faces[f];area+=Math.hypot(...normal(...v.map(i=>positions[i])))/2;for(const k of adj[f])if(facePatches[k]<0){facePatches[k]=id;queue.push(k);}}
        patches.push({id,feature:Math.floor(labels[start]/3),side:labels[start]?labels[start]%3-1:0,faces:queue,area,boundaries:[]});
    }
    // A few label-vote transition triangles are not independent wall surfaces.
    // Absorb only <=4-face fragments into an adjacent larger patch of the SAME
    // fracture. Geometry/reference labels are unchanged; GPU tests still decide
    // whether the resulting coarse representation preserves visible features.
    if(mergeFragments){
        const next=labels.slice();let merged=0;
        for(const patch of patches)if(patch.feature&&patch.faces.length<=4){
            const neighbors=new Map();
            for(const f of patch.faces)for(let j=0;j<3;j++)for(const k of edges.get(edgeKey(faces[f][j],faces[f][(j+1)%3])).faces){const other=patches[facePatches[k]];if(other.id!==patch.id&&other.feature===patch.feature&&other.faces.length>4)neighbors.set(other.id,(neighbors.get(other.id)||0)+1);}
            const best=[...neighbors].sort((a,b)=>b[1]-a[1]||a[0]-b[0])[0];if(best){const label=labels[patches[best[0]].faces[0]];patch.faces.forEach(f=>next[f]=label);merged++;}
        }
        if(merged){const result=fractureSurfaceGraph({...source,surfaceLabels:next},{mergeFragments:false});result.mergedFragments=merged;return result;}
    }
    const groups=new Map(),junctions=new Set(),tips=new Set();
    for(const edge of edges.values())if(edge.faces.length!==2||facePatches[edge.faces[0]]!==facePatches[edge.faces[1]]){
        const ids=[...new Set(edge.faces.map(f=>facePatches[f]))].sort((a,b)=>a-b),roles=source.fractureTags[edge.a*4+2]|source.fractureTags[edge.b*4+2],kind=roles&2?'mouth':roles&4?'tip':'wall-boundary',key=ids.join(',')+':'+kind;
        if(roles&4){tips.add(edge.a);tips.add(edge.b);}if(ids.length>=3){junctions.add(edge.a);junctions.add(edge.b);}
        if(!groups.has(key))groups.set(key,{patches:ids,kind,adj:new Map()});const group=groups.get(key);
        for(const [a,b] of [[edge.a,edge.b],[edge.b,edge.a]]){if(!group.adj.has(a))group.adj.set(a,[]);group.adj.get(a).push(b);}
        for(const f of edge.faces)patches[facePatches[f]].boundaries.push([edge.a,edge.b]);
    }
    const paths=[];
    for(const group of groups.values()){
        const seen=new Set(),trace=(a,b)=>{const vertices=[a,b];seen.add(edgeKey(a,b));while(group.adj.get(b)?.length===2){const c=group.adj.get(b).find(v=>v!==a);if(seen.has(edgeKey(b,c)))break;seen.add(edgeKey(b,c));vertices.push(c);a=b;b=c;}paths.push({patches:group.patches,kind:group.kind,vertices,closed:vertices[0]===vertices.at(-1)});};
        for(const [a,neighbors] of group.adj)if(neighbors.length!==2){junctions.add(a);for(const b of neighbors)if(!seen.has(edgeKey(a,b)))trace(a,b);}
        for(const [a,neighbors] of group.adj)for(const b of neighbors)if(!seen.has(edgeKey(a,b)))trace(a,b);
    }
    return {positions,faces,edges,facePatches,patches,paths,junctions,tips};
}

// Patch-conforming QEM: interior vertices move freely; shared boundary vertices
// slide along their edge, and multi-patch junctions remain fixed. Collapse link
// and foldover checks retain the source's local connectivity.
export function simplifyFractureSurfaces(source,target,{wallWeight=4,boundaryWeight=2,faceImportance,protectPatches=true,priority='budget',tolerance=.03}={}) {
    if(!Number.isInteger(target)||target<4)throw Error('Invalid surface triangle target.');
    const graph=fractureSurfaceGraph(source),{patches,facePatches}=graph;
    const nodes=graph.positions.map((p,id)=>({p,q:new Float64Array(10),faces:new Set(),alive:true,version:0,origin:id}));
    const faces=graph.faces.map((v,i)=>({v,patch:facePatches[i],alive:true,origin:i})),remaining=Int32Array.from(patches,p=>p.faces.length);
    let count=faces.length,collapses=0,maxError=0;
    const lo=[Infinity,Infinity,Infinity],hi=[-Infinity,-Infinity,-Infinity];for(const n of nodes)for(let a=0;a<3;a++){lo[a]=Math.min(lo[a],n.p[a]);hi[a]=Math.max(hi[a],n.p[a]);}
    const extent=Math.hypot(...sub(hi,lo)),epsilon=extent*extent*1e-12;
    faces.forEach((face,i)=>{
        let n=normal(...face.v.map(v=>nodes[v].p)),length=Math.hypot(...n);face.v.forEach(v=>nodes[v].faces.add(i));if(length<=epsilon)return;
        n=n.map(x=>x/length);const weight=length/2*(patches[face.patch].feature?wallWeight:1)*(faceImportance?.[i]??1),d=-dot(n,nodes[face.v[0]].p);
        face.v.forEach(v=>plane(nodes[v].q,n,d,weight));
    });
    for(const edge of graph.edges.values())if(edge.faces.length!==2||facePatches[edge.faces[0]]!==facePatches[edge.faces[1]]){
        const a=nodes[edge.a].p,b=nodes[edge.b].p,direction=sub(b,a),length=Math.hypot(...direction);if(!length)continue;
        for(const f of edge.faces){let n=cross(direction,normal(...faces[f].v.map(v=>nodes[v].p))),len=Math.hypot(...n);if(!len)continue;n=n.map(x=>x/len);for(const v of [edge.a,edge.b])plane(nodes[v].q,n,-dot(n,a),length*extent*.01*boundaryWeight);}
    }
    const membership=id=>new Set([...nodes[id].faces].map(f=>faces[f].patch));
    const neighbors=id=>new Set([...nodes[id].faces].flatMap(f=>faces[f].v).filter(v=>v!==id));
    const subset=(a,b)=>[...a].every(x=>b.has(x));
    const heap=new Heap();
    function candidate(a,b){
        if(a>b)[a,b]=[b,a];const na=nodes[a],nb=nodes[b];if(!na.alive||!nb.alive)return;
        const ma=membership(a),mb=membership(b);if(!subset(ma,mb)&&!subset(mb,ma))return;
        const q=Float64Array.from(na.q,(v,i)=>v+nb.q[i]);let choices;
        if(ma.size>=3&&mb.size>=3)return;
        if(ma.size>mb.size||ma.size>=3)choices=[na.p];
        else if(mb.size>ma.size||mb.size>=3)choices=[nb.p];
        else {
            const mid=na.p.map((v,i)=>(v+nb.p[i])/2);choices=[na.p,nb.p,mid];
            if(ma.size>1){
                const e0=error(q,na.p),e1=error(q,nb.p),em=error(q,mid),den=4*(e0+e1-2*em);
                if(den>1e-20){const t=Math.max(0,Math.min(1,(3*e0+e1-4*em)/den));choices.push(na.p.map((v,i)=>v+(nb.p[i]-v)*t));}
            }else{const p=optimum(q);if(p?.every(Number.isFinite)&&Math.hypot(...sub(p,mid))<=Math.hypot(...sub(na.p,nb.p))*2)choices.push(p);}
        }
        const p=choices.reduce((best,p)=>error(q,p)<error(q,best)?p:best).slice();
        return {a,b,p,q,cost:error(q,p),va:na.version,vb:nb.version};
    }
    function enqueue(a,b){const c=candidate(a,b);if(c)heap.push(c);}
    for(const edge of graph.edges.values())enqueue(edge.a,edge.b);
    while(count>target&&heap.values.length){
        const c=heap.pop(),{a,b,p}=c,na=nodes[a],nb=nodes[b];
        if(!na.alive||!nb.alive||na.version!==c.va||nb.version!==c.vb)continue;
        const shared=[...na.faces].filter(f=>nb.faces.has(f));if(shared.length!==2)continue;
        const opposite=new Set(shared.flatMap(f=>faces[f].v).filter(v=>v!==a&&v!==b)),an=neighbors(a),bn=neighbors(b);
        if([...an].filter(v=>bn.has(v)).some(v=>!opposite.has(v))||opposite.size!==2)continue;
        const removed=new Map();shared.forEach(f=>removed.set(faces[f].patch,(removed.get(faces[f].patch)||0)+1));
        if(protectPatches&&[...removed].some(([patch,n])=>remaining[patch]-n<1))continue;
        const affected=new Set([...na.faces,...nb.faces]);let valid=true;
        for(const f of affected){if(shared.includes(f))continue;const face=faces[f],old=face.v.map(v=>nodes[v].p),next=face.v.map(v=>v===a||v===b?p:nodes[v].p),n=normal(...old),nn=normal(...next),length=Math.hypot(...nn);if(length<=epsilon||dot(n,nn)<=.1*Math.hypot(...n)*length){valid=false;break;}}
        if(!valid)continue;
        const relativeError=Math.sqrt(c.cost/Math.max(1e-20,c.q[0]+c.q[4]+c.q[7]))/extent;
        if(priority==='quality'&&relativeError>tolerance)continue;
        maxError=Math.max(maxError,relativeError);
        na.p=p;na.q=c.q;na.version++;nb.version++;nb.alive=false;
        for(const f of affected){const face=faces[f];face.v.forEach(v=>nodes[v].faces.delete(f));if(shared.includes(f)){face.alive=false;remaining[face.patch]--;count--;continue;}face.v=face.v.map(v=>v===b?a:v);face.v.forEach(v=>nodes[v].faces.add(f));}
        nb.faces.clear();collapses++;
        const local=new Set([a,...neighbors(a)]),seen=new Set();
        for(const v of local)for(const w of neighbors(v)){const key=edgeKey(v,w);if(seen.has(key))continue;seen.add(key);enqueue(v,w);}
    }
    const map=new Map(),origins=[],indices=[],patchIds=[],sourceFaces=[];
    for(const face of faces)if(face.alive){for(const v of face.v){if(!map.has(v)){map.set(v,map.size);origins.push(v);}indices.push(map.get(v));}patchIds.push(face.patch);sourceFaces.push(face.origin);}
    const vertices=new Float32Array(map.size*16),weather=source.weather?new Float32Array(map.size*2):null,tags=new Float32Array(map.size*4);
    for(let i=0;i<origins.length;i++){const node=nodes[origins[i]],old=node.origin;vertices.set(source.vertices.subarray(old*16,old*16+16),i*16);vertices.set(node.p,i*16);tags.set(source.fractureTags.subarray(old*4,old*4+4),i*4);if(weather)weather.set(source.weather.subarray(old*2,old*2+2),i*2);}
    return {vertices,indices:new Uint32Array(indices),weather,fractureTags:tags,bounds:source.bounds.slice(),featureKind:source.featureKind,simplifierError:maxError,
        facePatches:new Uint32Array(patchIds),sourceFaces:new Uint32Array(sourceFaces),
        protection:{mode:'surfaces',supported:true,classifier:'generator-v1',lockedVertices:0,openings:{status:'not-checked',failed:0},
            surfaces:{mergedFragments:graph.mergedFragments??0,boundaryPaths:graph.paths.length,mouthPaths:graph.paths.filter(p=>p.kind==='mouth').length,tipVertices:graph.tips.size,junctions:graph.junctions.size,sourceNonManifoldEdges:[...graph.edges.values()].filter(e=>e.faces.length>2).length,
                patches:patches.map((patch,i)=>({id:i,feature:patch.feature,side:patch.side,area:patch.area,sourceTriangles:patch.faces.length,triangles:remaining[i]})),
                sourceBoundaryEdges:[...graph.edges.values()].filter(e=>e.faces.length!==2||facePatches[e.faces[0]]!==facePatches[e.faces[1]]).length,collapses,budgetBlocked:count>target}}};
}
