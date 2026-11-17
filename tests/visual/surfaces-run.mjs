import {chromium} from 'playwright';
import {createServer} from 'vite';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {normalizeRequest} from '../../automation/request.js';
const root=fileURLToPath(new URL('../../',import.meta.url)),heldOut=process.argv.includes('--held-out'),out=path.join(root,'output/fracture-surfaces',heldOut?'held-out':'development');
await fs.mkdir(out,{recursive:true});
const fixtures=heldOut?[
    {name:'reserved-slab',source:{form:2,seed:'surface-reserved-9721',resolution:88,fracture:.15,years:180}},
    {name:'reserved-path',source:{form:3,seed:'surface-reserved-6813',resolution:88,fracture:.13,years:250}}
]:[{name:'overhang',source:{form:0,seed:'fjord-1847',resolution:88}},{name:'split',source:{form:1,seed:'fjord-2168',resolution:88,fracture:.12}}];
const budgets=[500,1000,2000,4000,8000,16000,32000],refineSteps=4,files=['src/fracture-surfaces.js','src/fracture-refine.js','src/fracture-workflow.js','src/opening-gpu.js'],strategy={};
for(const f of files)strategy[f]=createHash('sha256').update(await fs.readFile(path.join(root,f))).digest('hex');
const server=await createServer({root,logLevel:'error',cacheDir:path.join(out,'.vite'),server:{host:'127.0.0.1',port:0,hmr:false}});await server.listen();let browser;const rows=[],reports=[],errors=[];
try {
    browser=await chromium.launch({headless:true,args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});const page=await browser.newPage();
    page.on('pageerror',e=>errors.push(e.message));
    await page.exposeFunction('__surfaceProgress',message=>console.log(message));
    await page.exposeFunction('__surfaceSave',async(name,png)=>{if(path.basename(name)!==name)throw Error('Invalid capture name');await fs.writeFile(path.join(out,name),Buffer.from(png,'base64'));});
    await page.exposeFunction('__surfaceRow',async row=>{rows.push(row);console.log(JSON.stringify({fixture:row.fixture,target:row.target,actual:row.triangles,development:row.development.failed,validation:row.validation.failed,seed:row.seedSelection.selected,edits:row.refinement.acceptedEdits}));await fs.writeFile(path.join(out,'partial.json'),JSON.stringify({strategy,rows,errors},null,2));});
    await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/automation/index.html`,{timeout:120000});
    for(const fixture of fixtures)reports.push(await page.evaluate(async({request,name})=>{const {surfaceStudy}=await import('/tests/visual/surfaces-harness.js');return surfaceStudy(request,name);},{name:fixture.name,request:normalizeRequest({source:fixture.source,budgets,method:'surfaces',refineSteps})}));
    for(const f of files)if(strategy[f]!==createHash('sha256').update(await fs.readFile(path.join(root,f))).digest('hex'))throw Error('Strategy changed during the study; rerun for consistent measurements.');
    await fs.writeFile(path.join(out,'report.json'),JSON.stringify({schema:1,heldOut,fixtures,budgets,refineSteps,strategy,reports,errors},null,2));
    if(errors.length)throw Error(errors.join('\n'));
}finally{await browser?.close();await server.close();}
