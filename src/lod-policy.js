export const LOD_DEFAULTS=Object.freeze({target:500,priority:'budget',tolerance:.03,features:1,fractures:'off',openingRepair:true});
export function normalizeSettings(input={}) {
    const number=(v,fallback,min,max)=>Number.isFinite(Number(v))?Math.min(max,Math.max(min,Number(v))):fallback;
    const fractures=['anchors','strict','skeleton'].includes(input.fractures)?input.fractures:'off';
    return {target:Math.round(number(input.target,500,24,50000)),priority:input.priority==='quality'||['anchors','strict'].includes(fractures)?'quality':'budget',
        tolerance:number(input.tolerance,.03,.001,.5),features:number(input.features,1,0,3),
        fractures,openingRepair:input.openingRepair!==false};
}
export function targetsFor(input) {
    const {target}=normalizeSettings(input);
    return [Math.min(200000,target*4),target,Math.max(12,Math.round(target/32)*8)];
}
// Uses physical render pixels and camera-space depth. Hysteresis prevents chatter.
export function chooseLOD(levels,{depth,viewportHeight,fov,scale=1,pixelError=1,previous=-1,hysteresis=.15}) {
    if(depth<=0)return -1;
    const projection=viewportHeight/(2*Math.tan(fov*Math.PI/360))*scale/depth;
    let best=-1;
    for(let i=levels.length-1;i>=0;i--) {
        const threshold=pixelError*(i===previous?1+hysteresis:1-hysteresis);
        if(levels[i].deviation.sampledMax*projection<=threshold){best=i;break;}
    }
    return best;
}
