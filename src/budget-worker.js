import {buildLODs} from './lod.js';
import {parseBudgets} from './budget-policy.js';
self.onmessage=async({data})=>{
    const {id,source,settings}=data;
    try {
        const budgets=parseBudgets(data.budgets.join(','));
        for(const target of budgets) {
            const result=await buildLODs(source,{...settings,target},progress=>self.postMessage({id,progress:`${target.toLocaleString()} triangles · ${progress}`}),{levels:[1]});
            const level=result.levels[0],buffers=['vertices','indices','bounds','weather','fractureTags'].filter(k=>level[k]).map(k=>level[k].buffer);
            self.postMessage({id,level},buffers);
        }
        self.postMessage({id,done:true});
    }catch(error){self.postMessage({id,error:String(error)});}
};
