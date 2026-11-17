// Generator-authored metadata, separate from material channels. IDs are stable
// for a seed/settings pair. Roles may overlap at a mouth or terminating tip.
export const FRACTURE_ROLES=Object.freeze({wall:1,mouth:2,tip:4});
export function fractureSemantics(source) {
    const tags=source.fractureTags,count=source.vertices.length/16;
    if(source.featureKind!=='fjord-fractures'||!tags?.length)return null;
    if(tags.length!==count*4||tags.some(x=>!Number.isFinite(x)))throw Error('Invalid fracture metadata.');
    for(let i=0;i<count;i++)if(!Number.isInteger(tags[i*4])||tags[i*4]<0||tags[i*4]>65535||![-1,0,1].includes(tags[i*4+1])||!Number.isInteger(tags[i*4+2])||tags[i*4+2]<0||tags[i*4+2]>7||tags[i*4+3]<0)throw Error('Invalid fracture tag.');
    const ids=new Uint32Array(source.indices.length/3),roles=new Uint8Array(ids.length),sides=new Int8Array(ids.length),features=new Map();
    for(let face=0;face<ids.length;face++) {
        const vertices=Array.from(source.indices.subarray(face*3,face*3+3)),votes=new Map();
        for(const v of vertices){const id=tags[v*4];if(id)votes.set(id,(votes.get(id)??0)+1);}
        const id=[...votes].sort((a,b)=>b[1]-a[1]||a[0]-b[0])[0]?.[0]??0;
        if(!id)continue;
        ids[face]=id;let side=0;
        for(const v of vertices)if(tags[v*4]===id){roles[face]|=tags[v*4+2];side+=tags[v*4+1];}
        sides[face]=Math.sign(side);
        if(!features.has(id))features.set(id,{id,faces:[],vertices:new Set(),positive:new Set(),negative:new Set(),mouth:new Set(),tips:new Set()});
        const feature=features.get(id);feature.faces.push(face);
        for(const v of vertices)if(tags[v*4]===id) {
            feature.vertices.add(v);if(tags[v*4+1]>0)feature.positive.add(v);if(tags[v*4+1]<0)feature.negative.add(v);
            if(tags[v*4+2]&2)feature.mouth.add(v);if(tags[v*4+2]&4)feature.tips.add(v);
        }
    }
    return {ids,roles,sides,features};
}
