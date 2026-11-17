import test from 'node:test';
import assert from 'node:assert/strict';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {InMemoryTransport} from '@modelcontextprotocol/sdk/inMemory.js';
import {createMCPServer} from '../automation/mcp.js';
import {normalizeRequest,replayRequest,sourceJob} from '../automation/request.js';

test('automation validates budgets, source parameters and quality priority without silent coercion',()=>{
    const request=normalizeRequest({budgets:[1000,500,500],method:'anchors-off',priority:'budget'});
    assert.deepEqual(request.budgets,[500,1000]);assert.equal(request.settings.priority,'quality');assert.equal(request.settings.openingRepair,false);
    assert.equal(request.source.job.options.length,12);
    for(const bad of [{budgets:[]},{budgets:[23]},{budgets:[501.5]},{budgets:Array(13).fill(500)},{size:129},{method:'typo'},
        {source:{form:4}},{source:{resolution:500}},{source:{years:1001}},{source:{seed:''}},{tolerance:NaN},{features:4},{unexpected:true}])assert.throws(()=>normalizeRequest(bad));
    assert.equal(normalizeRequest({method:'skeleton',priority:'budget'}).settings.priority,'budget');
});
test('curve export replay preserves the exact canonical source and reduction settings',()=>{
    const request=normalizeRequest({source:{form:2,seed:'replay-test',resolution:32,years:180,fracture:.15},budgets:[500],features:3});
    const replay=normalizeRequest(replayRequest({schema:1,...request}));
    assert.deepEqual(replay.source,request.source);assert.deepEqual(replay.settings,request.settings);
    assert.deepEqual(sourceJob(request.source.job),request.source.job);
    assert.throws(()=>replayRequest({schema:2}));
});
test('MCP exposes discovery, validated structured results, busy rejection and cancellation',{timeout:10000},async()=>{
    let calls=0,release,started;
    const running=new Promise(resolve=>started=resolve);
    const {server}=createMCPServer({run:async(input,{signal})=>{
        calls++;started();await new Promise((resolve,reject)=>{release=resolve;signal.addEventListener('abort',()=>reject(Error('cancelled')),{once:true});});
        return {schema:1,source:input.source,budgets:input.budgets,method:input.method,size:input.size,rows:[]};
    }});
    const client=new Client({name:'test',version:'1'}),[a,b]=InMemoryTransport.createLinkedPair();
    try {
        await server.connect(b);await client.connect(a);
        assert.deepEqual((await client.listTools()).tools.map(t=>t.name),['rock_catalog','rock_budget_curve']);
        const cat=await client.callTool({name:'rock_catalog',arguments:{}});assert.equal(cat.structuredContent.cameras,16);
        const invalid=await client.callTool({name:'rock_budget_curve',arguments:{budgets:[0]}});assert.equal(invalid.isError,true);assert.equal(calls,0);
        const controller=new AbortController();
        const pending=client.callTool({name:'rock_budget_curve',arguments:{budgets:[500]}},undefined,{signal:controller.signal});
        const rejected=assert.rejects(pending);await running;
        const busy=await client.callTool({name:'rock_budget_curve',arguments:{budgets:[500]}});assert.equal(busy.isError,true);
        controller.abort();await rejected;await new Promise(resolve=>setTimeout(resolve,30));
        const next=client.callTool({name:'rock_budget_curve',arguments:{budgets:[600]}});
        while(calls<2)await new Promise(resolve=>setTimeout(resolve,5));release();
        assert.deepEqual((await next).structuredContent.budgets,[600]);
    }finally{await client.close();await server.close();}
});
