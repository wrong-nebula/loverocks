import './style.css';
import * as T from 'three';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';
import {chooseLOD,normalizeSettings} from './lod-policy.js';
import {installBudgetCurve} from './budget-curve.js';
import {createOpeningGPUValidator} from './opening-gpu.js';
const loadBaker=()=>import('./asset-bake.js');
import {RoomEnvironment} from 'three/addons/environments/RoomEnvironment.js';
import {loadAtmosphere,makeSky,setSkySun} from './atmosphere.js';
import surfaceDetail from './surface-detail.glsl?raw';
import geologyDetail from './geology-detail.glsl?raw';
import {seeded} from './random.js';
import {makeCameraLut,lutSize} from './camera-lut.js';
import {renderStill} from './still.js';
import {simulateClimate} from './climate.js';
import fjordPresets from '../engine/src/presets.json';
import {volcanicPresets} from './volcanic.js';
import {geologyPresets} from './geology.js';

const el=id=>document.getElementById(id);
const viewport=el('viewport');
const presets=[...fjordPresets];
for(const [group,entries] of [['volcanic',volcanicPresets],['geology',geologyPresets]]) {
    for(const preset of entries) {
        el(group+'-forms').append(new Option(preset.name,String(presets.length)));
        presets.push({...preset,group});
    }
}
// Offset shared by the shader and the engine so per-pixel features match the mesh.
const seedAnchor=seed=>{const r=seeded(seed);return [r()*37,r()*37,r()*37];};
const seedNumber=seed=>Math.floor(seeded(seed+'/moss')()*1e6);
const specimenPreset=()=>presets[state.form].group?presets[state.form]:undefined;
const params=new URLSearchParams(location.search);
const turntableMode=params.has('turntable');
const state={
    form:T.MathUtils.clamp(Math.floor(Number(params.get('form'))||0),0,presets.length-1),
    seed:params.get('seed')?.slice(0,96)||'',
    years:0,climate:'alpine',light:34,view:'material',ao:0.82,snow:params.get('weather')==='snow'?.82:0
};
if(!state.seed) state.seed=presets[state.form].seed;
const fields=[
    ['years','Elapsed years',0,1000,1],['weather','Surface weathering',0,.55,.005],
    ['fracture','Joint opening',0,.19,.001],['carving','Erosion carving',0,1,.01],
    ['ao','Ambient occlusion',0,1,.01],['snow','Snow cover',0,1,.01],['moss','Moss',0,1,.01],['wet','Surface moisture',0,1,.01],['lichen','Lichens',0,1,.01],
    ['light','Sun elevation',10,70,1]
];
function makeRenderer() {
    try {
        return new T.WebGLRenderer({antialias:true,preserveDrawingBuffer:true,powerPreference:'high-performance'});
    } catch(error) {
        el('status').textContent='The preview needs a browser with WebGL 2 enabled.';
        throw error;
    }
}
const renderer=makeRenderer();
renderer.setPixelRatio(Math.min(devicePixelRatio,2));
renderer.shadowMap.enabled=true;
renderer.shadowMap.type=T.PCFShadowMap;
renderer.toneMapping=T.ACESFilmicToneMapping;
renderer.toneMappingExposure=1.05;
renderer.domElement.setAttribute('aria-label','Interactive three-dimensional rock preview');
viewport.prepend(renderer.domElement);
const scene=new T.Scene();
scene.background=new T.Color(0x33362e);
scene.fog=new T.FogExp2(0x33362e,0.011);
const camera=new T.PerspectiveCamera(40,1,0.045,2500);
const controls=new OrbitControls(camera,renderer.domElement);
controls.minDistance=1.9;
controls.maxDistance=2000;
controls.enableDamping=false;
controls.addEventListener('change',render);
const pmrem=new T.PMREMGenerator(renderer);
const room=new RoomEnvironment();
const environment=pmrem.fromScene(room,0.12);
scene.environment=environment.texture;
scene.environmentIntensity=0.45;
room.dispose();
pmrem.dispose();
const skyFill=new T.HemisphereLight(0xc9dfe8,0x5e573c,0.85);
scene.add(skyFill);
const sun=new T.DirectionalLight(0xffe1ae,2.65);
sun.castShadow=true;
sun.shadow.mapSize.set(2048,2048);
sun.shadow.normalBias=0.018;
sun.shadow.bias=-0.00013;
sun.shadow.radius=2.3;
scene.add(sun,sun.target);
let atmosphereReady=false;
const atmosphereLoad=loadAtmosphere().then(()=>{
    atmosphereReady=true;
    render();
}).catch(error=>{
    console.error(error);
    el('status').textContent='The sky is unavailable. Reload the page to retry.';
});

const rockGroup=new T.Group();
scene.add(rockGroup);
let landscape,worker,jobId=0,jobs=[],rockMeshes=[],rockTimer;
let exposureHistory,historyKey;
let assetBundle,sourceMesh,activeLOD=1,baking=false,bakeController;
const bakedAssets=new Map();
let gpuController,gpuValidation=Promise.resolve();
const budgetCurve=installBudgetCurve({renderer,getSource:()=>window.fjordReady?assetBundle?.source:null,getSettings:optimizationSettings,
    getIdentity:()=>({form:state.form,seed:state.seed,job:jobs[0]}),apply:settings=>{
        el('target').value=settings.target;el('fractures').value=settings.fractures;el('repair-openings').value=settings.openingRepair?'on':'off';
        el('priority').value=settings.priority;el('tolerance').value=settings.tolerance;el('features').value=settings.features;generate(true);
    }});
const silhouette=new T.MeshBasicMaterial({color:0xffffff});
const renderSize=new T.Vector2(),cameraPoint=new T.Vector3();
function optimizationSettings(){return normalizeSettings({target:el('target').value,priority:el('priority').value,tolerance:el('tolerance').value,features:el('features').value,openingRepair:el('repair-openings').value==='on',fractures:state.form<4?el('fractures').value:'off'});}
function clearBakes(){
    bakeController?.abort();
    for(const mesh of rockMeshes){mesh.geometry=mesh.userData.proceduralGeometry;mesh.material=currentMaterial();}
    if(bakedAssets.size)el('bake-status').textContent='Surface changed. Bake again to refresh the portable material.';
    for(const asset of bakedAssets.values())asset.dispose();
    bakedAssets.clear();
}

const aoAmount={value:state.ao};
const snowAmount={value:0};
const rockGrain={value:1};
const crystalline={value:0};
const bedded={value:0};
const stoneType={value:0};
// Fjord rocks carry a signed fracture-trace distance for crisp hairline cracks.
const crackLines={value:0};
const crackHair={value:.002};
const rockSeed={value:new T.Vector3()};
const rockMapAmount={value:1};
const rockLightDirection={value:new T.Vector3()};
const cameraLutStrength={value:0};
const cameraLut={value:turntableMode?makeCameraLut():null};
const reliefSize=448;
const surfaceTexture=new T.DataTexture(new Uint8Array([128,0,0,128]),1,1);
surfaceTexture.wrapS=surfaceTexture.wrapT=T.RepeatWrapping;
surfaceTexture.magFilter=T.LinearFilter;
surfaceTexture.minFilter=T.LinearMipmapLinearFilter;
surfaceTexture.anisotropy=Math.min(8,renderer.capabilities.getMaxAnisotropy());
surfaceTexture.generateMipmaps=true;
surfaceTexture.needsUpdate=true;
const surfaceLoad=fetch(import.meta.env.BASE_URL+'surface/relief-448.rgba').then(async response=>{
    if(!response.ok) throw Error('Rock surface map could not load.');
    const data=new Uint8Array(await response.arrayBuffer());
    if(data.length!==reliefSize*reliefSize*4) throw Error('Incomplete rock surface map.');
    surfaceTexture.image={data,width:reliefSize,height:reliefSize};
    surfaceTexture.needsUpdate=true;
}).catch(error=>console.error(error));

// Sheen is enabled for the material but tinted per pixel, so only moss gets the velvet rim.
const baseMaterial=new T.MeshPhysicalMaterial({vertexColors:true,roughness:1,clearcoat:1,clearcoatRoughness:0.28,sheen:1,sheenColor:0x000000});
baseMaterial.defaultAttributeValues={meshWeather:[0,1]};
baseMaterial.onBeforeCompile=shader=>{
    shader.uniforms.rockGrain=rockGrain;
    shader.uniforms.crystalline=crystalline;
    shader.uniforms.bedded=bedded;
    shader.uniforms.stoneType=stoneType;
    shader.uniforms.crackLines=crackLines;
    shader.uniforms.crackHair=crackHair;
    shader.uniforms.rockSeed=rockSeed;
    shader.uniforms.snowAmount=snowAmount;
    shader.uniforms.aoAmount=aoAmount;
    shader.uniforms.rockLightDirection=rockLightDirection;
    shader.uniforms.rockMapAmount=rockMapAmount;
    shader.uniforms.rockSurfaceMap={value:surfaceTexture};
    shader.vertexShader=`attribute vec4 surfaceData; attribute float fresh; attribute float edgeTransmission; attribute vec2 meshWeather; attribute float rockAO;
        varying vec4 vSurface; varying vec3 vRockPoint; varying vec3 vRockNormal; varying float vFresh;
        varying float vEdgeTransmission; varying vec2 vMeshWeather; varying float vRockAO; varying mat3 vRockNormalMatrix;
        `+shader.vertexShader.replace('#include <begin_vertex>',`#include <begin_vertex>
            vSurface=surfaceData; vRockPoint=position; vRockNormal=normal; vFresh=fresh; vEdgeTransmission=edgeTransmission; vMeshWeather=meshWeather; vRockAO=rockAO; vRockNormalMatrix=normalMatrix;`);
    shader.fragmentShader=`varying float vEdgeTransmission; varying vec2 vMeshWeather; varying float vRockAO;
        varying mat3 vRockNormalMatrix;
        uniform vec3 rockLightDirection; uniform float snowAmount; uniform float aoAmount; uniform float crystalline;
        uniform float crackLines; uniform float crackHair;
        `+surfaceDetail+geologyDetail+shader.fragmentShader
        .replace('#include <color_fragment>',`#include <color_fragment>
            float footprint=max(length(dFdx(vRockPoint)),length(dFdy(vRockPoint)));
            vec4 rockMap=surfaceMap(vRockPoint,vRockNormal);
            float granitePolish=0., graniteRoughness=1., graniteBoundary=1., laminaRelief=0., stoneSmooth=0., stoneRelief=0.;
            vec3 stoneSpecular=vec3(1.);
            vec3 graniteTilt=vec3(0.);
            bool perPixelStone=crystalline>0.||stoneType>2.5;
            if(stoneType>2.5){
                Stone stone;
                if(stoneType<3.5) stone=marbleStone(vRockPoint,footprint,clamp((.62-vSurface.x-.21*vSurface.y)/.2,0.,1.));
                else if(stoneType<4.5) stone=slateStone(vRockPoint,vEdgeTransmission,footprint);
                else if(stoneType<5.5) stone=conglomerateStone(vRockPoint,footprint);
                else stone=schistStone(vRockPoint,vEdgeTransmission,footprint);
                diffuseColor.rgb=stone.albedo*(1.-.44*vSurface.y-.16*vFresh);
                graniteRoughness=stone.roughness; graniteTilt=stone.tilt; stoneSmooth=stone.smoothness; stoneSpecular=stone.specular; stoneRelief=stone.relief;
            }
            if(crystalline>0.){
                granitePolish=clamp(vEdgeTransmission,0.,1.);
                Mineral mineral=graniteFabric(vRockPoint,footprint,granitePolish);
                // Same wetting the engine applies to the vertex colour; moss is drawn below.
                diffuseColor.rgb=mineral.albedo*(1.-.44*vSurface.y-.16*vFresh);
                graniteRoughness=mineral.roughness; graniteTilt=mineral.tilt; graniteBoundary=mineral.boundary;
            }
            if(bedded>0.){
                vec4 lamina=sandstoneLaminae(vEdgeTransmission,vRockPoint);
                diffuseColor.rgb*=lamina.rgb;
                laminaRelief=lamina.a;
            }
            // Per-pixel moss over the clean rock colour: clumpy edges and soft cushions
            // on the coverage grown in src/moss.js.
            float mossV=vSurface.z, mossPx=0., mossRelief=0.;
            if(mossV>.002){
                float cushion=.55*rockNoise(vRockPoint*30.)+.30*rockNoise(vRockPoint*75.+2.)+.15*rockNoise(vRockPoint*160.+5.);
                // Fuzzy edge: leaf-scale noise breaks the boundary into strands.
                float hairFade=1.-smoothstep(.3,.9,footprint*260.);
                float hair=(rockNoise(vRockPoint*260.)-.5)*hairFade+.6*(rockNoise(vRockPoint*110.+3.)-.5)*(1.-smoothstep(.3,.9,footprint*110.));
                float edgeW=.05+.6*fwidth(mossV)+.12*smoothstep(.3,.9,footprint*110.);
                float front=mossV+(cushion-.5)*.45+.42*hair;
                mossPx=max(smoothstep(.42-edgeW,.42+edgeW,front),smoothstep(.88,.98,mossV));
                // A sparse fringe of strands just outside the dense cushion.
                float fringe=smoothstep(.20,.38,front)*(1.-mossPx)*.75;
                // Stray young tufts take hold in the damp margin ahead of the front.
                float strayFade=1.-smoothstep(.3,.9,footprint*70.);
                float stray=smoothstep(.58,.64,.7*rockNoise(vRockPoint*70.+11.)+.3*rockNoise(vRockPoint*160.+4.)+.9*mossV)*smoothstep(.01,.08,mossV)*strayFade;
                mossPx=max(mossPx,max(stray,fringe));
                // How far into the colony this pixel is: 0 at the margin, 1 in the old centre.
                float margin=1.-smoothstep(.35,.85,mossV);
                // Soft cushions: rounded, lighter tops with darker hollows between them.
                float tuftFade=1.-smoothstep(.3,.9,footprint*48.);
                float clump=.65*rockNoise(vRockPoint*48.)+.35*rockNoise(vRockPoint*91.+7.);
                float dome=mix(1.,mix(.80,1.04,smoothstep(.22,.72,clump)),tuftFade);
                // Velvet: a dense fuzz of tiny leaves at two scales.
                float leafFade=1.-smoothstep(.3,.9,footprint*340.);
                float fibre=(rockNoise(vRockPoint*340.)-.5)*leafFade+.5*(rockNoise(vRockPoint*150.+9.)-.5)*(1.-smoothstep(.3,.9,footprint*150.));
                // Living moss is lime to yellow-green on the tops, deep green in the hollows.
                float tone=clamp(.40+.35*(cushion-.5)+.25*(clump-.5)*tuftFade+.22*fibre,0.,1.);
                vec3 deep=vec3(.014,.036,.006), mid=vec3(.040,.088,.012), lime=vec3(.092,.150,.020);
                vec3 mossCol=(tone<.5?mix(deep,mid,tone*2.):mix(mid,lime,tone*2.-1.))*dome;
                // Patches of a second, darker species and a few dry, brownish tufts.
                float species=smoothstep(.55,.75,rockNoise(vRockPoint*6.+21.));
                mossCol=mix(mossCol,mossCol*vec3(.62,.80,.70),.6*species);
                float dry=smoothstep(.70,.90,rockNoise(vRockPoint*14.+4.))*tuftFade;
                mossCol=mix(mossCol,vec3(.10,.085,.030)*dome,.35*dry);
                mossRelief=(.08*fibre+.10*(clump-.5)*tuftFade)*mossPx;
                // New growth at the margin is lighter and yellower than the old centre.
                mossCol=mix(mossCol,mossCol*vec3(1.22,1.16,.80)+vec3(.010,.012,0.),.45*margin);
                mossCol*=1.-.40*vSurface.y;
                // The rock right next to a cushion stays damp and shaded: a dark contact
                // zone with a faint film of algae.
                float contact=smoothstep(.0,.16,mossV)*(1.-mossPx);
                diffuseColor.rgb=mix(diffuseColor.rgb*(1.-.40*contact),vec3(.045,.055,.030),.18*contact);
                diffuseColor.rgb=mix(diffuseColor.rgb,mossCol,mossPx);
            }
            float flake=filteredGrain(vRockPoint,34.,footprint);
            float grit=filteredGrain(vRockPoint,102.,footprint);
            float micro=filteredGrain(vRockPoint,230.,footprint);
            vec2 colony=vec2(0.);
            if(vSurface.w>.07 && vFresh<.97) colony=lichenColony(vRockPoint,footprint);
            colony.x*=vMeshWeather.y;
            float snow=0.;
            if(snowAmount>0.){
                float coverage=vMeshWeather.x*snowAmount;
                float edge=.24+.22*rockNoise(vRockPoint*12.)+.16*rockNoise(vRockPoint*31.);
                snow=smoothstep(edge-.07,edge+.17,coverage);
                snow*=smoothstep(.28,.64,normalize(vRockNormal).y);
            }
            // Smooth, specular surfaces (low roughness, wet clearcoat) show no fine
            // grain: fade the grain and noise relief wherever the surface is glossy.
            float baseRoughness=perPixelStone?graniteRoughness-.21*vSurface.y:vSurface.x;
            float wetGloss=smoothstep(.26,.89,vSurface.y)*(1.-.91*vSurface.z);
            float gloss=max(1.-smoothstep(.28,.62,baseRoughness),wetGloss);
            float smoothFacet=max(max(crystalline*granitePolish,stoneSmooth),gloss);
            // Moss and lichen sit on top of the rock: none of the rock's grain,
            // noise or layering shows through them.
            float growth=clamp(max(mossPx,colony.x),0.,1.);
            float rockTexture=1.-growth;
            float mineralRelief=(.38*flake+.155*grit+.058*micro)*rockGrain*mix(1.,.14,smoothFacet)*rockTexture;
            float mapRelief=((rockMap.r-.5)*.21+(rockMap.a-.5)*.14)*rockMapAmount*mix(1.,.08,smoothFacet)*rockTexture;
            float relief=mix(mineralRelief+mapRelief+mossRelief+.24*colony.x+(laminaRelief*bedded+stoneRelief-.20*crystalline*(1.-graniteBoundary))*rockTexture,flake*.17+grit*.095,snow);
            diffuseColor.rgb*=1.+(mineralRelief+mapRelief)*mix(.44,.73,vSurface.z);
            diffuseColor.rgb*=1.+rockMapAmount*(rockMap.b*.13-rockMap.g*.085)*rockTexture;
            if(crackLines>0.){
                // Hairline fractures: a sharp dark core along the trace with a faint
                // lighter lip of fresh rock, antialiased from the interpolated distance.
                // Values above .25 are healed quartz veins (shifted by .5 in the engine).
                bool vein=vEdgeTransmission>.25;
                float signedTrace=vein?vEdgeTransmission-.5:vEdgeTransmission;
                float trace=abs(signedTrace);
                float aa=max(fwidth(signedTrace),1e-5);
                float show=rockTexture*(1.-snow);
                if(vein){
                    float veinHalf=.0022+.0018*rockNoise(vRockPoint*9.);
                    float body=1.-smoothstep(veinHalf-aa,veinHalf+aa,trace);
                    vec3 quartz=vec3(.48,.46,.42)*(1.+.12*(rockNoise(vRockPoint*80.)-.5));
                    diffuseColor.rgb=mix(diffuseColor.rgb,quartz,body*show*.85);
                }else{
                    float core=1.-smoothstep(crackHair-aa,crackHair+aa,trace);
                    float lip=smoothstep(crackHair,crackHair+.005,trace)*(1.-smoothstep(crackHair+.005,crackHair+.018,trace));
                    diffuseColor.rgb*=mix(1.,.20,core*show)*(1.+.10*lip*show);
                }
            }
            vec3 lichenColor=mix(vec3(.245,.275,.205),vec3(.395,.355,.21),colony.y);
            lichenColor*=1.+.12*grit;
            diffuseColor.rgb=mix(diffuseColor.rgb,lichenColor,colony.x*.74);
            diffuseColor.rgb=mix(diffuseColor.rgb,vec3(.76,.84,.89)*(1.+.12*grit),snow);`)
        .replace('#include <roughnessmap_fragment>',`#include <roughnessmap_fragment>
            float rockRoughness=perPixelStone?graniteRoughness-.21*vSurface.y+.16*mineralRelief*(1.-smoothFacet):vSurface.x+.16*mineralRelief;
            rockRoughness=mix(rockRoughness,.88,mossPx*.7);
            roughnessFactor=mix(clamp(rockRoughness,.06,1.),.96,max(colony.x*.88,snow));`)
        .replace('#include <normal_fragment_maps>',`#include <normal_fragment_maps>
            vec3 dpdx=dFdx(-vViewPosition);
            vec3 dpdy=dFdy(-vViewPosition);
            vec3 r1=cross(dpdy,normal);
            vec3 r2=cross(normal,dpdx);
            float det=dot(dpdx,r1);
            float bump=.015*max(length(dpdx),length(dpdy))/max(footprint,1e-5);
            vec3 gradient=(dFdx(relief)*r1+dFdy(relief)*r2)*bump*sign(det);
            normal=normalize(max(abs(det),1e-9)*normal-gradient);
            if(perPixelStone){
                vec3 tilt=vRockNormalMatrix*graniteTilt*(1.-max(colony.x,snow));
                normal=normalize(normal+tilt-dot(tilt,normal)*normal);
            }`)
        .replace('#include <lights_physical_fragment>',`#include <lights_physical_fragment>
            material.clearcoat *= smoothstep(.26,.89,vSurface.y)*(1.-.91*vSurface.z)*(1.-.88*colony.x)*(1.-.95*snow);
            material.clearcoatRoughness = mix(.43,.23,vSurface.y);
            // Dusty specimen surfaces reflect less than a clean dielectric.
            material.specularColor*=mix(stoneSpecular,vec3(1.),max(vSurface.y,snow));
            #ifdef USE_SHEEN
                // Leaf tips scatter light at grazing angles: a soft velvet rim on moss only.
                material.sheenColor=vec3(.13,.19,.04)*mossPx*(1.-colony.x)*(1.-snow);
                material.sheenRoughness=.55;
            #endif
            material.specularF90*=mix(dot(stoneSpecular,vec3(1./3.)),1.,max(vSurface.y,snow));`)
        .replace('#include <aomap_fragment>',`#include <aomap_fragment>
            float sdfAO=mix(1.,vRockAO,aoAmount);
            reflectedLight.indirectDiffuse*=sdfAO;
            #ifdef USE_CLEARCOAT
                clearcoatSpecularIndirect*=sdfAO;
            #endif
            #ifdef USE_ENVMAP
                reflectedLight.indirectSpecular*=computeSpecularOcclusion(
                    saturate(dot(geometryNormal,geometryViewDir)),sdfAO,material.roughness);
            #endif`)
        .replace('#include <emissivemap_fragment>',`#include <emissivemap_fragment>
            vec3 viewDir=normalize(vViewPosition);
            vec3 lightDir=normalize(mat3(viewMatrix)*rockLightDirection);
            float rim=pow(1.-clamp(dot(normal,viewDir),0.,1.),2.1);
            float back=smoothstep(.06,.83,-dot(normal,lightDir));
            float towardViewer=smoothstep(-.35,.74,-dot(lightDir,viewDir));
            // Only glass and marble carry a transmission signal; other stones reuse the channel.
            float carriesTransmission=(1.-max(crystalline,bedded))*(stoneType>3.5?0.:1.)*(1.-crackLines);
            float tint=vEdgeTransmission*carriesTransmission*rim*(.15+.82*back*towardViewer);
            totalEmissiveRadiance+=(stoneType>2.5?vec3(.62,.58,.50)*.55:vec3(.63,.177,.054))*tint;
            // Marble scatters light under the surface: lift its shadows with a warm glow.
            if(stoneType>2.5&&stoneType<3.5) totalEmissiveRadiance+=diffuseColor.rgb*vec3(1.,.92,.80)*.10*(1.-max(colony.x,snow));
            // Thin moss glows lime where the sun shines through it from behind.
            totalEmissiveRadiance+=diffuseColor.rgb*vec3(1.4,1.7,.6)*mossPx*(1.-snow)*(.02+.30*back*towardViewer*(.35+.65*rim));`);
    if(turntableMode){
        shader.uniforms.cameraLut=cameraLut;
        shader.uniforms.cameraLutStrength=cameraLutStrength;
        shader.fragmentShader=`uniform highp sampler3D cameraLut;
            uniform float cameraLutStrength;
            `+shader.fragmentShader.replace('#include <colorspace_fragment>',`#include <colorspace_fragment>
                vec3 lutCoord=(clamp(gl_FragColor.rgb,0.,1.)*${lutSize-1}.+.5)/${lutSize}.;
                gl_FragColor.rgb=mix(gl_FragColor.rgb,texture(cameraLut,lutCoord).rgb,cameraLutStrength);`);
    }
};
const clay=new T.MeshStandardMaterial({color:0xafa58d,roughness:0.88});
const normals=new T.MeshNormalMaterial();
const wire=new T.MeshBasicMaterial({color:0xb9ad8e,wireframe:true});
const mask=new T.ShaderMaterial({
    uniforms:{channel:{value:0}},
    defaultAttributeValues:{meshWeather:[0,1]},
    vertexShader:`attribute vec4 surfaceData; attribute float fresh; attribute vec2 meshWeather; attribute float rockAO;
        varying vec4 vSurface; varying vec3 vRockPoint; varying vec3 vRockNormal; varying float vFresh;
        varying vec2 vMeshWeather; varying float vRockAO;
        void main(){
            vSurface=surfaceData;vRockPoint=position;vRockNormal=normal;vFresh=fresh;vMeshWeather=meshWeather; vRockAO=rockAO;
            vec4 point=vec4(position,1.);
            #ifdef USE_INSTANCING
                point=instanceMatrix*point;
            #endif
            gl_Position=projectionMatrix*modelViewMatrix*point;
        }`,
    fragmentShader:`uniform int channel; varying vec2 vMeshWeather; varying float vRockAO; ${surfaceDetail}
        void main(){
            float m=channel==5?vRockAO:channel==4?vMeshWeather.x:vSurface[min(channel,3)];
            if(channel==3) {
                float footprint=max(length(dFdx(vRockPoint)),length(dFdy(vRockPoint)));
                m=lichenColony(vRockPoint,footprint).x*vMeshWeather.y;
            }
            gl_FragColor=vec4(vec3(m),1.);
        }`
});

function showOnly(level) {
    if(!sourceMesh)return;
    sourceMesh.visible=level===-1;
    rockMeshes.forEach((mesh,index)=>mesh.visible=index===level);
}
function selectedLOD() {
    if(turntableMode||el('lod-preview').value==='source')return -1;
    if(el('lod-preview').value!=='auto')return Number(el('lod-preview').value);
    camera.updateMatrixWorld();
    cameraPoint.copy(sourceMesh.geometry.boundingSphere.center).applyMatrix4(sourceMesh.matrixWorld).applyMatrix4(camera.matrixWorldInverse);
    renderer.getDrawingBufferSize(renderSize);
    return chooseLOD(assetBundle.levels,{depth:-cameraPoint.z-sourceMesh.geometry.boundingSphere.radius,viewportHeight:renderSize.y,
        fov:camera.fov,pixelError:Number(el('pixel-error').value),previous:activeLOD});
}
function updateLODStatus() {
    if(!assetBundle)return;
    const mesh=activeLOD<0?assetBundle.source:assetBundle.levels[activeLOD];
    const stats=activeLOD<0?assetBundle.sourceStats:mesh.stats;
    const label=activeLOD<0?'Source':`LOD ${activeLOD}`;
    const baked=bakedAssets.get(activeLOD);
    let text=`${label} · ${stats.triangles.toLocaleString()} triangles · ${(baked?.stats.vertices??stats.vertices).toLocaleString()} vertices · ${((baked?.stats.geometryBytes??stats.bytes)/1024).toFixed(1)} KiB geometry`;
    if(baked)text+=` · ${(baked.stats.textureBytesWithMipmaps/1048576).toFixed(1)} MiB textures with mipmaps`;
    if(activeLOD>=0){
        if(mesh.protection.lockedVertices)text+=` · ${mesh.protection.lockedVertices.toLocaleString()} fracture vertices fixed`;
        const opening=mesh.protection.openings;
        const gpu=mesh.protection.gpu;
        if(gpu?.status==='checking')text+=' · Checking rendered openings…';
        else if(gpu?.status==='passed')text+=' · GPU opening checks passed at 128px.';
        else if(gpu?.status==='needs-review')text+=` · GPU opening checks failed in ${gpu.failed} regions. Review before export.`;
        else if(gpu?.status==='unavailable')text+=' · GPU checks unavailable. Review before export.';
        else if(opening?.status==='needs-review')text+=' · Opening checks unresolved. Review the mesh or increase the budget.';
        else if(opening?.status==='passed')text+=` · CPU estimate checked at ${opening.viewingSize}px; GPU check not available for this level.`;
        if(!mesh.budgetMet)text+=` · Budget not met (${mesh.target.toLocaleString()} requested).`;
        else if(!mesh.qualityMet)text+=' · Budget met; fidelity tolerance exceeded.';
    }
    if(el('lod-status').textContent!==text)el('lod-status').textContent=text;
    el('lod-status').classList.toggle('lod-warning',activeLOD>=0&&(!mesh.budgetMet||!mesh.qualityMet||(mesh.protection.gpu?['needs-review','unavailable'].includes(mesh.protection.gpu.status):mesh.protection.openings?.status==='needs-review')));
    for(const row of el('lod-results').querySelectorAll('[data-level]'))row.dataset.selected=Number(row.dataset.level)===activeLOD;
    el('bake').disabled=baking||activeLOD<0||!window.fjordReady;
    el('fractures').disabled=baking||state.form>=4;
    el('repair-openings').disabled=baking||state.form>=4||el('fractures').value!=='anchors';
    el('priority').disabled=baking||(state.form<4&&['anchors','strict'].includes(el('fractures').value));
    el('fracture-help').textContent=state.form>=4?'Fracture protection applies to the four Fjord rock types.':el('fractures').value==='skeleton'?'Experimental: sparse fracture guides stay fixed while other vertices can move. Openings may change. Compare measured quality before choosing a budget.':'Landmarks use labeled mouths, walls and tips. Opening repair may exceed the budget. Keep fracture faces retains all labeled faces. Bake textures for surface detail.';
    el('glb').textContent=activeLOD<0?'Source GLB':'Export GLB';
    el('glb').title=activeLOD<0?'Source mesh with vertex colours only. Select a LOD for baked textures.':'Export the selected LOD with baked PBR textures';
    el('comparison').hidden=el('compare').value==='off';
    el('comparison-lod').textContent=`${label} · ${stats.triangles.toLocaleString()} tris${baked?' · Baked':''}`;
    window.fjordLOD={active:activeLOD,triangles:stats.triangles,baked:bakedAssets.has(activeLOD)};
}
function render() {
    if(import.meta.env.DEV&&params.has('quality-test'))return;
    if(!assetBundle||!sourceMesh){renderer.render(scene,camera);return;}
    activeLOD=selectedLOD();showOnly(activeLOD);updateLODStatus();
    const comparison=el('compare').value;
    const originalOverride=scene.overrideMaterial,background=scene.background,fog=scene.fog,floor=landscape.visible;
    if(comparison==='silhouette'){
        scene.overrideMaterial=silhouette;scene.background=new T.Color(0x151813);scene.fog=null;landscape.visible=false;
    }
    renderer.setScissorTest(false);renderer.render(scene,camera);
    if(comparison!=='off') {
        renderer.getSize(renderSize);renderer.setScissorTest(true);renderer.setScissor(0,0,Math.floor(renderSize.x/2),renderSize.y);
        showOnly(-1);renderer.render(scene,camera);renderer.setScissorTest(false);showOnly(activeLOD);
    }
    scene.overrideMaterial=originalOverride;scene.background=background;scene.fog=fog;landscape.visible=floor;
}
function cameraReset() {
    const p=presets[state.form];
    controls.target.set(0,Math.max(0.45,p.height),0);
    camera.fov=40;
    el('preview-size').value='fit';
    camera.aspect=viewport.clientWidth/Math.max(viewport.clientHeight,1);
    const sphere=sourceMesh?.geometry.boundingSphere;
    if(sphere)controls.target.copy(sphere.center);
    const halfAngle=Math.min(T.MathUtils.degToRad(camera.fov/2),Math.atan(Math.tan(T.MathUtils.degToRad(camera.fov/2))*camera.aspect));
    const distance=sphere?sphere.radius/Math.sin(halfAngle)*1.15:8;
    camera.position.copy(controls.target).add(new T.Vector3(
        Math.sin(p.azimuth),Math.sin(p.elevation),Math.cos(p.azimuth)).normalize().multiplyScalar(distance));
    renderer.domElement.style.touchAction='none';
    renderer.domElement.tabIndex=0;
    renderer.domElement.setAttribute('aria-label','Rock preview. Arrow keys orbit. Plus and minus zoom.');
    const type=specimenPreset()?.seed;
    const glass=type==='glass-buttes';
    const granite=type==='st-cloud-granite';
    crystalline.value=Number(granite);
    bedded.value=Number(type==='red-rock-canyon');
    stoneType.value={'vermont-marble':3,'bangor-slate':4,'oligomict-conglomerate':5,'mica-schist':6}[type]||0;
    rockSeed.value.set(...seedAnchor(state.seed));
    const fine={'vermont-marble':[.35,.20],'bangor-slate':[.30,.20],'oligomict-conglomerate':[.6,.5],'mica-schist':[.45,.35],'red-rock-canyon':[.78,.55]}[type];
    // Fjord rocks (no preset group) get a calmer surface: less grain and map relief.
    const fjord=!presets[state.form].group;
    crackLines.value=Number(fjord);
    rockGrain.value=glass?.12:fine?.[0]??(fjord?.32:1);
    rockMapAmount.value=glass?.075:fine?.[1]??(fjord?.34:1);
    scene.environmentIntensity=glass?.92:granite?.76:.45;
    baseMaterial.ior=glass?1.49:granite?1.54:1.50;
    camera.aspect=viewport.clientWidth/Math.max(viewport.clientHeight,1);
    camera.updateProjectionMatrix();
    controls.update();
    render();
}
function lights() {
    const angle=presets[state.form].sun;
    const elev=T.MathUtils.degToRad(state.light);
    const direction=new T.Vector3(Math.cos(angle)*Math.cos(elev),Math.sin(elev),Math.sin(angle)*Math.cos(elev));
    setSkySun(direction);
    rockLightDirection.value.copy(direction);
    sun.target.position.set(0,0,0);
    sun.position.copy(sun.target.position).addScaledVector(direction,18);
    const span=4;
    Object.assign(sun.shadow.camera,{left:-span,right:span,top:span,bottom:-span,near:1,far:48});
    sun.shadow.camera.updateProjectionMatrix();
    sun.color.set(0xffe4bd).lerp(new T.Color(0xffbf76),1-T.MathUtils.smoothstep(state.light,10,42));
    render();
}
function dispose(group) {
    const geometries=new Set(),materials=new Set();
    group.traverse(o=>{
        if(o.isInstancedMesh) o.dispose();
        if(o.geometry) geometries.add(o.geometry);
        if(o.material) materials.add(o.material);
    });
    for(const g of geometries) g.dispose();
    for(const m of materials) {
        m.normalMap?.dispose();
        m.dispose();
    }
    group.removeFromParent();
}
function landscapeUpdate() {
    if(landscape) dispose(landscape);
    landscape=new T.Group();
    const floor=new T.Mesh(new T.PlaneGeometry(160,160),new T.MeshStandardMaterial({color:0x434438,roughness:0.96}));
    floor.rotation.x=-Math.PI/2;
    floor.receiveShadow=true;
    landscape.add(floor);
    scene.add(landscape);
    render();
}
function options(form) {
    const p=presets[form], key=state.seed+'/'+state.climate;
    if(key!==historyKey) {
        exposureHistory=simulateClimate(state.seed,state.climate);
        historyKey=key;
    }
    return [
        // Moss is grown in the worker (src/moss.js), so the engine bakes none.
        state.weather,p.rounding,state.fracture,state.carving,0,state.wet,state.lichen,
        1-Math.exp(-exposureHistory.runoff[state.years]/16700),1-Math.exp(-exposureHistory.frost[state.years]/5700),
        ...seedAnchor(state.seed)
    ];
}
function asGeometry({vertices,indices,weather}) {
    const geometry=new T.BufferGeometry();
    const packed=new T.InterleavedBuffer(vertices,16);
    for(const [name,size,offset] of [['position',3,0],['normal',3,3],['color',3,6],['surfaceData',4,9],['fresh',1,13],['edgeTransmission',1,14],['rockAO',1,15]]) {
        geometry.setAttribute(name,new T.InterleavedBufferAttribute(packed,size,offset));
    }
    if(weather) geometry.setAttribute('meshWeather',new T.BufferAttribute(weather,2));
    geometry.setIndex(new T.BufferAttribute(indices,1));
    geometry.computeBoundingSphere();
    return geometry;
}
function currentMaterial() {
    if(state.view==='material') return baseMaterial;
    if(state.view==='clay') return clay;
    if(state.view==='normal') return normals;
    if(state.view==='wire') return wire;
    mask.uniforms.channel.value={roughness:0,wet:1,moss:2,lichen:3,snow:4,ao:5}[state.view];
    return mask;
}
function updateView() {
    const material=currentMaterial();
    material.fog=false;
    rockMeshes.forEach((mesh,index)=>{
        const baked=bakedAssets.get(index);
        mesh.geometry=state.view==='material'&&baked?baked.geometry:mesh.userData.proceduralGeometry;
        mesh.material=state.view==='material'&&baked?baked.material:material;
    });
    if(sourceMesh)sourceMesh.material=material;
    landscape.visible=state.view==='material'||state.view==='clay';
    render();
}
function generate(reuse=false) {
    if(baking)return;
    gpuController?.abort();
    if(!reuse)budgetCurve.sourcePending();else budgetCurve.cancel('Updating mesh…');
    clearTimeout(rockTimer);
    if(!reuse){worker?.terminate();worker=undefined;}
    clearBakes();
    window.fjordReady=null;
    worker??=new Worker(new URL('./worker.js',import.meta.url),{type:'module'});
    const id=++jobId;
    const fitCamera=!sourceMesh||sourceMesh.userData.form!==state.form;
    el('status').textContent='Building rock meshes…';
    el('glb').disabled=true;
    el('png').disabled=true;
    for(const id of ['reduce','lod-preview','bake','lod-export','curve-run','curve-use'])el(id).disabled=true;
    const detail=turntableMode?160:Number(el('detail').value);
    // Moss grows facing away from the prevailing sun; elevation is a fixed typical
    // value so the Sun elevation slider can relight without regrowing.
    const sunAngle=presets[state.form].sun, sunElevation=T.MathUtils.degToRad(35);
    const moss={amount:state.moss,years:state.years,seed:seedNumber(state.seed),
        sun:[Math.cos(sunAngle)*Math.cos(sunElevation),Math.sin(sunElevation),Math.sin(sunAngle)*Math.cos(sunElevation)]};
    crackHair.value=.0012+.012*state.fracture;
    jobs=[{form:state.form,seed:state.seed,resolution:detail,options:options(state.form),meshWeather:!turntableMode,moss}];
    let incoming=[];
    worker.onmessage=({data})=>{
        if(data.id!==jobId)return;
        if(data.progress){el('status').textContent=data.progress;return;}
        if(data.error){
            el('status').textContent=data.error;
            worker.terminate();
            worker=undefined;
            el('reduce').disabled=false;
            return;
        }
        if(!data.done) {
            incoming[data.index]=data;
            el('status').textContent=`Building rocks · ${data.index+1} / ${jobs.length}`;
            return;
        }
        for(const child of rockGroup.children)(child.userData.proceduralGeometry??child.geometry).dispose();
        rockGroup.clear();rockMeshes=[];
        assetBundle=incoming[0];
        sourceMesh=new T.Mesh(asGeometry(assetBundle.source),currentMaterial());
        sourceMesh.name=jobs[0].seed+'_source';sourceMesh.castShadow=sourceMesh.receiveShadow=true;
        sourceMesh.userData.form=state.form;
        rockGroup.add(sourceMesh);
        for(const level of assetBundle.levels) {
            const mesh=new T.Mesh(asGeometry(level),currentMaterial());
            mesh.userData.proceduralGeometry=mesh.geometry;
            mesh.name=jobs[0].seed+'_LOD'+level.level;
            mesh.castShadow=mesh.receiveShadow=true;rockGroup.add(mesh);rockMeshes.push(mesh);
        }
        incoming=[];
        el('status').textContent='';
        for(const id of ['glb','png','reduce','lod-preview','lod-export'])el(id).disabled=false;
        el('lod-results').innerHTML=`<table class="lod-table"><thead><tr><th>Mesh</th><th>Triangles</th><th>Reduction</th></tr></thead><tbody>
            <tr data-level="-1"><td>Source</td><td>${assetBundle.sourceStats.triangles.toLocaleString()}</td><td>—</td></tr>
            ${assetBundle.levels.map(l=>`<tr data-level="${l.level}"><td>LOD ${l.level}</td><td>${l.stats.triangles.toLocaleString()}</td><td>${(100*(1-l.stats.triangles/assetBundle.sourceStats.triangles)).toFixed(1)}%</td></tr>`).join('')}
            </tbody></table>`;
        el('bake-status').textContent='Bakes colour, normals, roughness and AO for portable GLB export.';
        window.fjordReady={meshes:1,triangles:assetBundle.sourceStats.triangles,levels:assetBundle.levels.map(l=>({level:l.level,target:l.target,...l.stats,deviation:l.deviation,protection:l.protection,budgetMet:l.budgetMet,qualityMet:l.qualityMet}))};
        updateView();
        if(fitCamera&&!turntableMode)cameraReset();
        budgetCurve.sourceChanged(JSON.stringify(jobs[0]),state.form<4);
        if(state.form<4&&assetBundle.settings.fractures!=='off') {
            const bundle=assetBundle,level=bundle.levels[1],controller=new AbortController();gpuController=controller;
            level.protection.gpu={status:'checking'};updateLODStatus();
            gpuValidation=(async()=>{
                const checker=createOpeningGPUValidator(renderer,bundle.source);
                try {level.protection.gpu=checker?await checker.measure(level,{signal:controller.signal}):{status:'unavailable'};}
                catch(error){if(!controller.signal.aborted)level.protection.gpu={status:'unavailable',reason:String(error)};}
                finally{checker?.dispose();if(assetBundle===bundle&&!controller.signal.aborted)updateLODStatus();}
            })();
        }else gpuValidation=Promise.resolve();
        document.dispatchEvent(new Event('fjord:ready'));
    };
    worker.onerror=event=>{if(id!==jobId)return;el('status').textContent=event.message||'The mesh worker could not start.';worker?.terminate();worker=undefined;el('reduce').disabled=false;};
    worker.postMessage({id,jobs,optimization:optimizationSettings()});
}
function updateUrl() {
    const query=new URLSearchParams({form:state.form,seed:state.seed});
    window.history.replaceState(null,'','?'+query);
}
function resetSurface() {
    const p=presets[state.form];
    Object.assign(state,{weather:p.weather,fracture:p.fracture,
        carving:p.carving??0.52,moss:p.moss,wet:p.wet??0.48,lichen:p.lichen??0.57});
}
function sync() {
    el('form').value=state.form;
    el('seed').value=state.seed;
    el('view').querySelector('[value=snow]').hidden=turntableMode;
    if(turntableMode&&state.view==='snow'){
        state.view='material';
        el('view').value='material';
    }
    snowAmount.value=turntableMode?0:state.snow;
    for(const [key,,min,max] of fields) {
        el(key).value=state[key];
        sliderValue(key,min,max);
        if(key==='snow') el(key).parentElement.hidden=turntableMode;
    }
}
function sliderValue(key,min,max) {
    const value=state[key];
    el(key).style.setProperty('--fill',100*(value-min)/(max-min)+'%');
    el(key+'-value').value=key==='years'?value+' yr':key==='light'?value+'°':Math.round(value*100)+'%';
}
for(const [key,label,min,max,step] of fields) {
    const row=document.createElement('div');
    row.className='parameter';
    row.innerHTML=`<label for="${key}">${label}</label><output id="${key}-value" for="${key}"></output><input type="range" id="${key}" min="${min}" max="${max}" step="${step}">`;
    const section=key==='light'?'scene':
        ['moss','wet','lichen','snow','ao'].includes(key)?'surface':'weather';
    el(section+'-controls').append(row);
    el(key).addEventListener('input',()=>{
        state[key]=Number(el(key).value);
        sliderValue(key,min,max);
        if(key==='light'){lights();return;}
        if(key==='ao'){aoAmount.value=state.ao;clearBakes();updateView();return;}
        if(key==='snow'){snowAmount.value=state.snow;clearBakes();updateView();return;}
        clearTimeout(rockTimer);
        rockTimer=setTimeout(generate,180);
    });
}
el('form').onchange=()=>{
    state.form=Number(el('form').value);
    state.seed=presets[state.form].seed;
    resetSurface();sync();updateUrl();cameraReset();lights();generate();
};
el('seed-form').onsubmit=event=>{
    event.preventDefault();
    state.seed=el('seed').value.trim()||presets[state.form].seed;
    sync();updateUrl();generate();
};
el('shuffle').onclick=()=>{
    el('seed').value='fjord-'+crypto.getRandomValues(new Uint32Array(1))[0].toString(36);
    el('seed-form').requestSubmit();
};
// Roll a whole new rock. Surface values are drawn around the rock type's own
// defaults, so clean specimens stay clean; view settings (AO, snow, mesh
// detail) are left alone.
function randomize() {
    if(baking)return;
    const random=(min,max)=>min+(max-min)*Math.random();
    const clamp=(key,value)=>{
        const [, , min,max,step]=fields.find(field=>field[0]===key);
        return Math.min(max,Math.max(min,Math.round(value/step)*step));
    };
    state.form=Math.floor(Math.random()*presets.length);
    const p=presets[state.form];
    state.seed='stone-'+crypto.getRandomValues(new Uint32Array(1))[0].toString(36);
    state.climate=['alpine','maritime','continental'][Math.floor(Math.random()*3)];
    const base={weather:p.weather,fracture:p.fracture,carving:p.carving??.52,
        moss:p.moss,wet:p.wet??.48,lichen:p.lichen??.57};
    Object.assign(state,{
        years:clamp('years',random(0,1000)),
        weather:clamp('weather',base.weather*random(.45,1.9)),
        fracture:clamp('fracture',base.fracture*random(.3,2.2)),
        carving:clamp('carving',random(.15,.9)),
        moss:clamp('moss',base.moss*random(0,2)),
        wet:clamp('wet',base.wet*random(.3,1.8)),
        lichen:clamp('lichen',base.lichen*random(0,2)),
        light:clamp('light',random(18,58))
    });
    el('climate').value=state.climate;
    sync();updateUrl();cameraReset();lights();generate();
}
el('randomize').onclick=randomize;
document.addEventListener('keydown',event=>{
    const typing=event.target.closest?.('input,select,textarea,[contenteditable]');
    if(event.key.toLowerCase()==='r'&&!event.metaKey&&!event.ctrlKey&&!event.altKey&&!typing) randomize();
});
el('detail').onchange=()=>generate();
el('view').onchange=()=>{state.view=el('view').value;updateView();};
el('climate').onchange=()=>{state.climate=el('climate').value;generate();};
el('reset').onclick=cameraReset;
renderer.domElement.addEventListener('keydown',event=>{
    switch(event.key) {
        case 'ArrowLeft': controls.rotateLeft(.10); break;
        case 'ArrowRight': controls.rotateLeft(-.10); break;
        case 'ArrowUp': controls.rotateUp(.10); break;
        case 'ArrowDown': controls.rotateUp(-.10); break;
        case '+': case '=': controls.dollyIn(.9); break;
        case '-': controls.dollyOut(.9); break;
        default: return;
    }
    event.preventDefault();
});
function setExpanded(expanded) {
    el('stage').classList.toggle('expanded',expanded);
    document.body.classList.toggle('preview-expanded',expanded);
    el('fullscreen').setAttribute('aria-pressed',expanded);
    el('fullscreen').setAttribute('aria-label',expanded?'Restore preview size':'Expand preview');
    el('fullscreen').title=expanded?'Restore preview size':'Expand preview';
    el('fullscreen').focus();
}
el('fullscreen').onclick=()=>setExpanded(!el('stage').classList.contains('expanded'));
document.addEventListener('keydown',event=>{
    if(event.key==='Escape'&&el('stage').classList.contains('expanded')) setExpanded(false);
});
function download(data,type,suffix,seed=state.seed) {
    const url=URL.createObjectURL(new Blob([data],{type}));
    const a=document.createElement('a');
    a.href=url;
    a.download='fjord-'+seed.replace(/[^a-z0-9-]/gi,'-')+suffix;
    a.click();
    setTimeout(()=>URL.revokeObjectURL(url),1500);
}
el('png').onclick=async()=>{
    const button=el('png');
    button.disabled=true;
    button.textContent='Rendering…';
    try {
        await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
        const seed=state.seed;
        const png=await renderStill(renderer,scene,camera,sun.shadow);
        download(png,'image/png','-4k.png',seed);
    } catch(error) {
        el('status').textContent=error.message;
    } finally {
        button.textContent='Render 4K PNG';
        button.disabled=!window.fjordReady;
    }
};
function setBakeBusy(value) {
    baking=value;
    for(const input of document.querySelectorAll('.inspector input,.inspector select,.inspector button,.exports button'))input.disabled=value;
    budgetCurve.setExternalBusy(value);
    if(!value){el('bake').disabled=activeLOD<0;updateLODStatus();}
}
async function ensureBaked(level) {
    const size=Number(el('bake-size').value),cached=bakedAssets.get(level);
    if(cached?.size===size)return cached;
    if(cached){rockMeshes[level].geometry=rockMeshes[level].userData.proceduralGeometry;rockMeshes[level].material=currentMaterial();cached.dispose();bakedAssets.delete(level);}
    bakeController=new AbortController();
    const {bakeAsset}=await loadBaker();
    const result=await bakeAsset({source:assetBundle.source,level:assetBundle.levels[level],size,renderer,material:baseMaterial,
        progress:message=>{el('status').textContent=message;el('bake-status').textContent=message;},signal:bakeController.signal});
    bakedAssets.set(level,result);return result;
}
async function runBake(action) {
    if(baking||!window.fjordReady)return;
    if(budgetCurve.getResults().busy)budgetCurve.cancel();
    setBakeBusy(true);
    try {await gpuValidation;await action();el('status').textContent='';}
    catch(error){el('status').textContent=error.message;el('bake-status').textContent='Bake failed. Try a smaller texture size or a higher triangle budget.';console.error(error);}
    finally{setBakeBusy(false);updateView();}
}
function manifest() {
    return {version:1,generator:'loverocks',seed:state.seed,form:state.form,settings:{...state},sourceResolution:Number(el('detail').value),
        optimization:assetBundle.settings,coordinateSystem:'right-handed, Y-up',units:'generator units',
        lodSelection:{metric:'bidirectional sampled maximum surface distance',certifiedBound:false,pixelTolerance:Number(el('pixel-error').value),hysteresis:.15},
        material:'Baked standard metallic-roughness PBR; clearcoat, sheen and transmission approximated',
        levels:assetBundle.levels.map(l=>({level:l.level,file:`rock_LOD${l.level}.glb`,target:l.target,...l.stats,
            budgetMet:l.budgetMet,qualityMet:l.qualityMet,simplifierError:l.simplifierError,deviation:l.deviation,protection:l.protection,
            textureSize:bakedAssets.get(l.level)?.size??null,exportStats:bakedAssets.get(l.level)?.stats??null,
            projection:bakedAssets.get(l.level)?.projection??null}))};
}
el('reduce').onclick=()=>{
    if(!el('target').reportValidity())return;
    generate(true);
};
el('fractures').onchange=()=>{if(['anchors','strict'].includes(el('fractures').value))el('priority').value='quality';else if(el('fractures').value==='skeleton')el('priority').value='budget';updateLODStatus();};
for(const id of ['tolerance','features'])el(id).addEventListener('change',()=>budgetCurve.settingsChanged());
el('target').onkeydown=event=>{if(event.key==='Enter')el('reduce').click();};
el('lod-preview').onchange=()=>{el('pixel-row').hidden=el('lod-preview').value!=='auto';updateView();};
el('compare').onchange=()=>{el('compare-help').hidden=el('compare').value==='off';render();};
el('pixel-error').onchange=render;
el('preview-size').onchange=()=>{
    if(!sourceMesh)return;
    if(el('preview-size').value==='fit'){cameraReset();return;}
    const sphere=sourceMesh.geometry.boundingSphere;
    renderer.getDrawingBufferSize(renderSize);
    const direction=camera.position.clone().sub(controls.target).normalize();
    const angle=Math.atan(Number(el('preview-size').value)*Math.tan(T.MathUtils.degToRad(camera.fov/2))/renderSize.y);
    controls.target.copy(sphere.center);
    camera.position.copy(controls.target).addScaledVector(direction,sphere.radius/Math.sin(angle));
    controls.update();render();
};
el('bake').onclick=()=>runBake(async()=>{
    const level=activeLOD;await ensureBaked(level);
    el('bake-status').textContent=`LOD ${level} baked at ${el('bake-size').value} px. Preview now uses the portable material.`;
});
el('glb').onclick=()=>runBake(async()=>{
    const {glbFor}=await loadBaker();
    const level=activeLOD;
    if(level<0){
        const material=new T.MeshStandardMaterial({vertexColors:true,roughness:.84});
        try{download(await glbFor(sourceMesh.geometry,material,state.seed+'_source',{exportMode:'vertex-colour source'}),'model/gltf-binary','-source.glb');}
        finally{material.dispose();}
        return;
    }
    const baked=await ensureBaked(level);
    download(await glbFor(baked.geometry,baked.material,state.seed+'_LOD'+level,manifest().levels[level]),'model/gltf-binary',`-LOD${level}.glb`);
    el('bake-status').textContent=`Exported LOD ${level} with baked PBR textures.`;
});
el('lod-export').onclick=()=>runBake(async()=>{
    const {glbFor,makeLODPack}=await loadBaker();
    const files={};
    for(const level of assetBundle.levels){
        const baked=await ensureBaked(level.level);
        files[`rock_LOD${level.level}.glb`]=new Uint8Array(await glbFor(baked.geometry,baked.material,state.seed+'_LOD'+level.level,manifest().levels[level.level]));
    }
    download(makeLODPack(files,manifest()),'application/zip','-LOD-pack.zip');
    el('bake-status').textContent='Exported three baked GLBs and an LOD manifest.';
});
new ResizeObserver(()=>{
    const {width,height}=viewport.getBoundingClientRect();
    if(width<1||height<1)return;
    renderer.setSize(width,height,false);
    camera.aspect=width/height;
    camera.updateProjectionMatrix();
    render();
}).observe(viewport);
resetSurface();sync();landscapeUpdate();cameraReset();lights();
if(import.meta.env.DEV&&params.has('quality-test'))el('detail').value='32';
Promise.all([atmosphereLoad,surfaceLoad]).then(generate);

// A dev-only adapter lets visual tests exercise the real source shader and
// portable baker. Vite removes this branch from production builds.
if(import.meta.env.DEV&&params.has('quality-test')) {
    import('../tests/visual/harness.js').then(({qualityHarness})=>{
        window.fjordQuality=qualityHarness({renderer,scene,material:baseMaterial,sourceGeometry:()=>sourceMesh.geometry,getBundle:()=>assetBundle});
        window.fjordQuality.source=()=>assetBundle.source;
        window.fjordQuality.curveResults=()=>budgetCurve.getResults();
        window.fjordQuality.configure=fixture=>new Promise((resolve,reject)=>{
            Object.assign(state,{form:fixture.form,seed:fixture.seed,years:0,climate:'alpine',snow:0,ao:.82,view:'material'});
            resetSurface();Object.assign(state,fixture.surface??{});el('detail').value=fixture.resolution??88;
            aoAmount.value=state.ao;sync();cameraReset();lights();
            const timer=setTimeout(()=>{document.removeEventListener('fjord:ready',done);reject(Error('Quality fixture generation timed out.'));},120000);
            const done=()=>{clearTimeout(timer);resolve(window.fjordReady);};
            document.addEventListener('fjord:ready',done,{once:true});generate();
        });
    });
}

// The local batch renderer uses the same geometry, material and camera as the studio.
if(turntableMode) {
    let captureCanvas, captureContext, orbit;
    window.prepareTurntable=(size=2160,samples=1.5)=>{
        if(!atmosphereReady||!rockMeshes.length) throw Error('Wait for the sky and specimen to load.');
        scene.background.set(0);
        scene.fog=null;
        landscape.visible=false;
        skyFill.visible=false;
        const split=state.form===1;
        const sunAzimuth=presets[state.form].azimuth-(split?1.02:.88);
        const sunElevation=T.MathUtils.degToRad(split?29:34);
        const sunDirection=new T.Vector3(
            Math.sin(sunAzimuth)*Math.cos(sunElevation),
            Math.sin(sunElevation),
            Math.cos(sunAzimuth)*Math.cos(sunElevation)
        );
        setSkySun(sunDirection);
        rockLightDirection.value.copy(sunDirection);
        sun.color.set(0xffe9ce);
        sun.intensity=split?2.35:2.55;
        const skyScene=new T.Scene();
        // The lower hemisphere models daylight reflected by open ground.
        skyScene.add(makeSky(false,[.090,.101,.093]));
        const generator=new T.PMREMGenerator(renderer);
        const skyEnvironment=generator.fromScene(skyScene,.055,.1,240,{size:512});
        scene.environment=skyEnvironment.texture;
        scene.environmentIntensity=3.45;
        generator.dispose();
        for(const object of skyScene.children) {
            object.geometry.dispose();
            object.material.dispose();
        }
        renderer.toneMappingExposure=1.78;
        cameraLutStrength.value=1;
        renderer.setPixelRatio(1);
        renderer.setSize(Math.round(size*samples),Math.round(size*samples),false);
        const bounds=new T.Box3().setFromObject(rockGroup);
        const center=bounds.getCenter(new T.Vector3());
        sun.target.position.copy(center);
        sun.position.copy(center).addScaledVector(sunDirection,18);
        const span=bounds.getSize(new T.Vector3());
        let horizontalRadius=0;
        const position=sourceMesh.geometry.getAttribute('position');
        for(let i=0;i<position.count;i++) {
            horizontalRadius=Math.max(horizontalRadius,Math.hypot(position.getX(i)-center.x,position.getZ(i)-center.z));
        }
        const radius=Math.hypot(horizontalRadius,span.y*0.5);
        orbit={
            center,
            distance:radius/Math.sin(T.MathUtils.degToRad(17))*(split?.91:1),
            angle:presets[state.form].azimuth
        };
        camera.aspect=1;
        camera.fov=38;
        camera.updateProjectionMatrix();
        const shadowSize=Math.min(4096,renderer.capabilities.maxTextureSize);
        sun.shadow.mapSize.set(shadowSize,shadowSize);
        sun.shadow.map?.dispose();
        sun.shadow.map=null;
        sun.shadow.camera.left=-2.6;
        sun.shadow.camera.right=2.6;
        sun.shadow.camera.top=2.6;
        sun.shadow.camera.bottom=-2.6;
        sun.shadow.camera.updateProjectionMatrix();
        sun.shadow.normalBias=.0035;
        sun.shadow.bias=-.00009;
        sun.shadow.radius=1.65;
        renderer.shadowMap.autoUpdate=false;
        renderer.shadowMap.needsUpdate=true;
        captureCanvas=document.createElement('canvas');
        captureCanvas.width=captureCanvas.height=size;
        captureContext=captureCanvas.getContext('2d',{alpha:false});
        captureContext.imageSmoothingQuality='high';
    };
    window.turntableFrame=(fraction,format='image/jpeg')=>{
        const angle=orbit.angle+2*Math.PI*fraction;
        const elevation=state.form===1?.29:.31;
        camera.position.set(
            orbit.center.x+Math.sin(angle)*orbit.distance*Math.cos(elevation),
            orbit.center.y+orbit.distance*Math.sin(elevation),
            orbit.center.z+Math.cos(angle)*orbit.distance*Math.cos(elevation)
        );
        camera.lookAt(orbit.center);
        render();
        captureContext.drawImage(renderer.domElement,0,0,captureCanvas.width,captureCanvas.height);
        return captureCanvas.toDataURL(format,.97).split(',')[1];
    };
}
