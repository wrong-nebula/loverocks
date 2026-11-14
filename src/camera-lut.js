import {Data3DTexture, LinearFilter, RGBAFormat} from 'three';

export const lutSize=33;

// Display-referred Rec.709/sRGB finishing grade. The curve keeps code zero black.
export function gradeCamera(r,g,b) {
    const luma=.2126*r+.7152*g+.0722*b;
    const lift=.23*luma*(1-luma)*(1-luma);
    const saturation=1+.045*Math.sin(Math.PI*luma);
    const warmth=.018*luma*luma*(1-luma);
    const clamp=x=>Math.min(1,Math.max(0,x));
    return [
        clamp(luma+(r-luma)*saturation+lift+warmth),
        clamp(luma+(g-luma)*saturation+lift),
        clamp(luma+(b-luma)*saturation+lift-warmth*.55)
    ];
}

export function makeCameraLut() {
    const data=new Uint8Array(lutSize**3*4);
    let index=0;
    for(let b=0;b<lutSize;b++) for(let g=0;g<lutSize;g++) for(let r=0;r<lutSize;r++) {
        for(const value of gradeCamera(r/(lutSize-1),g/(lutSize-1),b/(lutSize-1))) {
            data[index++]=Math.round(value*255);
        }
        data[index++]=255;
    }
    const texture=new Data3DTexture(data,lutSize,lutSize,lutSize);
    texture.format=RGBAFormat;
    texture.minFilter=texture.magFilter=LinearFilter;
    texture.needsUpdate=true;
    return texture;
}
