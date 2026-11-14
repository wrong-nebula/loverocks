varying vec4 vSurface;
varying vec3 vRockPoint;
varying vec3 vRockNormal;
varying float vFresh;
uniform sampler2D rockSurfaceMap;
uniform float rockGrain;
uniform float rockMapAmount;

vec3 rockHash(vec3 p){
    p=fract(p*vec3(.1031,.1030,.0973));
    p+=dot(p,p.yxz+33.33);
    return fract((p.xxy+p.yxx)*p.zyx);
}

float rockNoise(vec3 p){
    vec3 i=floor(p),f=fract(p);
    f=f*f*(3.-2.*f);
    vec2 a=mix(vec2(rockHash(i).x,rockHash(i+vec3(0,0,1)).x),
        vec2(rockHash(i+vec3(1,0,0)).x,rockHash(i+vec3(1,0,1)).x),f.x);
    vec2 b=mix(vec2(rockHash(i+vec3(0,1,0)).x,rockHash(i+vec3(0,1,1)).x),
        vec2(rockHash(i+vec3(1,1,0)).x,rockHash(i+vec3(1,1,1)).x),f.x);
    vec2 c=mix(a,b,f.y);
    return mix(c.x,c.y,f.z);
}

float filteredGrain(vec3 p,float frequency,float footprint){
    return (rockNoise(p*frequency)-.5)*(1.-smoothstep(.32,1.18,footprint*frequency));
}

vec4 surfaceMap(vec3 p,vec3 n){
    vec3 weight=abs(normalize(n));
    weight*=weight;
    weight*=weight;
    weight/=max(.001,weight.x+weight.y+weight.z);
    vec3 q=p*.77+vec3(.31,.63,.17);
    return weight.x*texture2D(rockSurfaceMap,vec2(q.z*1.23+q.y*.14,q.y*.72))
         + weight.y*texture2D(rockSurfaceMap,vec2(q.x+q.z*.23,q.z))
         + weight.z*texture2D(rockSurfaceMap,vec2(q.x*1.13-q.y*.21,q.y*.74));
}

vec2 lichenColony(vec3 p,float footprint){
    float colonization=rockNoise(p*4.1+vec3(5.4,23.7,8.2));
    float habitat=smoothstep(.27,.77,vSurface.w*(.50+.73*colonization))*(1.-.98*vFresh);
    if(habitat<.012)return vec2(0.);
    const float frequency=12.5;
    vec3 q=p*frequency+vec3(27.4,14.1,53.7);
    vec3 cell=floor(q);
    vec3 local=fract(q);
    float nearest=2.;
    float pigment=.5;
    for(int z=-1;z<=1;z++){
        for(int y=-1;y<=1;y++){
            for(int x=-1;x<=1;x++){
                vec3 neighbor=vec3(float(x),float(y),float(z));
                vec3 random=rockHash(cell+neighbor);
                vec3 delta=neighbor+mix(vec3(.12),vec3(.88),random)-local;
                float d=length(delta*vec3(.94,1.12,1.));
                float radius=mix(.095,.41,random.y*random.y);
                if(d-radius<nearest){
                    nearest=d-radius;
                    pigment=random.x;
                }
            }
        }
    }
    float edgeNoise=filteredGrain(p+vec3(19.2,0.,0.),68.,footprint);
    float blur=clamp(footprint*frequency*.77,.012,.23);
    float colony=1.-smoothstep(-blur,blur,nearest+edgeNoise*.22);
    return vec2(colony*habitat,pigment);
}
