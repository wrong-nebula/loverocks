import test from 'node:test';
import assert from 'node:assert/strict';
import {regressionFailures} from './visual/regression.js';
const row={fixture:'split',view:'front',size:128,profile:'anchors',triangles:1000,metrics:{silhouetteIoU:.98,boundaryP95Px:1,gapFill:.02,colorMAE:.03,normalMeanDeg:5,fractureDepthP95:.005,fractureLostArea:0}};
test('visual gate accepts repeatable measurements and catches a real regression',()=>{
    assert.deepEqual(regressionFailures([row],{rows:[row]}),[]);
    const broken=structuredClone(row);broken.metrics.gapFill=.7;
    assert.match(regressionFailures([broken],{rows:[row]}).join(' '),/gapFill regressed/);
});
test('lost measurements, matrix entries, invalid values and budget changes fail the gate',()=>{
    for(const change of [r=>r.metrics.fractureDepthP95=null,r=>r.metrics.colorMAE=NaN,r=>r.triangles=2000]) {
        const changed=structuredClone(row);change(changed);assert.ok(regressionFailures([changed],{rows:[row]}).length);
    }
    assert.ok(regressionFailures([],{rows:[row]}).length);
    assert.ok(regressionFailures([row,row],{rows:[row]}).length);
});
