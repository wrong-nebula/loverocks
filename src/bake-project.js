import {Vector3,Triangle} from 'three';
import {MeshBVH} from 'three-mesh-bvh';
import {geometryFor} from './lod.js';

// Project each atlas texel onto the canonical (moss-displaced) reference.
// Work runs off the UI thread and never changes the source mesh.
export function projectAtlas(source,low,size,progress=()=>{}) {
    const geometry=geometryFor(source),tree=new MeshBVH(geometry,{indirect:true});
    const p=geometry.getAttribute('position'),idx=geometry.index;
    const maps=Array.from({length:7},()=>new Float32Array(size*size*4));
    const occupied=new Uint8Array(size*size),lowIndex=low.indices;
    const point=new Vector3(),closest={point:new Vector3()},bary=new Vector3();
    const a=new Vector3(),b=new Vector3(),c=new Vector3();
    const lp=low.positions,uv=low.uv,n=low.normals,tan=low.tangents;
    let maximumDistance=0,covered=0;
    for(let face=0;face<lowIndex.length;face+=3) {
        const ids=[lowIndex[face],lowIndex[face+1],lowIndex[face+2]];
        const [i,j,k]=ids;
        const ax=uv[i*2]*size,ay=uv[i*2+1]*size,bx=uv[j*2]*size,by=uv[j*2+1]*size,cx=uv[k*2]*size,cy=uv[k*2+1]*size;
        const det=(by-cy)*(ax-cx)+(cx-bx)*(ay-cy);
        if(Math.abs(det)<1e-10)continue;
        const xmin=Math.max(0,Math.floor(Math.min(ax,bx,cx))),xmax=Math.min(size-1,Math.ceil(Math.max(ax,bx,cx)));
        const ymin=Math.max(0,Math.floor(Math.min(ay,by,cy))),ymax=Math.min(size-1,Math.ceil(Math.max(ay,by,cy)));
        for(let y=ymin;y<=ymax;y++)for(let x=xmin;x<=xmax;x++) {
            const u=((by-cy)*(x+.5-cx)+(cx-bx)*(y+.5-cy))/det;
            const v=((cy-ay)*(x+.5-cx)+(ax-cx)*(y+.5-cy))/det,w=1-u-v;
            if(u<0||v<0||w<0)continue;
            const weights=[u,v,w],at=y*size+x,o=at*4;
            point.set(0,0,0);
            for(let z=0;z<3;z++)point.setComponent(z,ids.reduce((s,id,r)=>s+lp[id*3+z]*weights[r],0));
            if(!tree.closestPointToPoint(point,closest))continue;
            maximumDistance=Math.max(maximumDistance,closest.distance);
            const fi=closest.faceIndex*3,si=[idx.getX(fi),idx.getX(fi+1),idx.getX(fi+2)];
            a.fromBufferAttribute(p,si[0]);b.fromBufferAttribute(p,si[1]);c.fromBufferAttribute(p,si[2]);
            Triangle.getBarycoord(closest.point,a,b,c,bary);
            const sw=[bary.x,bary.y,bary.z];
            const read=channel=>si.reduce((s,id,r)=>s+source.vertices[id*16+channel]*sw[r],0);
            maps[0].set([closest.point.x,closest.point.y,closest.point.z,read(15)],o);
            maps[1].set([read(3),read(4),read(5),read(13)],o);
            maps[2].set([read(6),read(7),read(8),read(14)],o);
            maps[3].set([read(9),read(10),read(11),read(12)],o);
            maps[4].set([source.weather?si.reduce((s,id,r)=>s+source.weather[id*2]*sw[r],0):0,
                source.weather?si.reduce((s,id,r)=>s+source.weather[id*2+1]*sw[r],0):1,0,1],o);
            for(let z=0;z<3;z++) {
                maps[5][o+z]=ids.reduce((s,id,r)=>s+n[id*3+z]*weights[r],0);
                maps[6][o+z]=ids.reduce((s,id,r)=>s+tan[id*4+z]*weights[r],0);
            }
            maps[5][o+3]=tan[i*4+3];
            occupied[at]=1;covered++;
        }
        if(face%300===0)progress(Math.round(face/lowIndex.length*100));
    }
    // Extend attributes into chart gutters before differentiating the procedural
    // material. Also protects mip levels from black UV seams.
    let filled=occupied.slice();
    for(let pass=0;pass<8;pass++) {
        const next=filled.slice();
        for(let y=0;y<size;y++)for(let x=0;x<size;x++) {
            const at=y*size+x;if(filled[at])continue;
            const neighbors=[x>0?at-1:-1,x<size-1?at+1:-1,y>0?at-size:-1,y<size-1?at+size:-1];
            const near=neighbors.find(v=>v>=0&&filled[v]);if(near===undefined)continue;
            for(const map of maps)map.set(map.subarray(near*4,near*4+4),at*4);
            next[at]=1;
        }
        filled=next;
    }
    geometry.dispose();
    return {maps,size,maximumDistance,coverage:covered/(size*size)};
}
