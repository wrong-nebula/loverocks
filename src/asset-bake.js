import * as T from 'three';
import {UVUnwrapper} from 'xatlas-three';
import {GLTFExporter} from 'three/addons/exporters/GLTFExporter.js';
import {zipSync,strToU8} from 'fflate';
import {repairDegenerateTangents} from './bake-tangents.js';

let unwrapper,loading;
const bakePrograms=new WeakMap();
async function unwrap(geometry,size) {
    if(!unwrapper) {
        unwrapper=new UVUnwrapper({BufferAttribute:T.BufferAttribute});
        const base=new URL(import.meta.env.BASE_URL+'vendor/xatlas/',location.href).href;
        loading=unwrapper.loadLibrary(()=>{},base+'xatlas.wasm',base+'xatlas.js');
    }
    await loading;
    unwrapper.packOptions={padding:8,resolution:size,bilinear:true,rotateCharts:true};
    const atlas=await unwrapper.unwrapGeometry(geometry);
    if(atlas.atlasCount!==1)throw Error('UVs did not fit in one texture. Use a larger bake size.');
    // xatlas-three marks float normals normalized and adds a redundant uv2.
    // glTF forbids normalized FLOAT accessors; all maps use our one UV set.
    geometry.attributes.normal.normalized=false;
    geometry.deleteAttribute('uv2');
    geometry.normalizeNormals();
    geometry.computeTangents();
    repairDegenerateTangents(geometry);
}
function plainGeometry(mesh) {
    const geometry=new T.BufferGeometry(),count=mesh.vertices.length/16;
    for(const [name,offset,width] of [['position',0,3],['normal',3,3]]) {
        const array=new Float32Array(count*width);
        for(let i=0;i<count;i++)array.set(mesh.vertices.subarray(i*16+offset,i*16+offset+width),i*width);
        geometry.setAttribute(name,new T.BufferAttribute(array,width));
    }
    geometry.setIndex(new T.BufferAttribute(mesh.indices.slice(),1));
    return geometry;
}
function project(source,geometry,size,progress,signal) {
    return new Promise((resolve,reject)=>{
        const worker=new Worker(new URL('./bake-worker.js',import.meta.url),{type:'module'});
        const finish=(error,result)=>{worker.terminate();signal?.removeEventListener('abort',abort);error?reject(error):resolve(result);};
        const abort=()=>finish(new DOMException('Bake cancelled','AbortError'));
        if(signal?.aborted){abort();return;}
        signal?.addEventListener('abort',abort,{once:true});
        worker.onerror=e=>finish(Error(e.message));
        worker.onmessage=({data})=>{
            if(data.error)finish(Error(data.error));
            else if(data.maps)finish(null,data);
            else progress(`Projecting reference detail · ${data.progress}%`);
        };
        worker.postMessage({source,size,low:{positions:geometry.attributes.position.array,normals:geometry.attributes.normal.array,
            tangents:geometry.attributes.tangent.array,uv:geometry.attributes.uv.array,indices:geometry.index.array}});
    });
}
function extractBlock(shader,start,end) {
    const a=shader.indexOf(start),b=shader.indexOf(end,a);
    if(a<0||b<0)throw Error('The rock material changed; the baker needs an updated shader adapter.');
    return shader.slice(a+start.length,b);
}
function canvasFromPixels(bytes,size) {
    const canvas=document.createElement('canvas');canvas.width=canvas.height=size;
    const ctx=canvas.getContext('2d'),pixels=new Uint8ClampedArray(bytes.length);
    for(let y=0;y<size;y++)pixels.set(bytes.subarray(y*size*4,(y+1)*size*4),(size-1-y)*size*4);
    ctx.putImageData(new ImageData(pixels,size,size),0,0);return canvas;
}
function bakeMaps(renderer,material,projection) {
    const shader={uniforms:T.UniformsUtils.clone(T.ShaderLib.physical.uniforms),vertexShader:T.ShaderLib.physical.vertexShader,fragmentShader:T.ShaderLib.physical.fragmentShader};
    material.onBeforeCompile(shader,renderer);
    const code=shader.fragmentShader;
    const prefix=code.slice(0,code.indexOf('#define STANDARD')).replace(/\bvarying\s+/g,'');
    const colour=extractBlock(code,'#include <color_fragment>','#include <alphamap_fragment>');
    const rough=extractBlock(code,'#include <roughnessmap_fragment>','#include <metalnessmap_fragment>');
    const normal=extractBlock(code,'#include <normal_fragment_maps>','#include <clearcoat_normal_fragment_begin>');
    const textures=projection.maps.map(data=>{
        const t=new T.DataTexture(data,projection.size,projection.size,T.RGBAFormat,T.FloatType);t.needsUpdate=true;return t;
    });
    let uniforms={...shader.uniforms,mode:{value:0},bakeSize:{value:projection.size}};
    textures.forEach((t,i)=>uniforms['atlas'+i]={value:t});
    let bakeMaterial=new T.ShaderMaterial({uniforms,depthTest:false,depthWrite:false,
        vertexShader:'void main(){gl_Position=vec4(position.xy,0.,1.);}',
        fragmentShader:`${prefix}
        uniform sampler2D atlas0,atlas1,atlas2,atlas3,atlas4,atlas5,atlas6;
        uniform float bakeSize; uniform int mode;
        vec3 vViewPosition;
        vec3 toSRGB(vec3 c){return mix(c*12.92,1.055*pow(max(c,vec3(0.)),vec3(1./2.4))-.055,step(vec3(.0031308),c));}
        void main(){
            vec2 uv=gl_FragCoord.xy/bakeSize;
            vec4 p=texture2D(atlas0,uv),n=texture2D(atlas1,uv),c=texture2D(atlas2,uv),weather=texture2D(atlas4,uv);
            if(weather.w<.5){gl_FragColor=vec4(mode==1?vec3(.5,.5,1.):vec3(0.),1.);return;}
            vRockPoint=p.xyz;vRockNormal=normalize(n.xyz);vFresh=n.w;vEdgeTransmission=c.w;
            vSurface=texture2D(atlas3,uv);vMeshWeather=weather.xy;vRockAO=p.w;vRockNormalMatrix=mat3(1.);
            vViewPosition=-p.xyz;
            vec4 diffuseColor=vec4(c.rgb,1.);
            ${colour}
            float roughnessFactor=1.;
            ${rough}
            vec3 normal=vRockNormal;
            ${normal}
            vec4 ln=texture2D(atlas5,uv),lt=texture2D(atlas6,uv);
            vec3 N=normalize(ln.xyz),T=normalize(lt.xyz-N*dot(N,lt.xyz)),B=cross(N,T)*ln.w;
            vec3 tangentNormal=normalize(vec3(dot(normal,T),dot(normal,B),dot(normal,N)));
            if(mode==0)gl_FragColor=vec4(toSRGB(clamp(diffuseColor.rgb,0.,1.)),1.);
            else if(mode==1)gl_FragColor=vec4(tangentNormal*.5+.5,1.);
            else gl_FragColor=vec4(mix(1.,clamp(vRockAO,0.,1.),aoAmount),roughnessFactor,0.,1.);
        }`});
    let program=bakePrograms.get(renderer);
    if(program?.material.fragmentShader===bakeMaterial.fragmentShader) {
        // Repeated LOD bakes share shader code. Retain its compiled program,
        // while replacing every input (including atlas textures and uniforms).
        for(const [key,uniform] of Object.entries(uniforms))program.material.uniforms[key].value=uniform.value;
        bakeMaterial.dispose();bakeMaterial=program.material;uniforms=bakeMaterial.uniforms;
        bakeMaterial.uniformsNeedUpdate=true;
    }else {
        program?.material.dispose();program?.geometry.dispose();
        const geometry=new T.PlaneGeometry(2,2),scene=new T.Scene();scene.add(new T.Mesh(geometry,bakeMaterial));
        program={geometry,scene,camera:new T.Camera(),material:bakeMaterial};bakePrograms.set(renderer,program);
    }
    const {scene,camera}=program,target=new T.WebGLRenderTarget(projection.size,projection.size,{depthBuffer:false});
    const previous=renderer.getRenderTarget(),tone=renderer.toneMapping,scissor=renderer.getScissorTest();
    const maps=[];
    try {
        renderer.setScissorTest(false);renderer.toneMapping=T.NoToneMapping;renderer.setRenderTarget(target);
        for(let i=0;i<3;i++) {
            uniforms.mode.value=i;renderer.render(scene,camera);
            const bytes=new Uint8Array(projection.size**2*4);renderer.readRenderTargetPixels(target,0,0,projection.size,projection.size,bytes);
            maps.push(canvasFromPixels(bytes,projection.size));
        }
    }finally {
        renderer.setRenderTarget(previous);renderer.toneMapping=tone;renderer.setScissorTest(scissor);
        target.dispose();textures.forEach(t=>t.dispose());
        textures.forEach((_,i)=>{uniforms['atlas'+i].value=null;});
    }
    return maps;
}
export async function bakeAsset({source,level,size,renderer,material,progress=()=>{},signal}) {
    const geometry=plainGeometry(level);
    try {
        progress('Unwrapping the reduced mesh…');await unwrap(geometry,size);
        if(signal?.aborted)throw new DOMException('Bake cancelled','AbortError');
        const projection=await project(source,geometry,size,progress,signal);
        progress('Baking colour, normal and surface maps…');
        const canvases=bakeMaps(renderer,material,projection);
        const textures=canvases.map((canvas,i)=>{const t=new T.CanvasTexture(canvas);t.colorSpace=i===0?T.SRGBColorSpace:T.NoColorSpace;t.flipY=true;return t;});
        const bakedMaterial=new T.MeshStandardMaterial({map:textures[0],normalMap:textures[1],roughnessMap:textures[2],metalnessMap:textures[2],aoMap:textures[2],roughness:1,metalness:0,fog:false});
        // A single UV set serves all maps; explicitly use channel 0 for AO.
        textures[2].channel=0;
        return {geometry,material:bakedMaterial,canvases,size,stats:{vertices:geometry.attributes.position.count,
            geometryBytes:Object.values(geometry.attributes).reduce((sum,a)=>sum+a.array.byteLength,geometry.index.array.byteLength),
            textureBytesWithMipmaps:Math.round(size*size*4*3*4/3)},projection:{maximumDistance:projection.maximumDistance,coverage:projection.coverage},
            dispose(){geometry.dispose();bakedMaterial.dispose();textures.forEach(t=>t.dispose());}};
    }catch(error){geometry.dispose();throw error;}
}
export async function glbFor(geometry,material,name,metadata) {
    const mesh=new T.Mesh(geometry,material);mesh.name=name;mesh.userData={...metadata};
    return new GLTFExporter().parseAsync(mesh,{binary:true});
}
export function makeLODPack(files,manifest) {
    return zipSync({...files,'lod-manifest.json':strToU8(JSON.stringify(manifest,null,2)),
        'README.txt':strToU8('Each GLB is a separate LOD of the same asset, in the same coordinates.\nConfigure LOD switching in your engine; glTF core does not automatically switch these meshes.\nDeviation values are bidirectional sampled distances, not certified bounds.\nMaterials bake base colour, tangent-space normals, roughness and AO. Clearcoat, sheen and transmission are approximated by standard PBR.\n')},{level:6});
}
