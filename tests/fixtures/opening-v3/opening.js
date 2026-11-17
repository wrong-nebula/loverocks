import {BufferGeometry,BufferAttribute,Vector3,Ray,FrontSide} from 'three';
import {MeshBVH} from 'three-mesh-bvh';
import {fractureSemantics} from '../../../src/fracture-semantics.js';
import {openingRegions} from '../../../src/opening-acceptance.js';

// CPU perspective witnesses, independently checked by the GPU visual suite.
// Region identities come from the reference, never from the reduced mesh.
const SIZE=128,WIDTH=SIZE+16,cache=new WeakMap();
const quantile=a=>a.length?a.sort((x,y)=>x-y)[Math.min(a.length-1,Math.floor(a.length*.95))]:Infinity;
export function openingWitnesses(source,geometry) {
    if(cache.has(source)){const c=cache.get(source);c.geometry=geometry;return c;}
    const semantic=fractureSemantics(source);if(!semantic?.features.size)return null;
    geometry.computeBoundingSphere();const sphere=geometry.boundingSphere,diameter=2*sphere.radius;
    const angle=Math.atan(SIZE/WIDTH*Math.tan(40*Math.PI/360)),distance=sphere.radius/Math.sin(angle),front=distance-sphere.radius;
    const ray=new Ray(),right=new Vector3(),up=new Vector3(),forward=new Vector3(),worldUp=new Vector3(0,1,0),views=[];
    for(const elevation of [.15,.65])for(let a=0;a<8;a++) {
        const azimuth=a*Math.PI/4;
        forward.set(Math.sin(azimuth)*Math.cos(elevation),Math.sin(elevation),Math.cos(azimuth)*Math.cos(elevation));
        right.crossVectors(worldUp,forward).normalize();up.crossVectors(forward,right);
        const origin=sphere.center.clone().addScaledVector(forward,distance),count=WIDTH*WIDTH;
        const directions=new Float32Array(count*12),distances=new Float32Array(count*4),faces=new Int32Array(count*4).fill(-1),cosines=new Float32Array(count*4);
        const frame={silhouette:new Uint8Array(count*4),semantic:new Uint8Array(count*4),depth:new Float32Array(count)};
        ray.origin.copy(origin);
        for(let y=0;y<WIDTH;y++)for(let x=0;x<WIDTH;x++) {
            const pixel=y*WIDTH+x,votes=new Map();let hits=0,depth=0;
            for(let sy=0;sy<2;sy++)for(let sx=0;sx<2;sx++) {
                const sample=pixel*4+sy*2+sx,px=(2*(x+(sx+.5)/2)/WIDTH-1)*Math.tan(40*Math.PI/360),py=(2*(y+(sy+.5)/2)/WIDTH-1)*Math.tan(40*Math.PI/360);
                ray.direction.copy(forward).negate().addScaledVector(right,px).addScaledVector(up,py).normalize();
                directions.set(ray.direction.toArray(),sample*3);cosines[sample]=-ray.direction.dot(forward);
                const hit=geometry.boundsTree.raycastFirst(ray,FrontSide,0,diameter*3);let key=0;
                if(hit) {
                    hits++;distances[sample]=hit.distance;faces[sample]=hit.faceIndex;
                    depth+=(hit.distance*cosines[sample]-front)/diameter/4;
                    key=semantic.ids[hit.faceIndex]+(semantic.sides[hit.faceIndex]+1)*65536;
                }
                votes.set(key,(votes.get(key)??0)+1);
            }
            frame.silhouette[pixel*4]=Math.round(hits*255/4);frame.depth[pixel]=depth;
            const [key,votesCount]=[...votes].sort((a,b)=>b[1]-a[1]||a[0]-b[0])[0];
            if(votesCount>=3){frame.semantic[pixel*4]=key%256;frame.semantic[pixel*4+1]=Math.floor(key/256)%256;frame.semantic[pixel*4+2]=Math.floor(key/65536);}
        }
        const grouped=openingRegions(frame,WIDTH,WIDTH),regions=[];
        let component=0;
        for(const [kind,list] of [['gap',grouped.gaps],['depth',grouped.walls]])for(const group of list) {
            const id=kind==='gap'?group.label:Math.floor(group.label/3),pixels=group.pixels;
            const samples=pixels;
            regions.push({id,component:component++,kind,pixels:pixels.length,samples,side:kind==='depth'?group.label%3-1:0});
        }
        views.push({name:`${elevation}/${a}`,origin:origin.toArray(),directions,distances,faces,cosines,frame,regions,front});
    }
    const faceVertices=face=>Array.from(source.indices.subarray(face*3,face*3+3));
    const incident=Array.from({length:source.vertices.length/16},()=>[]);
    for(let face=0;face<source.indices.length/3;face++)for(const vertex of faceVertices(face))incident[vertex].push(face);
    const context={semantic,diameter,step:diameter/SIZE,source,geometry,views,faceVertices,incident};cache.set(source,context);return context;
}
function referencePoints(context,view,pixel,id,kind) {
    const indices=[];
    if(kind==='depth')indices.push(pixel);
    else {
        const x=pixel%WIDTH,y=Math.floor(pixel/WIDTH),near=[];
        for(let dy=-3;dy<=3;dy++)for(let dx=-3;dx<=3;dx++)if(x+dx>=0&&x+dx<WIDTH&&y+dy>=0&&y+dy<WIDTH) {
            const at=(y+dy)*WIDTH+x+dx;
            if(view.frame.semantic[at*4]+view.frame.semantic[at*4+1]*256===id)near.push({at,d:dx*dx+dy*dy,side:view.frame.semantic[at*4+2]});
        }
        near.sort((a,b)=>a.d-b.d||a.at-b.at);
        for(const side of [0,2]){const p=near.find(p=>p.side===side);if(p)indices.push(p.at);}
        if(!indices.length&&near.length)indices.push(near[0].at);
    }
    const faces=[],points=[];
    for(const at of indices)for(let s=0;s<4;s++) {
        const sample=at*4+s,face=view.faces[sample];if(face<0||faces.includes(face))continue;
        const p=new Vector3().fromArray(view.origin).addScaledVector(new Vector3().fromArray(view.directions,sample*3),view.distances[sample]);
        faces.push(face);points.push(p.toArray());
    }
    return {faces,points};
}
export function inspectOpenings(context,positions,indices,viewingSize=128) {
    if(!context)return {status:'unavailable',tested:0,failed:0,failures:[],openings:[]};
    const geometry=new BufferGeometry();geometry.setAttribute('position',new BufferAttribute(positions,3));geometry.setIndex(new BufferAttribute(indices,1));
    const bvh=new MeshBVH(geometry,{indirect:true}),ray=new Ray(),failures=[],openings=[];let tested=0;
    const scale=(viewingSize/SIZE)**2;
    try {
        for(const view of context.views) {
            ray.origin.fromArray(view.origin);const pixelCache=new Map();
            const samplePixel=pixel=>{
                if(pixelCache.has(pixel))return pixelCache.get(pixel);
                let hits=0,depth=0,point,worst=-1;
                for(let s=0;s<4;s++) {
                    const at=pixel*4+s;ray.direction.fromArray(view.directions,at*3);
                    const hit=bvh.raycastFirst(ray,FrontSide,0,context.diameter*3);
                    if(hit){
                        hits++;depth+=(hit.distance*view.cosines[at]-view.front)/context.diameter/4;
                        const error=Math.abs(hit.distance-view.distances[at]);
                        if(error>worst){worst=error;point=hit.point.toArray();}
                    }
                }
                const value={hits,depth,point};pixelCache.set(pixel,value);return value;
            };
            for(const region of view.regions) {
                if(region.pixels*scale<(region.kind==='gap'?4:8))continue;
                let filled=0,missing=0;const errors=[],bad=[];
                for(const pixel of region.samples) {
                    tested++;const hit=samplePixel(pixel);
                    if(region.kind==='gap') {
                        if(hit.hits>=2){filled++;bad.push({pixel,error:Infinity,point:hit.point});}
                    }else {
                        if(hit.hits<4){missing++;bad.push({pixel,error:Infinity,point:hit.point});}
                        else {
                            const error=Math.abs(hit.depth-view.frame.depth[pixel])*viewingSize;errors.push(error);
                            if(error>1.75)bad.push({pixel,error,point:hit.point});
                        }
                    }
                }
                const p95=quantile(errors),allowedGap=Math.max(1/scale,Math.floor(region.pixels*.1));
                const allowedMissing=Math.max(2/scale,region.samples.length*.08);
                const failed=region.kind==='gap'?filled>allowedGap:missing>allowedMissing||p95>1.75;
                openings.push({id:region.id,view:view.name,component:region.component,kind:region.kind,referencePixels:region.pixels,
                    samples:region.samples.length,filledPixels:filled,missingPixels:missing,depthP95Px:Number.isFinite(p95)?p95:null,accepted:!failed});
                if(failed)for(const item of bad) {
                    const refs=referencePoints(context,view,item.pixel,region.id,region.kind);
                    if(refs.faces.length)failures.push({id:region.id,view:view.name,component:region.component,kind:region.kind,...refs,...item});
                }
            }
        }
    }finally{geometry.dispose();}
    const failedRegions=openings.filter(o=>!o.accepted).length;
    return {status:failedRegions?'needs-review':openings.length?'passed':'not-visible',tested,failed:failedRegions,failedSamples:failures.length,failures,viewingSize,openings};
}
export function constrainOpeningFailures(context,result,protection,pass) {
    const groups=new Map(),v=context.source.vertices;
    for(const failure of result.failures) {
        const key=`${failure.id}/${failure.view}/${failure.component}/${failure.kind}`;
        if(!groups.has(key))groups.set(key,[]);groups.get(key).push(failure);
    }
    const distance=(a,b)=>a.reduce((sum,x,i)=>sum+(x-b[i])**2,0);
    const representatives=[],dense=pass>=4,perRegion=dense?512:4;
    // Round-robin across openings prevents one long joint spending the entire
    // batch. Within each opening spread constraints over distinct bad regions.
    for(const list of groups.values()) {
        list.sort((a,b)=>a.error===b.error?0:b.error>a.error?1:-1);
        const selected=[];
        for(const failure of list) {
            const point=failure.points[0];
            if(selected.every(s=>distance(s.points[0],point)>(context.step*(dense?.5:4))**2))selected.push(failure);
            if(selected.length===perRegion)break;
        }
        representatives.push(selected);
    }
    let added=0,used=0;
    const pin=(face,point)=>{
        const ids=context.faceVertices(face).sort((a,b)=>distance(Array.from(v.subarray(a*16,a*16+3)),point)-distance(Array.from(v.subarray(b*16,b*16+3)),point));
        const id=ids.find(i=>!protection.locks[i]);
        if(pass<2) {
            if(id!==undefined){protection.locks[id]=1;protection.supportPatches.set(id,context.faceVertices(face));added++;}
        }else {
            const patchFaces=new Set([face]);
            if(pass>=4)for(let ring=0;ring<Math.max(1,pass-4);ring++)for(const f of [...patchFaces])for(const vertex of context.faceVertices(f))for(const adjacent of context.incident[vertex])patchFaces.add(adjacent);
            for(const f of patchFaces) {
                const patch=context.faceVertices(f);
                for(const vertex of patch)if(!protection.locks[vertex]){protection.locks[vertex]=1;added++;}
                protection.supportFaces.push(patch);
            }
        }
    };
    for(let round=0;round<perRegion;round++)for(const group of representatives) {
        const failure=group[round];if(!failure||used>=(dense?512:32))continue;used++;
        failure.faces.forEach((face,i)=>pin(face,failure.points[i]));
        // A closer false surface can occlude an already-fixed source patch.
        // Constrain the source near that obstruction as well as the cavity wall.
        if(pass>0&&failure.point) {
            const hit={point:new Vector3()};
            context.geometry.boundsTree.closestPointToPoint(new Vector3().fromArray(failure.point),hit);
            if(hit.faceIndex!==undefined)pin(hit.faceIndex,hit.point.toArray());
        }
    }
    protection.stats.lockedVertices=protection.locks.reduce((sum,x)=>sum+x,0);
    protection.stats.repairVertices=(protection.stats.repairVertices??0)+added;
    return added;
}
export function openingSummary(result,passes) {
    const {failures,...summary}=result;return {...summary,passes};
}
