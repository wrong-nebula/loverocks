import {z} from 'zod';
import presets from '../engine/src/presets.json' with {type:'json'};
import {seeded} from '../src/random.js';
import {simulateClimate} from '../src/climate.js';
import {normalizeSettings} from '../src/lod-policy.js';
import {OPENING_ACCEPTANCE} from '../src/opening-acceptance.js';

const finite=z.number().finite(),unit=finite.min(0).max(1);
export const methods=['skeleton','anchors-off','anchors','strict','off'];
const resolution=z.number().int().min(16).max(256);
const form=z.number().int().min(0).max(3);
const seed=z.string().min(1).max(96);
export const jobSchema=z.object({form,seed,resolution,options:z.array(finite).length(12),meshWeather:z.boolean(),
    moss:z.object({amount:unit,years:z.number().int().min(0).max(1000),seed:z.number().int().nonnegative(),sun:z.array(finite).length(3)}).strict().optional()}).strict();
export const sourceSchema=z.object({form:form.default(1),seed:seed.optional(),resolution:resolution.default(54),
    years:z.number().int().min(0).max(1000).default(0),climate:z.enum(['alpine','maritime','continental']).default('alpine'),
    weather:finite.min(0).max(.55).optional(),fracture:finite.min(0).max(.19).optional(),carving:unit.default(.52),
    moss:unit.optional(),wet:unit.default(.48),lichen:unit.default(.57)}).strict();
export const requestShape={source:z.union([jobSchema,sourceSchema]).default({}),
    budgets:z.array(z.number().int().min(24).max(50000)).min(1).max(12).default([500,750,1000,2000]),
    method:z.enum(methods).default('skeleton'),priority:z.enum(['budget','quality']).default('budget'),
    tolerance:finite.min(.001).max(.5).default(.03),features:finite.min(0).max(3).default(1),
    size:z.union([z.literal(64),z.literal(128),z.literal(256)]).default(128),
    detail:z.enum(['summary','full']).default('summary'),timeoutMs:z.number().int().min(1000).max(1800000).default(600000)};
export const requestSchema=z.object(requestShape).strict();

export function sourceJob(source) {
    if('options' in source)return jobSchema.parse(source);
    const s=sourceSchema.parse(source),p=presets[s.form],name=s.seed??p.seed;
    const history=simulateClimate(name,s.climate),random=seeded(name),sun=p.sun,elevation=35*Math.PI/180;
    return {form:s.form,seed:name,resolution:s.resolution,meshWeather:true,
        options:[s.weather??p.weather,p.rounding,s.fracture??p.fracture,s.carving,0,s.wet,s.lichen,
            1-Math.exp(-history.runoff[s.years]/16700),1-Math.exp(-history.frost[s.years]/5700),random()*37,random()*37,random()*37],
        moss:{amount:s.moss??p.moss,years:s.years,seed:Math.floor(seeded(name+'/moss')()*1e6),sun:[Math.cos(sun)*Math.cos(elevation),Math.sin(elevation),Math.sin(sun)*Math.cos(elevation)]}};
}
export function normalizeRequest(input) {
    const value=requestSchema.parse(input),job=sourceJob(value.source),budgets=[...new Set(value.budgets)].sort((a,b)=>a-b);
    const settings=normalizeSettings({target:budgets[0],priority:value.priority,tolerance:value.tolerance,features:value.features,
        fractures:value.method==='anchors-off'?'anchors':value.method,openingRepair:value.method!=='anchors-off'});
    return {...value,budgets,source:{form:job.form,seed:job.seed,job},settings};
}
export function replayRequest(report) {
    if(report.schema!==1||!report.source?.job||!report.settings)throw Error('Expected a schema 1 curve export with source.job and settings.');
    return {source:report.source.job,budgets:report.budgets,method:report.method,size:report.size,
        priority:report.settings.priority,tolerance:report.settings.tolerance,features:report.settings.features};
}
export function catalog() {
    return {name:'loverocks',forms:presets.map((p,form)=>({form,name:p.name,seed:p.seed})),methods,
        budgets:{min:24,max:50000,maxItems:12,default:[500,750,1000,2000]},sizes:[64,128,256],acceptanceSize:128,cameras:16,
        acceptancePolicy:OPENING_ACCEPTANCE,sourceResolution:{min:16,max:256,default:54},
        notes:['Landmark and strict modes enforce quality priority and may exceed the requested budget.',
            'Skeleton is experimental. Meeting a budget does not imply fracture quality passes.',
            '64 and 256 pixels are diagnostics. Only 128 pixels can receive acceptance.',
            'Measurements use headless Chromium WebGL (SwiftShader), not CPU acceptance estimates.',
            'This interface measures geometry. It does not bake or export GLB assets.']};
}
