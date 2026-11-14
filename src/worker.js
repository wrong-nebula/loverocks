import init, {generate,SurfaceIndex} from './wasm/fjord_engine.js';
import {growMoss,mossVolume} from './moss.js';

const ready=init();

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
            if(job.moss) mossVolume(vertices,indices,growMoss(vertices,indices,job.moss));
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
