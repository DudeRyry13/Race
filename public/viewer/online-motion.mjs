const clamp=(n,a,b)=>Math.max(a,Math.min(b,n));
const angle=n=>Math.atan2(Math.sin(n),Math.cos(n));
const lerp=(a,b,t)=>a+(b-a)*t;
const distance=(a,b)=>Math.hypot(...a.map((n,i)=>n-b[i]));

// Draw remote karts on a continuous timeline. The small adaptive buffer absorbs
// packet jitter; short gaps use the kart's turn rate rather than a straight line.
export function createMotionBuffer(){
  let samples=[],interval=.04,jitter=0,correction=null,delayScale=1;
  const delay=()=>clamp(interval*1.1+jitter*2,.045,.12);
  function extrapolate(s,seconds){
    const t=seconds<=.16?seconds:.16+.06*(1-Math.exp(-(seconds-.16)/.06));
    const [vx,vy,vz]=s.vel,w=s.turn,a=w*t;
    const sine=Math.abs(w)>.001?Math.sin(a)/w:t;
    const cosine=Math.abs(w)>.001?(1-Math.cos(a))/w:0;
    return {p:[s.p[0]+vx*sine+vz*cosine,s.p[1]+vy*t-(s.grounded?0:12*t*t),s.p[2]+vz*sine-vx*cosine],
      rot:[s.rot[0],s.rot[1]+s.spin*t,s.rot[2]],vel:[vx*Math.cos(a)+vz*Math.sin(a),vy-(s.grounded?0:24*t),vz*Math.cos(a)-vx*Math.sin(a)]};
  }
  function raw(now,buffer=delay()*delayScale){
    const last=samples.at(-1);if(!last)return null;
    const time=last.time+last.age+(now-last.receivedAt)/1000-buffer;
    if(time>=last.time)return extrapolate(last,Math.max(0,time-last.time));
    let b=1;while(b<samples.length&&samples[b].time<time)b++;
    const first=samples[Math.max(0,b-1)],second=samples[Math.min(b,samples.length-1)];
    if(time<=samples[0].time||first===second)return {p:[...first.p],rot:[...first.rot],vel:[...first.vel]};
    const span=second.time-first.time,t=clamp((time-first.time)/span,0,1),t2=t*t,t3=t2*t;
    const extent=distance(first.p,second.p),limit=extent*1.5;
    const tangent=s=>{const length=Math.hypot(...s.vel)*span;return s.vel.map(v=>v*span*(length>limit?limit/Math.max(.001,length):1));};
    const va=tangent(first),vb=tangent(second);
    return {p:first.p.map((p,i)=>{
      const smooth=(2*t3-3*t2+1)*p+(t3-2*t2+t)*va[i]+(-2*t3+3*t2)*second.p[i]+(t3-t2)*vb[i];
      return clamp(smooth,Math.min(p,second.p[i])-.15,Math.max(p,second.p[i])+.15);
    }),rot:first.rot.map((v,i)=>v+angle(second.rot[i]-v)*t),vel:first.vel.map((v,i)=>lerp(v,second.vel[i],t))};
  }
  function sample(now){
    const pose=raw(now);if(!pose||!correction)return pose;
    const weight=Math.exp(-Math.max(0,now-correction.at)/90);
    pose.p=pose.p.map((v,i)=>v+correction.p[i]*weight);
    pose.rot=pose.rot.map((v,i)=>v+correction.rot[i]*weight);
    return pose;
  }
  return {
    push(state,{receivedAt=performance.now(),sourceTime=receivedAt/1000,transitSeconds=0,grounded=true}={}){
      if(!Number.isFinite(sourceTime))sourceTime=receivedAt/1000;
      const last=samples.at(-1);if(last&&sourceTime<=last.time)return false;
      const before=sample(receivedAt),span=last?sourceTime-last.time:0;
      const speed=Math.hypot(...(state.vel??[0,0,0]));
      const teleport=last&&distance(last.p,state.p)>Math.max(12,(speed+Math.hypot(...last.vel))*span*1.5+4);
      if(teleport||span>.8){samples=[];correction=null;jitter=0;}
      else if(last&&span>0){
        interval=lerp(interval,clamp(span,.016,.1),.15);
        jitter=lerp(jitter,Math.abs((receivedAt-last.receivedAt)/1000-span),.15);
      }
      const inferredSpin=last&&span>0?angle(state.rot[1]-last.rot[1])/span:0;
      samples.push({time:sourceTime,receivedAt,age:clamp(transitSeconds,0,.35),p:[...state.p],rot:[...state.rot],
        vel:[...(state.vel??[0,0,0])],turn:clamp(state.motion?.[0]??inferredSpin,-3,3),spin:clamp(state.motion?.[1]??inferredSpin,-4,4),grounded});
      if(samples.length>24)samples.shift();
      const after=raw(receivedAt);
      if(before&&!teleport&&span<=.8&&distance(before.p,after.p)<8){
        correction={at:receivedAt,p:before.p.map((v,i)=>v-after.p[i]),rot:before.rot.map((v,i)=>angle(v-after.rot[i]))};
      }else correction=null;
      return true;
    },
    sample,predict:now=>raw(now,0),
    setDelayScale(value,now){
      value=clamp(value,0,1);if(Math.abs(value-delayScale)<.005)return;
      const before=sample(now);delayScale=value;const after=raw(now);
      if(before&&after)correction={at:now,p:before.p.map((v,i)=>v-after.p[i]),rot:before.rot.map((v,i)=>angle(v-after.rot[i]))};
    },
    get bufferedSeconds(){return delay();},
    get size(){return samples.length;}
  };
}

// Position is corrected immediately for physics; preserve the visible pose while
// the correction settles, including the heading used by the chase camera.
export function preserveLocalPose(r,previous){
  const correction=previous.position.clone().sub(r.group.position);
  if(correction.length()>8){r.netOffset.set(0,0,0);r.netRotation.identity();r.netHeadingOffset=0;return false;}
  r.netOffset.copy(correction);
  r.netRotation.copy(r.group.quaternion).invert().multiply(previous.rotation).normalize();
  r.netHeadingOffset=angle(previous.heading-r.motionHeading);
  return true;
}

export function settleLocalPose(r,dt){
  const decay=Math.exp(-Math.max(0,dt)*12);
  r.netOffset.multiplyScalar(decay);
  r.netRotation.slerp(r.netRotation.clone().identity(),1-decay);
  r.netHeadingOffset*=decay;
}
