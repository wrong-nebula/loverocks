import test from 'node:test';
import assert from 'node:assert/strict';
import {openingAcceptance,openingAcceptanceFailures} from './visual/opening-acceptance.js';

function frame(w=16) {
    const f={silhouette:new Uint8Array(w*w*4),semantic:new Uint8Array(w*w*4),depth:new Float32Array(w*w)};
    for(let y=2;y<w-2;y++)for(let x=2;x<w-2;x++) {
        const i=y*w+x;if(x>=6&&x<=9&&y>=6&&y<=9)continue;
        f.silhouette[i*4]=255;f.semantic[i*4]=1;f.semantic[i*4+2]=x<8?0:2;f.depth[i]=.4;
    }
    return f;
}
test('per-opening acceptance rejects a closed hole even against an identical regression baseline',()=>{
    const source=frame(),candidate=structuredClone(source);
    assert.equal(openingAcceptance(source,candidate,16,16,128).status,'passed');
    for(let y=6;y<=9;y++)for(let x=6;x<=9;x++)candidate.silhouette[(y*16+x)*4]=255;
    const acceptance=openingAcceptance(source,candidate,16,16,128);
    assert.equal(acceptance.status,'failed');assert.ok(acceptance.openings.some(o=>o.kind==='opening'&&!o.accepted));
    const rows=[{fixture:'closed',view:'front',size:128,profile:'anchors',acceptance}];
    assert.ok(openingAcceptanceFailures(rows).length>0,'recording this image as a baseline cannot change absolute acceptance');
});
test('wall checks expose cavity flattening, lost walls and missing semantic captures',()=>{
    const source=frame(),candidate=structuredClone(source);
    candidate.depth.fill(.5);
    assert.ok(openingAcceptance(source,candidate,16,16,128).openings.some(o=>o.kind==='wall'&&o.depthP95Px>2&&!o.accepted));
    candidate.silhouette.fill(0);
    assert.equal(openingAcceptance(source,candidate,16,16,128).status,'failed');
    delete source.semantic;
    assert.equal(openingAcceptance(source,candidate,16,16,128).status,'unavailable');
    assert.ok(openingAcceptanceFailures([{fixture:'missing',view:'front',size:128,profile:'anchors'}]).length);
});
test('one closed opening cannot hide behind another opening or a large good wall',()=>{
    const source=frame(32),candidate=structuredClone(source);
    // The first hole exists at 6..9. Add a second hole on the same fracture ID.
    for(let y=18;y<=21;y++)for(let x=18;x<=21;x++)source.silhouette[(y*32+x)*4]=source.semantic[(y*32+x)*4]=0;
    for(let y=6;y<=9;y++)for(let x=6;x<=9;x++)candidate.silhouette[(y*32+x)*4]=255;
    for(let y=18;y<=21;y++)for(let x=18;x<=21;x++)candidate.silhouette[(y*32+x)*4]=0;
    const result=openingAcceptance(source,candidate,32,32,128),gaps=result.openings.filter(o=>o.kind==='opening');
    assert.equal(gaps.length,2);assert.equal(gaps.filter(g=>!g.accepted).length,1);
    assert.equal(openingAcceptance(source,candidate,32,32,256).inScope,false,'larger stress captures do not change the intended viewing-size contract');
});
