import {resolveCapsuleCollision} from './collision.mjs';
import {consumeShield} from './racing-rules.mjs';

// Collision bounds come from the Blender asset. This module creates no meshes.
export function createTrackObstacles({route,racers,getPlayer,sound,isHuman=r=>r===getPlayer()}){
  const hazards=route.obstacles.map(h=>({...h,position:route.getPointAt(h.distance/route.length).fromArray(h.position)}));
  let cooldowns=new WeakMap();
  function step(dt,only=null,barriersOnly=false){
    for(const r of only?[only]:racers){
      const timers=cooldowns.get(r)??new Map();cooldowns.set(r,timers);
      for(const [id,time] of timers)if(time<=dt)timers.delete(id);else timers.set(id,time-dt);
      for(const h of hazards){
        if(barriersOnly&&h.kind!=='barrier')continue;
        const dx=r.group.position.x-h.position.x,dz=r.group.position.z-h.position.z;
        if(Math.abs(r.group.position.y-h.position.y)>h.height+1||Math.hypot(dx,dz)>h.radius+r.halfLength+2)continue;
        if(h.kind==='barrier'){
          const body={x:r.group.position.x,z:r.group.position.z,y:r.group.position.y,heading:r.heading,radius:r.radius,halfLength:r.halfLength,mass:r.tuning?.mass??1,
            vx:Math.sin(r.motionHeading)*r.currentSpeed+r.hit.x,vz:Math.cos(r.motionHeading)*r.currentSpeed+r.hit.z};
          const fixed={x:h.position.x,z:h.position.z,y:body.y,heading:h.heading+Math.PI/2,radius:h.length/2,halfLength:h.width/2,mass:1e10,vx:0,vz:0};
          const collision=resolveCapsuleCollision(body,fixed,.12);if(!collision)continue;
          const t=route.getTangentAt(r.u),sx=body.x-r.group.position.x,sz=body.z-r.group.position.z;
          if(!isHuman(r)){r.distance+=sx*t.x+sz*t.z;r.lane+=sx*t.z-sz*t.x;}
          r.group.position.x=body.x;r.group.position.z=body.z;
          const fx=Math.sin(r.motionHeading),fz=Math.cos(r.motionHeading);
          r.currentSpeed=body.vx*fx+body.vz*fz;r.hit.set(body.vx-fx*r.currentSpeed,0,body.vz-fz*r.currentSpeed);
          if(r===getPlayer()&&collision.impulse>2&&!timers.has(h.id)){sound('collision',.8);timers.set(h.id,.5);}
        }else{
          const t=route.getTangentAt(h.distance/route.length),forward=dx*t.x+dz*t.z,side=dx*t.z-dz*t.x;
          if(Math.abs(forward)>h.length/2+r.radius||Math.abs(side)>h.width/2+r.radius||!r.grounded||timers.has(h.id))continue;
          timers.set(h.id,1.4);
          if(consumeShield(r)){if(r===getPlayer())sound('shieldBreak');continue;}
          if(h.kind==='oil'){r.oilTime=Math.max(r.oilTime,2);r.currentSpeed*=.8;}
          else{r.slowTime=Math.max(r.slowTime,1.2);r.stunTime=Math.max(r.stunTime,.15);r.currentSpeed*=.52;r.hitFlash=.55;}
          if(r===getPlayer())sound(h.kind==='oil'?'oil':'hit');
        }
      }
    }
  }
  return {hazards,step,reset(){cooldowns=new WeakMap();}};
}
