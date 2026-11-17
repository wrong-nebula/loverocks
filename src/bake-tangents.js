import {Vector3} from 'three';

// Tiny charts can collapse to a point in the packed UV atlas. Their UV
// derivative has no tangent; use a deterministic orthogonal frame for both
// projection and export, without changing valid chart tangents or geometry.
export function repairDegenerateTangents(geometry) {
    const normal=geometry.getAttribute('normal'),tangent=geometry.getAttribute('tangent');
    const n=new Vector3(),t=new Vector3(),axis=new Vector3();
    let repaired=0;
    for(let i=0;i<tangent.count;i++) {
        t.fromBufferAttribute(tangent,i);
        if(Number.isFinite(t.lengthSq())&&t.lengthSq()>1e-12)continue;
        n.fromBufferAttribute(normal,i).normalize();
        if(!Number.isFinite(n.lengthSq())||n.lengthSq()<.5)throw Error('Cannot bake a mesh with invalid normals.');
        const x=Math.abs(n.x),y=Math.abs(n.y),z=Math.abs(n.z);
        axis.set(x<=y&&x<=z?1:0,y<x&&y<=z?1:0,z<x&&z<y?1:0);
        t.crossVectors(axis,n).normalize();
        tangent.setXYZW(i,t.x,t.y,t.z,1);repaired++;
    }
    tangent.needsUpdate=true;
    return repaired;
}
