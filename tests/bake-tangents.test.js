import test from 'node:test';
import assert from 'node:assert/strict';
import {BufferGeometry,Float32BufferAttribute,Vector3} from 'three';
import {repairDegenerateTangents} from '../src/bake-tangents.js';

test('collapsed UV charts get unit orthogonal tangents without moving protected faces',()=>{
    const g=new BufferGeometry();
    g.setAttribute('position',new Float32BufferAttribute([0,0,0,1,0,0,0,1,0],3));
    g.setAttribute('normal',new Float32BufferAttribute([0,0,1,0,0,1,0,0,1],3));
    g.setAttribute('uv',new Float32BufferAttribute([0,0,0,0,0,0],2));g.setIndex([0,1,2]);
    const positions=g.attributes.position.array.slice(),indices=g.index.array.slice();
    g.computeTangents();assert.equal(repairDegenerateTangents(g),3);
    for(let i=0;i<3;i++) {
        const t=new Vector3().fromBufferAttribute(g.attributes.tangent,i),n=new Vector3().fromBufferAttribute(g.attributes.normal,i);
        assert.ok(Math.abs(t.length()-1)<1e-6);assert.ok(Math.abs(t.dot(n))<1e-6);
        assert.equal(g.attributes.tangent.getW(i),1);
    }
    assert.deepEqual(g.attributes.position.array,positions);assert.deepEqual(g.index.array,indices);
    const tangents=g.attributes.tangent.array.slice();
    assert.equal(repairDegenerateTangents(g),0);assert.deepEqual(g.attributes.tangent.array,tangents);
});
