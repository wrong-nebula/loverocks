import * as T from 'three';
import {fractureSemantics} from './fracture-semantics.js';
import {openingAcceptance,OPENING_ACCEPTANCE} from './opening-acceptance.js';

const pause=()=>new Promise(resolve=>setTimeout(resolve,0));
function geometry(mesh) {
    const positions=new Float32Array(mesh.vertices.length/16*3);
    for(let i=0;i<positions.length/3;i++)positions.set(mesh.vertices.subarray(i*16,i*16+3),i*3);
    const g=new T.BufferGeometry();g.setAttribute('position',new T.BufferAttribute(positions,3));g.setIndex(new T.BufferAttribute(mesh.indices,1));g.computeBoundingSphere();return g;
}
// This is an actual GPU observation, independent of CPU ray witnesses. The
// acceptance policy stays fixed; other viewing sizes are explicitly diagnostic.
export function createOpeningGPUValidator(renderer,source,{size=128,azimuths=8}={}) {
    if(![64,128,256].includes(size)||![4,8].includes(azimuths))throw Error('Unsupported opening capture size or camera set.');
    const semantic=fractureSemantics(source);if(!semantic)return null;
    const width=size+16,ss=2,reference=geometry(source),sphere=reference.boundingSphere;
    const scene=new T.Scene();scene.background=new T.Color(0);
    const camera=new T.PerspectiveCamera(40,1,.01,1000),mesh=new T.Mesh(reference);scene.add(mesh);
    const white=new T.MeshBasicMaterial({color:0xffffff,toneMapped:false});
    const depth=new T.ShaderMaterial({uniforms:{front:{value:0},span:{value:2*sphere.radius}},
        vertexShader:'varying float depth; void main(){vec4 p=modelViewMatrix*vec4(position,1.);depth=-p.z;gl_Position=projectionMatrix*p;}',
        fragmentShader:'uniform float front,span; varying float depth; void main(){gl_FragColor=vec4((depth-front)/span,0.,0.,1.);}'});
    const semanticGeometry=new T.BufferGeometry(),semanticPositions=new Float32Array(source.indices.length*3),labels=new Float32Array(source.indices.length*2);
    for(let i=0;i<source.indices.length;i++){semanticPositions.set(source.vertices.subarray(source.indices[i]*16,source.indices[i]*16+3),i*3);labels.set([semantic.ids[Math.floor(i/3)],semantic.sides[Math.floor(i/3)]+1],i*2);}
    semanticGeometry.setAttribute('position',new T.BufferAttribute(semanticPositions,3));semanticGeometry.setAttribute('feature',new T.BufferAttribute(labels,2));
    const tags=new T.ShaderMaterial({vertexShader:'attribute vec2 feature; varying vec2 tag; void main(){tag=feature;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',
        fragmentShader:'varying vec2 tag; void main(){float id=floor(tag.x+0.5);gl_FragColor=vec4(mod(id,256.)/255.,floor(id/256.)/255.,tag.y/255.,1.);}'});
    const target=new T.WebGLRenderTarget(width*ss,width*ss),floatTarget=new T.WebGLRenderTarget(width*ss,width*ss,{type:T.FloatType});
    const views=[];for(const [height,elevation] of [['low',.15],['high',.65]])for(let a=0;a<azimuths;a++)views.push({name:`${height}-${a}`,elevation,azimuth:a*2*Math.PI/azimuths});
    const references=new Map();let disposed=false;
    function capture(g,m,pass) {
        mesh.geometry=g;mesh.material=m;
        const buffer=pass==='depth'?floatTarget:target;renderer.setRenderTarget(buffer);renderer.render(scene,camera);
        const raw=pass==='depth'?new Float32Array((width*ss)**2*4):new Uint8Array((width*ss)**2*4);
        renderer.readRenderTargetPixels(buffer,0,0,width*ss,width*ss,raw);
        const bytes=pass==='depth'?new Float32Array(width*width):new Uint8Array(width*width*4);
        for(let y=0;y<width;y++)for(let x=0;x<width;x++) {
            const i=y*width+x;
            if(pass==='semantic') {
                const votes=new Map();
                for(let sy=0;sy<ss;sy++)for(let sx=0;sx<ss;sx++){const at=((y*ss+sy)*width*ss+x*ss+sx)*4,key=raw[at]+raw[at+1]*256+raw[at+2]*65536;votes.set(key,(votes.get(key)??0)+1);}
                const [key,count]=[...votes].sort((a,b)=>b[1]-a[1]||a[0]-b[0])[0];
                if(count>=3)bytes.set([key%256,Math.floor(key/256)%256,Math.floor(key/65536),255],i*4);
            }else for(let c=0;c<(pass==='depth'?1:4);c++) {
                let value=0;for(let sy=0;sy<ss;sy++)for(let sx=0;sx<ss;sx++)value+=raw[((y*ss+sy)*width*ss+x*ss+sx)*4+c]/4;
                bytes[pass==='depth'?i:i*4+c]=pass==='depth'?value:Math.round(value);
            }
        }
        if(pass==='depth'&&bytes.some(x=>!Number.isFinite(x)))throw Error('GPU depth capture contains invalid values.');
        return bytes;
    }
    function frame(view,candidate) {
        const old={target:renderer.getRenderTarget(),tone:renderer.toneMapping,scissor:renderer.getScissorTest(),viewport:renderer.getViewport(new T.Vector4()),rect:renderer.getScissor(new T.Vector4()),auto:renderer.autoClear};
        try {
            renderer.setScissorTest(false);renderer.toneMapping=T.NoToneMapping;renderer.autoClear=true;
            const angle=Math.atan(size/width*Math.tan(40*Math.PI/360)),distance=sphere.radius/Math.sin(angle);
            camera.position.copy(sphere.center).addScaledVector(new T.Vector3(Math.sin(view.azimuth)*Math.cos(view.elevation),Math.sin(view.elevation),Math.cos(view.azimuth)*Math.cos(view.elevation)),distance);
            camera.lookAt(sphere.center);camera.updateMatrixWorld();depth.uniforms.front.value=distance-sphere.radius;
            if(!references.has(view.name)) {
                const ref={silhouette:capture(reference,white,'silhouette'),depth:capture(reference,depth,'depth'),semantic:capture(semanticGeometry,tags,'semantic')};
                if(!ref.depth.some(v=>v>0&&v<1))throw Error('Reference GPU depth buffer is empty.');references.set(view.name,ref);
            }
            return {source:references.get(view.name),candidate:{silhouette:capture(candidate,white,'silhouette'),depth:capture(candidate,depth,'depth')}};
        }finally{renderer.setRenderTarget(old.target);renderer.setViewport(old.viewport);renderer.setScissor(old.rect);renderer.setScissorTest(old.scissor);renderer.toneMapping=old.tone;renderer.autoClear=old.auto;}
    }
    return {
        async measure(level,{signal,progress=()=>{},onFrame=()=>{}}={}) {
            if(disposed)throw Error('GPU opening checker has been disposed.');
            const candidate=geometry(level),rows=[];let intersection=0,union=0;
            try {
                for(const view of views) {
                    signal?.throwIfAborted();progress(`Checking openings · ${view.name}`);
                    const frames=frame(view,candidate),acceptance=openingAcceptance(frames.source,frames.candidate,width,width,size);
                    for(let i=0;i<width*width;i++){const a=frames.source.silhouette[i*4]>127,b=frames.candidate.silhouette[i*4]>127;if(a||b)union++;if(a&&b)intersection++;}
                    await onFrame(view,frames,acceptance);rows.push({view:view.name,acceptance});await pause();
                }
            }finally{candidate.dispose();}
            const openings=rows.flatMap(row=>row.acceptance.openings.map(o=>({...o,view:row.view}))),failed=openings.filter(o=>!o.accepted),depths=openings.filter(o=>o.kind==='wall'&&o.depthP95Px!==null).map(o=>o.depthP95Px);
            const gaps=openings.filter(o=>o.kind==='opening'),gapPixels=gaps.reduce((n,o)=>n+o.pixels,0),filled=gaps.reduce((n,o)=>n+o.filledPixels,0);
            return {method:'gpu',status:!openings.length?'not-visible':failed.length?'needs-review':'passed',inScope:size===OPENING_ACCEPTANCE.viewingSize,
                viewingSize:size,cameras:views.length,tested:openings.length,failed:failed.length,failures:failed,
                depthP95Px:depths.length?Math.max(...depths):null,silhouetteIoU:union?intersection/union:null,gapFill:gapPixels?filled/gapPixels:null,rows};
        },
        dispose(){disposed=true;for(const resource of [reference,semanticGeometry,white,depth,tags,target,floatTarget])resource.dispose();references.clear();}
    };
}
