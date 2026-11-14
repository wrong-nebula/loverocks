import {Vector2} from 'three';

export function renderStill(renderer, scene, camera, shadow) {
    const aspect=camera.aspect;
    const longest=3840;
    const width=aspect>=1 ? longest : Math.round(longest*aspect);
    const height=aspect>=1 ? Math.round(longest/aspect) : longest;
    const scale=2;
    const output=document.createElement('canvas');
    output.width=width;
    output.height=height;
    const context=output.getContext('2d',{alpha:false});
    context.imageSmoothingQuality='high';
    const size=renderer.getSize(new Vector2());
    const ratio=renderer.getPixelRatio();
    const shadowSize=shadow.mapSize.clone();
    const autoUpdate=renderer.shadowMap.autoUpdate;
    const tile=Math.min(1024,Math.floor(renderer.capabilities.maxTextureSize/scale));
    const stillShadowSize=Math.min(4096,renderer.capabilities.maxTextureSize);
    function setShadowSize(w,h) {
        if(shadow.mapSize.x===w&&shadow.mapSize.y===h) return;
        shadow.mapSize.set(w,h);
        shadow.map?.dispose();
        shadow.map=null;
        shadow.mapPass?.dispose();
        shadow.mapPass=null;
    }
    try {
        renderer.setPixelRatio(1);
        renderer.shadowMap.autoUpdate=false;
        setShadowSize(stillShadowSize,stillShadowSize);
        renderer.shadowMap.needsUpdate=true;
        for(let y=0;y<height;y+=tile) {
            for(let x=0;x<width;x+=tile) {
                const w=Math.min(tile,width-x),h=Math.min(tile,height-y);
                camera.setViewOffset(width*scale,height*scale,x*scale,y*scale,w*scale,h*scale);
                renderer.setSize(w*scale,h*scale,false);
                renderer.render(scene,camera);
                context.drawImage(renderer.domElement,0,0,w*scale,h*scale,x,y,w,h);
            }
        }
    } finally {
        camera.clearViewOffset();
        camera.aspect=aspect;
        camera.updateProjectionMatrix();
        renderer.setPixelRatio(ratio);
        renderer.setSize(size.x,size.y,false);
        setShadowSize(shadowSize.x,shadowSize.y);
        renderer.shadowMap.autoUpdate=autoUpdate;
        renderer.shadowMap.needsUpdate=true;
        renderer.render(scene,camera);
    }
    return new Promise((resolve,reject)=>output.toBlob(
        blob=>blob?resolve(blob):reject(Error('The browser could not encode the PNG.')),'image/png'));
}
