import {createMotionBuffer} from './online-motion.mjs?build=online-v17';
export const RACER_FIELDS=['currentSpeed','heading','motionHeading','steering','distance','u','nearest','lastU','lane','laneTarget','laneVelocity',
  'y','verticalSpeed','lastFloor','grounded','onRoad','finished','energy','boosting','item','itemSince','turboTime','shieldTime','slowTime','oilTime','stunTime',
  'itemCooldown','hitFlash','boostLatch','padCooldown','nitroLocked','drifting','driftAngle','driftSign','driftCharge','driftTier','driftHop','pathCurvature'];
const number=n=>Number.isFinite(n)?Math.round(n*10000)/10000:0;
const previousMotion=new WeakMap(),angle=n=>Math.atan2(Math.sin(n),Math.cos(n));
export function packRacer(r,now=performance.now()/1000){
  const previous=previousMotion.get(r),dt=previous?now-previous.time:0;
  const motion=dt>.005&&dt<.5?[angle(r.motionHeading-previous.heading)/dt,angle(r.heading-previous.yaw)/dt]:[0,0];
  previousMotion.set(r,{time:now,heading:r.motionHeading,yaw:r.heading});
  return {id:r.id,p:r.group.position.toArray().map(number),rot:[r.group.rotation.x,r.group.rotation.y,r.group.rotation.z].map(number),
    hit:r.hit.toArray().map(number),
    motion:motion.map(n=>number(Math.max(-4,Math.min(4,n)))),
    vel:[Math.sin(r.motionHeading)*r.currentSpeed+r.hit.x,r.verticalSpeed||0,Math.cos(r.motionHeading)*r.currentSpeed+r.hit.z].map(number),
    v:RACER_FIELDS.map(key=>typeof r[key]==='number'?number(r[key]):r[key]??null)};
}
export function applyRacer(r,state,{interpolate=false,transitSeconds=0,sourceTime,receivedAt=performance.now()}={}){
  for(let i=0;i<RACER_FIELDS.length;i++)r[RACER_FIELDS[i]]=state.v[i];
  r.hit.fromArray(state.hit);
  if(interpolate){
    r.netMotion??=createMotionBuffer();
    r.netMotion.push(state,{receivedAt,sourceTime,transitSeconds,grounded:r.grounded});
  }else{r.netMotion=null;r.group.position.fromArray(state.p);r.group.rotation.set(...state.rot,'YXZ');}
  if(r.steer)r.steer.time=1-r.steering;
}
