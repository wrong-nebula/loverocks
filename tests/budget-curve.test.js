import test from 'node:test';
import assert from 'node:assert/strict';
import {parseBudgets,gpuVerdict,curveSettingsKey} from '../src/budget-policy.js';
import {normalizeSettings} from '../src/lod-policy.js';
test('custom budget sets are bounded, ordered and deduplicated without silently clamping input',()=>{
    assert.deepEqual(parseBudgets('2000, 500; 750\n1000 500'),[500,750,1000,2000]);
    assert.deepEqual(parseBudgets('24,50000'),[24,50000]);
    for(const value of ['', '0,500','50001','1e3','500.5','-100','Infinity','500, <script>','1000,'.repeat(13)])assert.throws(()=>parseBudgets(value));
});
test('curve verdict distinguishes GPU acceptance, diagnostics and missing observations',()=>{
    assert.equal(gpuVerdict({status:'passed',failed:0,inScope:true}),'Pass at 128 px');
    assert.equal(gpuVerdict({status:'passed',failed:0,inScope:false}),'Diagnostic only');
    assert.equal(gpuVerdict({status:'needs-review',failed:1,inScope:true}),'Review required');
    assert.equal(gpuVerdict({status:'unavailable'}),'Not checked');
    assert.equal(gpuVerdict({status:'not-visible'}),'No visible regions');
    const settings={budgets:[500,1000],method:'skeleton',size:128,priority:'budget',tolerance:.03,features:1};
    for(const changed of [{size:64},{budgets:[500,2000]},{method:'anchors'},{tolerance:.01},{priority:'quality'}])assert.notEqual(curveSettingsKey(settings),curveSettingsKey({...settings,...changed}));
    assert.equal(normalizeSettings({fractures:'skeleton',priority:'budget'}).priority,'budget');
    assert.equal(normalizeSettings({fractures:'anchors',priority:'budget'}).priority,'quality');
});
