// Complete expensive first-use work while the loading screen is still visible.
export async function prepareRaceGraphics({THREE,renderer,scene,camera,racers,items,onProgress=()=>{}}){
  const yieldFrame=()=>new Promise(resolve=>requestAnimationFrame(()=>setTimeout(resolve,0)));
  const extras=items.warmupObjects(),visibility=new Map(),culling=new Map(),textures=new Set();
  const viewport=renderer.getViewport(new THREE.Vector4());
  try{
    for(const object of extras)scene.add(object);
    scene.updateMatrixWorld(true);
    for(let i=0;i<racers.length;i++){
      onProgress(.15*i/racers.length);
      racers[i].model.traverse(mesh=>{
        if(!mesh.isSkinnedMesh)return;
        mesh.skeleton.update();
        // Bounds are local to the skinned mesh, with room for steering and hair.
        mesh.computeBoundingSphere();mesh.boundingSphere.radius*=1.35;
      });
      await yieldFrame();
    }
    scene.traverse(object=>{
      visibility.set(object,object.visible);object.visible=true;
      if(object.isMesh||object.isLine||object.isPoints||object.isSprite){
        culling.set(object,object.frustumCulled);object.frustumCulled=false;
        for(const material of Array.isArray(object.material)?object.material:[object.material]){
          if(material)for(const value of Object.values(material))if(value?.isTexture)textures.add(value);
        }
      }
    });
    let uploaded=0;
    for(const texture of textures){
      renderer.initTexture(texture);onProgress(.15+.45*++uploaded/textures.size);
      await yieldFrame();
    }
    onProgress(.65);await renderer.compileAsync(scene,camera);await yieldFrame();
    // Shader compilation alone does not upload vertex buffers or bone textures.
    // Use the canvas behind the loading screen so the output color-space and
    // tone-mapping variants exactly match the race (render targets differ).
    renderer.setViewport(0,0,32,32);renderer.render(scene,camera);
    onProgress(1);await yieldFrame();
  }finally{
    renderer.setViewport(viewport);
    for(const [object,value] of visibility)object.visible=value;
    for(const [object,value] of culling)object.frustumCulled=value;
    for(const object of extras)scene.remove(object);
  }
}
