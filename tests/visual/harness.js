import * as T from 'three';
import {buildLODs} from '../../src/lod.js';
import {bakeAsset} from '../../src/asset-bake.js';
import {fractureSemantics} from '../../src/fracture-semantics.js';
import {openingAcceptance,openingRegions,OPENING_ACCEPTANCE} from './opening-acceptance.js';
import {compareImages} from './metrics.js';
import {OutputPass} from 'three/addons/postprocessing/OutputPass.js';

function normalPass(material,procedural=false) {
    const result=material.clone();result.fog=false;
    result.onBeforeCompile=(shader,renderer)=>{
        if(procedural)material.onBeforeCompile(shader,renderer);
        shader.fragmentShader=shader.fragmentShader.replace('#include <opaque_fragment>','gl_FragColor = vec4(normalize(normal) * 0.5 + 0.5, 1.0);')
            .replace('#include <tonemapping_fragment>','').replace('#include <colorspace_fragment>','');
    };
    result.customProgramCacheKey=()=>procedural?'quality-procedural-normal-v1':'quality-baked-normal-v1';
    return result;
}
function imageCanvas(bytes,size,flip=true) {
    const c=document.createElement('canvas');c.width=c.height=size;
    const pixels=new Uint8ClampedArray(bytes.length);
    for(let y=0;y<size;y++)pixels.set(bytes.subarray(y*size*4,(y+1)*size*4),(flip?size-1-y:y)*size*4);
    c.getContext('2d').putImageData(new ImageData(pixels,size,size),0,0);return c;
}
function openingOverlay(source,candidate,width,size) {
    const bytes=source.color.slice(),regions=openingRegions(source,width,width);
    for(let i=0;i<bytes.length;i+=4){bytes[i]*=.3;bytes[i+1]*=.3;bytes[i+2]*=.3;bytes[i+3]=255;}
    for(const {pixels} of regions.gaps)if(pixels.length>=OPENING_ACCEPTANCE.minGapPixels)for(const i of pixels) {
        const bad=candidate&&candidate.silhouette[i*4]>127;
        bytes.set(bad?[255,140,45,255]:[110,220,190,255],i*4);
    }
    for(const {pixels} of regions.walls)if(pixels.length>=OPENING_ACCEPTANCE.minWallPixels)for(const i of pixels) {
        const bad=candidate&&(candidate.silhouette[i*4]<251||Math.abs(source.depth[i]-candidate.depth[i])*size>OPENING_ACCEPTANCE.maxDepthP95Px);
        bytes.set(bad?[250,70,100,255]:[75,165,190,255],i*4);
    }
    return bytes;
}
export function qualityHarness({renderer,scene,material,sourceGeometry,getBundle}) {
    // Keep the expensive procedural-normal program alive across fixtures.
    // Scene/texture buffers are still disposed after each case.
    const sourceNormal=normalPass(material,true);
    return {async run({fixture,target=500,sizes=[64,128,256],views,textureSize=512,profiles=['off',{name:'unrepaired',settings:{fractures:'anchors'},options:{repairOpenings:false}},'anchors','strict']}) {
        const bundle=getBundle(),source=bundle.source,rows=[],variants=[],resources=[];
        const testScene=new T.Scene();testScene.environment=scene.environment;testScene.environmentIntensity=scene.environmentIntensity;
        testScene.background=new T.Color(0x33362e);
        for(const light of scene.children.filter(o=>o.isLight)) {
            const copy=light.clone();copy.castShadow=false;
            if(light.target){copy.target=light.target.clone();testScene.add(copy.target);}
            testScene.add(copy);
        }
        const geometry=sourceGeometry(),mesh=new T.Mesh(geometry,material);testScene.add(mesh);
        const sphere=geometry.boundingSphere,cam=new T.PerspectiveCamera(40,1,.01,1000);
        const white=new T.MeshBasicMaterial({color:0xffffff,fog:false,toneMapped:false});resources.push(white);
        const fresh=new T.ShaderMaterial({vertexShader:'attribute float fresh; varying float value; void main(){value=fresh;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',
            fragmentShader:'varying float value; void main(){gl_FragColor=vec4(vec3(value),1.);}'});resources.push(fresh);
        const depthMaterial=new T.ShaderMaterial({uniforms:{front:{value:0},span:{value:sphere.radius*2}},
            vertexShader:'varying float depth; void main(){vec4 p=modelViewMatrix*vec4(position,1.);depth=-p.z;gl_Position=projectionMatrix*p;}',
            fragmentShader:'uniform float front,span; varying float depth; void main(){gl_FragColor=vec4((depth-front)/span,0.,0.,1.);}'});resources.push(depthMaterial);
        const semantic=fractureSemantics(source),semanticGeometry=new T.BufferGeometry();
        const semanticPositions=new Float32Array(source.indices.length*3),semanticLabels=new Float32Array(source.indices.length*2);
        for(let i=0;i<source.indices.length;i++) {
            semanticPositions.set(source.vertices.subarray(source.indices[i]*16,source.indices[i]*16+3),i*3);
            semanticLabels.set([semantic?.ids[Math.floor(i/3)]??0,(semantic?.sides[Math.floor(i/3)]??0)+1],i*2);
        }
        semanticGeometry.setAttribute('position',new T.BufferAttribute(semanticPositions,3));
        semanticGeometry.setAttribute('feature',new T.BufferAttribute(semanticLabels,2));
        const semanticMaterial=new T.ShaderMaterial({vertexShader:'attribute vec2 feature; varying vec2 tag; void main(){tag=feature;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',
            fragmentShader:'varying vec2 tag; void main(){float id=floor(tag.x+0.5);gl_FragColor=vec4(mod(id,256.)/255.,floor(id/256.)/255.,tag.y/255.,1.);}'});
        resources.push(semanticGeometry,semanticMaterial);
        const outputPass=new OutputPass();resources.push(outputPass);
        const old={target:renderer.getRenderTarget(),tone:renderer.toneMapping,scissor:renderer.getScissorTest(),shadows:renderer.shadowMap.enabled,
            clear:renderer.getClearColor(new T.Color()),alpha:renderer.getClearAlpha()};
        try {
            for(const entry of profiles) {
                // Test-only reducer modules allow paired experiments against a
                // frozen implementation without adding studio tuning controls.
                const profile=typeof entry==='string'?entry:entry.name;
                const reduce=entry.module?(await import(/* @vite-ignore */ entry.module)).buildLODs:buildLODs;
                window.qualityProgress=`${fixture}: reducing ${profile}`;
                const reduced=await reduce(source,{...bundle.settings,target,fractures:profile,...entry.settings},p=>window.qualityProgress=`${fixture} ${profile}: ${p}`,entry.options);
                const level=reduced.levels[1];
                const baked=await bakeAsset({source,level,size:textureSize,renderer,material,progress:p=>window.qualityProgress=`${fixture} ${profile}: ${p}`});
                variants.push({profile,level,baked,normal:normalPass(baked.material)});
            }
            // A matched-count control distinguishes the effect of protecting
            // rims from simply keeping more triangles.
            const anchored=variants.find(v=>v.profile==='anchors'),off=variants.find(v=>v.profile==='off');
            if(anchored&&off) {
                if(anchored.level.stats.triangles===off.level.stats.triangles)variants.push({...off,profile:'matched',shared:true});
                else {
                    const reduced=await buildLODs(source,{...bundle.settings,target:anchored.level.stats.triangles,fractures:'off'}),level=reduced.levels[1];
                    const baked=await bakeAsset({source,level,size:textureSize,renderer,material});
                    variants.push({profile:'matched',level,baked,normal:normalPass(baked.material)});
                }
            }
            renderer.shadowMap.enabled=false;renderer.setScissorTest(false);
            for(const view of views)for(const size of sizes) {
                window.qualityProgress=`${fixture}: ${view.name} at ${size} px`;
                // The projected source bounding sphere has the requested pixel
                // diameter. Eight pixels of padding leave silhouette errors visible.
                const width=size+16,ss=2;
                const angle=Math.atan(size/width*Math.tan(T.MathUtils.degToRad(cam.fov/2)));
                const direction=new T.Vector3(Math.sin(view.azimuth)*Math.cos(view.elevation),Math.sin(view.elevation),Math.cos(view.azimuth)*Math.cos(view.elevation));
                cam.position.copy(sphere.center).addScaledVector(direction,sphere.radius/Math.sin(angle));cam.lookAt(sphere.center);cam.updateMatrixWorld();
                depthMaterial.uniforms.front.value=sphere.radius/Math.sin(angle)-sphere.radius;
                const targetBuffer=new T.WebGLRenderTarget(width*ss,width*ss,{depthBuffer:true});
                const hdrBuffer=new T.WebGLRenderTarget(width*ss,width*ss,{depthBuffer:true,type:T.HalfFloatType});
                const depthBuffer=new T.WebGLRenderTarget(width*ss,width*ss,{depthBuffer:true,type:T.FloatType});
                const capture=(g,m,pass)=>{
                    mesh.geometry=g;mesh.material=m;
                    testScene.background=pass==='color'?new T.Color(0x33362e):new T.Color(0);
                    renderer.toneMapping=pass==='color'?T.ACESFilmicToneMapping:T.NoToneMapping;
                    // Offscreen Three.js rendering skips tone mapping and
                    // output conversion. Use an HDR buffer + OutputPass for
                    // colour so screenshots and MAE actually measure sRGB.
                    renderer.setRenderTarget(pass==='color'?hdrBuffer:pass==='depth'?depthBuffer:targetBuffer);renderer.render(testScene,cam);
                    if(pass==='color')outputPass.render(renderer,targetBuffer,hdrBuffer);
                    if(pass==='depth') {
                        const raw=new Float32Array((width*ss)**2*4);renderer.readRenderTargetPixels(depthBuffer,0,0,width*ss,width*ss,raw);
                        const values=new Float32Array(width*width);
                        for(let y=0;y<width;y++)for(let x=0;x<width;x++)for(let sy=0;sy<ss;sy++)for(let sx=0;sx<ss;sx++)values[y*width+x]+=raw[((y*ss+sy)*width*ss+x*ss+sx)*4]/(ss*ss);
                        if(values.some(v=>!Number.isFinite(v)))throw Error('Depth capture contains invalid values.');
                        return values;
                    }
                    const raw=new Uint8Array((width*ss)**2*4);renderer.readRenderTargetPixels(targetBuffer,0,0,width*ss,width*ss,raw);
                    const bytes=new Uint8Array(width*width*4);
                    if(pass==='semantic') {
                        // Never average categorical IDs across supersamples.
                        for(let y=0;y<width;y++)for(let x=0;x<width;x++) {
                            const votes=new Map();
                            for(let sy=0;sy<ss;sy++)for(let sx=0;sx<ss;sx++) {
                                const at=((y*ss+sy)*width*ss+x*ss+sx)*4,key=raw[at]+raw[at+1]*256+raw[at+2]*65536;
                                votes.set(key,(votes.get(key)??0)+1);
                            }
                            const [key,count]=[...votes].sort((a,b)=>b[1]-a[1]||a[0]-b[0])[0];
                            if(count>=3){const at=(y*width+x)*4;bytes[at]=key%256;bytes[at+1]=Math.floor(key/256)%256;bytes[at+2]=Math.floor(key/65536);bytes[at+3]=255;}
                        }
                        return bytes;
                    }
                    for(let y=0;y<width;y++)for(let x=0;x<width;x++)for(let c=0;c<4;c++) {
                        let sum=0;for(let sy=0;sy<ss;sy++)for(let sx=0;sx<ss;sx++)sum+=raw[((y*ss+sy)*width*ss+x*ss+sx)*4+c];
                        bytes[(y*width+x)*4+c]=Math.round(sum/(ss*ss));
                    }
                    return bytes;
                };
                const sourceFrames={silhouette:capture(geometry,white,'silhouette'),fracture:capture(geometry,fresh,'fracture'),
                    color:capture(geometry,material,'color'),normal:capture(geometry,sourceNormal,'normal'),depth:capture(geometry,depthMaterial,'depth')};
                if(semantic)sourceFrames.semantic=capture(semanticGeometry,semanticMaterial,'semantic');
                if(!sourceFrames.depth.some(v=>v>0&&v<1))throw Error('Reference depth buffer is empty or unsupported.');
                const frames=[{label:`Source · ${bundle.sourceStats.triangles} tris`,...sourceFrames,opening:openingOverlay(sourceFrames,null,width,size)}];
                for(const variant of variants) {
                    const candidate={silhouette:capture(variant.baked.geometry,white,'silhouette'),
                        color:capture(variant.baked.geometry,variant.baked.material,'color'),normal:capture(variant.baked.geometry,variant.normal,'normal'),depth:capture(variant.baked.geometry,depthMaterial,'depth')};
                    const metrics=compareImages(sourceFrames,candidate,width,width);
                    rows.push({fixture,view:view.name,size,profile:variant.profile,target,triangles:variant.level.stats.triangles,
                        protection:variant.level.protection,deviation:variant.level.deviation,simplifierError:variant.level.simplifierError,metrics,acceptance:openingAcceptance(sourceFrames,candidate,width,width,size)});
                    frames.push({label:`${variant.profile} · ${variant.level.stats.triangles} tris`,...candidate,opening:openingOverlay(sourceFrames,candidate,width,size)});
                }
                // Contact sheets include the actual pixel-size images without
                // browser DPR, camera changes, a floor, or differing lights.
                const sheet=document.createElement('canvas');sheet.width=frames.length*(width+12);sheet.height=(width+26)*4+28;
                const ctx=sheet.getContext('2d');ctx.fillStyle='#151813';ctx.fillRect(0,0,sheet.width,sheet.height);
                ctx.font='12px system-ui';ctx.fillStyle='#eeece2';ctx.fillText(`${fixture} · ${view.name} · ${size} render pixels · colour / silhouette / normals / opening samples`,8,18);
                for(const [column,frame] of frames.entries())for(const [row,pass] of ['color','silhouette','normal','opening'].entries()) {
                    const x=column*(width+12)+6,y=28+row*(width+26);ctx.fillText(frame.label,x,y+16);ctx.drawImage(imageCanvas(frame[pass],width),x,y+22);
                }
                if(window.__qualitySave)await window.__qualitySave(`${fixture}-${view.name}-${size}.png`,sheet.toDataURL('image/png').split(',')[1]);
                targetBuffer.dispose();hdrBuffer.dispose();depthBuffer.dispose();
                await new Promise(resolve=>setTimeout(resolve,0));
            }
            return {rows,sourceTriangles:bundle.sourceStats.triangles};
        }finally {
            for(const v of variants)if(!v.shared){v.baked.dispose();v.normal.dispose();}
            resources.forEach(r=>r.dispose());
            renderer.setRenderTarget(old.target);renderer.toneMapping=old.tone;renderer.setScissorTest(old.scissor);renderer.shadowMap.enabled=old.shadows;
            renderer.setClearColor(old.clear,old.alpha);
        }
    }};
}
