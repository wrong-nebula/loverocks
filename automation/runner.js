import {chromium} from 'playwright';
import {createServer} from 'vite';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {normalizeRequest} from './request.js';

const root=fileURLToPath(new URL('../',import.meta.url));
export async function runCurve(input,{signal,progress=()=>{}}={}) {
    const request=normalizeRequest(input),deadline=AbortSignal.timeout(request.timeoutMs);
    const cancellation=signal?AbortSignal.any([signal,deadline]):deadline;
    let server,browser,cache;
    const stop=()=>{void browser?.close().catch(()=>{});};
    cancellation.addEventListener('abort',stop,{once:true});
    try {
        cancellation.throwIfAborted();cache=await mkdtemp(path.join(tmpdir(),'loverocks-curve-'));
        server=await createServer({root,configFile:false,logLevel:'silent',cacheDir:cache,server:{host:'127.0.0.1',port:0,hmr:false,open:false}});
        await server.listen();cancellation.throwIfAborted();
        browser=await chromium.launch({headless:true,args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});
        cancellation.throwIfAborted();const page=await browser.newPage(),errors=[];
        page.on('pageerror',error=>errors.push(error.message));
        await page.exposeFunction('reportProgress',message=>Promise.resolve(progress(message)).catch(()=>{}));
        const origin=`http://127.0.0.1:${server.httpServer.address().port}`;
        await page.route('**/*',route=>route.request().url().startsWith(origin+'/')?route.continue():route.abort());
        await page.goto(origin+'/automation/index.html',{waitUntil:'load',timeout:60000});
        await page.waitForFunction(()=>typeof window.runBudgetCurve==='function',null,{timeout:60000});
        const result=await page.evaluate(request=>window.runBudgetCurve(request),request);
        cancellation.throwIfAborted();if(errors.length)throw Error(errors.join('\n'));
        return result;
    }catch(error){
        if(cancellation.aborted)throw Error(deadline.aborted?'Budget comparison timed out. Increase timeoutMs or reduce source detail.':'Budget comparison cancelled.');
        if(/Executable doesn't exist/.test(error.message))throw Error('Chromium is not installed. Run: npx playwright install chromium');
        throw error;
    }finally{
        cancellation.removeEventListener('abort',stop);
        await browser?.close().catch(()=>{});await server?.close();if(cache)await rm(cache,{recursive:true,force:true});
    }
}
