import init, {generate,SurfaceIndex} from './wasm/fjord_engine.js';

const ready=init();

// Vertex layout (16 floats): position 0-2, normal 3-5, colour 6-8,
// surfaceData 9-12 (roughness, wet, moss, lichen), fresh 13, signal 14, AO 15.
const STRIDE=16, MOSS=11;

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

// Moss has real volume: push the surface out along its normal into soft,
// lumpy cushions wherever the engine grew moss, then rebuild those normals.
function mossVolume(vertices,indices) {
    const count=vertices.length/STRIDE;
    const lift=new Float32Array(count);
    let any=false;
    for(let i=0;i<count;i++) {
        const m=vertices[i*STRIDE+MOSS];
        if(m<=.02) continue;
        const o=i*STRIDE, x=vertices[o], y=vertices[o+1], z=vertices[o+2];
        const clump=.5*noise(x*6+11,y*6+3,z*6+5)+.32*noise(x*15+2,y*15+7,z*15+13)+.18*noise(x*27+8,y*27+1,z*27+4);
        // Dense cushions: thick, with fairly abrupt edges where they meet bare rock.
        const h=smooth(.16,.42,m)*(.014+.046*clump);
        if(h<=0) continue;
        lift[i]=h; any=true;
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

function meshWeather(vertices,indices) {
    const count=vertices.length/16;
    const positions=new Float32Array(count*3);
    const normals=new Float32Array(count*3);
    for(let i=0;i<count;i++){
        for(let axis=0;axis<3;axis++){
            positions[i*3+axis]=vertices[i*16+axis];
            normals[i*3+axis]=vertices[i*16+3+axis];
        }
    }
    const surface=new SurfaceIndex(positions,indices);
    try {
        return surface.weather(normals);
    } finally {
        surface.free();
    }
}

self.onmessage=async ({data})=>{
    const {id,jobs}=data;
    try {
        await ready;
        for (const [index,job] of jobs.entries()) {
            const mesh=generate(job.form,job.seed,job.resolution,new Float32Array(job.options));
            const vertices=mesh.vertices(), indices=mesh.indices(), bounds=mesh.bounds();
            mesh.free();
            mossVolume(vertices,indices);
            const weather=job.meshWeather?meshWeather(vertices,indices):null;
            const buffers=[vertices.buffer,indices.buffer,bounds.buffer];
            if(weather) buffers.push(weather.buffer);
            self.postMessage({id,index,vertices,indices,bounds,weather},buffers);
        }
        self.postMessage({id,done:true});
    } catch (error) {
        self.postMessage({id,error:String(error)});
    }
};
