import {ITEM_TYPES,ITEM_BY_ID,consumeShield} from './racing-rules.mjs';
import {createMotionBuffer} from './online-motion.mjs?build=online-v17';

export const PICKUP_ROW_SIZE=5;
export function pickupLayout(length,width){
  const previousRows=Math.max(9,Math.floor(length/72)),rows=Math.max(3,Math.floor(previousRows/3));
  return Array.from({length:rows},(_,i)=>[-.34,-.17,0,.17,.34].map(factor=>({distance:(i+.55)*length/rows,lane:factor*width}))).flat();
}
export function createRaceItems({THREE,scene,route,racers,getPlayer,getTime,notify,sound,onPickup=()=>{},isHuman=r=>r===getPlayer(),onEvent=()=>{}}){
  const pickups=[],traps=[],rockets=[],effects=[],loose=[],particles=[];
  const replicas=new Map();let networkIds=new WeakMap(),networkCounter=0;
  let seed=0x7a91bc31;
  const random=()=>{seed^=seed<<13;seed^=seed>>>17;seed^=seed<<5;return (seed>>>0)/4294967296;};
  const clamp=THREE.MathUtils.clamp;
  const basic=(color,extra={})=>new THREE.MeshBasicMaterial({color,...extra});
  const cubeGeo=new THREE.BoxGeometry(.84,.84,.84),sphereGeo=new THREE.SphereGeometry(1,14,10),ringGeo=new THREE.RingGeometry(.82,1,40);
  const pickupMaterial=basic(0x7964ff,{transparent:true,opacity:.88}),edgeMaterial=new THREE.LineBasicMaterial({color:0xb5fcff});
  const edgeGeo=new THREE.EdgesGeometry(cubeGeo),trapMaterial=new THREE.MeshStandardMaterial({color:0xc84145,roughness:.5,emissive:0x731228,emissiveIntensity:.45});
  const mineMaterial=new THREE.MeshStandardMaterial({color:0x47345b,metalness:.6,roughness:.4,emissive:0xff3388,emissiveIntensity:.65});
  const oilMaterial=basic(0x25134a,{transparent:true,opacity:.87,side:THREE.DoubleSide});
  function labelTexture(text,color='#ffffff'){
    const canvas=document.createElement('canvas');canvas.width=128;canvas.height=128;const c=canvas.getContext('2d');c.clearRect(0,0,128,128);c.fillStyle=color;c.font=`bold ${text.length>1?48:76}px system-ui`;c.textAlign='center';c.textBaseline='middle';c.fillText(text,64,64);const texture=new THREE.CanvasTexture(canvas);texture.colorSpace=THREE.SRGBColorSpace;return texture;
  }
  const questionMaterial=basic(0xffffff,{map:labelTexture('?'),transparent:true,depthWrite:false,side:THREE.DoubleSide});
  const tntLabel=basic(0xffffff,{map:labelTexture('TNT','#fff4d2'),transparent:true,side:THREE.DoubleSide});
  const particleCapacity=650,particlePositions=new Float32Array(particleCapacity*3),particleColors=new Float32Array(particleCapacity*3);
  particlePositions.fill(-10000);
  const particleGeometry=new THREE.BufferGeometry();particleGeometry.setAttribute('position',new THREE.BufferAttribute(particlePositions,3));particleGeometry.setAttribute('color',new THREE.BufferAttribute(particleColors,3));
  const dots=document.createElement('canvas');dots.width=32;dots.height=32;const dc=dots.getContext('2d'),gradient=dc.createRadialGradient(16,16,0,16,16,16);gradient.addColorStop(0,'#fff');gradient.addColorStop(.3,'#fff');gradient.addColorStop(1,'#ffffff00');dc.fillStyle=gradient;dc.fillRect(0,0,32,32);
  const points=new THREE.Points(particleGeometry,new THREE.PointsMaterial({size:.23,vertexColors:true,transparent:true,depthWrite:false,map:new THREE.CanvasTexture(dots),blending:THREE.AdditiveBlending}));points.frustumCulled=false;scene.add(points);
  const sampleAt=u=>({p:route.getPointAt(u),t:route.getTangentAt(u),u});
  function floorAt(position,u){return route.surfaceAt(position,sampleAt(u)).height;}
  function at(distance,lane=0){const u=((distance/route.length)%1+1)%1,s=sampleAt(u),left=new THREE.Vector3(s.t.z,0,-s.t.x).normalize();return s.p.clone().addScaledVector(left,lane);}
  function burst(position,color=0xffa65f,count=24){
    const col=new THREE.Color(color);
    for(let i=0;i<count;i++){
      if(particles.length>=particleCapacity)particles.shift();
      particles.push({p:position.clone(),v:new THREE.Vector3((random()-.5)*7,random()*6+.8,(random()-.5)*7),life:.45+random()*.5,total:1,color:col.clone()});
    }
  }
  function flash(position,radius,color=0xff9563){
    const mesh=new THREE.Mesh(sphereGeo,basic(color,{transparent:true,opacity:.65,depthWrite:false,blending:THREE.AdditiveBlending}));mesh.position.copy(position);scene.add(mesh);effects.push({mesh,life:.48,total:.48,radius});
    const ring=new THREE.Mesh(ringGeo,basic(color,{transparent:true,opacity:.85,depthWrite:false,side:THREE.DoubleSide}));ring.rotation.x=-Math.PI/2;ring.position.copy(position);ring.position.y-=.3;scene.add(ring);effects.push({mesh:ring,life:.6,total:.6,radius:radius*1.2});burst(position,color,32);
  }
  function hurt(r,{slow=1.8,stun=.3,oil=0,force=.54,owner=null,color=0xff9166}={}){
    if(consumeShield(r)){flash(r.group.position.clone().add(new THREE.Vector3(0,.8,0)),1.7,0x8aeeff);if(r===getPlayer()){notify('ЩИТ ПРИНЯЛ УДАР','#8aeeff');sound('shieldBreak');}return false;}
    r.slowTime=Math.max(r.slowTime,slow);r.stunTime=Math.max(r.stunTime,stun);r.oilTime=Math.max(r.oilTime,oil);r.currentSpeed*=force;r.hitFlash=.55;
    onEvent({kind:'hit',racer:r.id,oil:!!oil});
    if(owner){const away=r.group.position.clone().sub(owner.group.position);away.y=0;if(away.lengthSq()>.01)r.hit.addScaledVector(away.normalize(),3.5);}
    if(r===getPlayer()){notify(oil?'МАСЛО! МЕНЬШЕ СЦЕПЛЕНИЯ':'ПОПАДАНИЕ!',color);sound(oil?'oil':'hit');}
    return true;
  }
  function explosion(position,radius,owner){
    flash(position,radius);if(getPlayer()?.group.position.distanceTo(position)<45)sound('explosion');
    for(const r of racers)if(Math.abs(r.group.position.y-position.y)<3&&Math.hypot(r.group.position.x-position.x,r.group.position.z-position.z)<radius)hurt(r,{owner,slow:2,stun:.48,force:.48});
  }
  function makePickup(position,kind=null){
    const mesh=new THREE.Group(),cube=new THREE.Mesh(cubeGeo,pickupMaterial);mesh.add(cube,new THREE.LineSegments(edgeGeo,edgeMaterial));
    const plane=new THREE.Mesh(new THREE.PlaneGeometry(.65,.65),kind?basic(0xffffff,{map:labelTexture(ITEM_BY_ID[kind].symbol),transparent:true,side:THREE.DoubleSide}):questionMaterial);plane.position.z=.435;mesh.add(plane);mesh.position.copy(position);mesh.position.y+=1.05;scene.add(mesh);
    return mesh;
  }
  for(const {distance,lane} of pickupLayout(route.length,route.width)){
    const p=at(distance,lane);p.y=floorAt(p,distance/route.length);
    if(route.physical&&!route.surfaceAt(p,sampleAt(distance/route.length)).supported)continue;
    if(route.obstacles?.some(h=>h.kind==='barrier'&&Math.abs(h.distance-distance)<h.length/2+1.5&&Math.abs(h.lane-lane)<h.width/2+1))continue;
    pickups.push({mesh:makePickup(p),base:p.clone(),distance,lane,respawn:0,phase:random()*6.28});
  }
  function give(r,id){r.item=id;r.itemSince=getTime();r.itemCooldown=.25;burst(r.group.position.clone().add(new THREE.Vector3(0,.6,0)),ITEM_BY_ID[id].color,14);onEvent({kind:'pickup',racer:r.id,item:id});if(r===getPlayer()){onPickup(ITEM_BY_ID[id]);sound('pickup');}}
  function findTarget(r,direction=1){
    let best=null,bestGap=110;
    for(const other of racers){if(other===r||other.finished)continue;const gap=(((other.u-r.u)*route.length*direction)%route.length+route.length)%route.length;if(gap>2&&gap<bestGap){bestGap=gap;best=other;}}
    return best;
  }
  function trapMesh(kind){
    const root=new THREE.Group();let mesh;
    if(kind==='tnt'){
      mesh=new THREE.Group();mesh.add(new THREE.Mesh(new THREE.BoxGeometry(.95,.82,.9),trapMaterial));const text=new THREE.Mesh(new THREE.PlaneGeometry(.8,.45),tntLabel);text.position.z=.46;mesh.add(text);mesh.position.y=.42;
      const fuse=new THREE.Mesh(new THREE.SphereGeometry(.09,8,6),basic(0xffdf89));fuse.position.y=.52;mesh.add(fuse);
    }else if(kind==='mine'){
      mesh=new THREE.Mesh(new THREE.CylinderGeometry(.68,.8,.22,12),mineMaterial);mesh.position.y=.15;
    }else{
      mesh=new THREE.Mesh(new THREE.CircleGeometry(2.2,28),oilMaterial);mesh.rotation.x=-Math.PI/2;mesh.position.y=.025;
    }
    root.add(mesh);return root;
  }
  function spawnTrap(r,kind){
    const distance=r.distance-r.halfLength-2.2,lane=clamp(r.lane,-route.width*.4,route.width*.4),position=at(distance,lane),u=((distance/route.length)%1+1)%1;
    position.y=floorAt(position,u)+.08;const mesh=trapMesh(kind);mesh.position.copy(position);
    scene.add(mesh);traps.push({mesh,kind,distance,lane,position:position.clone(),owner:r,born:getTime(),life:kind==='oil'?13:24,radius:kind==='oil'?2.35:1.25});
    if(r===getPlayer())sound('drop');
    if(traps.length>65){scene.remove(traps.shift().mesh);}
  }
  function rocketMesh(){
    const mesh=new THREE.Group();
    const body=new THREE.Mesh(new THREE.CylinderGeometry(.15,.15,.8,10),basic(0xe9faff));body.rotation.x=Math.PI/2;mesh.add(body);
    const nose=new THREE.Mesh(new THREE.ConeGeometry(.16,.35,10),basic(0xff815b));nose.rotation.x=Math.PI/2;nose.position.z=.55;mesh.add(nose);
    const glow=new THREE.Mesh(new THREE.SphereGeometry(.13,8,6),basic(0x76e9ff));glow.position.z=-.5;mesh.add(glow);return mesh;
  }
  function launchRocket(r,direction){
    const target=findTarget(r,direction),mesh=rocketMesh();scene.add(mesh);
    const distance=r.distance+direction*2.5,u=((distance/route.length)%1+1)%1,p=at(distance,r.lane),t=route.getTangentAt(u);p.y=floorAt(p,u)+.8;mesh.position.copy(p);mesh.rotation.y=Math.atan2(t.x*direction,t.z*direction);
    rockets.push({mesh,owner:r,target,direction,distance,lane:r.lane,life:3.4,travel:0});if(r===getPlayer())sound('rocket');
  }
  function use(r,backward=false){
    if(!r.item||r.itemCooldown>0)return false;
    const kind=r.item;r.item=null;r.itemCooldown=.35;
    onEvent({kind:'use',racer:r.id,item:kind});
    if(backward&&['shield','turbo','emp'].includes(kind)){
      const distance=r.distance-3.5,p=at(distance,r.lane);p.y=floorAt(p,distance/route.length);
      loose.push({mesh:makePickup(p,kind),base:p.clone(),kind,born:getTime(),owner:r,life:20});
    }else if(['tnt','mine','oil'].includes(kind))spawnTrap(r,kind);
    else if(kind==='rocket')launchRocket(r,backward?-1:1);
    else if(kind==='shield'){r.shieldTime=6;if(r===getPlayer()){notify('ЩИТ ВКЛЮЧЁН','#8aeeff');sound('shield');}}
    else if(kind==='turbo'){r.turboTime=Math.max(r.turboTime,2.4);if(r===getPlayer()){notify('ТУРБО!','#72ffc9');sound('turbo');}}
    else if(kind==='emp'){
      flash(r.group.position.clone().add(new THREE.Vector3(0,.55,0)),11,0xa49bff);
      for(const other of racers)if(other!==r&&other.group.position.distanceTo(r.group.position)<11)hurt(other,{owner:r,slow:2.5,stun:.12,force:.65,color:'#b3adff'});
      if(r===getPlayer())sound('emp');
    }
    return true;
  }
  function botUse(r){
    if(!r.item||getTime()-r.itemSince<(r.aiLevel==='hard'?.15:r.aiLevel==='medium'?.3:.9)||r.itemCooldown>0||r.stunTime>0)return;
    const ahead=findTarget(r,1),behind=findTarget(r,-1),age=getTime()-r.itemSince;
    if(r.item==='rocket'&&ahead)use(r);
    else if(r.item==='rocket'&&behind&&behind.group.position.distanceTo(r.group.position)<45)use(r,true);
    else if(['tnt','mine','oil'].includes(r.item)&&(behind&&behind.group.position.distanceTo(r.group.position)<18||age>5))use(r);
    else if(r.item==='shield'&&(rockets.some(p=>p.target===r)||traps.some(t=>t.position.distanceTo(r.group.position)<9)||age>6))use(r);
    else if(r.item==='emp'&&racers.some(other=>other!==r&&other.group.position.distanceTo(r.group.position)<9))use(r);
    else if(r.item==='turbo'&&r.aiTurboAllowed)use(r);
  }
  function step(dt){
    const now=getTime();
    for(const pick of pickups){
      pick.respawn=Math.max(0,pick.respawn-dt);pick.mesh.visible=pick.respawn===0;
      if(pick.respawn>0)continue;
      for(const r of racers)if(!r.item&&r.itemCooldown===0&&Math.abs(r.group.position.y-pick.base.y)<1.6&&Math.hypot(r.group.position.x-pick.base.x,r.group.position.z-pick.base.z)<1.25+r.radius){give(r,ITEM_TYPES[Math.floor(random()*ITEM_TYPES.length)].id);pick.respawn=9;pick.mesh.visible=false;break;}
    }
    for(let i=loose.length-1;i>=0;i--){const pick=loose[i];pick.life-=dt;let taken=false;for(const r of racers)if(!r.item&&r.itemCooldown===0&&(r!==pick.owner||now-pick.born>1.5)&&r.group.position.distanceTo(pick.base)<2){give(r,pick.kind);taken=true;break;}if(taken||pick.life<=0){scene.remove(pick.mesh);loose.splice(i,1);}}
    for(const r of racers)if(r.padCooldown<=0&&r.grounded)for(const pad of route.pads){
      const dx=r.group.position.x-pad.origin.x,dz=r.group.position.z-pad.origin.z;
      if(Math.abs(r.group.position.y-pad.origin.y)<1.6&&Math.abs(dx*pad.forward.x+dz*pad.forward.z)<pad.length*.5&&Math.abs(dx*pad.forward.z-dz*pad.forward.x)<pad.width*.5){r.turboTime=Math.max(r.turboTime,.95);r.padCooldown=1.4;if(r===getPlayer())sound('turbo');break;}
    }
    for(let i=traps.length-1;i>=0;i--){
      const trap=traps[i];trap.life-=dt;let remove=trap.life<=0;
      if(now-trap.born>.7)for(const r of racers){
        if(r===trap.owner&&now-trap.born<1.4)continue;
        if(Math.abs(r.group.position.y-trap.position.y)>1.8||Math.hypot(r.group.position.x-trap.position.x,r.group.position.z-trap.position.z)>trap.radius+r.radius)continue;
        if(trap.kind==='tnt'){explosion(trap.position.clone().add(new THREE.Vector3(0,.4,0)),5.1,trap.owner);remove=true;break;}
        if(trap.kind==='mine'){flash(trap.position,3,0xff73ba);hurt(r,{owner:trap.owner,slow:2.2,stun:.5,force:.4});remove=true;break;}
        if(r.oilTime<.4)hurt(r,{owner:trap.owner,slow:0,stun:0,oil:2.6,force:.82,color:'#c09aff'});
      }
      if(remove){scene.remove(trap.mesh);traps.splice(i,1);}
    }
    for(let i=rockets.length-1;i>=0;i--){
      const rocket=rockets[i];rocket.life-=dt;rocket.distance+=rocket.direction*88*dt;rocket.travel+=88*dt;
      if(rocket.target)rocket.lane=THREE.MathUtils.damp(rocket.lane,rocket.target.lane,7,dt);
      const u=((rocket.distance/route.length)%1+1)%1,p=at(rocket.distance,rocket.lane),t=route.getTangentAt(u);p.y=floorAt(p,u)+.8;
      if(rocket.target&&rocket.target.group.position.distanceTo(p)<12)p.y=THREE.MathUtils.lerp(p.y,rocket.target.group.position.y+.5,.7);
      rocket.mesh.position.copy(p);rocket.mesh.rotation.y=Math.atan2(t.x*rocket.direction,t.z*rocket.direction);
      let hit=null;for(const r of racers)if(r!==rocket.owner&&Math.abs(r.group.position.y-p.y)<2&&Math.hypot(r.group.position.x-p.x,r.group.position.z-p.z)<r.radius+.65){hit=r;break;}
      if(hit){explosion(p,3.5,rocket.owner);rocket.life=0;}
      if(rocket.life<=0||rocket.travel>210){scene.remove(rocket.mesh);rockets.splice(i,1);}
    }
    for(const r of racers)if(!isHuman(r))botUse(r);
  }
  let trailTimer=0;
  function animate(dt){
    for(const mesh of replicas.values())if(mesh.userData.onlineMotion){
      const pose=mesh.userData.onlineMotion.sample(performance.now());
      if(pose){mesh.position.fromArray(pose.p);mesh.rotation.set(...pose.rot);}
    }
    const now=getTime();for(const pick of pickups){pick.mesh.rotation.set(.15,now*1.5+pick.phase,.12);pick.mesh.position.y=pick.base.y+1.05+Math.sin(now*2+pick.phase)*.12;}
    for(const pick of loose){pick.mesh.rotation.y+=dt*1.6;pick.mesh.position.y=pick.base.y+1+Math.sin(now*3)*.12;}
    for(let i=effects.length-1;i>=0;i--){const effect=effects[i];effect.life-=dt;const progress=1-effect.life/effect.total;effect.mesh.scale.setScalar(.2+progress*effect.radius);effect.mesh.material.opacity=Math.max(0,(1-progress)*.65);if(effect.life<=0){scene.remove(effect.mesh);effect.mesh.material.dispose();effects.splice(i,1);}}
    trailTimer+=dt;
    if(trailTimer>.035){
      trailTimer=0;for(const rocket of rockets)burst(rocket.mesh.position,0x8ae8ff,1);
      for(const r of racers){
        if(!r.group.visible)continue;
        const p=r.group.position.clone().add(new THREE.Vector3(-Math.sin(r.heading)*r.halfLength,.18,-Math.cos(r.heading)*r.halfLength));
        if(r.boosting)burst(p,0x89baff,1);
        if(r.drifting){
          const color=r.driftTier>=3?0x8ffff0:r.driftTier>=2?0xff8bcf:r.driftTier>=1?0xffcb6e:0x6e7a91;burst(p,color,2);
          for(const spark of particles.slice(-2)){spark.v.multiplyScalar(.45);spark.v.y=.7+random();spark.life=.3+random()*.25;}
        }
      }
    }
    for(let i=particles.length-1;i>=0;i--){const p=particles[i];p.life-=dt;if(p.life<=0){particles.splice(i,1);continue;}p.v.y-=8*dt;p.p.addScaledVector(p.v,dt);}
    for(let i=0;i<particleCapacity;i++){const p=particles[i],j=i*3;if(!p){particlePositions[j]=particlePositions[j+1]=particlePositions[j+2]=-10000;continue;}particlePositions[j]=p.p.x;particlePositions[j+1]=p.p.y;particlePositions[j+2]=p.p.z;const fade=Math.min(1,p.life*2);particleColors[j]=p.color.r*fade;particleColors[j+1]=p.color.g*fade;particleColors[j+2]=p.color.b*fade;}
    particleGeometry.attributes.position.needsUpdate=true;particleGeometry.attributes.color.needsUpdate=true;
  }
  function reset(){
    for(const object of replicas.values())removeReplica(object);replicas.clear();networkIds=new WeakMap();networkCounter=0;
    for(const list of [traps,rockets,effects,loose]){for(const object of list)scene.remove(object.mesh);list.length=0;}particles.length=0;seed=0x7a91bc31;
    for(const pickup of pickups){pickup.respawn=0;pickup.mesh.visible=true;}
  }
  function dispose(){
    const roots=[points,...pickups.map(p=>p.mesh),...[traps,rockets,effects,loose].flatMap(list=>list.map(o=>o.mesh))];
    const geometries=new Set([cubeGeo,sphereGeo,ringGeo,edgeGeo,particleGeometry]),materials=new Set([pickupMaterial,edgeMaterial,trapMaterial,mineMaterial,oilMaterial,questionMaterial,tntLabel]),textures=new Set();
    for(const root of roots){scene.remove(root);root.traverse(o=>{if(o.geometry)geometries.add(o.geometry);if(o.material)for(const m of Array.isArray(o.material)?o.material:[o.material])materials.add(m);});}
    reset();for(const p of pickups)scene.remove(p.mesh);
    for(const material of materials)for(const value of Object.values(material))if(value?.isTexture)textures.add(value);
    for(const resource of [...geometries,...materials,...textures])resource.dispose();
  }
  function removeReplica(mesh){
    scene.remove(mesh);
    const sharedGeometries=new Set([cubeGeo,sphereGeo,ringGeo,edgeGeo,particleGeometry]);
    const sharedMaterials=new Set([pickupMaterial,edgeMaterial,trapMaterial,mineMaterial,oilMaterial,questionMaterial,tntLabel]);
    mesh.traverse(o=>{
      if(o.geometry&&!sharedGeometries.has(o.geometry))o.geometry.dispose();
      if(o.material)for(const m of Array.isArray(o.material)?o.material:[o.material])if(!sharedMaterials.has(m))m.dispose();
    });
  }
  function networkSnapshot(){
    const objects=[];
    const collect=(list,kind)=>{for(const object of list){
      if(!networkIds.has(object))networkIds.set(object,++networkCounter);
      const mesh=object.mesh;
      objects.push({id:networkIds.get(object),kind:kind==='trap'?object.kind:kind==='effect'?(mesh.geometry===ringGeo?'ring':'flash'):kind,
        item:object.kind,p:mesh.position.toArray(),rot:[mesh.rotation.x,mesh.rotation.y,mesh.rotation.z],scale:mesh.scale.toArray(),
        ...(kind==='rocket'?{vel:[Math.sin(mesh.rotation.y)*88,0,Math.cos(mesh.rotation.y)*88]}:{}),
        color:mesh.material?.color?.getHex(),opacity:mesh.material?.opacity});
    }};
    collect(traps,'trap');collect(rockets,'rocket');collect(loose,'loose');collect(effects,'effect');
    return {pickups:pickups.map(p=>p.respawn),objects};
  }
  function applyNetwork(state,{sourceTime,transitSeconds=0,receivedAt=performance.now(),paused=false}={}){
    for(let i=0;i<pickups.length;i++){pickups[i].respawn=state.pickups[i]??0;pickups[i].mesh.visible=pickups[i].respawn===0;}
    const alive=new Set();
    for(const object of state.objects){
      alive.add(object.id);let mesh=replicas.get(object.id);
      if(!mesh){
        if(['tnt','mine','oil'].includes(object.kind))mesh=trapMesh(object.kind);
        else if(object.kind==='rocket')mesh=rocketMesh();
        else if(object.kind==='loose')mesh=makePickup(new THREE.Vector3(),object.item);
        else mesh=new THREE.Mesh(object.kind==='ring'?ringGeo:sphereGeo,basic(object.color??0xff9563,{transparent:true,depthWrite:false,side:THREE.DoubleSide,blending:THREE.AdditiveBlending}));
        scene.add(mesh);replicas.set(object.id,mesh);
      }
      if(object.kind==='rocket'&&!paused){
        const first=!mesh.userData.onlineMotion;mesh.userData.onlineMotion??=createMotionBuffer();
        mesh.userData.onlineMotion.push(object,{sourceTime,transitSeconds,receivedAt,grounded:true});
        if(first){mesh.position.fromArray(object.p);mesh.rotation.set(...object.rot);}
      }else{mesh.userData.onlineMotion=null;mesh.position.fromArray(object.p);mesh.rotation.set(...object.rot);}
      mesh.scale.fromArray(object.scale);
      if(mesh.material&&object.opacity!==undefined)mesh.material.opacity=object.opacity;
    }
    for(const [id,mesh] of replicas)if(!alive.has(id)){removeReplica(mesh);replicas.delete(id);}
  }
  return {step,animate,reset,use,burst,dispose,networkSnapshot,applyNetwork,get pickups(){return pickups;},get hazards(){return traps;}};
}
