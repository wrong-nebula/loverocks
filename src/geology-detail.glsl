// Per-pixel geology for the photo presets. The mesh supplies one smooth scalar
// per vertex (sandstone: bedding coordinate, granite: fracture-face polish);
// everything finer than the mesh spacing is resolved here.
uniform float bedded;
uniform vec3 rockSeed;

struct Grain { vec3 id; vec3 id2; vec3 offset; float border; };

// Jittered 3D Voronoi, keeping the two nearest cells so neighbouring crystals
// can be blended across a soft, irregular contact instead of a hard polygon edge.
Grain grainCell(vec3 p){
    vec3 cell=floor(p), local=fract(p);
    float first=9., second=9.;
    Grain g;
    g.id=cell; g.id2=cell; g.offset=vec3(0.);
    for(int x=-1;x<=1;x++) for(int y=-1;y<=1;y++) for(int z=-1;z<=1;z++){
        vec3 step=vec3(x,y,z);
        vec3 o=step+.12+.76*rockHash(cell+step)-local;
        float d=dot(o,o);
        if(d<first){ second=first; g.id2=g.id; first=d; g.id=cell+step; g.offset=o; }
        else if(d<second){ second=d; g.id2=cell+step; }
    }
    g.border=sqrt(second)-sqrt(first);
    return g;
}

float rockFbm(vec3 p){
    return .52*rockNoise(p)+.28*rockNoise(p*2.13+3.1)+.14*rockNoise(p*4.37+7.7)+.06*rockNoise(p*9.1+1.9);
}

// Antialiased threshold of a noise field.
float noiseMask(float n,float threshold){
    float w=max(fwidth(n)*.75,.012);
    return smoothstep(threshold-w,threshold+w,n);
}

struct Mineral { vec3 albedo; float roughness; vec3 tilt; float boundary; };

// Coarse biotite-hornblende granite. Only the K-feldspar and plagioclase
// phenocrysts are crystal cells, heavily warped with soft contacts; the quartz
// and plagioclase groundmass and the ragged mafic clusters are multi-scale noise,
// so the fabric reads as interlocking grains rather than a polygon mosaic.
Mineral graniteFabric(vec3 p,float footprint,float polish){
    vec3 q=p+rockSeed;

    // Phenocrysts: blocky, slightly elongated crystals with ragged outlines.
    vec3 warp=vec3(rockFbm(q*5.1+1.3),rockFbm(q*5.1+5.1),rockFbm(q*5.1+9.7))-.5;
    vec3 jag=vec3(rockNoise(q*24.+2.1),rockNoise(q*24.+7.3),rockNoise(q*24.+3.9))-.5;
    const vec3 bigScale=vec3(8.6,11.,9.6);
    Grain big=grainCell((q+warp*.11+jag*.022)*bigScale);
    vec3 h1=rockHash(big.id+vec3(6.1,7.4,31.3)), h2=rockHash(big.id2+vec3(6.1,7.4,31.3));
    vec3 hb2=rockHash(big.id+vec3(19.7,2.3,8.8));
    // Contact softness: blend toward the neighbour's mineral near the shared edge.
    float bigAA=smoothstep(.30,.95,footprint*bigScale.y);
    float contact=.5+.5*smoothstep(0.,.09+footprint*bigScale.y,big.border);
    float kfs1=step(h1.x,.44), kfs2=step(h2.x,.44);
    float pl1=step(.44,h1.x)*step(h1.x,.56), pl2=step(.44,h2.x)*step(h2.x,.56);
    float kfs=mix(kfs2,kfs1,contact), plag=mix(pl2,pl1,contact);
    float phenocryst=clamp(kfs+plag,0.,1.);

    // Groundmass: grey glassy quartz vs milky plagioclase, patchy at two scales.
    float g=rockFbm(q*15.+vec3(4.2,1.7,8.8))+.18*(rockNoise(q*41.)-.5);
    float whiteFine=noiseMask(g,.50);
    float quartzFine=1.-whiteFine;

    // Mafics: biotite books and hornblende, in ragged clusters with stray flakes.
    float cluster=rockFbm(q*2.7+vec3(11.,3.,7.));
    float m=rockFbm(q*17.+vec3(2.,9.,4.))+.26*(rockNoise(q*43.)-.5)+.60*(cluster-.5);
    float mafic=noiseMask(m,.585)*(1.-.45*phenocryst);

    // Colours with in-grain mottling and perthite streaks in K-feldspar.
    float mottle=rockNoise(q*46.)-.5;
    vec3 lamellaAxis=normalize(hb2-.5);
    float perthite=smoothstep(.35,.95,sin(dot(q,lamellaAxis)*190.+6.*rockNoise(q*30.)))
        *(1.-smoothstep(.25,.6,fwidth(dot(q,lamellaAxis)*190.)));
    float twin=sign(dot(big.offset,lamellaAxis.zxy));
    vec3 pink=mix(vec3(.60,.37,.32),vec3(.76,.53,.47),mix(h2.y,h1.y,contact))*(1.+.05*twin*contact);
    pink=mix(pink,vec3(.80,.70,.66),.22*perthite);
    vec3 white=mix(vec3(.64,.63,.61),vec3(.79,.78,.76),h1.y);
    vec3 quartz=mix(vec3(.24,.245,.255),vec3(.44,.44,.45),rockNoise(q*21.));
    vec3 fineWhite=mix(vec3(.62,.61,.59),vec3(.76,.75,.73),rockNoise(q*27.+3.));
    vec3 dark=mix(vec3(.022,.020,.020),vec3(.048,.044,.042),rockNoise(q*52.));
    vec3 ground=mix(quartz,fineWhite,whiteFine);
    vec3 crystalColor=(pink*kfs+white*plag)/max(phenocryst,1e-3);
    vec3 albedo=mix(ground,crystalColor,phenocryst);
    albedo=mix(albedo,dark,mafic);
    albedo*=(1.+.12*mottle)*.90;
    albedo=mix(albedo,vec3(.50,.43,.40),bigAA);

    // Weathered shell: feldspar turns chalky, mafics bronze slightly.
    float weathered=1.-polish;
    float luma=dot(albedo,vec3(.299,.587,.114));
    albedo=mix(albedo,vec3(luma)*1.05+.03,.17*weathered*(1.-mafic));
    albedo=mix(albedo,albedo+vec3(.040,.030,.018),weathered*mafic);

    // Gloss: fresh cleavage and fracture faces vs weathered grus.
    float freshRough=mix(quartzFine*mix(.07,.13,rockNoise(q*18.))+whiteFine*.21,mix(.16,.24,h1.z),phenocryst);
    freshRough=mix(freshRough,.12,mafic)+.05*perthite;
    float wornRough=mix(quartzFine*.50+whiteFine*.74,.77,phenocryst);
    wornRough=mix(wornRough,.48,mafic);
    float roughness=mix(wornRough,freshRough,polish);
    roughness=mix(roughness,.42,bigAA*.6);

    // Facet orientation. Feldspar cleavage is one plane per crystal, broken by
    // small cleavage steps; quartz fractures are conchoidal (smoothly curving);
    // mica flakes tilt in many small directions.
    vec3 cleavage=normalize(hb2-.5+.25*twin*(h1-.5))*.24;
    vec3 steps=(vec3(rockNoise(q*55.),rockNoise(q*55.+4.),rockNoise(q*55.+9.))-.5)*.10;
    vec3 conchoidal=(vec3(rockNoise(q*19.+1.),rockNoise(q*19.+6.),rockNoise(q*19.+11.))-.5)*.16;
    vec3 flakes=(vec3(rockNoise(q*38.+2.),rockNoise(q*38.+8.),rockNoise(q*38.+5.))-.5)*.75;
    vec3 tilt=mix(conchoidal,(cleavage+steps)*contact,phenocryst);
    tilt=mix(tilt,flakes,mafic)*mix(.35,1.,polish)*(1.-bigAA);

    Mineral mineral;
    mineral.albedo=albedo; mineral.roughness=roughness; mineral.tilt=tilt;
    mineral.boundary=1.;
    return mineral;
}

// Cross-bedded sandstone: stacked sets of inclined, tangential foresets.
// Thick iron-stained bands carry the main pattern; fine laminae of irregular
// spacing and strength sit inside them. Sets are truncated at their base.
// Returns (rgb tone multiplier, relief).
vec4 sandstoneLaminae(float bed,vec3 p){
    vec3 q=p+rockSeed*.37;
    float setCoord=bed*2.6+.30*rockNoise(q*1.6)+.12*rockNoise(q*4.3);
    float setId=floor(setCoord), t=fract(setCoord);
    vec3 h=rockHash(vec3(setId*1.37,setId*.71+4.1,9.3));
    float azimuth=h.x*6.2832;
    float along=dot(q.xz,vec2(cos(azimuth),sin(azimuth)));
    float dip=mix(.12,.40,h.y);
    // Foresets steepen upward and curve into the set base.
    float lam=bed+dip*along*(.45+.55*t)+.05*(h.z-.5)*along*along;

    // Thick bands: a dark rust band of varying width and strength in each cycle.
    float bandPhase=lam*mix(5.,7.5,h.z)+1.8*rockNoise(q*1.9+setId)+.6*rockNoise(q*4.7+setId);
    float bw=fwidth(bandPhase);
    float bid=floor(bandPhase), bl=fract(bandPhase);
    vec3 rb=rockHash(vec3(bid,setId,5.3));
    // Broad soft bands with an irregular light/dark split.
    float darkEnd=mix(.42,.66,rb.x);
    float band=smoothstep(0.,.34+bw,bl)*(1.-smoothstep(darkEnd-.14-bw,darkEnd+.30+bw,bl));
    float bandStrength=mix(.62,1.,rb.y)*mix(.82,1.,h.y);
    band=mix(.5*darkEnd,band,1.-smoothstep(.25,.60,bw))*bandStrength;
    vec3 tone=mix(vec3(1.13,1.10,1.08),vec3(.68,.50,.42),band);

    // Fine laminae inside the bands.
    float phase=lam*mix(38.,60.,h.z)+2.4*rockNoise(q*2.3+setId);
    float fw=fwidth(phase);
    float id=floor(phase), l=fract(phase);
    vec3 r=rockHash(vec3(id,setId,3.7));
    float width=mix(.07,.30,r.x);
    float strength=mix(.008,.03,r.y)*(r.z<.2?-.5:1.);
    float profile=smoothstep(0.,.5,l)*(1.-smoothstep(.5,1.,l));   // soft, low-contrast texture
    float mean=.25;
    float fineFade=1.-smoothstep(.30,.70,fw);
    float lamina=mix(mean,profile,fineFade);
    tone*=1.-strength*lamina;

    // Bounding surface between sets.
    float fs=fwidth(setCoord);
    float edge=(1.-smoothstep(0.,max(.02,fs*1.2),t))*(1.-smoothstep(.02,.06,fs));
    tone*=1.-.02*edge;
    float relief=band*.10*(1.-smoothstep(.25,.60,bw))-.03*edge;
    return vec4(tone,relief);
}

// ---------------------------------------------------------------------------
// Specimen stones. stoneType: 3 marble, 4 slate, 5 conglomerate, 6 mica schist.
uniform float stoneType;

struct Stone { vec3 albedo; float roughness; vec3 tilt; float smoothness; vec3 specular; float relief; };

// How flat a layer coordinate is across this pixel: 1 on a cleavage or
// foliation face (the coordinate barely changes), 0 across broken edges.
float layerFace(float u,float footprint){
    float slope=length(vec2(dFdx(u),dFdy(u)))/max(footprint,1e-5);
    return 1.-smoothstep(.18,.62,slope);
}

vec3 randomTilt(vec3 p){
    return vec3(rockNoise(p),rockNoise(p+4.1),rockNoise(p+9.3))-.5;
}

float detailFade(float footprint,float frequency){
    return 1.-smoothstep(.3,.9,footprint*frequency);
}

// Sugary white marble: interlocking calcite grains, each a tiny raised facet
// that catches the light, with faint grey veils, blush, and rare dark specks.
Stone marbleStone(vec3 p,float footprint,float polish){
    vec3 q=p+rockSeed;
    vec3 warp=vec3(rockNoise(q*9.+1.),rockNoise(q*9.+5.),rockNoise(q*9.+9.))-.5;
    const float scale=58.;
    Grain g=grainCell((q+warp*.014)*scale);
    vec3 h=rockHash(g.id+vec3(3.3,7.1,1.9));
    float fade=detailFade(footprint,scale);
    float edge=smoothstep(0.,.10+footprint*scale,g.border);
    float cloud=rockFbm(q*2.3+3.);
    vec3 albedo=mix(vec3(.80,.76,.68),vec3(.74,.71,.66),smoothstep(.48,.78,cloud));
    albedo=mix(albedo,vec3(.82,.76,.71),.55*smoothstep(.55,.8,rockFbm(q*1.4+11.)));   // blush
    float veilPath=abs(rockFbm(q*vec3(1.1,2.6,1.4)+6.)-.5);
    float veil=smoothstep(.06,.0,veilPath)*smoothstep(.45,.7,rockFbm(q*1.7+2.));
    albedo=mix(albedo,vec3(.64,.65,.64),.45*veil);                                       // faint grey veils
    albedo*=1.+.09*(h.x-.5)*fade;
    float speck=noiseMask(rockNoise(q*150.),.95)*detailFade(footprint,150.);
    albedo=mix(albedo,vec3(.12,.11,.11),speck*.75);
    Stone s;
    s.albedo=albedo;
    s.roughness=mix(mix(.70,.55,polish),mix(.36,.22,polish),edge*fade);
    s.tilt=normalize(h-.5)*.46*fade*edge;
    s.smoothness=0.;
    s.specular=vec3(.55,.52,.46);
    // Each grain is a small dome; boundaries are fine grooves.
    s.relief=((h.y-.5)*.30*edge+.22*(rockNoise(q*95.)-.5)*detailFade(footprint,95.))*fade;
    return s;
}

// Slate: fine-grained, matte blue-grey cleavage faces built of small stepped
// scales, with pale wispy streaks along the lineation and tiny mica flecks;
// broken edges are paler and show the lamination.
Stone slateStone(vec3 p,float u,float footprint){
    vec3 q=p+rockSeed;
    float face=layerFace(u,footprint);
    float tone=rockFbm(q*3.6)-.5;
    vec3 albedo=vec3(.046,.058,.084)*(1.+.20*tone);
    // Scales: platy flakes that step slightly at their edges.
    const float scale=26.;
    vec3 warp=vec3(rockNoise(q*7.),rockNoise(q*7.+3.),rockNoise(q*7.+6.))-.5;
    Grain flake=grainCell((q+warp*.04)*vec3(scale,scale*.6,scale));
    vec3 h=rockHash(flake.id+vec3(1.3,8.8,2.2));
    float fade=detailFade(footprint,scale);
    float rim=smoothstep(0.,.07+footprint*scale,flake.border);
    albedo*=1.+.035*(h.x-.5)*fade;
    // Pale wisps stretched along the lineation.
    float wisp=smoothstep(.60,.82,rockFbm(q*vec3(1.8,7.5,1.8)+2.));
    albedo=mix(albedo,albedo*1.55+vec3(.010,.011,.013),.55*wisp);
    float fine=rockNoise(q*160.)*detailFade(footprint,160.);
    albedo*=1.+.10*(fine-.5);
    float fleck=noiseMask(rockNoise(q*210.+3.),.91)*detailFade(footprint,210.);
    albedo=mix(albedo,vec3(.12,.13,.15),fleck*.5);
    // Thin pale fracture veinlets cross some cleavage faces.
    float veinlet=smoothstep(.010,.0,abs(rockNoise(q*vec3(2.6,7.,2.6)+4.)-.5))*smoothstep(.55,.75,rockNoise(q*1.9+8.));
    albedo=mix(albedo,vec3(.16,.17,.18),.55*veinlet*face);
    float lam=sin(u*260.+5.*rockNoise(q*4.))*(1.-smoothstep(.4,1.,fwidth(u*260.)));
    vec3 edgeColor=albedo*(1.18+.10*lam)+vec3(.006,.007,.008);
    Stone s;
    s.albedo=mix(edgeColor,albedo,face);
    s.roughness=mix(.82,.50+.10*h.y,face);
    s.tilt=normalize(h-.5)*.12*face*fade;
    s.smoothness=face*.7;
    s.specular=vec3(.55,.58,.62);
    float scales=rockFbm(q*vec3(22.,10.,22.)+5.);
    float ledge=smoothstep(.47,.53,rockNoise(q*vec3(9.,4.,9.)+1.))*detailFade(footprint,40.);
    s.relief=(.18*(scales-.5)*detailFade(footprint,22.)+.14*ledge-.10*veinlet)*face+.08*(fine-.5);
    return s;
}

// Mirror of `pebbles` in geology.rs.
vec2 pebbleField(vec3 p){
    vec2 best=vec2(9.,0.);
    for(int level=0;level<2;level++){
        float scale=level==0?3.7:7.6, salt=level==0?0.:17.;
        vec3 x=p*vec3(scale,scale*1.35,scale)+vec3(salt,salt*.5,salt*.25);
        vec3 cell=floor(x);
        for(int i=-1;i<=1;i++) for(int j=-1;j<=1;j++) for(int k=-1;k<=1;k++){
            vec3 id=cell+vec3(i,j,k);
            vec3 h=rockHash(id);
            if(h.x<.03) continue;
            vec3 centre=id+.5+(h-.5)*.5;
            vec3 axes=rockHash(id+vec3(4.4,1.2,8.6));
            vec3 squash=vec3(.80+.45*axes.x,.85+.55*axes.y,.80+.45*axes.z);
            float d=(length((x-centre)*squash)-mix(.46,.60,h.y))/(scale*1.25);
            if(d<best.x) best=vec2(d,rockHash(id+vec3(9.1,3.3,5.7)).x);
        }
    }
    return best;
}

// Conglomerate: salmon, peach and tan quartzite pebbles, each mottled and
// speckled, set in a rusty sand matrix with granules, dark contact rims and
// manganese stains.
Stone conglomerateStone(vec3 p,float footprint){
    vec3 q=p+rockSeed;
    vec2 pebble=pebbleField(q);
    float w=max(fwidth(pebble.x),.0025);
    float inside=1.-smoothstep(-w,w,pebble.x);
    float k=pebble.y;
    vec3 stone=k<.30?vec3(.40,.23,.15):k<.55?vec3(.40,.19,.11):k<.72?vec3(.34,.19,.11)
        :k<.84?vec3(.36,.14,.06):k<.95?vec3(.28,.19,.16):vec3(.04,.032,.028);
    float mottle=rockFbm(q*14.+k*40.);
    stone*=1.+.30*(mottle-.5)+.10*(rockNoise(q*55.+k*9.)-.5);
    float pebbleSpeck=noiseMask(rockNoise(q*95.+k*13.),.88)*detailFade(footprint,95.);
    stone=mix(stone,stone*.55,pebbleSpeck*.6);
    float quartzVein=smoothstep(.018,0.,abs(rockNoise(q*vec3(6.,18.,6.)+k*7.)-.5))*step(.75,fract(k*5.));
    stone=mix(stone,vec3(.46,.36,.31),.18*quartzVein);
    stone=mix(stone,stone*.78,smoothstep(-.014,0.,pebble.x));          // weathered rind
    vec3 matrix=mix(vec3(.22,.085,.045),vec3(.30,.14,.08),rockNoise(q*30.));
    // Granules: small pebbles too fine for the pebble field.
    float granule=noiseMask(rockNoise(q*48.+3.),.72);
    matrix=mix(matrix,vec3(.36,.22,.15)*(1.+.3*(rockNoise(q*48.+9.)-.5)),granule*.85);
    float grit=noiseMask(rockNoise(q*120.),.86)*detailFade(footprint,120.);
    matrix=mix(matrix,vec3(.34,.27,.21),grit*.45);
    // Contact rims: the matrix darkens where it wraps each pebble.
    matrix*=mix(.55,1.,smoothstep(0.,.03,pebble.x));
    float stain=noiseMask(rockFbm(q*3.4+7.)+.12*(rockNoise(q*11.)-.5),.70);
    matrix=mix(matrix,vec3(.05,.035,.03),stain*.75);
    Stone s;
    s.albedo=mix(matrix,stone,inside);
    s.roughness=mix(.92,mix(.62,.78,fract(k*7.)),inside);
    s.tilt=randomTilt(q*9.+k*20.)*.10*inside;
    s.smoothness=inside*.5;
    s.specular=vec3(.34,.28,.22);
    s.relief=inside*(.30*(mottle-.5)+.12*(rockNoise(q*40.)-.5))+(1.-inside)*(.35*granule-.2);
    return s;
}

// Mica schist: grainy, glittering golden-brown foliation faces with olive and
// rust mottling smeared along the foliation, a fibrous micro-relief, and thin
// irregular lamellae on the split edges.
Stone schistStone(vec3 p,float u,float footprint){
    vec3 q=p+rockSeed;
    float face=layerFace(u,footprint);
    float band=rockNoise(vec3(u*38.,q.x*1.5,q.z*1.5));
    vec3 albedo=mix(vec3(.12,.075,.030),vec3(.18,.115,.045),rockFbm(q*3.1));
    albedo*=1.+.30*(rockFbm(q*11.+4.)-.5);                                           // fine mottling
    albedo=mix(albedo,vec3(.090,.085,.050),.45*smoothstep(.55,.8,band));              // olive chlorite
    float rust=smoothstep(.46,.68,rockFbm(q*vec3(1.4,5.5,2.4)+5.));                  // smeared along foliation
    albedo=mix(albedo,vec3(.20,.068,.024),.80*rust);
    const float scale=95.;
    Grain flake=grainCell(q*vec3(scale,scale*2.5,scale));
    vec3 h=rockHash(flake.id+vec3(2.7,6.1,4.4));
    float fade=detailFade(footprint,scale);
    albedo*=1.+.45*(h.x-.5)*fade*face;
    float fibre=rockNoise(q*vec3(55.,200.,55.))*detailFade(footprint,200.);
    float crinkle=sin(q.x*70.+q.z*25.+4.*rockNoise(q*6.))*detailFade(footprint,40.);
    float lam=rockNoise(vec3(u*230.,q.x*6.,q.z*6.)+2.*rockNoise(q*5.));
    lam*=1.-smoothstep(.4,1.,fwidth(u*230.));
    vec3 edge=mix(vec3(.12,.105,.070),vec3(.17,.13,.075),smoothstep(.18,.40,lam)+.6*smoothstep(.45,.7,rockNoise(q*3.)));
    edge*=1.+.25*(rockFbm(q*8.)-.5);
    Stone s;
    s.albedo=mix(edge,albedo,face);
    s.roughness=mix(.74,mix(.38,.20,h.y)*fade+.44*(1.-fade),face);
    s.tilt=normalize(h-.5)*.42*face*fade;
    s.smoothness=face*.4;
    s.specular=vec3(.85,.62,.30);   // iron-stained mica glints gold
    s.relief=(.40*(fibre-.5)+.25*(h.z-.5)*fade+.12*crinkle)*face+(1.-face)*.45*(lam-.5);
    return s;
}
