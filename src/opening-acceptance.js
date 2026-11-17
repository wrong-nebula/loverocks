import {gapRegion} from './image-metrics.js';

// Authoring acceptance for LOD 1 used as a 128-pixel background asset.
// Larger captures still report these metrics; they are stress diagnostics.
// These limits are independent of regression baselines and cannot be reset
// by recording a new baseline.
export const OPENING_ACCEPTANCE=Object.freeze({viewingSize:128,minGapPixels:4,maxGapFill:.2,minWallPixels:8,maxDepthP95Px:2,maxMissingWallFraction:.1});
const idAt=(rgba,i)=>rgba[i*4]+rgba[i*4+1]*256;
function components(labels,w,h) {
    const seen=new Uint8Array(w*h),out=[];
    for(let start=0;start<labels.length;start++)if(labels[start]&&!seen[start]) {
        const label=labels[start],pixels=[start];seen[start]=1;
        for(let at=0;at<pixels.length;at++) {
            const i=pixels[at],x=i%w,y=Math.floor(i/w);
            for(const j of [x?i-1:-1,x+1<w?i+1:-1,y?i-w:-1,y+1<h?i+w:-1])if(j>=0&&!seen[j]&&labels[j]===label){seen[j]=1;pixels.push(j);}
        }
        out.push({label,pixels});
    }
    return out;
}
export function openingRegions(source,w,h) {
    const semanticMask=new Uint8Array(w*h*4),wallLabels=new Uint32Array(w*h),gapLabels=new Uint32Array(w*h);
    for(let i=0;i<w*h;i++) {
        const id=idAt(source.semantic,i);
        if(id){semanticMask[i*4]=255;if(source.silhouette[i*4]>250)wallLabels[i]=id*3+Math.min(2,source.semantic[i*4+2]);}
    }
    const gap=gapRegion(source.silhouette,semanticMask,w,h);
    for(let i=0;i<gap.length;i++)if(gap[i]) {
        const x=i%w,y=Math.floor(i/w);let best=Infinity,id=0;
        for(let dy=-2;dy<=2;dy++)for(let dx=-2;dx<=2;dx++) {
            if(x+dx<0||x+dx>=w||y+dy<0||y+dy>=h)continue;
            const candidateId=idAt(source.semantic,(y+dy)*w+x+dx),d=dx*dx+dy*dy;
            if(candidateId&&(d<best||(d===best&&candidateId<id))){best=d;id=candidateId;}
        }
        gapLabels[i]=id;
    }
    return {gaps:components(gapLabels,w,h),walls:components(wallLabels,w,h)};
}
export function openingAcceptance(source,candidate,w,h,size) {
    if(!source.semantic)return {status:'unavailable',inScope:size===OPENING_ACCEPTANCE.viewingSize,openings:[],ignored:0};
    const regions=openingRegions(source,w,h),openings=[];
    let ignored=0,component=0;
    for(const {label:id,pixels} of regions.gaps) {
        if(pixels.length<OPENING_ACCEPTANCE.minGapPixels){ignored++;continue;}
        const filled=pixels.filter(i=>candidate.silhouette[i*4]>127).length;
        const allowed=Math.max(1,Math.floor(pixels.length*OPENING_ACCEPTANCE.maxGapFill));
        openings.push({id,component:component++,kind:'opening',pixels:pixels.length,filledPixels:filled,allowedFilledPixels:allowed,accepted:filled<=allowed,
            reason:filled>allowed?`${filled}/${pixels.length} opening pixels filled (allowed ${allowed})`:null});
    }
    for(const {label,pixels} of regions.walls) {
        if(pixels.length<OPENING_ACCEPTANCE.minWallPixels){ignored++;continue;}
        const errors=[];let missing=0;
        for(const i of pixels) {
            if(candidate.silhouette[i*4]<251){missing++;continue;}
            if(!source.depth||!candidate.depth)continue;
            const error=Math.abs(source.depth[i]-candidate.depth[i])*size;
            if(Number.isFinite(error))errors.push(error);
        }
        errors.sort((a,b)=>a-b);
        const p95=errors.length?errors[Math.min(errors.length-1,Math.floor(errors.length*.95))]:null;
        const allowed=Math.max(2,Math.floor(pixels.length*OPENING_ACCEPTANCE.maxMissingWallFraction));
        const accepted=missing<=allowed&&p95!==null&&p95<=OPENING_ACCEPTANCE.maxDepthP95Px;
        openings.push({id:Math.floor(label/3),side:label%3-1,component:component++,kind:'wall',pixels:pixels.length,missingPixels:missing,depthP95Px:p95,accepted,
            reason:accepted?null:`wall lost ${missing}/${pixels.length} pixels; depth p95 ${p95===null?'unavailable':p95.toFixed(2)} px (limit ${OPENING_ACCEPTANCE.maxDepthP95Px})`});
    }
    return {status:openings.some(o=>!o.accepted)?'failed':openings.length?'passed':'not-visible',inScope:size===OPENING_ACCEPTANCE.viewingSize,openings,ignored};
}
export function openingAcceptanceFailures(rows) {
    const failures=[];let measured=0;
    for(const row of rows)if(row.profile==='anchors'&&row.size===OPENING_ACCEPTANCE.viewingSize) {
        const key=`${row.fixture}/${row.view}/${row.size}`,acceptance=row.acceptance;
        if(!acceptance||acceptance.status==='unavailable'){failures.push(`${key}: semantic opening measurements unavailable`);continue;}
        measured+=acceptance.openings.length;
        for(const opening of acceptance.openings)if(!opening.accepted)failures.push(`${key} fracture ${opening.id} ${opening.kind} ${opening.component}: ${opening.reason}`);
    }
    if(!measured)failures.push('No important visible fracture openings or walls were measured.');
    return failures;
}
