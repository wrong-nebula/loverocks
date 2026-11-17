#!/usr/bin/env node
import {McpServer} from '@modelcontextprotocol/sdk/server/mcp.js';
import {StdioServerTransport} from '@modelcontextprotocol/sdk/server/stdio.js';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {catalog,requestShape} from './request.js';
import {runCurve} from './runner.js';

export function createMCPServer({run=runCurve}={}) {
    const server=new McpServer({name:'loverocks',version:'1.0.0'}),active=new Set();
    const annotations={readOnlyHint:true,destructiveHint:false,idempotentHint:true,openWorldHint:false};
    server.registerTool('rock_catalog',{description:'List Fjord forms, reduction methods, budget limits and fixed GPU acceptance policy.',inputSchema:{},annotations},async()=>{
        const result=catalog();return {content:[{type:'text',text:JSON.stringify(result)}],structuredContent:result};
    });
    server.registerTool('rock_budget_curve',{
        description:'Measure customizable triangle budgets from one canonical Fjord source with rendered opening checks. Supports surfaces, skeleton, landmarks, repair, strict and unprotected modes. Surfaces compares patch and skeleton seeds, fits with refineSteps (0–32), and checks 16 development plus 16 additional cameras; other modes use 16 cameras. Only 128 px is acceptance; 64/256 are diagnostics. Source may be preset settings or an exact source.job from a UI curve export. Returns actual counts, quality verdicts, smallest tested passing budget and replayable JSON. May take several minutes; supports progress and cancellation. Does not export GLB.',
        inputSchema:requestShape,annotations},async(input,extra)=>{
        if(active.size)return {isError:true,content:[{type:'text',text:'A comparison is already running. Wait for it or cancel it before starting another.'}]};
        const controller=new AbortController();active.add(controller);let progress=0;
        try {
            const result=await run(input,{signal:AbortSignal.any([extra.signal,controller.signal]),progress:async message=>{
                const token=extra._meta?.progressToken;if(token!==undefined)await extra.sendNotification({method:'notifications/progress',params:{progressToken:token,progress:++progress,message}});
            }});
            const summary={source:result.source,budgets:result.budgets,size:result.size,method:result.method,budgetStudy:result.budgetStudy,
                rows:result.rows.map(row=>({target:row.target,triangles:row.triangles,verdict:row.verdict,failed:row.gpu.failed,depthP95Px:row.gpu.depthP95Px}))};
            return {content:[{type:'text',text:JSON.stringify(summary)}],structuredContent:result};
        }catch(error){return {isError:true,content:[{type:'text',text:error.message}]};}
        finally{active.delete(controller);}
    });
    const cancel=()=>{for(const controller of active)controller.abort();};
    server.server.onclose=cancel;
    return {server,cancel};
}
export async function serveMCP() {
    const {server,cancel}=createMCPServer();
    const close=()=>{cancel();void server.close();};
    process.once('SIGINT',close);process.once('SIGTERM',close);
    await server.connect(new StdioServerTransport());
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))await serveMCP();
