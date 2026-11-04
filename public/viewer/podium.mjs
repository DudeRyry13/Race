export function createPodium({THREE,raceScene,racers,camera,hoverHeight}){
  const scene=new THREE.Scene();scene.background=new THREE.Color('#080c1d');scene.environment=raceScene.environment;scene.environmentIntensity=.7;
  scene.add(new THREE.HemisphereLight(0xc8eaff,0x432651,2.2));
  const key=new THREE.DirectionalLight(0xe3f8ff,3);key.position.set(3,8,7);scene.add(key);
  const rim=new THREE.PointLight(0xc26fff,110,30);rim.position.set(-6,4,-3);scene.add(rim);
  const floor=new THREE.Mesh(new THREE.CylinderGeometry(12,12,.16,64),new THREE.MeshStandardMaterial({color:0x10172d,roughness:.28,metalness:.45}));floor.position.y=-.1;scene.add(floor);
  const slots=[{x:0,height:1.35,color:'#ffda78',clip:'PodiumVictory'},
    {x:-4.2,height:.85,color:'#b5d5ed',clip:'PodiumRage'},
    {x:4.2,height:.45,color:'#da9e78',clip:'PodiumSleep'}];
  function texture(lines,color,width=512,height=128){
    const c=document.createElement('canvas');c.width=width;c.height=height;const ctx=c.getContext('2d');ctx.textAlign='center';ctx.textBaseline='middle';
    lines.forEach((line,i)=>{ctx.fillStyle=i===0?color:'#9baecb';ctx.font=`${lines.length===1?'900 92':i===0?'800 37':'600 23'}px Segoe UI,system-ui`;ctx.fillText(line,width/2,height*(i+.5)/lines.length,width-20);});
    const map=new THREE.CanvasTexture(c);map.colorSpace=THREE.SRGBColorSpace;return map;
  }
  function sprite(lines,color,scale){const s=new THREE.Sprite(new THREE.SpriteMaterial({map:texture(lines,color),transparent:true,depthTest:false}));s.scale.set(...scale);return s;}
  for(let i=0;i<3;i++){
    const slot=slots[i],material=new THREE.MeshStandardMaterial({color:0x1d2942,metalness:.65,roughness:.25,emissive:slot.color,emissiveIntensity:.09});
    const base=new THREE.Mesh(new THREE.BoxGeometry(3.9,slot.height,3.8),material);base.position.set(slot.x,slot.height/2,0);scene.add(base);
    const edge=new THREE.LineSegments(new THREE.EdgesGeometry(base.geometry),new THREE.LineBasicMaterial({color:slot.color}));edge.position.copy(base.position);scene.add(edge);
    const number=new THREE.Mesh(new THREE.PlaneGeometry(.9,.65),new THREE.MeshBasicMaterial({map:texture([String(i+1)],slot.color,128,128),transparent:true}));number.position.set(slot.x,slot.height*.5,1.91);scene.add(number);
  }
  const confettiCount=150,confettiPositions=new Float32Array(confettiCount*3),confettiColors=new Float32Array(confettiCount*3),confetti=[];
  const palette=['#ffdd79','#8aeaff','#ed9bff','#b9ffb7'];
  for(let i=0;i<confettiCount;i++){const p={x:(Math.random()-.5)*12,z:(Math.random()-.5)*6,speed:.6+Math.random()*.8,phase:Math.random()*8};confetti.push(p);const color=new THREE.Color(palette[i%4]);confettiColors.set([color.r,color.g,color.b],i*3);}
  const confettiGeometry=new THREE.BufferGeometry();confettiGeometry.setAttribute('position',new THREE.BufferAttribute(confettiPositions,3));confettiGeometry.setAttribute('color',new THREE.BufferAttribute(confettiColors,3));
  const confettiMesh=new THREE.Points(confettiGeometry,new THREE.PointsMaterial({size:.065,vertexColors:true}));confettiMesh.frustumCulled=false;scene.add(confettiMesh);
  const labels=[],stars=[],sleep=sprite(['Z z z'],'#aebcff',[1.0,.26,1]);scene.add(sleep);
  for(let i=0;i<3;i++){const label=sprite([''],slots[i].color,[3.7,.75,1]);scene.add(label);labels.push(label);}
  for(let i=0;i<4;i++){const s=sprite(['✦'],'#ffcf79',[.32,.24,1]);scene.add(s);stars.push(s);}
  let actors=[],time=0,active=false;
  function cloneRacer(source){
    const model=source.clone(true),originals=new Map(),copies=new Map(),materials=new Map();
    function pair(original,copy){
      originals.set(copy,original);copies.set(original,copy);
      for(let i=0;i<original.children.length;i++)pair(original.children[i],copy.children[i]);
    }
    pair(source,model);
    model.traverse(object=>{
      object.visible=!object.isLight;object.matrixAutoUpdate=true;object.matrixWorldAutoUpdate=true;
      if(!object.isMesh)return;
      // The podium always draws its three actors, independent of racing bounds.
      object.frustumCulled=false;
      function cloneMaterial(material){
        if(!materials.has(material)){const copy=material.clone();copy.visible=true;materials.set(material,copy);}
        return materials.get(material);
      }
      object.material=Array.isArray(object.material)?object.material.map(cloneMaterial):cloneMaterial(object.material);
      if(!object.isSkinnedMesh)return;
      const original=originals.get(object),skeleton=original.skeleton.clone();
      skeleton.bones=original.skeleton.bones.map(bone=>copies.get(bone));
      object.bindMode=THREE.AttachedBindMode;object.bind(skeleton,original.bindMatrix);
      object.boundingBox=null;
      object.boundingSphere=object.geometry.boundingSphere?.clone()??new THREE.Sphere(new THREE.Vector3(),1);
    });
    model.position.set(0,0,0);model.quaternion.identity();model.scale.set(1,1,1);model.updateMatrix();
    return model;
  }
  function posedBounds(model){
    const bounds=new THREE.Box3(),point=new THREE.Vector3();
    model.traverse(mesh=>{
      if(!mesh.isMesh)return;
      const positions=mesh.geometry.getAttribute('position');if(!positions)return;
      if(mesh.isSkinnedMesh)mesh.skeleton.update();
      const step=Math.max(1,Math.ceil(positions.count/3000));
      for(let i=0;i<positions.count;i+=step){mesh.getVertexPosition(i,point);point.applyMatrix4(mesh.matrixWorld);bounds.expandByPoint(point);}
    });
    return bounds;
  }
  function hide(){
    if(!active)return;active=false;
    for(const actor of actors){
      scene.remove(actor.group);actor.mixer.stopAllAction();actor.mixer.uncacheRoot(actor.model);
      const skeletons=new Set(),materials=new Set();actor.model.traverse(o=>{if(o.isSkinnedMesh)skeletons.add(o.skeleton);if(o.isMesh)for(const m of Array.isArray(o.material)?o.material:[o.material])materials.add(m);});
      for(const skeleton of skeletons)skeleton.dispose();
      for(const material of materials)material.dispose();
      // Geometry and image textures are shared; actor materials and skins are separate.
    }
    actors=[];
    for(const label of labels)label.visible=false;for(const star of stars)star.visible=false;sleep.visible=false;
  }
  function show(order){
    hide();active=true;time=0;camera.fov=42;camera.updateProjectionMatrix();
    for(const label of labels)label.visible=false;for(const star of stars)star.visible=false;sleep.visible=false;
    for(const [i,r] of order.slice(0,3).entries()){
      const slot=slots[i],model=cloneRacer(r.model),group=new THREE.Group(),placement=new THREE.Group();
      // Animation never owns the transform that sizes and places the actor.
      model.name='podium_model_'+r.id;placement.add(model);group.add(placement);scene.add(group);
      const mixer=new THREE.AnimationMixer(model),action=mixer.clipAction(r.actions[slot.clip].getClip());
      action.reset().setLoop(THREE.LoopRepeat,Infinity).setEffectiveWeight(1).play();mixer.update(0);
      scene.updateMatrixWorld(true);
      const bounds=posedBounds(model),size=bounds.getSize(new THREE.Vector3()),centre=bounds.getCenter(new THREE.Vector3());
      const scale=1.65/size.y;
      placement.scale.setScalar(scale);placement.position.set(-centre.x*scale,-bounds.min.y*scale+.035,-centre.z*scale);
      group.position.set(slot.x,slot.height,.05);group.rotation.set(0,i===1?.12:i===2?-.12:0,0);
      actors.push({group,model,mixer,action,id:r.id});
      labels[i].visible=true;labels[i].material.map.dispose();labels[i].material.map=texture([r.hero.name,''],slot.color);labels[i].material.needsUpdate=true;labels[i].position.set(slot.x,slot.height+2.45,0);
    }
    scene.updateMatrixWorld(true);
    for(const actor of actors)actor.model.traverse(o=>{if(o.isSkinnedMesh)o.skeleton.update();});
  }
  function update(dt){
    if(!active)return;time+=dt;
    for(const actor of actors)actor.mixer.update(dt);scene.updateMatrixWorld(true);
    for(const actor of actors)actor.model.traverse(o=>{if(o.isSkinnedMesh)o.skeleton.update();});
    const distance=Math.max(15.4,13.7/(2*Math.tan(THREE.MathUtils.degToRad(camera.fov/2))*camera.aspect));
    camera.position.set(1.3+Math.sin(time*.22)*.45,1.25+distance*.30,distance);camera.lookAt(0,1.25,0);
    for(let i=0;i<confettiCount;i++){const p=confetti[i];confettiPositions.set([p.x+Math.sin(time*1.5+i)*.25,5.8-((time*p.speed+p.phase)%6.5),p.z],i*3);}confettiGeometry.attributes.position.needsUpdate=true;
    if(actors[1]){
      const r=actors[1],head=r.model.getObjectByName('Head'),p=head?head.getWorldPosition(new THREE.Vector3()):r.group.position.clone().add(new THREE.Vector3(0,1.6,0));
      const u=(r.action.time%3)/3,hit=[.215,.29,.685,.76].some(t=>Math.abs(u-t)<.055);
      for(let i=0;i<stars.length;i++){const angle=time*7+i*Math.PI/2;stars[i].visible=hit;stars[i].position.set(p.x+Math.cos(angle)*.5,p.y+.35+Math.sin(angle*2)*.08,p.z+Math.sin(angle)*.4);}
    }
    if(actors[2]){
      const r=actors[2],head=r.model.getObjectByName('Head');sleep.visible=true;head?head.getWorldPosition(sleep.position):sleep.position.copy(r.group.position).add(new THREE.Vector3(0,1.7,0));sleep.position.y+=.45+Math.sin(time*2)*.08;sleep.position.x+=.35;
    }
  }
  return {show,hide,update,scene};
}
