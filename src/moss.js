// Moss placement by growth rather than noise.
//
// 1. Habitat: every vertex gets a suitability score from where moss actually
//    thrives: surfaces that hold water and debris (tops, ledges, the damp
//    base), faces turned away from the sun, sheltered crevices and wet rock.
//    Fresh fracture faces and overhangs stay bare.
// 2. Spores: a jittered 3D grid of landing points (independent of mesh
//    resolution) seeds colonies where the habitat lets them take hold.
// 3. Growth: colonies spread from their seeds across the surface. Travel cost is
//    real distance divided by habitat, so moss runs over damp shaded rock,
//    creeps over dry faces and stops at bare ones. Older colonies get further.
// 4. Thickness follows age: cushions are thickest at a colony's old centre and
//    thin out at the growing edge.
//
// Vertex layout (16 floats): position 0-2, normal 3-5, colour 6-8,
// surfaceData 9-12 (roughness, wet, moss, lichen), fresh 13, signal 14, AO 15.
const STRIDE=16, WET=10, MOSS=11, LICHEN=12, FRESH=13, AO=15;

function hash(x,y,z) {
    let h=Math.imul(x|0,374761393)^Math.imul(y|0,668265263)^Math.imul(z|0,2147483647);
    h=Math.imul(h^(h>>>13),1274126177);
    return ((h^(h>>>16))>>>0)/4294967296;
}
function noise(x,y,z) {
    const ix=Math.floor(x),iy=Math.floor(y),iz=Math.floor(z);
    const fx=x-ix,fy=y-iy,fz=z-iz;
    const u=fx*fx*(3-2*fx),v=fy*fy*(3-2*fy),w=fz*fz*(3-2*fz);
    const lerp=(a,b,t)=>a+(b-a)*t;
    const plane=dz=>lerp(
        lerp(hash(ix,iy,iz+dz),hash(ix+1,iy,iz+dz),u),
        lerp(hash(ix,iy+1,iz+dz),hash(ix+1,iy+1,iz+dz),u),v);
    return lerp(plane(0),plane(1),w);
}
const smooth=(a,b,x)=>{const t=Math.min(1,Math.max(0,(x-a)/(b-a)));return t*t*(3-2*t);};

// Binary min-heap keyed by Float64 cost, storing vertex indices.
class Heap {
    constructor(){this.keys=[];this.items=[];}
    get size(){return this.items.length;}
    push(key,item){
        const k=this.keys,it=this.items;let i=it.length;k.push(key);it.push(item);
        while(i>0){const p=(i-1)>>1;if(k[p]<=k[i])break;[k[p],k[i]]=[k[i],k[p]];[it[p],it[i]]=[it[i],it[p]];i=p;}
    }
    pop(){
        const k=this.keys,it=this.items,top=it[0],topKey=k[0],lastK=k.pop(),lastI=it.pop();
        if(it.length){
            k[0]=lastK;it[0]=lastI;let i=0;const n=it.length;
            for(;;){const l=2*i+1,r=l+1;let m=i;
                if(l<n&&k[l]<k[m])m=l; if(r<n&&k[r]<k[m])m=r; if(m===i)break;
                [k[m],k[i]]=[k[i],k[m]];[it[m],it[i]]=[it[i],it[m]];i=m;}
        }
        this.lastKey=topKey;return top;
    }
}

function habitatOf(vertices,count,sun,salt) {
    let yMin=Infinity;
    for(let i=0;i<count;i++) yMin=Math.min(yMin,vertices[i*STRIDE+1]);
    const habitat=new Float32Array(count);
    for(let i=0;i<count;i++){
        const o=i*STRIDE, x=vertices[o], y=vertices[o+1], z=vertices[o+2];
        const nx=vertices[o+3], ny=vertices[o+4], nz=vertices[o+5];
        const catchment=Math.max(smooth(-.15,.75,ny),1-smooth(0,.45,y-yMin));   // tops, ledges, damp base
        const shade=1-smooth(-.2,.7,nx*sun[0]+ny*sun[1]+nz*sun[2]);             // away from the sun
        const crevice=smooth(0,.45,1-vertices[o+AO]);                            // sheltered hollows
        const wet=vertices[o+WET];
        const micro=noise(x*3.1+salt,y*3.1+7,z*3.1+3);
        const h=.34*catchment+.22*shade+.16*crevice+.28*wet+.26*(micro-.5);
        const overhang=smooth(-.6,-.22,ny);                                      // no water reaches under
        habitat[i]=Math.min(1,Math.max(0,h))*overhang*(1-.92*vertices[o+FRESH]);
    }
    return habitat;
}

function adjacency(indices,count) {
    const degree=new Uint32Array(count+1);
    for(let t=0;t<indices.length;t+=3) for(let e=0;e<3;e++){degree[indices[t+e]]+=2;}
    const start=new Uint32Array(count+1);
    for(let i=0;i<count;i++) start[i+1]=start[i]+degree[i];
    const fill=start.slice(0,count), next=new Uint32Array(start[count]);
    for(let t=0;t<indices.length;t+=3){
        const a=indices[t],b=indices[t+1],c=indices[t+2];
        next[fill[a]++]=b;next[fill[a]++]=c;
        next[fill[b]++]=a;next[fill[b]++]=c;
        next[fill[c]++]=a;next[fill[c]++]=b;
    }
    return {start,next};
}

/**
 * Grow moss over a mesh in place: writes coverage to the moss channel, thins
 * lichen under it, and returns per-vertex colony depth (for cushion thickness)
 * and distance inside the colony front (for the rounded rim).
 * amount: the Moss slider (0..1). years: elapsed years. sun: unit direction.
 */
export function growMoss(vertices,indices,{amount,years,sun,seed}) {
    const count=vertices.length/STRIDE;
    const depth=new Float32Array(count), inner=new Float32Array(count);
    for(let i=0;i<count;i++) vertices[i*STRIDE+MOSS]=0;
    if(!(amount>.004)) return {depth,inner};
    const salt=(seed%997)*.37;
    const habitat=habitatOf(vertices,count,sun,salt);
    const {start,next}=adjacency(indices,count);

    const heap=new Heap(), cost=new Float64Array(count).fill(Infinity);
    const growth=(.35+2.2*amount)*(.75+.25*Math.min(1,years/600));
    // Spores land on a jittered grid (independent of mesh resolution); each one
    // that takes hold claims its nearest vertex and starts a colony with a head
    // start set by its age.
    const sow=(cell,odds,budget,offset)=>{
        const grid=new Map();
        for(let i=0;i<count;i++){
            const o=i*STRIDE;
            const key=`${Math.floor(vertices[o]/cell)},${Math.floor(vertices[o+1]/cell)},${Math.floor(vertices[o+2]/cell)}`;
            let list=grid.get(key); if(!list) grid.set(key,list=[]); list.push(i);
        }
        for(const [key,list] of grid){
            const [gx,gy,gz]=key.split(',').map(Number);
            const sx=gx+offset, sy=gy+seed, sz=gz-offset;
            const spore=[(gx+hash(sx,sy,gz))*cell,(gy+hash(sx+3,gy,sz))*cell,(gz+hash(gx,sy+5,sz))*cell];
            let best=-1,bestD=Infinity;
            for(const i of list){
                const o=i*STRIDE, d=(vertices[o]-spore[0])**2+(vertices[o+1]-spore[1])**2+(vertices[o+2]-spore[2])**2;
                if(d<bestD){bestD=d;best=i;}
            }
            if(hash(sx*7,sy*13+11,sz*17+5)>=odds(habitat[best])) continue;
            const head=-budget*(.35+.65*hash(sx*3,sy+29,sz+31));
            if(head<cost[best]){cost[best]=head;heap.push(head,best);}
        }
    };
    // Main colonies, then small satellite tufts scattered around good habitat.
    sow(.3,h=>h*h*(.30+.95*amount),growth,0);
    sow(.11,h=>h*h*h*(.10+.45*amount),growth*.16,101);

    // Habitat-weighted geodesic spread from every colony at once. It runs a
    // little past each front (the halo) so the shader can draw the margin.
    const HALO=.12;
    while(heap.size){
        const i=heap.pop(), c=heap.lastKey;
        if(c>cost[i]) continue;
        if(c>=HALO) break;
        const oi=i*STRIDE;
        for(let k=start[i];k<start[i+1];k++){
            const j=next[k];
            const oj=j*STRIDE;
            const len=Math.hypot(vertices[oj]-vertices[oi],vertices[oj+1]-vertices[oi+1],vertices[oj+2]-vertices[oi+2]);
            const h=.5*(habitat[i]+habitat[j]);
            if(h<.08) continue;                               // bare rock stops the front
            // Uneven ground: the front advances in fingers rather than a smooth circle.
            const rough=.6+.55*noise(vertices[oj]*9+salt,vertices[oj+1]*9+4,vertices[oj+2]*9+8)
                +.45*noise(vertices[oj]*23+salt,vertices[oj+1]*23+9,vertices[oj+2]*23+2);
            const step=len*rough/Math.pow(.12+h,1.6);
            const nc=c+step;
            if(nc<cost[j]){cost[j]=nc;heap.push(nc,j);}
        }
    }

    for(let i=0;i<count;i++){
        if(!(cost[i]<HALO)) continue;
        const o=i*STRIDE;
        if(cost[i]>=0){
            // Outside the front: a faint value (< .2) that never grows a cushion
            // but marks the damp margin where stray tufts can take hold.
            vertices[o+MOSS]=.2*(1-cost[i]/HALO)*smooth(.03,.22,habitat[i]);
            continue;
        }
        const inside=-cost[i];
        const fray=.05*(noise(vertices[o]*17+salt,vertices[o+1]*17+6,vertices[o+2]*17+1)-.5);
        const cover=(.2+.8*smooth(0,.035,inside+fray))*smooth(.03,.22,habitat[i]);
        vertices[o+MOSS]=cover;
        vertices[o+LICHEN]*=1-.94*cover;
        depth[i]=smooth(0,.6,inside)*cover;
        inner[i]=inside+fray;
    }
    return {depth,inner};
}

/**
 * Moss has real volume: push the surface out along its normal into soft,
 * lumpy cushions (thickest at old colony centres) and rebuild those normals.
 */
export function mossVolume(vertices,indices,{depth,inner}) {
    const count=vertices.length/STRIDE;
    let any=false;
    for(let i=0;i<count;i++) {
        const m=vertices[i*STRIDE+MOSS];
        if(m<=.02) continue;
        const o=i*STRIDE, x=vertices[o], y=vertices[o+1], z=vertices[o+2];
        const clump=.5*noise(x*6+11,y*6+3,z*6+5)+.32*noise(x*15+2,y*15+7,z*15+13)+.18*noise(x*27+8,y*27+1,z*27+4);
        // Rounded rim: the cushion rises steeply at the front and rolls over into
        // its top, like a pillow edge, instead of a straight ramp.
        const rim=Math.sqrt(smooth(0,.09,inner[i]));
        const h=rim*smooth(.05,.3,m)*(.010+.020*depth[i]+.030*clump*(.5+.5*depth[i]));
        if(h<=0) continue;
        any=true;
        for(let a=0;a<3;a++) vertices[o+a]+=vertices[o+3+a]*h;
    }
    if(!any) return;
    const normals=new Float32Array(count*3);
    for(let t=0;t<indices.length;t+=3) {
        const a=indices[t]*STRIDE,b=indices[t+1]*STRIDE,c=indices[t+2]*STRIDE;
        const e1x=vertices[b]-vertices[a],e1y=vertices[b+1]-vertices[a+1],e1z=vertices[b+2]-vertices[a+2];
        const e2x=vertices[c]-vertices[a],e2y=vertices[c+1]-vertices[a+1],e2z=vertices[c+2]-vertices[a+2];
        const nx=e1y*e2z-e1z*e2y,ny=e1z*e2x-e1x*e2z,nz=e1x*e2y-e1y*e2x;
        for(const k of [indices[t],indices[t+1],indices[t+2]]) {normals[k*3]+=nx;normals[k*3+1]+=ny;normals[k*3+2]+=nz;}
    }
    for(let i=0;i<count;i++) {
        const w=smooth(0,.15,vertices[i*STRIDE+MOSS]);
        if(w<=0) continue;
        const o=i*STRIDE;
        let nx=normals[i*3],ny=normals[i*3+1],nz=normals[i*3+2];
        const len=Math.hypot(nx,ny,nz)||1;
        // Keep the face-normal orientation consistent with the engine's normals.
        const sign=nx*vertices[o+3]+ny*vertices[o+4]+nz*vertices[o+5]<0?-1:1;
        nx=vertices[o+3]+(sign*nx/len-vertices[o+3])*w;
        ny=vertices[o+4]+(sign*ny/len-vertices[o+4])*w;
        nz=vertices[o+5]+(sign*nz/len-vertices[o+5])*w;
        const l2=Math.hypot(nx,ny,nz)||1;
        vertices[o+3]=nx/l2; vertices[o+4]=ny/l2; vertices[o+5]=nz/l2;
    }
}
