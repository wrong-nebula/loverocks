import * as T from 'three';
import source from './atmosphere.glsl?raw';

const sun = {value:new T.Vector3()};
const transmittance = {value:null};
const irradiance = {value:null};
const scattering = {value:null};
const uniforms = {
    sunDirection:sun,
    transmittance_texture:transmittance,
    irradiance_texture:irradiance,
    scattering_texture:scattering,
    single_mie_scattering_texture:scattering
};
const sizes = [
    ['transmittance',256,64,0,transmittance],
    ['irradiance',64,16,0,irradiance],
    ['scattering',256,128,32,scattering]
];

export async function loadAtmosphere() {
    await Promise.all(sizes.map(async ([name,width,height,depth,uniform])=>{
        const response = await fetch(import.meta.env.BASE_URL+'atmosphere/'+name+'.bin');
        if(!response.ok) throw Error('Could not load the sky lookup tables.');
        const data = new Uint16Array(await response.arrayBuffer());
        if(data.length!==width*height*(depth||1)*4) throw Error('The sky lookup tables are incomplete.');
        const texture = depth ? new T.Data3DTexture(data,width,height,depth) : new T.DataTexture(data,width,height);
        texture.type=T.HalfFloatType;
        texture.minFilter=texture.magFilter=T.LinearFilter;
        texture.needsUpdate=true;
        uniform.value=texture;
    }));
}

export function setSkySun(direction) { sun.value.copy(direction); }

export function makeSky(includeSun=true, groundRadiance=[.052,.062,.045]) {
    const material = new T.ShaderMaterial({
        uniforms:{...uniforms,groundRadiance:{value:new T.Color(...groundRadiance)}}, side:T.BackSide, depthWrite:false,
        vertexShader:`varying vec3 skyDirection;
            void main(){
                skyDirection=position;
                gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);
            }`,
        fragmentShader:`${source}
            varying vec3 skyDirection;
            uniform vec3 sunDirection;
            uniform vec3 groundRadiance;
            void main(){
                vec3 dir=normalize(skyDirection);
                vec3 sky=studioSky(dir,sunDirection,max(.001,fwidth(dir.x)),${includeSun});
                vec3 color=mix(sky*vec3(.77,.86,.79),groundRadiance,smoothstep(.0,.20,-dir.y));
                gl_FragColor=vec4(color,1.);
                #include <tonemapping_fragment>
                #include <colorspace_fragment>
            }`
    });
    const dome=new T.Mesh(new T.SphereGeometry(145,48,32),material);
    dome.renderOrder=-2;
    return dome;
}

export function makeWater() {
    const material = new T.ShaderMaterial({
        uniforms, transparent:true, depthWrite:false,
        vertexShader:`varying vec3 waterPosition;
            void main(){
                vec4 world=modelMatrix*vec4(position,1.);
                waterPosition=world.xyz;
                gl_Position=projectionMatrix*viewMatrix*world;
            }`,
        fragmentShader:`${source}
            varying vec3 waterPosition;
            uniform vec3 sunDirection;

            vec2 wave(vec2 p,vec2 direction,float frequency,float amplitude,float phase){
                float width=fwidth(dot(p,direction))*frequency;
                return direction*cos(dot(p,direction)*frequency+phase)*amplitude*(1.-smoothstep(.7,3.1,width));
            }
            void main(){
                vec3 view=normalize(cameraPosition-waterPosition);
                vec2 p=waterPosition.xz;
                float warp=sin(dot(p,vec2(.42,.68)))*1.16+sin(dot(p,vec2(-.58,.19)))*.83;
                vec2 slope=wave(p,vec2(.19,.98),4.3,.011,warp)
                    +wave(p,vec2(-.48,.88),7.4,.013,1.3-warp)
                    +wave(p,vec2(.74,.67),14.1,.009,warp)
                    +wave(p,vec2(-.87,.49),23.0,.004,-warp);
                vec3 normal=normalize(vec3(slope.x,1.,slope.y));
                vec3 reflected=reflect(-view,normal);
                float facing=clamp(dot(normal,view),0.,1.);
                float fresnel=.02037+.97963*pow(1.-facing,5.);
                vec3 reflectedSky=studioSky(reflected,sunDirection,.004,false)*vec3(.57,.69,.66);
                float glint=pow(max(0.,dot(reflected,sunDirection)),240.);
                vec3 deep=mix(vec3(.031,.087,.059),vec3(.019,.049,.047),smoothstep(10.,75.,length(waterPosition-cameraPosition)));
                float attenuation=mix(.30,.76,1.-smoothstep(.04,.34,facing));
                float alpha=fresnel+(1.-fresnel)*attenuation;
                vec3 color=(fresnel*reflectedSky+(1.-fresnel)*attenuation*deep)/alpha;
                color+=vec3(.27,.20,.095)*glint*fresnel;
                gl_FragColor=vec4(color,alpha);
                #include <tonemapping_fragment>
                #include <colorspace_fragment>
            }`
    });
    const water=new T.Mesh(new T.PlaneGeometry(300,300),material);
    water.position.set(0,-0.27,-110);
    water.rotation.x=-Math.PI/2;
    water.renderOrder=2;
    water.name='Lake';
    return water;
}
