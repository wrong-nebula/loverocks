import {chromium} from 'playwright';
import {createServer} from 'vite';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../../',import.meta.url)),repair=process.argv.includes('--repairs'),heldOut=process.argv.includes('--held-out');
const out=path.join(root,'output/fracture-skeleton',repair?'repair-check':heldOut?'budget-held-out':'budget-check');await fs.mkdir(out,{recursive:true});
const server=await createServer({root,cacheDir:path.join(out,'.vite'),server:{host:'127.0.0.1',port:0,hmr:false}});await server.listen();
let browser;const rows=[],errors=[];
try {
 browser=await chromium.launch({headless:true,args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});const page=await browser.newPage();
 page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
 await page.exposeFunction('__qualitySave',async(name,png)=>{if(path.basename(name)!==name)throw Error('Invalid capture');await fs.writeFile(path.join(out,name),Buffer.from(png,'base64'));});
 await page.exposeFunction('__budgetRow',async row=>{rows.push(row);console.log(JSON.stringify({fixture:row.fixture,method:row.method,target:row.target,triangles:row.triangles,cpu:row.cpu,failed:row.gpu.failed,depth:row.gpu.depthP95Px}));await fs.writeFile(path.join(out,'partial.json'),JSON.stringify({rows,errors},null,2));});
 await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/?quality-test`,{waitUntil:'domcontentloaded',timeout:120000});await page.waitForFunction(()=>window.fjordQuality&&window.fjordReady,null,{timeout:120000});
 const fixtures=repair?[
  {name:'validation-slab',form:2,seed:'opening-validation-6139',surface:{fracture:.15,years:180}},
  {name:'validation-path',form:3,seed:'opening-validation-4073',surface:{fracture:.13,years:250}}
 ]:heldOut?[{name:'curve-split',form:1,seed:'curve-holdout-8147',surface:{fracture:.12}},{name:'curve-path',form:3,seed:'curve-holdout-3951',surface:{fracture:.13}}]:[{name:'split',form:1,seed:'fjord-2168',surface:{fracture:.12}}];
 for(const fixture of fixtures){await page.evaluate(f=>window.fjordQuality.configure(f),fixture);console.log('Fixture',fixture.name);
  await page.evaluate(async options=>{const {runBudgetExperiment}=await import('/tests/visual/budget-harness.js');return runBudgetExperiment(window.fjordQuality.source(),options);},
   {fixture:fixture.name,...(repair?{budgets:[500],methods:['before','anchors'],repairComparison:true}:heldOut?{budgets:[500,1000,2000],methods:['anchors-off','skeleton']}:{})});
 }
 await fs.writeFile(path.join(out,'report.json'),JSON.stringify({schema:1,fixtures,rows,errors},null,2));
 if(errors.length)throw Error(errors.join('\n'));
 if(repair&&rows.some(row=>row.method==='anchors'&&(row.gpu.failed||row.cpu.status!=='passed')))throw Error('A repaired regression fixture failed opening acceptance.');
}finally{await browser?.close();await server.close();}
