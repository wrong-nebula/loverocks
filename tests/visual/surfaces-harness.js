import * as T from 'three';
import init from '../../src/wasm/fjord_engine.js';
import {generateSource} from '../../src/source.js';
import {buildLODs} from '../../src/lod.js';
import {simplifySkeleton} from '../../src/fracture-skeleton.js';
import {completeSurfaceLevel,budgetStudy,combineOpeningChecks} from '../../src/fracture-workflow.js';
import {createOpeningGPUValidator} from '../../src/opening-gpu.js';
import {tile} from './budget-harness.js';

export async function surfaceStudy(request,fixture){
    await init();const source=generateSource(request.source.job),renderer=new T.WebGLRenderer({antialias:false}),rows=[];
    const progress=message=>window.__surfaceProgress?.(`${fixture}: ${message}`);
    try {
        for(const target of request.budgets){
            await progress(`budget ${target}`);const {levels}=await buildLODs(source,{...request.settings,target,fractures:'surfaces'},()=>{}, {levels:[1]});
            const raw=levels[0],result=await completeSurfaceLevel(renderer,source,raw,request.settings,{steps:request.refineSteps,progress});
            const level=result.level,gpu=result.gpu;
            const row={fixture,target,triangles:level.stats.triangles,budgetMet:level.budgetMet,gpu,
                seedSelection:level.protection.seedSelection,refinement:level.protection.refinement,surfaces:level.protection.surfacePartition,
                development:level.protection.development,validation:level.protection.validation};
            const firstPass=gpu.status==='passed'&&!rows.some(r=>r.gpu.status==='passed');
            if(target===500||firstPass){
                const skeleton=await simplifySkeleton(source,target,request.settings),captures=new Map(),baselineChecks=[];
                for(const viewSet of ['development','validation']){
                    const validator=createOpeningGPUValidator(renderer,source,{viewSet});
                    try {
                        for(const [name,mesh] of [['skeleton',skeleton],['patches',raw],['fitted',level]]){
                            const check=await validator.measure(mesh,{onFrame:(view,frames)=>{
                                if(!['low-0','high-1','check-low-0','check-high-1'].includes(view.name))return;
                                if(!captures.has(view.name))captures.set(view.name,{source:frames.source,frames:[]});captures.get(view.name).frames.push({name,triangles:mesh.indices.length/3,frame:frames.candidate});
                            }});if(name==='skeleton')baselineChecks.push(check);
                        }
                    }finally{validator.dispose();}
                }
                row.skeletonBaseline=combineOpeningChecks(...baselineChecks);
                for(const [view,sheet] of captures){
                    const entries=[{name:'Source',triangles:source.indices.length/3,frame:sheet.source},...sheet.frames],width=144,canvas=document.createElement('canvas');canvas.width=entries.length*(width+14);canvas.height=550;
                    const ctx=canvas.getContext('2d');ctx.fillStyle='#151813';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.font='12px system-ui';ctx.fillStyle='#eeece2';ctx.fillText(`${fixture} · requested ${target} · ${view}`,8,18);
                    entries.forEach((entry,x)=>['silhouette','depth','error'].forEach((kind,y)=>{ctx.fillStyle='#eeece2';ctx.fillText(`${entry.name}: ${entry.triangles} tris`,x*(width+14)+6,42+y*170);ctx.drawImage(tile(entry.frame,kind,sheet.source,128),x*(width+14)+6,48+y*170);}));
                    await window.__surfaceSave(`${fixture}-${target}-${view}.png`,canvas.toDataURL('image/png').split(',')[1]);
                }
            }
            rows.push(row);await window.__surfaceRow(row);
        }
        return {fixture,source:request.source,refineSteps:request.refineSteps,rows,budgetStudy:budgetStudy(rows)};
    }finally{renderer.dispose();renderer.forceContextLoss();}
}
