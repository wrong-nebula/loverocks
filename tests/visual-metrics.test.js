import test from 'node:test';
import assert from 'node:assert/strict';
import {compareImages} from './visual/metrics.js';

function frame(w,h,hole=false,shift=0) {
    const data={};for(const p of ['silhouette','fracture','normal','color'])data[p]=new Uint8Array(w*h*4);
    for(let y=4;y<h-4;y++)for(let x=4+shift;x<w-4+shift;x++) {
        if(hole&&x>=12+shift&&x<20+shift&&y>=9&&y<23)continue;
        const i=(y*w+x)*4;data.silhouette.set([255,255,255,255],i);data.fracture.set([255,255,255,255],i);
        data.normal.set([128,128,255,255],i);data.color.set([64,128,192,255],i);
    }
    return data;
}
test('identical images have perfect silhouette, appearance and normal metrics',()=>{
    const a=frame(32,32,true),m=compareImages(a,a,32,32);
    assert.equal(m.silhouetteIoU,1);assert.equal(m.boundaryP95Px,0);assert.equal(m.colorMAE,0);assert.ok(m.normalMeanDeg<1e-5);
    assert.ok(m.gapPixels>0);assert.equal(m.gapFill,0);
});
test('closing an opening is detected even with the same exterior silhouette',()=>{
    const m=compareImages(frame(32,32,true),frame(32,32),32,32);
    assert.equal(m.gapFill,1);assert.ok(m.extraArea>.2);assert.ok(m.silhouetteIoU<.85);
});
test('a one-pixel shift is measured in pixels, independently of colour',()=>{
    const m=compareImages(frame(32,32),frame(32,32,false,1),32,32);
    assert.equal(m.boundaryP95Px,1);assert.equal(m.colorMAE,0);assert.ok(m.silhouetteIoU<1);
});
test('normal and material changes are detected independently',()=>{
    const a=frame(32,32),b=structuredClone(a);
    for(let i=0;i<32*32;i++)if(b.silhouette[i*4]){b.normal.set([255,128,128,255],i*4);b.color[i*4]+=30;}
    const m=compareImages(a,b,32,32);
    assert.equal(m.silhouetteIoU,1);assert.ok(m.normalMeanDeg>89);assert.ok(Math.abs(m.colorMAE-30/255/3)<1e-6);
});
test('empty references fail rather than producing a passing score',()=>{
    const a=frame(8,8);assert.throws(()=>compareImages(a,a,8,8),/empty/);
});
test('cavity flattening is detected even when silhouette and materials match',()=>{
    const a=frame(32,32),b=structuredClone(a);
    a.depth=new Float32Array(32*32).fill(.5);b.depth=new Float32Array(32*32).fill(.4);
    const m=compareImages(a,b,32,32);
    assert.equal(m.silhouetteIoU,1);assert.equal(m.colorMAE,0);
    assert.ok(Math.abs(m.fractureDepthP95-.1)<1e-6);
});
