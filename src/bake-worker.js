import {projectAtlas} from './bake-project.js';
self.onmessage=({data})=>{
    try {
        const result=projectAtlas(data.source,data.low,data.size,value=>self.postMessage({progress:value}));
        self.postMessage(result,result.maps.map(m=>m.buffer));
    }catch(error){self.postMessage({error:String(error)});}
};
