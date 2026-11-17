import * as T from 'three';
import init from '../src/wasm/fjord_engine.js';
import {generateSource} from '../src/source.js';
import {buildLODs} from '../src/lod.js';
import {createOpeningGPUValidator} from '../src/opening-gpu.js';
import {OPENING_ACCEPTANCE} from '../src/opening-acceptance.js';
import {curveSettingsKey,gpuVerdict} from '../src/budget-policy.js';

window.runBudgetCurve=async request=>{
    const progress=async message=>window.reportProgress?.(message);
    await init();await progress('Generating the reference surface…');
    const source=generateSource(request.source.job),renderer=new T.WebGLRenderer({antialias:false});
    let validator;
    try {
        validator=createOpeningGPUValidator(renderer,source,{size:request.size});
        if(!validator)throw Error('This source has no usable fracture labels.');
        const rows=[];
        for(const target of request.budgets) {
            await progress(`Reducing to ${target} triangles…`);
            const {levels}=await buildLODs(source,{...request.settings,target},()=>{}, {levels:[1]});
            const level=levels[0],gpu=await validator.measure(level,{progress:message=>progress(`${target}: ${message}`)});
            if(request.detail!=='full'){delete gpu.rows;delete gpu.failures;}
            rows.push({target,triangles:level.stats.triangles,budgetMet:level.budgetMet,qualityMet:level.qualityMet,
                simplifierError:level.simplifierError,deviation:level.deviation,skeleton:level.protection.skeleton,
                cpu:{status:level.protection.openings.status,failed:level.protection.openings.failed},gpu,verdict:gpuVerdict(gpu)});
        }
        return {schema:1,source:request.source,budgets:request.budgets,method:request.method,size:request.size,settings:request.settings,
            key:curveSettingsKey({...request,...request.settings}),acceptancePolicy:OPENING_ACCEPTANCE,complete:true,
            detail:request.detail,backend:'chromium-webgl-swiftshader',rows};
    }finally{validator?.dispose();renderer.dispose();renderer.forceContextLoss();}
};
