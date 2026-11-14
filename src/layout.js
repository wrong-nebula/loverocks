import {seeded} from './random.js';
// Coordinates are measured on the painting. Feet are pinned to the reference
// frame, then resolved to world positions through the fixed pinhole camera.
const paintingAspect = 4022/3182;
const paintingCamera = {eye:[0,3.25,0], aim:[0,2.31,-10], zoom:2.60};
const paintingPlacements = [
    // form, seed, image x/y of the foot, image width/height, turn, depth stretch
    [2,'left-slab', .063,.794,.201,.321, -.27,1.38],
    [0,'fjord-1847', .477,.726,.224,.175, .42,1.28],
    [1,'fjord-2168', .725,.944,.288,.239, -.12,1.23],
    [3,'left-block', .195,.833,.144,.127, -.27,1.18],
    [3,'round-path', .388,.768,.135,.124, .42,1.16],
    [3,'mossy-front', .311,.967,.112,.084, -.39,.95],
    [0,'left-bank', .206,.743,.158,.109, -.56,1.40],
    [0,'left-upper', .024,.451,.093,.061, .68,1.13],
    [3,'upper-scree', .091,.483,.049,.033, -.40,1.1],
    [3,'upper-shelf', .129,.527,.052,.042, .24,1.15],
    [3,'small-middle', .341,.716,.078,.058, .68,1.1],
    [2,'far-shore', .701,.744,.047,.045, -.43,.9],
    [3,'shore-wide', .806,.866,.113,.089, .56,.9],
    [3,'shore-near', .945,.954,.103,.095, -.4,1.16],
    [2,'shore-left', .861,.970,.092,.117, .26,.94],
    [3,'shore-cropped', .982,1.032,.123,.105, .87,1.26],
    [3,'shore-amber', .903,.860,.065,.043, -.22,.92],
    [3,'shore-low', .968,.937,.058,.025, .20,.93],
    [3,'shore-pale', .823,.764,.043,.028, .55,.96,0.080],
    [3,'shore-middle', .901,.813,.031,.023, -.24,.94,0.068],
    [3,'shore-last', .979,.924,.057,.034, -.26,.94],
    [3,'shore-small', .937,.808,.029,.017, .17,1.0,0.061],
    [3,'far-flat', .952,.778,.048,.015, .12,1.0,0.050],
    [3,'outer-amber', .987,.826,.060,.035, -.38,1.20,0.083],
    [3,'submerged-shelf', .869,.809,.063,.019, -.65,1.36,0.60],
    [3,'submerged-left', .819,.791,.047,.012, .47,1.3,0.52],
    [3,'submerged-round', .920,.840,.057,.018, .37,1.14,0.53],
    [3,'submerged-edge', .979,.855,.069,.024, -.22,1.27,0.58],
    [3,'submerged-flat', .956,.870,.055,.012, .56,1.25,0.55],
    [3,'submerged-pebble', .894,.841,.025,.010, .73,1.07,0.39],
    [3,'submerged-dark', .862,.834,.036,.013, -.44,1.31,0.73],
    [3,'submerged-pale', .986,.794,.041,.012, .24,1.12,0.72],
    [3,'submerged-near', .935,.865,.030,.009, -.20,1.08,0.38],
    [3,'path-side-chip', .316,.752,.033,.037, -.61,1.16],
    [3,'path-ledge', .274,.780,.058,.041, .27,1.24],
    [3,'slab-foot', .109,.781,.047,.040, -.21,1.18],
    [3,'bank-fragment', .209,.626,.088,.058, -.62,1.24],
    [3,'distant-lip', .674,.724,.052,.028, -.37,.92],
    [3,'middle-rear', .372,.675,.066,.050, -.26,.94]
];

export function paintingObjects(seed) {
    const path = seeded(seed+'/stone-path');
    const placements = [...paintingPlacements];
    const stepGroups = [
        [.342,.675,3,.037], [.319,.702,4,.048],
        [.289,.738,5,.054], [.276,.782,5,.060],
        [.293,.807,3,.042]
    ];
    for (const [u,v,count,width] of stepGroups) {
        for (let i=0; i<count; i++) {
            const w=width*(0.53+0.55*path());
            placements.push([3,'step-'+placements.length,u+(path()-.5)*width*1.58,
                v+(path()-.5)*0.025,w,w*(0.27+0.35*path()),(path()-.5)*2.5,1.13]);
        }
    }
    for (const [u,v] of [[.333,.844],[.354,.862],[.398,.893],[.466,.942],[.494,.983]]) {
        const w=0.014+path()*0.014;
        placements.push([3,'trail-'+placements.length,u+(path()-.5)*0.030,
            v+(path()-.5)*0.023,w,w*(0.17+0.21*path()),path()*2.5,1.32]);
    }
    return placements.map(([form,key,...placement])=>({
        form,seed:seed==='painting' && key.startsWith('fjord-') ? key : seed+'/'+key,placement
    }));
}

export function paintingGround(x,z) {
    return 0.53*Math.exp(-((x+2.25)*(x+2.25)*0.19+(z+10)*(z+10)*0.017))
        - 0.24*Math.tanh(x*0.65) + 0.62*Math.exp(-((x+5.7)**2*0.062+(z+13.8)**2*0.023))
        + 0.29*Math.exp(-((x+1.75)**2*0.43+(z+8.9)**2*0.51))
        + 0.11*Math.sin(x*0.77+z*0.23)*Math.sin(z*0.51)
        + 0.050*Math.sin(x*1.20+z*0.48)*Math.sin(z*0.94)
        + 0.022*Math.sin(x*3.3-z*1.17)*Math.cos(z*2.4);
}

export function projectPaintingRock(bounds,u,v,w,h,yaw,stretch,waterDepth) {
    const g={min:bounds.slice(0,3),max:bounds.slice(3)};
    const forward = unit(paintingCamera.aim.map((a,i)=>a-paintingCamera.eye[i]));
    const up = cross([1,0,0],forward);
    const ux = (u*2-1)*paintingAspect/paintingCamera.zoom;
    const uy = (1-v*2)/paintingCamera.zoom;
    const ray = [ux,forward[1]+up[1]*uy,forward[2]+up[2]*uy];
    let t = -paintingCamera.eye[1]/ray[1];
    if (waterDepth === undefined) {
        for (let i=0; i<7; i++) t=(paintingGround(ray[0]*t,ray[2]*t)-paintingCamera.eye[1])/ray[1];
    } else {
        t = (-0.27-waterDepth-paintingCamera.eye[1])/ray[1];
    }
    const foot = paintingCamera.eye.map((a,i)=>a+t*ray[i]);
    const center = [(g.min[0]+g.max[0])*0.5, Math.max(0,g.min[1]),
        (g.min[2]+g.max[2])*0.5];
    const span = g.max.map((value,i)=>value-g.min[i]);
    const imageWidth = 2*w*paintingAspect*t/paintingCamera.zoom;
    const imageHeight = 2*h*t/paintingCamera.zoom;
    const scale = [imageWidth/span[0],imageHeight/(g.max[1]-center[1]),
        imageWidth*stretch/Math.max(span[0],span[2])];
    return {foot,center,scale,yaw,waterDepth};
}
export {paintingAspect,paintingCamera};
const unit=v=>{const length=Math.hypot(...v);return v.map(x=>x/length);};
const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
