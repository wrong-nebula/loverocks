import {chromium} from 'playwright';
import {createServer} from 'vite';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {openingAcceptanceFailures,OPENING_ACCEPTANCE} from './opening-acceptance.js';
import {regressionFailures,tolerances} from './regression.js';

const root=fileURLToPath(new URL('../../',import.meta.url)),args=process.argv.slice(2);
const quick=args.includes('--quick'),update=args.includes('--update-baseline'),heldOut=args.includes('--held-out'),validation=args.includes('--validation'),review=args.includes('--review'),acceptanceOnly=args.includes('--acceptance-only');
const fixtures=validation?[
    {name:'validation-overhang',form:0,seed:'opening-validation-2851'},
    {name:'validation-split',form:1,seed:'opening-validation-9437',surface:{fracture:.14}},
    {name:'validation-slab',form:2,seed:'opening-validation-6139',surface:{fracture:.15,years:180}},
    {name:'validation-path',form:3,seed:'opening-validation-4073',surface:{fracture:.13,years:250}}
]:heldOut?[
    {name:'overhang-unseen',form:0,seed:'landmark-holdout-4219',resolution:144},
    {name:'split-unseen',form:1,seed:'landmark-holdout-7351',resolution:144,surface:{fracture:.14}},
    {name:'slab-unseen',form:2,seed:'landmark-holdout-8623',surface:{fracture:.16,years:200}},
    {name:'path-unseen',form:3,seed:'landmark-holdout-1957',surface:{fracture:.15,years:400}}
]:[
    {name:'overhang',form:0,seed:'fjord-1847'},
    {name:'split',form:1,seed:'fjord-2168',surface:{fracture:.12}},
    {name:'slab',form:2,seed:'fjord-5329',surface:{fracture:.13}},
    {name:'weathered',form:0,seed:'fjord-1847-visual-stress',surface:{fracture:.15,years:400}}
];
const views=[];
for(const [height,elevation] of [['low',.15],['high',.65]])for(let azimuth=0;azimuth<4;azimuth++)views.push({name:`${height}-${azimuth}`,azimuth:azimuth*Math.PI/2,elevation});
const out=path.join(root,'output',validation?'visual-validation':heldOut?(quick?'visual-held-out-quick':'visual-held-out'):quick?'visual-quick':'visual-quality');
await fs.mkdir(out,{recursive:true});
const server=await createServer({root,cacheDir:path.join(out,'.vite'),server:{host:'127.0.0.1',port:0,watch:null,hmr:false}});await server.listen();
const port=server.httpServer.address().port;
let browser;const rows=[],failures=[],pageErrors=[];
const baselinePath=path.join(root,'tests/visual',validation?'baseline-validation.json':heldOut?'baseline-held-out.json':'baseline.json');
try {
    browser=await chromium.launch({headless:true,args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});
    const page=await browser.newPage({viewport:{width:1280,height:900},deviceScaleFactor:1});
    page.on('pageerror',e=>{pageErrors.push(e.message);console.error(e.message);});
    page.on('console',m=>{if(m.type()==='error')pageErrors.push(m.text());});
    await page.exposeFunction('__qualitySave',async(name,png)=>{
        if(path.basename(name)!==name)throw Error('Invalid capture name.');
        await fs.writeFile(path.join(out,name),Buffer.from(png,'base64'));
    });
    await page.goto(`http://127.0.0.1:${port}/?quality-test`,{waitUntil:'domcontentloaded',timeout:120000});
    await page.waitForFunction(()=>window.fjordQuality&&window.fjordReady,{},{timeout:120000});
    const gpu=await page.evaluate(()=>{const gl=document.querySelector('canvas').getContext('webgl2'),ext=gl.getExtension('WEBGL_debug_renderer_info');return ext?gl.getParameter(ext.UNMASKED_RENDERER_WEBGL):gl.getParameter(gl.RENDERER);});
    for(const fixture of quick?fixtures.slice(0,1):fixtures) {
        console.log(`Visual fixture: ${fixture.name}`);
        await page.evaluate(f=>window.fjordQuality.configure(f),fixture);
        const timer=setInterval(async()=>{try{console.log(await page.evaluate(()=>window.qualityProgress));}catch{}},15000);
        let deadline;
        try {
            const result=await Promise.race([page.evaluate(options=>window.fjordQuality.run(options),{fixture:fixture.name,target:500,textureSize:512,
                sizes:quick?[128]:[64,128,256],views:quick?views.filter(v=>v.name==='low-0'||v.name==='high-1'):views}),
                new Promise((_,reject)=>{deadline=setTimeout(()=>reject(Error(`Visual fixture ${fixture.name} timed out`)),600000);})]);
            rows.push(...result.rows);
        }finally{clearInterval(timer);clearTimeout(deadline);}
    }
    if(pageErrors.length)failures.push(...pageErrors);
    let baseline;
    try{baseline=JSON.parse(await fs.readFile(baselinePath,'utf8'));}catch{}
    if(update&&!quick) {
        if(failures.length)throw Error('Cannot update a baseline after browser errors.');
        await fs.writeFile(baselinePath,JSON.stringify({schema:1,chromium:browser.version(),gpu,tolerances,rows:rows.map(({fixture,view,size,profile,target,triangles,metrics})=>({fixture,view,size,profile,target,triangles,metrics}))},null,2));
    }else if(review||acceptanceOnly) {
        // Absolute acceptance remains independent of baseline comparison.
    }else if(baseline) {
        failures.push(...regressionFailures(rows,baseline,{requireAll:!quick}));
    }else if(!quick)failures.push('No visual baseline. Review report, then explicitly run --update-baseline.');
    const acceptanceFailures=openingAcceptanceFailures(rows);
    const summaries=[];
    for(const fixture of new Set(rows.map(r=>r.fixture)))for(const profile of ['off','unrepaired','anchors','strict','matched']) {
        const group=rows.filter(r=>r.fixture===fixture&&r.profile===profile);
        const values=m=>group.map(r=>r.metrics[m]).filter(v=>v!==null);
        const avg=m=>values(m).length?values(m).reduce((n,x)=>n+x,0)/values(m).length:null;
        const gapPixels=group.reduce((n,r)=>n+r.metrics.gapPixels,0),filled=group.reduce((n,r)=>n+r.metrics.filledGapPixels,0);
        summaries.push({fixture,profile,triangles:group[0].triangles,silhouetteIoU:avg('silhouetteIoU'),boundaryP95Px:Math.max(...group.map(r=>r.metrics.boundaryP95Px)),
            gapFill:gapPixels?filled/gapPixels:null,gapPixels,colorMAE:avg('colorMAE'),normalMeanDeg:avg('normalMeanDeg'),
            fractureDepthP95:values('fractureDepthP95').length?Math.max(...values('fractureDepthP95')):null,fractureLostArea:avg('fractureLostArea')});
    }
    const report={schema:1,chromium:browser.version(),gpu,heldOut,validation,fixtures,acceptancePolicy:OPENING_ACCEPTANCE,acceptanceFailures,regressionChecked:!review&&!acceptanceOnly,rendering:{supersampling:2,sizes:quick?[128]:[64,128,256],textureSize:512},
        baselineUpdated:update&&!quick,tolerances,failures,summaries,rows};
    await fs.writeFile(path.join(out,'report.json'),JSON.stringify(report,null,2));
    const fmt=(v,scale=1)=>v===null?'—':(v*scale).toFixed(2);
    const table=summaries.map(s=>`<tr><td>${s.fixture}</td><td>${s.profile}</td><td>${s.triangles}</td><td>${fmt(s.silhouetteIoU,100)}%</td><td>${fmt(s.boundaryP95Px)}</td><td>${fmt(s.gapFill,100)}%</td><td>${fmt(s.fractureDepthP95,100)}%</td><td>${fmt(s.colorMAE,100)}%</td><td>${fmt(s.normalMeanDeg)}°</td></tr>`).join('');
    const history=heldOut||validation?null:JSON.parse(await fs.readFile(path.join(root,'tests/visual/landmarks-v1.json'),'utf8'));
    const historicalTable=history?history.summaries.map(old=>{
        const current=summaries.find(s=>s.fixture===old.fixture&&s.profile==='anchors');
        if(!current)return '';
        return `<tr><td>${old.fixture}</td><td>${old.triangles} → ${current.triangles}</td><td>${fmt(old.silhouetteIoU,100)} → ${fmt(current.silhouetteIoU,100)}%</td><td>${fmt(old.gapFill,100)} → ${fmt(current.gapFill,100)}%</td><td>${fmt(old.fractureDepthP95,100)} → ${fmt(current.fractureDepthP95,100)}%</td></tr>`;
    }).join(''):'';
    const images=[...new Set(rows.map(r=>`${r.fixture}-${r.view}-${r.size}.png`))];
    const html=`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Rock LOD visual quality</title>
    <style>body{font:15px/1.5 system-ui;margin:32px;color:#20251f;max-width:1500px}table{border-collapse:collapse;font-variant-numeric:tabular-nums}td,th{padding:8px 12px;border-bottom:1px solid #ccc;text-align:right}td:first-child,th:first-child{text-align:left}img{max-width:100%;height:auto;background:#151813}summary{cursor:pointer;padding:10px}pre{white-space:pre-wrap}a{color:#315d35}</style>
    <h1>Rock LOD visual quality</h1><p>Paired source comparisons at fixed physical pixel sizes, eight camera angles and identical lighting. Lower errors are better; higher silhouette IoU is better. These metrics are diagnostics, not certified perceptual bounds.</p>
    <p><b>unrepaired</b>: semantic landmarks without opening repair. <b>off</b>: 500-triangle request. <b>anchors</b>: sampled rim/depth vertices locked. <b>strict</b>: all vertices of classified fracture faces locked. <b>matched</b>: unprotected reduction requested at the anchored mesh's actual count. Check triangle cost before attributing gains to protection.</p>
    <p>Gap fill measures source-background pixels inside its projected convex hull near visible fresh fracture faces. It is a proxy for visible openings, not 3D topology. Colour MAE and normal error use overlapping visible pixels. Boundary values below are the worst per-view 95th percentile; other values are means, with gap fill weighted by eligible pixels.</p>
    <p>Fracture depth error is the worst per-view p95 camera-depth difference on overlapping marked fracture pixels, as a fraction of the source bounding-sphere diameter. It catches cavity flattening even when an opening does not expose the background.</p>
    <table><thead><tr><th>Fixture</th><th>Mode</th><th>Triangles</th><th>Silhouette IoU</th><th>Boundary p95 px</th><th>Gap filled</th><th>Fracture depth p95</th><th>Colour MAE</th><th>Normal error</th></tr></thead><tbody>${table}</tbody></table>
    ${historicalTable&&!quick?`<h2>Landmarks: previous → current</h2><p>Historical measurements preserve the cost and quality tradeoff separately from the current regression baseline. Smaller meshes can lose cavity detail; lower gap/depth errors and higher silhouette overlap are better.</p><table><thead><tr><th>Fixture</th><th>Triangles</th><th>Silhouette IoU</th><th>Gap filled</th><th>Fracture depth p95</th></tr></thead><tbody>${historicalTable}</tbody></table>`:''}
    <h2>Opening acceptance at ${OPENING_ACCEPTANCE.viewingSize} pixels: ${acceptanceFailures.length?'FAIL':'PASS'}</h2><p>Independent of the regression baseline. Each visible opening component of at least ${OPENING_ACCEPTANCE.minGapPixels} pixels may lose at most 20% (one-pixel allowance for small regions). Visible wall components of at least ${OPENING_ACCEPTANCE.minWallPixels} pixels must retain coverage and stay within ${OPENING_ACCEPTANCE.maxDepthP95Px} pixels of p95 depth error. Larger captures are stress diagnostics. Passing is limited to these source seeds, viewing sizes and cameras; it is not an all-view guarantee.</p><pre>${acceptanceFailures.join('\n')}</pre>
    <h2>Regression gate: ${review||acceptanceOnly?'NOT CHECKED':failures.length?'FAIL':'PASS'}</h2><p>${update?'Baseline recorded after this run. A new baseline is not evidence of improvement; inspect paired controls above.':quick?'Quick smoke subset.':'Checked against the versioned visual baseline.'}</p><pre>${failures.join('\n')}</pre>
    <p>Chromium ${report.chromium}; ${gpu}. 2× supersampling, DPR 1, 512 px texture atlases. <a href="report.json">Full measurements</a>.</p>
    <h2>Contact sheets</h2><p>Last row: eligible source wall samples in blue and gaps in green; candidate wall coverage/depth errors in red, filled gap samples in orange. Individual error pixels can fall within the per-region allowance; read the acceptance measurements for pass/fail.</p>${images.map(name=>`<details><summary>${name}</summary><img loading="lazy" src="${name}" alt="Source and LOD comparisons for ${name}"></details>`).join('')}</html>`;
    await fs.writeFile(path.join(out,'index.html'),html);
    console.log(JSON.stringify(summaries,null,2));console.log(`Report: ${path.join(out,'index.html')}`);
    if(acceptanceFailures.length)console.error(`Opening acceptance: ${acceptanceFailures.length} failures\n${acceptanceFailures.join('\n')}`);
    if(failures.length)console.error(failures.join('\n'));
    if(pageErrors.length||(!review&&(failures.length||acceptanceFailures.length)))process.exitCode=1;
}finally{await browser?.close();await server.close();}
