import * as T from 'three';
import {makeWater} from './atmosphere.js';
import {seeded} from './random.js';
import {paintingCamera,paintingGround,paintingAspect} from './layout.js';

const eye=new T.Vector3(...paintingCamera.eye);
const forward=new T.Vector3(...paintingCamera.aim).sub(eye).normalize();
const up=new T.Vector3(1,0,0).cross(forward);
const smooth=(a,b,x)=>{const t=T.MathUtils.clamp((x-a)/(b-a),0,1);return t*t*(3-2*t);};
const edge=x=>0.411+0.27*T.MathUtils.clamp(x,0,1.12)+0.17*smooth(0.20,0.67,x)
    +0.095*smooth(0.73,1.05,x)+0.010*Math.sin(11*x)-0.009*Math.sin(23*x+1.2);
function uv(x,y,z) {
    const rel=new T.Vector3(x,y,z).sub(eye), depth=rel.dot(forward);
    return [0.5+rel.x*1.3/(depth*paintingAspect),0.5-rel.dot(up)*1.3/depth];
}
function at(u,v) {
    const ray=forward.clone().addScaledVector(up,(1-2*v)/paintingCamera.zoom);
    ray.x=(2*u-1)*paintingAspect/paintingCamera.zoom;
    let t=-eye.y/ray.y;
    for(let i=0;i<8;i++) t=(paintingGround(ray.x*t,ray.z*t)-eye.y)/ray.y;
    return eye.clone().addScaledVector(ray,t);
}
function biome(u,v) {
    const path=0.265+0.264*smooth(0.76,1.04,v)+0.073*(1-smooth(0.64,0.79,v));
    const track=1-smooth(0.008,0.042,Math.abs(u-path)+0.006*Math.sin(v*220));
    const gold=(1-smooth(0.66,0.76,v))*(1-smooth(0.46,0.60,u))
        +0.73*Math.exp(-((u-0.587)**2/0.142**2+(v-0.714)**2/0.047**2));
    return [track,Math.min(1,gold)];
}
function soilColor(u,v,random) {
    const [track,gold]=biome(u,v);
    const patches=0.52+0.26*Math.sin(u*78+v*42)*Math.cos(v*60)+0.22*(random-0.5);
    const grass=new T.Color(0x363b18).lerp(new T.Color(0x747932),patches);
    const straw=new T.Color(0x92703a).lerp(new T.Color(0xad8950),patches);
    return grass.lerp(straw,gold).lerp(new T.Color(0x796346).multiplyScalar(0.74+0.37*patches),track*0.91);
}

export function makeLandscape(seed,grassAmount) {
    const group=new T.Group();
    const random=seeded(seed+'/meadow');
    const vertices=[], colors=[], indices=[];
    const columns=192, rows=125;
    for(let j=0;j<=rows;j++) for(let i=0;i<=columns;i++) {
        const u=-0.06+1.12*i/columns, v=edge(u)+(1.09-edge(u))*j/rows;
        const p=at(u,v);
        vertices.push(p.x,p.y,p.z);
        colors.push(...soilColor(u,v,random()).toArray());
        if(i<columns && j<rows) {
            const a=j*(columns+1)+i,b=a+columns+1;
            indices.push(a,b,a+1,a+1,b,b+1);
        }
    }
    const ground=new T.BufferGeometry();
    ground.setAttribute('position',new T.Float32BufferAttribute(vertices,3));
    ground.setAttribute('color',new T.Float32BufferAttribute(colors,3));
    ground.setIndex(indices);
    ground.computeVertexNormals();
    const earth=new T.Mesh(ground,new T.MeshStandardMaterial({vertexColors:true,roughness:0.97}));
    earth.receiveShadow=true;
    group.add(earth);

    const blades=new T.BufferGeometry();
    const points=[], bladeColors=[], bladeIndices=[];
    for(let i=0;i<7;i++) {
        const a=random()*Math.PI*2, dx=Math.cos(a),dz=Math.sin(a);
        const width=0.008+random()*0.006, height=0.08+random()*0.10;
        const start=points.length/3;
        points.push(-dz*width,0,dx*width,dz*width,0,-dx*width,
            dx*0.022-dz*width*0.68,height*0.55,dz*0.022+dx*width*0.68,
            dx*0.022+dz*width*0.68,height*0.55,dz*0.022-dx*width*0.68,
            dx*0.066,height,dz*0.066);
        for(const shade of [0.40,0.40,0.78,0.80,1.14]) bladeColors.push(shade,shade,shade);
        bladeIndices.push(start,start+1,start+2,start+1,start+3,start+2,start+2,start+3,start+4);
    }
    blades.setAttribute('position',new T.Float32BufferAttribute(points,3));
    blades.setAttribute('color',new T.Float32BufferAttribute(bladeColors,3));
    blades.setIndex(bladeIndices);
    blades.computeVertexNormals();
    const attempts=Math.round(27500*grassAmount);
    const grass=new T.InstancedMesh(blades,new T.MeshLambertMaterial({vertexColors:true,side:T.DoubleSide}),attempts);
    const dummy=new T.Object3D();
    let count=0;
    for(let i=0;i<attempts;i++) {
        const u=-0.04+random()*1.08, v=edge(u)+(1.08-edge(u))*random();
        const [track,gold]=biome(u,v);
        const patch=0.68+0.25*Math.sin(u*87+v*63)*Math.sin(v*44-u*11);
        if(random()>(1-0.94*track)*T.MathUtils.lerp(patch,0.99,gold)) continue;
        dummy.position.copy(at(u,v));
        dummy.rotation.y=random()*Math.PI*2;
        dummy.scale.setScalar(0.50+0.75*random()+gold*0.49);
        dummy.updateMatrix();
        grass.setMatrixAt(count,dummy.matrix);
        grass.setColorAt(count,new T.Color(0x42521f).lerp(new T.Color(0x9e9840),random()*0.48)
            .lerp(new T.Color(0xcba25e),gold*(0.76+0.24*random())));
        count++;
    }
    grass.count=count;
    grass.receiveShadow=true;
    group.add(grass);

    group.add(makeWater());
    return group;
}

export function makePebbles(rockMeshes,placements,seed) {
    const random=seeded(seed+'/pebbles'),group=new T.Group();
    const source=rockMeshes.slice(0,13);
    for(const [index,parent] of source.entries()) {
        if(!parent) continue;
        const transform=placements[index];
        const mesh=new T.InstancedMesh(parent.geometry,parent.material,35);
        const dummy=new T.Object3D();
        let count=0;
        for(let i=0;i<35;i++) {
            const angle=random()*Math.PI*2, radius=0.38+random()**1.4*1.28;
            const x=transform.foot[0]+Math.cos(angle)*radius;
            const z=transform.foot[2]+Math.sin(angle)*radius;
            const y=paintingGround(x,z);
            const [u,v]=uv(x,y,z);
            if(v<edge(u)+0.006 || u< -0.03 || u>1.04 || v>1.07) continue;
            const [track]=biome(u,v);
            if(track>0.8 && random()>0.38) continue;
            dummy.position.set(x,y-0.02,z);
            dummy.rotation.set(0,random()*Math.PI*2,0);
            const size=0.017+0.061*random()**1.9;
            dummy.scale.set(size,size*(0.42+random()*0.47),size*(0.78+0.36*random()));
            dummy.updateMatrix();
            mesh.setMatrixAt(count++,dummy.matrix);
        }
        mesh.count=count;
        mesh.receiveShadow=true;
        group.add(mesh);
    }
    return group;
}
