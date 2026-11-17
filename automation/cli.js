#!/usr/bin/env node
import {parseArgs} from 'node:util';
import {readFile,writeFile} from 'node:fs/promises';
import {catalog,replayRequest} from './request.js';
import {parseBudgets} from '../src/budget-policy.js';
import {runCurve} from './runner.js';

const help=`love-rocks CLI

  node automation/cli.js catalog
  node automation/cli.js curve --budgets 300,600,1200 --method skeleton
  node automation/cli.js curve --input curve.json --out measured.json
  node automation/cli.js mcp

Curve options:
  --form 0..3           Fjord form (default 1: Split boulder)
  --seed TEXT           Preset seed when omitted
  --resolution 16..256  Source detail (default 54)
  --budgets LIST        Up to 12 integer budgets, 24..50000
  --method NAME         skeleton | anchors-off | anchors | strict | off
  --priority NAME       budget | quality (landmark/strict require quality)
  --tolerance NUMBER    Combined simplifier tolerance, .001.. .5
  --features NUMBER     Feature emphasis, 0..3
  --size 64|128|256     Only 128 px can pass acceptance
  --detail summary|full Include per-camera observations with full
  --input FILE          Request JSON or exported UI curve JSON
  --out FILE            Write JSON to a new file (otherwise stdout)
  --force               Allow replacing --out
  --timeout-ms NUMBER   1000..1800000 (default 600000)
  --require-pass        Exit 2 unless every point passes at 128 px
  --quiet              Suppress progress on stderr

JSON goes to stdout; progress/errors go to stderr. Ctrl-C cancels and cleans up.
Install the browser once: npx playwright install chromium
`;
const controller=new AbortController();
process.once('SIGINT',()=>controller.abort());process.once('SIGTERM',()=>controller.abort());
try {
    const {values,positionals}=parseArgs({allowPositionals:true,options:{
        help:{type:'boolean',short:'h'},force:{type:'boolean'},quiet:{type:'boolean'},'require-pass':{type:'boolean'},
        ...Object.fromEntries(['form','seed','resolution','budgets','method','priority','tolerance','features','size','detail','input','out','timeout-ms'].map(key=>[key,{type:'string'}]))}});
    const [command,...rest]=positionals;if(rest.length)throw Error('Unexpected positional arguments. Use --help.');
    if(values.help||!command)process.stdout.write(help);
    else if(command==='catalog')process.stdout.write(JSON.stringify(catalog(),null,2)+'\n');
    else if(command==='mcp') {
        // MCP owns its signal handlers and reserves stdout for the protocol.
        process.removeAllListeners('SIGINT');process.removeAllListeners('SIGTERM');
        const {serveMCP}=await import('./mcp.js');await serveMCP();
    }else if(command==='curve') {
        let input={};
        if(values.input){const data=JSON.parse(await readFile(values.input,'utf8'));input=data.schema===1?replayRequest(data):data;}
        const sourceFlags=['form','seed','resolution'].filter(key=>values[key]!==undefined);
        if(sourceFlags.length&&input.source?.options)throw Error('A replay contains exact source parameters. Change only curve settings, or provide a new source request.');
        if(sourceFlags.length)input.source={...input.source,...Object.fromEntries(sourceFlags.map(key=>[key,key==='seed'?values[key]:Number(values[key])]))};
        for(const key of ['method','priority','detail'])if(values[key]!==undefined)input[key]=values[key];
        for(const key of ['tolerance','features','size'])if(values[key]!==undefined)input[key]=Number(values[key]);
        if(values['timeout-ms']!==undefined)input.timeoutMs=Number(values['timeout-ms']);
        if(values.budgets!==undefined)input.budgets=parseBudgets(values.budgets);
        const result=await runCurve(input,{signal:controller.signal,progress:message=>{if(!values.quiet)process.stderr.write(message+'\n');}});
        const json=JSON.stringify(result,null,2)+'\n';
        if(values.out)await writeFile(values.out,json,{flag:values.force?'w':'wx'});else process.stdout.write(json);
        if(values['require-pass']&&result.rows.some(row=>!row.gpu.inScope||row.gpu.status!=='passed'))process.exitCode=2;
    }else throw Error(`Unknown command: ${command}. Use --help.`);
}catch(error){
    process.stderr.write(JSON.stringify({error:error.message})+'\n');process.exitCode=controller.signal.aborted?130:1;
}
