import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {fileURLToPath} from 'node:url';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
import {runCurve} from '../automation/runner.js';
const root=fileURLToPath(new URL('../',import.meta.url)),exec=promisify(execFile);

test('CLI and real stdio MCP reproduce the saved UI curve with independent GPU measurements',{timeout:180000},async()=>{
    const input=JSON.parse(await fs.readFile(new URL('fixtures/curve-replay.json',import.meta.url),'utf8'));
    const {stdout,stderr,code}=await exec(process.execPath,['automation/cli.js','curve','--input','tests/fixtures/curve-replay.json','--quiet','--require-pass'],{cwd:root,timeout:120000,maxBuffer:4e6}).then(()=>assert.fail('Quality failure must exit 2'),error=>error);
    assert.equal(code,2);
    const cli=JSON.parse(stdout);assert.equal(stderr,'');
    assert.equal(cli.rows[0].triangles,592);assert.equal(cli.rows[0].gpu.failed,90);assert.equal(cli.rows[0].gpu.cameras,16);
    assert.equal(cli.rows[0].verdict,'Review required');assert.equal(cli.rows[0].gpu.inScope,true);
    const transport=new StdioClientTransport({command:process.execPath,args:[root+'automation/mcp.js'],cwd:root,stderr:'pipe'});
    const client=new Client({name:'integration',version:'1'});let logs='',progress=[];transport.stderr.on('data',chunk=>logs+=chunk);
    try {
        await client.connect(transport);assert.equal((await client.listTools()).tools.length,2);
        const result=await client.callTool({name:'rock_budget_curve',arguments:{source:input.source.job,budgets:[600],method:'skeleton',size:128}},undefined,
            {timeout:120000,onprogress:p=>progress.push(p)});
        assert.ok(!result.isError,JSON.stringify(result));const mcp=result.structuredContent;
        assert.deepEqual(mcp.rows,cli.rows);assert.deepEqual(mcp.source,cli.source);assert.ok(progress.length>0);
        assert.equal(logs,'');
    }finally{await client.close();}
});
test('timeout and cancellation close the renderer and permit a fresh diagnostic run',{timeout:120000},async()=>{
    const controller=new AbortController();
    await assert.rejects(runCurve({budgets:[500],source:{resolution:32}},{signal:controller.signal,progress:()=>controller.abort()}),/cancelled/);
    await assert.rejects(runCurve({budgets:[500],source:{resolution:256},timeoutMs:1000}),/timed out/);
    const result=await runCurve({budgets:[300],source:{resolution:32},size:64,detail:'full'});
    assert.equal(result.complete,true);assert.equal(result.rows[0].gpu.inScope,false);assert.match(result.rows[0].verdict,/Diagnostic/);
    assert.equal(result.rows[0].gpu.rows.length,16);assert.ok(Array.isArray(result.rows[0].gpu.failures));
});
