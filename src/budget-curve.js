import {DEFAULT_BUDGETS,parseBudgets,curveSettingsKey,gpuVerdict} from './budget-policy.js';
import {OPENING_ACCEPTANCE} from './opening-acceptance.js';
import {createOpeningGPUValidator} from './opening-gpu.js';
import {normalizeSettings} from './lod-policy.js';
const $=id=>document.getElementById(id),storageKey='loverocks.budget-curve.v1';
export function installBudgetCurve({renderer,getSource,getSettings,getIdentity,apply}) {
    let worker,controller,version=0,rows=[],selection=-1,snapshot=null,busy=false,sourceKey,supported=false,blocked=false;
    try {const saved=JSON.parse(localStorage.getItem(storageKey));if(saved){parseBudgets(saved.budgets);$('curve-budgets').value=saved.budgets;if(['skeleton','anchors','anchors-off','strict','off'].includes(saved.method))$('curve-method').value=saved.method;if(['budget','quality'].includes(saved.priority))$('curve-priority').value=saved.priority;if([64,128,256].includes(saved.size))$('curve-size').value=saved.size;}}catch{}
    const status=message=>$('curve-status').textContent=message;
    function cancel(message='Comparison cancelled. Completed points remain available.') {
        version++;worker?.terminate();worker=null;controller?.abort();controller=null;busy=false;
        $('curve-run').disabled=blocked||!supported||!getSource();$('curve-cancel').hidden=true;if(message)status(message);
    }
    function clear(message='Settings changed. Run the comparison again.') {
        cancel(message);rows=[];selection=-1;snapshot=null;draw();
    }
    function draw() {
        const qualityRequired=['anchors','anchors-off','strict'].includes($('curve-method').value);
        if(qualityRequired)$('curve-priority').value='quality';
        $('curve-priority').disabled=blocked||!supported||qualityRequired;
        const metric=$('curve-metric').value,values={depth:r=>r.gpu.depthP95Px,silhouette:r=>r.gpu.silhouetteIoU===null?null:r.gpu.silhouetteIoU*100,failures:r=>r.gpu.failed};
        const label={depth:'Worst wall p95 · pixels',silhouette:'Silhouette overlap · %',failures:'Failed region checks'}[metric];
        const points=rows.map((r,i)=>({i,x:r.triangles,y:values[metric](r)})).filter(p=>Number.isFinite(p.y)).sort((a,b)=>a.x-b.x||a.i-b.i);
        $('curve-plot').hidden=!rows.length;$('curve-table').hidden=!rows.length;
        $('curve-use').disabled=blocked||selection<0;$('curve-export').disabled=blocked||!rows.length;
        if(!rows.length){$('curve-plot').replaceChildren();$('curve-table').replaceChildren();$('curve-selected').textContent='';return;}
        const maxX=Math.max(1,...points.map(p=>p.x)),maxY=metric==='silhouette'?100:Math.max(metric==='depth'?2:1,...points.map(p=>p.y))*1.1;
        const x=n=>42+n/maxX*244,y=n=>162-n/maxY*124;
        const line=points.map(p=>`${x(p.x)},${y(p.y)}`).join(' '),ticks=[0,.5,1];
        $('curve-plot').innerHTML=`<svg viewBox="0 0 310 204" role="group" aria-label="${label} against actual triangle count"><text x="42" y="16">${label}</text><path class="curve-axis" d="M42 30V162H286"/>${ticks.map(t=>`<text x="36" y="${y(t*maxY)+4}" text-anchor="end">${(t*maxY).toFixed(metric==='failures'?0:1)}</text><text x="${x(t*maxX)}" y="180" text-anchor="middle">${Math.round(t*maxX).toLocaleString()}</text>`).join('')}<text x="164" y="199" text-anchor="middle">Actual triangles</text>${metric==='depth'?`<path class="curve-threshold" d="M42 ${y(2)}H286"><title>Fixed 128-pixel acceptance depth limit: 2 pixels</title></path>`:''}<polyline class="curve-line" points="${line}"/>${points.map(p=>`<circle class="curve-point" data-point="${p.i}" data-selected="${p.i===selection}" cx="${x(p.x)}" cy="${y(p.y)}" r="5" tabindex="0" role="button" aria-pressed="${p.i===selection}" aria-label="Select ${rows[p.i].target} requested triangles, ${p.x} actual, ${p.y.toFixed(2)} ${metric}"/>`).join('')}</svg>`;
        $('curve-table').innerHTML=`<table class="lod-table"><caption>Requested and actual cost</caption><thead><tr><th>Budget</th><th>Actual</th><th>Depth px</th><th>Failed</th></tr></thead><tbody>${rows.map((r,i)=>`<tr data-selected="${i===selection}"><td><button type="button" data-point="${i}" aria-pressed="${i===selection}">${r.target.toLocaleString()}</button></td><td>${r.triangles.toLocaleString()}</td><td>${r.gpu.depthP95Px?.toFixed(2)??'—'}</td><td>${r.gpu.failed}</td></tr>`).join('')}</tbody></table>`;
        if(selection>=0){const r=rows[selection];$('curve-selected').textContent=`${gpuVerdict(r.gpu)} · ${r.target.toLocaleString()} requested, ${r.triangles.toLocaleString()} actual triangles. ${r.gpu.failed} of ${r.gpu.tested} region checks failed across ${r.gpu.cameras} cameras.${r.triangles>r.target?' Budget exceeded.':''}`;}
    }
    for(const parent of [$('curve-plot'),$('curve-table')]) {
        const choose=event=>{const at=event.target.closest('[data-point]');if(!at)return;selection=Number(at.dataset.point);draw();if(event.type==='keydown'||event.detail===0)parent.querySelector(`[data-point="${selection}"]`)?.focus();};
        parent.addEventListener('click',choose);
        parent.addEventListener('keydown',event=>{if(event.target.tagName.toLowerCase()==='circle'&&['Enter',' '].includes(event.key)){event.preventDefault();choose(event);}});
    }
    $('curve-metric').onchange=draw;
    for(const id of ['curve-budgets','curve-method','curve-size','curve-priority'])$(id).addEventListener('input',()=>clear());
    $('curve-reset').onclick=()=>{$('curve-budgets').value=DEFAULT_BUDGETS;clear();};
    $('curve-cancel').onclick=()=>cancel();
    $('curve-use').onclick=()=>{
        if(selection<0||!snapshot)return;
        const row=rows[selection],settings={...snapshot.settings,target:row.target};cancel('Applying selected budget…');apply(settings);
    };
    $('curve-export').onclick=()=>{
        if(!snapshot||!rows.length)return;
        const blob=new Blob([JSON.stringify({schema:1,...snapshot,acceptancePolicy:OPENING_ACCEPTANCE,complete:rows.length===snapshot.budgets.length,rows},null,2)],{type:'application/json'}),url=URL.createObjectURL(blob),a=document.createElement('a');
        a.href=url;a.download='rock-quality-budget-curve.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
    };
    $('curve-run').onclick=()=>{
        let budgets;try{budgets=parseBudgets($('curve-budgets').value);$('curve-budgets').setCustomValidity('');}catch(error){$('curve-budgets').setCustomValidity(error.message);$('curve-budgets').reportValidity();status(error.message);return;}
        const source=getSource();if(!source||blocked||!supported)return;
        const method=$('curve-method').value,size=Number($('curve-size').value),settings=normalizeSettings({...getSettings(),priority:$('curve-priority').value,fractures:method==='anchors-off'?'anchors':method,openingRepair:method!=='anchors-off'});
        clear('Starting comparison…');const id=++version;controller=new AbortController();const signal=controller.signal;busy=true;
        snapshot={source:getIdentity(),budgets,method,size,settings,key:curveSettingsKey({budgets,method,size,...settings})};
        try{localStorage.setItem(storageKey,JSON.stringify({budgets:$('curve-budgets').value,method,size,priority:settings.priority}));}catch{}
        const validator=createOpeningGPUValidator(renderer,source,{size});
        if(!validator){clear('Opening comparisons require a Fjord rock with fracture labels.');return;}
        $('curve-run').disabled=true;$('curve-cancel').hidden=false;
        worker=new Worker(new URL('./budget-worker.js',import.meta.url),{type:'module'});let queue=Promise.resolve(),failed=false;
        const fail=error=>{if(id!==version)return;failed=true;cancel(signal.aborted?'Comparison cancelled.':`Comparison failed: ${error.message??error}. Try fewer budgets or lower source detail.`);};
        worker.onmessage=({data})=>{
            if(data.id!==id||id!==version)return;
            if(data.progress){if(!rows.length)status(data.progress);return;}
            if(data.error){queue=queue.then(()=>{throw Error(data.error);}).catch(fail);return;}
            if(data.level)queue=queue.then(async()=>{
                if(id!==version||failed)return;
                const level=data.level,gpu=await validator.measure(level,{signal,progress:p=>status(`${level.target.toLocaleString()} triangles · ${p}`)});
                if(id!==version)return;
                rows.push({target:level.target,triangles:level.stats.triangles,budgetMet:level.budgetMet,qualityMet:level.qualityMet,simplifierError:level.simplifierError,deviation:level.deviation,skeleton:level.protection.skeleton,cpu:{status:level.protection.openings.status,failed:level.protection.openings.failed},gpu});
                if(selection<0)selection=0;draw();status(`${rows.length} of ${budgets.length} budgets measured.`);
            }).catch(fail);
            if(data.done)queue=queue.then(()=>{if(id===version&&!failed){worker?.terminate();worker=null;busy=false;$('curve-run').disabled=blocked||!supported;$('curve-cancel').hidden=true;status(`${rows.length} budgets measured at ${size} pixels. ${size===128?'GPU acceptance uses the fixed opening limits.':'These are diagnostics; acceptance is defined at 128 pixels.'}`);}}).finally(()=>validator.dispose());
        };
        worker.onerror=event=>{fail(Error(event.message||'Worker failed'));queue.finally(()=>validator.dispose());};
        signal.addEventListener('abort',()=>queue.finally(()=>validator.dispose()),{once:true});
        worker.postMessage({id,source,settings,budgets});
    };
    $('curve-budgets').addEventListener('input',()=>$('curve-budgets').setCustomValidity(''));
    return {
        cancel,settingsChanged:()=>{if(rows.length||busy)clear();},
        sourceChanged(key,nextSupported){supported=nextSupported;if(key!==sourceKey){sourceKey=key;clear('Choose budgets, then run a comparison.');}for(const id of ['curve-run','curve-method','curve-budgets','curve-size'])$(id).disabled=!supported;if(!supported)status('Opening comparisons apply to Fjord rocks.');else if(rows.length&&!busy)status('Measurements retained for this source.');draw();},
        sourcePending(){supported=false;clear('Waiting for the source mesh…');$('curve-run').disabled=true;},
        setExternalBusy(value){blocked=value;$('curve-run').disabled=value||busy||!supported;draw();},
        getResults:()=>({snapshot,rows,busy})
    };
}
