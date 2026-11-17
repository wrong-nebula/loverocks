import {buildLODs} from '../../src/lod.js';
import {createOpeningGPUValidator} from '../../src/opening-gpu.js';
import {openingRegions} from '../../src/opening-acceptance.js';
import * as T from 'three';
function tile(frame,kind,source,size) {
    const width=size+16,canvas=document.createElement('canvas');canvas.width=canvas.height=width;
    const bytes=new Uint8ClampedArray(width*width*4),regions=openingRegions(source,width,width),eligible=new Set(regions.walls.filter(o=>o.pixels.length>=8).flatMap(o=>o.pixels));
    for(let i=0;i<width*width;i++) {
        const at=((width-1-Math.floor(i/width))*width+i%width)*4,hit=frame.silhouette[i*4]>127;
        let color=kind==='silhouette'?[frame.silhouette[i*4],frame.silhouette[i*4],frame.silhouette[i*4]]:hit?[220-frame.depth[i]*160,210-frame.depth[i]*150,180-frame.depth[i]*130]:[21,24,19];
        if(kind==='error'&&eligible.has(i))color=!hit||Math.abs(source.depth[i]-frame.depth[i])*size>2?[250,70,100]:[75,165,190];
        bytes.set([...color,255],at);
    }
    canvas.getContext('2d').putImageData(new ImageData(bytes,width,width),0,0);return canvas;
}
export async function runBudgetExperiment(source,{fixture,budgets=[500,750,1000,2000],methods=['off','anchors-off','skeleton'],repairComparison=false}={}) {
    const renderer=new T.WebGLRenderer({antialias:false}),rows=[],sheets=new Map(),size=128,width=size+16;
    const validator=createOpeningGPUValidator(renderer,source,{size,azimuths:repairComparison?4:8});
    const old=repairComparison?(await import(/* @vite-ignore */ '/tests/fixtures/opening-v3/lod.js')).buildLODs:null;
    try {
        for(const method of methods)for(const target of budgets) {
            window.qualityProgress=`${fixture}: ${method} ${target} reducing`;
            const reduce=method==='before'?old:buildLODs;
            const settings={target,fractures:method==='anchors-off'||method==='before'?'anchors':method,openingRepair:method!=='anchors-off',priority:'budget',tolerance:.03};
            const result=await reduce(source,settings,p=>window.qualityProgress=`${fixture} ${method} ${target}: ${p}`,{levels:[1]});
            const level=result.levels[0];level.target??=target;level.stats??={triangles:level.indices.length/3};level.protection.openings??={};
            const gpu=await validator.measure(level,{progress:p=>window.qualityProgress=`${fixture} ${method} ${target}: ${p}`,onFrame:(view,frames)=>{
                if(!['low-0','low-2','low-3','high-1'].includes(view.name))return;
                const key=`${fixture}-${method}-${view.name}`;
                if(!sheets.has(key))sheets.set(key,{source:frames.source,frames:[]});
                sheets.get(key).frames.push({target,triangles:level.stats.triangles,frame:frames.candidate});
            }});
            rows.push({fixture,method,target,triangles:level.stats.triangles,budgetMet:level.budgetMet,qualityMet:level.qualityMet,deviation:level.deviation,skeleton:level.protection.skeleton,
                cpu:{status:level.protection.openings.status,failed:level.protection.openings.failed},gpu});
            if(window.__budgetRow)await window.__budgetRow(rows.at(-1));
        }
        for(const [name,sheet] of sheets) {
            const frames=[{target:'Source',triangles:source.indices.length/3,frame:sheet.source},...sheet.frames];
            const canvas=document.createElement('canvas');canvas.width=frames.length*(width+12);canvas.height=(width+30)*3+28;
            const ctx=canvas.getContext('2d');ctx.fillStyle='#151813';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.fillStyle='#eeece2';ctx.font='12px system-ui';ctx.fillText(name+' · silhouette / depth / wall errors',8,18);
            for(const [column,entry] of frames.entries())for(const [row,kind] of ['silhouette','depth','error'].entries()){
                const x=column*(width+12)+6,y=28+row*(width+30);ctx.fillStyle='#eeece2';ctx.fillText(`${entry.target} · ${entry.triangles} tris`,x,y+16);ctx.drawImage(tile(entry.frame,kind,sheet.source,size),x,y+22);
            }
            if(window.__qualitySave)await window.__qualitySave(name+'.png',canvas.toDataURL('image/png').split(',')[1]);
        }
        return rows;
    }finally{validator.dispose();renderer.dispose();renderer.forceContextLoss();}
}
