import {generate,SurfaceIndex} from './wasm/fjord_engine.js';
import {growMoss,mossVolume} from './moss.js';

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

// Call after initializing the Wasm engine. Shared by studio and automation.
export function generateSource(job) {
    const mesh=generate(job.form,job.seed,job.resolution,new Float32Array(job.options));
    let vertices,indices,bounds,tags;
    try {vertices=mesh.vertices();indices=mesh.indices();bounds=mesh.bounds();tags=mesh.fracture_tags();}
    finally {mesh.free();}
    if(job.moss)mossVolume(vertices,indices,growMoss(vertices,indices,job.moss));
    const weather=job.meshWeather?meshWeather(vertices,indices):null;
    return {vertices,indices,bounds,weather,fractureTags:tags.length?tags:null,featureKind:job.form<4?'fjord-fractures':null};
}
