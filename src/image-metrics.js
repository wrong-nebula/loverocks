// Image metrics use physical render pixels. Geometry, visible gaps, material
// and shading normals are reported separately; no single score certifies quality.
const maskOf=rgba=>Uint8Array.from({length:rgba.length/4},(_,i)=>rgba[i*4]>127?1:0);
function boundary(mask,w,h) {
    const result=[];
    for(let y=0;y<h;y++)for(let x=0;x<w;x++) {
        const i=y*w+x;
        if(mask[i]&&(x===0||y===0||x===w-1||y===h-1||!mask[i-1]||!mask[i+1]||!mask[i-w]||!mask[i+w]))result.push(i);
    }
    return result;
}
// Exact Euclidean distance to the nearest boundary pixel via separable squared
// distance transforms (lower envelopes of parabolas), O(width * height).
function distanceField(points,w,h) {
    const field=new Float64Array(w*h).fill(1e12);for(const i of points)field[i]=0;
    const n=Math.max(w,h),v=new Int32Array(n),z=new Float64Array(n+1),f=new Float64Array(n),d=new Float64Array(n);
    const transform=len=>{
        let k=0;v[0]=0;z[0]=-Infinity;z[1]=Infinity;
        for(let q=1;q<len;q++) {
            let s;
            do{s=((f[q]+q*q)-(f[v[k]]+v[k]*v[k]))/(2*(q-v[k]));if(s<=z[k])k--;else break;}while(k>=0);
            k++;v[k]=q;z[k]=s;z[k+1]=Infinity;
        }
        k=0;for(let q=0;q<len;q++){while(z[k+1]<q)k++;d[q]=(q-v[k])**2+f[v[k]];}
    };
    for(let y=0;y<h;y++){for(let x=0;x<w;x++)f[x]=field[y*w+x];transform(w);for(let x=0;x<w;x++)field[y*w+x]=d[x];}
    for(let x=0;x<w;x++){for(let y=0;y<h;y++)f[y]=field[y*w+x];transform(h);for(let y=0;y<h;y++)field[y*w+x]=Math.sqrt(d[y]);}
    return field;
}
function convexHull(points,w) {
    const p=points.map(i=>[i%w,Math.floor(i/w)]).sort((a,b)=>a[0]-b[0]||a[1]-b[1]);
    const cross=(a,b,c)=>(b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]);
    const half=items=>{const out=[];for(const x of items){while(out.length>1&&cross(out.at(-2),out.at(-1),x)<=0)out.pop();out.push(x);}out.pop();return out;};
    return [...half(p),...half(p.slice().reverse())];
}
export function gapRegion(silhouette,fracture,w,h) {
    const mask=maskOf(silhouette),hull=convexHull(boundary(mask,w,h),w),result=new Uint8Array(w*h);
    if(hull.length<3)return result;
    const nearby=new Uint8Array(w*h);
    for(let y=0;y<h;y++)for(let x=0;x<w;x++)if(fracture[(y*w+x)*4]>89) {
        for(let dy=-2;dy<=2;dy++)for(let dx=-2;dx<=2;dx++)if(x+dx>=0&&x+dx<w&&y+dy>=0&&y+dy<h)nearby[(y+dy)*w+x+dx]=1;
    }
    for(let y=0;y<h;y++)for(let x=0;x<w;x++) {
        const i=y*w+x;if(mask[i]||!nearby[i])continue;
        let inside=true;
        for(let a=0;a<hull.length;a++){const p=hull[a],q=hull[(a+1)%hull.length];if((q[0]-p[0])*(y-p[1])-(q[1]-p[1])*(x-p[0])<0){inside=false;break;}}
        if(inside)result[i]=1;
    }
    return result;
}
export function compareImages(source,candidate,w,h) {
    const a=maskOf(source.silhouette),b=maskOf(candidate.silhouette),gap=gapRegion(source.silhouette,source.fracture,w,h);
    let intersection=0,union=0,sourceArea=0,missing=0,extra=0,gaps=0,filled=0,color=0,normal=0,interior=0,featurePixels=0,lostFeaturePixels=0;
    const normalErrors=[],fractureDepthErrors=[];
    for(let i=0;i<a.length;i++) {
        sourceArea+=a[i];intersection+=a[i]&b[i];union+=a[i]|b[i];missing+=a[i]&&!b[i]?1:0;extra+=b[i]&&!a[i]?1:0;
        if(gap[i]){gaps++;filled+=b[i];}
        if(a[i]&&source.fracture[i*4]>89){featurePixels++;if(!b[i])lostFeaturePixels++;}
        // Exclude mixed foreground/background samples from material, normal
        // and depth metrics. Silhouette metrics account for those edge pixels.
        if(source.silhouette[i*4]>250&&candidate.silhouette[i*4]>250) {
            interior++;
            let dot=0,la=0,lb=0;
            for(let c=0;c<3;c++) {
                const p=i*4+c;
                color+=Math.abs(source.color[p]-candidate.color[p])/255/3;
                const na=source.normal[p]/127.5-1,nb=candidate.normal[p]/127.5-1;
                dot+=na*nb;la+=na*na;lb+=nb*nb;
            }
            const angle=Math.acos(Math.max(-1,Math.min(1,dot/Math.sqrt(Math.max(1e-12,la*lb)))))*180/Math.PI;
            normal+=angle;normalErrors.push(angle);
            if(source.fracture[i*4]>89&&source.depth&&candidate.depth)fractureDepthErrors.push(Math.abs(source.depth[i]-candidate.depth[i]));
        }
    }
    if(!sourceArea)throw Error('Visual reference is empty; refusing a false pass.');
    const ab=boundary(a,w,h),bb=boundary(b,w,h),ad=distanceField(ab,w,h),bd=distanceField(bb,w,h);
    const distances=[...ab.map(i=>bd[i]),...bb.map(i=>ad[i])].sort((a,b)=>a-b);
    normalErrors.sort((a,b)=>a-b);
    fractureDepthErrors.sort((a,b)=>a-b);
    const quantile=(x,q)=>x.length?x[Math.min(x.length-1,Math.floor(x.length*q))]:null;
    return {silhouetteIoU:intersection/union,missingArea:missing/sourceArea,extraArea:extra/sourceArea,
        boundaryMeanPx:distances.reduce((s,x)=>s+x,0)/distances.length,boundaryP95Px:quantile(distances,.95),
        gapPixels:gaps,filledGapPixels:filled,gapFill:gaps>=4?filled/gaps:null,
        featurePixels,lostFeaturePixels,fractureLostArea:featurePixels?lostFeaturePixels/featurePixels:null,
        fractureDepthP95:quantile(fractureDepthErrors,.95),fractureDepthSamples:fractureDepthErrors.length,
        colorMAE:interior?color/interior:null,normalMeanDeg:interior?normal/interior:null,normalP95Deg:quantile(normalErrors,.95)};
}
