import {racerTuning} from './racing-rules.mjs';

export function resetDrift(r){Object.assign(r,{drifting:false,driftAngle:0,driftSign:0,driftCharge:0,driftTier:0,driftHop:0});}
export function stepDrift(r,dt,{held,steering,onRoad=true}){
  const tuning=racerTuning(r),allowed=onRoad&&r.grounded&&r.currentSpeed>tuning.driftMinSpeed&&r.stunTime<=0&&r.oilTime<=0;
  let released=0;
  if(!r.drifting&&held&&allowed&&Math.abs(steering)>.2){
    r.drifting=true;r.driftSign=Math.sign(steering);r.driftCharge=0;r.driftHop=.24;
  }
  if(r.drifting){
    if(!held||!allowed){
      if(allowed&&r.driftCharge>=.65){released=r.driftTier;r.turboTime=Math.max(r.turboTime,[0,.4,.7,1.0][released]*(tuning.miniTurbo??1));}
      r.drifting=false;r.driftCharge=0;r.driftTier=0;
    }else{
      r.driftCharge=Math.min(2.2,r.driftCharge+dt*(tuning.driftChargeRate??1));r.driftTier=r.driftCharge>=1.9?3:r.driftCharge>=1.25?2:r.driftCharge>=.65?1:0;
    }
  }
  const target=r.drifting?r.driftSign*(.44+.14*Math.max(-.5,steering*r.driftSign)):0;
  r.driftAngle+=(target-r.driftAngle)*(1-Math.exp(-dt*(r.drifting?12:10)));r.driftHop=Math.max(0,r.driftHop-dt);
  const blend=r.drifting?1:Math.min(1,Math.abs(r.driftAngle)/.50);
  return {released,blend,curvature:blend>.02?r.driftSign*(.024+.014*steering*r.driftSign)*(tuning.handling??1):null};
}

export function createDriftEffects({THREE,scene}){
  const capacity=2400,positions=new Float32Array(capacity*18),colors=new Float32Array(capacity*18),expires=new Float64Array(capacity);
  positions.fill(-10000);const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.BufferAttribute(positions,3));geometry.setAttribute('color',new THREE.BufferAttribute(colors,3));
  const mesh=new THREE.Mesh(geometry,new THREE.MeshBasicMaterial({vertexColors:true,transparent:true,opacity:.55,side:THREE.DoubleSide,depthWrite:false}));mesh.frustumCulled=false;mesh.renderOrder=1;scene.add(mesh);
  let cursor=0,time=0,timer=0;const last=new Map();
  function clear(){positions.fill(-10000);expires.fill(0);geometry.attributes.position.needsUpdate=true;last.clear();}
  function update(dt,racers){
    time+=dt;timer+=dt;let changed=false;
    for(let i=0;i<capacity;i++)if(expires[i]&&expires[i]<time){positions.fill(-10000,i*18,(i+1)*18);expires[i]=0;changed=true;}
    if(timer>=.035){timer=0;for(const r of racers){
      if(!r.drifting||!r.grounded||r.surfaceKind==='sand'){last.delete(r.id);continue;}
      const forward=new THREE.Vector3(Math.sin(r.heading),0,Math.cos(r.heading)),side=new THREE.Vector3(forward.z,0,-forward.x),pair=[];
      for(const sign of [-1,1]){
        const p=r.group.position.clone().addScaledVector(forward,-r.halfLength*.65).addScaledVector(side,sign*r.radius*.72);p.y+=.025;pair.push(p);
      }
      const old=last.get(r.id);last.set(r.id,pair);
      if(!old)continue;
      for(let i=0;i<2;i++){
        const a=old[i],b=pair[i];if(a.distanceToSquared(b)>16)continue;
        const dx=b.x-a.x,dz=b.z-a.z,len=Math.hypot(dx,dz)||1,nx=dz/len*.10,nz=-dx/len*.10;
        const vertices=[a.x+nx,a.y,a.z+nz,a.x-nx,a.y,a.z-nz,b.x+nx,b.y,b.z+nz,a.x-nx,a.y,a.z-nz,b.x-nx,b.y,b.z-nz,b.x+nx,b.y,b.z+nz];
        positions.set(vertices,cursor*18);const col=new THREE.Color(r.driftTier>=2?'#473043':'#202231');
        for(let k=0;k<6;k++)colors.set([col.r,col.g,col.b],cursor*18+k*3);
        expires[cursor]=time+11;cursor=(cursor+1)%capacity;changed=true;
      }
    }}
    if(changed){geometry.attributes.position.needsUpdate=true;geometry.attributes.color.needsUpdate=true;}
  }
  return {update,clear};
}
