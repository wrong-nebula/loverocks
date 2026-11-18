import init from './wasm/fjord_engine.js';
import {generateSource} from './source.js';
import {buildLODs,meshStats,normalizeSettings} from './lod.js';

const ready=init();
let cachedKey, cachedSource;

self.onmessage=async ({data})=>{
    const {id,jobs,reduce=false}=data;
    try {
        await ready;
        for (const [index,job] of jobs.entries()) {
            const key=JSON.stringify(job);
            if(key!==cachedKey) {
                self.postMessage({id,progress:'Generating the reference surface…'});
                cachedSource=generateSource(job);cachedKey=key;
            }
            const reference=cachedSource;
            const result=reduce
                ?await buildLODs(reference,data.optimization,message=>self.postMessage({id,progress:message}))
                :{levels:[],settings:normalizeSettings({...data.optimization,fractures:reference.featureKind==='fjord-fractures'?data.optimization?.fractures:'off'}),sourceStats:meshStats(reference)};
            // Keep the canonical source in this worker for on-demand LOD reduction.
            const source={vertices:reference.vertices.slice(),indices:reference.indices.slice(),bounds:reference.bounds.slice(),weather:reference.weather?.slice(),fractureTags:reference.fractureTags?.slice(),featureKind:reference.featureKind};
            const buffers=[];
            for(const mesh of [source,...result.levels])for(const name of ['vertices','indices','bounds','weather','fractureTags'])if(mesh[name])buffers.push(mesh[name].buffer);
            self.postMessage({id,index,source,...result},buffers);
        }
        self.postMessage({id,done:true});
    } catch (error) {
        self.postMessage({id,error:String(error)});
    }
};
