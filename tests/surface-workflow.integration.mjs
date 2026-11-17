import test from 'node:test';
import assert from 'node:assert/strict';
import {runCurve} from '../automation/runner.js';
test('surface workflow reports seed selection, bounded fitting, and unseen-angle validation',{timeout:180000},async()=>{
    const report=await runCurve({source:{form:0,resolution:32},budgets:[500],method:'surfaces',refineSteps:2,detail:'full'});
    const row=report.rows[0];assert.equal(row.gpu.cameras,32);assert.equal(row.gpu.viewSet,'development+validation');
    assert.ok(row.surfaces.patches.length>0);assert.ok(row.seedSelection.candidates.some(c=>c.name==='patches'));
    assert.ok(row.seedSelection.candidates.some(c=>c.name==='skeleton'));
    assert.ok(row.gpu.rows.some(r=>r.view.startsWith('check-')));
    const history=row.refinement.history;
    for(let i=1;i<history.length;i++){assert.ok(history[i].triangles<=500||history[i].operation==='stalled');assert.ok(history[i].failed<=history[i-1].failed);assert.ok(history[i].worst<=history[i-1].worst+1e-5);assert.ok(history[i].gaps<=history[i-1].gaps);}
    if(row.validation.failed)assert.equal(row.gpu.status,'needs-review');
    assert.equal(report.budgetStudy.provenMinimum,false);
});
