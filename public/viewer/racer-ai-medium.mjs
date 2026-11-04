// Difficulty changes planning and reactions; character motor limits stay shared.
export function createMediumRaceAI({THREE,route,rules,difficulty='medium'}){
  const hard=difficulty==='hard',clamp=THREE.MathUtils.clamp,L=route.length,half=route.width/2;
  const count=Math.max(hard?180:120,Math.ceil(L/(hard?4.5:6))),bound=half-(hard?1.35:1.6),wrap=i=>(i%count+count)%count;
  const centres=[],normals=[];
  for(let i=0;i<count;i++){
    centres.push(route.getPointAt(i/count));const t=route.getTangentAt(i/count);normals.push(new THREE.Vector3(t.z,0,-t.x).normalize());
  }
  let lanes=new Float64Array(count),next=new Float64Array(count);const x=new Float64Array(count),z=new Float64Array(count);
  // A periodic bending/length optimisation avoids the rapid lane oscillations
  // produced by independently moving individual racing-line points.
  for(let iteration=0;iteration<(hard?2600:1800);iteration++){
    for(let i=0;i<count;i++){x[i]=centres[i].x+normals[i].x*lanes[i];z[i]=centres[i].z+normals[i].z*lanes[i];}
    for(let i=0;i<count;i++){
      const a=wrap(i-1),b=wrap(i+1),aa=wrap(i-2),bb=wrap(i+2);
      const gx=6*x[i]-4*(x[a]+x[b])+x[aa]+x[bb]+.035*(2*x[i]-x[a]-x[b]);
      const gz=6*z[i]-4*(z[a]+z[b])+z[aa]+z[bb]+.035*(2*z[i]-z[a]-z[b]);
      next[i]=clamp(lanes[i]-.05*(gx*normals[i].x+gz*normals[i].z),-bound,bound);
    }
    [lanes,next]=[next,lanes];
  }
  for(let pass=0;pass<3;pass++){
    for(let i=0;i<count;i++)next[i]=(lanes[wrap(i-1)]+2*lanes[i]+lanes[wrap(i+1)])/4;
    [lanes,next]=[next,lanes];
  }
  function laneAt(distance){
    const a=((distance/L)%1+1)%1*count,i=Math.floor(a),t=a-i;
    const p0=lanes[wrap(i-1)],p1=lanes[i],p2=lanes[wrap(i+1)],p3=lanes[wrap(i+2)];
    return clamp(.5*(2*p1+(p2-p0)*t+(2*p0-5*p1+4*p2-p3)*t*t+(-p0+3*p1-3*p2+p3)*t*t*t),-bound,bound);
  }
  function pointAt(distance){
    const u=distance/L,t=route.getTangentAt(u),p=route.getPointAt(u),lane=laneAt(distance);
    p.x+=t.z*lane;p.z-=t.x*lane;return p;
  }
  const samples=Math.max(360,Math.ceil(L/2)),ds=L/samples,index=i=>(i%samples+samples)%samples;
  const points=Array.from({length:samples},(_,i)=>pointAt(i*ds)),curves=new Float64Array(samples),safe=new Float64Array(samples),segments=new Float64Array(samples);
  for(let i=0;i<samples;i++){
    const a=points[index(i-1)],b=points[i],c=points[index(i+1)],ax=b.x-a.x,az=b.z-a.z,bx=c.x-b.x,bz=c.z-b.z;
    const length=Math.max(.1,(Math.hypot(ax,az)+Math.hypot(bx,bz))/2);
    curves[i]=Math.atan2(bx*az-bz*ax,ax*bx+az*bz)/length;
    safe[i]=Math.min(rules.boostSpeed,Math.sqrt(rules.driftGrip*.995/Math.max(.0001,Math.abs(curves[i]))));
    segments[i]=b.distanceTo(c);
  }
  for(let pass=0;pass<3;pass++)for(let i=samples-1;i>=0;i--)
    safe[i]=Math.min(safe[i],Math.sqrt(safe[index(i+1)]**2+2*rules.braking*.98*segments[i]));
  const paceProfiles=new Map();
  function pace(profile){
    const key=[profile.boostSpeed,profile.driftGrip,profile.braking].join(':');
    if(!paceProfiles.has(key)){
      const values=new Float64Array(samples);
      for(let i=0;i<samples;i++)values[i]=Math.min(profile.boostSpeed,Math.sqrt(profile.driftGrip*(hard?.999:.995)/Math.max(.0001,Math.abs(curves[i]))));
      for(let pass=0;pass<3;pass++)for(let i=samples-1;i>=0;i--)values[i]=Math.min(values[i],Math.sqrt(values[index(i+1)]**2+2*profile.braking*(hard?1:.98)*segments[i]));
      paceProfiles.set(key,values);
    }
    return paceProfiles.get(key);
  }
  function reference(distance,profile=rules){
    const speeds=pace(profile);
    const a=((distance/L)%1+1)%1*samples,i=Math.floor(a),f=a-i,j=index(i+1);
    return {lane:laneAt(distance),slope:(laneAt(distance+1)-laneAt(distance-1))/2,
      curvature:THREE.MathUtils.lerp(curves[i],curves[j],f),speed:Math.min(speeds[i],speeds[j])};
  }
  const gap=(a,b)=>{let value=(a-b)%L;if(value>L/2)value-=L;if(value<-L/2)value+=L;return value;};
  const pads=route.pads.map(pad=>{
    let best=0,distance=Infinity;
    for(let i=0;i<samples;i++){const d=route.getPointAt(i/samples).distanceToSquared(pad.origin);if(d<distance){distance=d;best=i;}}
    const u=best/samples,p=route.getPointAt(u),t=route.getTangentAt(u),left=new THREE.Vector3(t.z,0,-t.x);
    return {distance:u*L,lane:pad.origin.clone().sub(p).dot(left)};
  });
  function plan(r,racers,pickups,hazards,dt){
    r.aiLevel=hard?'hard':'medium';
    const profile=r.tuning??rules,ref=reference(r.distance,profile),ahead=reference(r.distance+Math.max(2,r.currentSpeed*(hard?.15:.09)),profile),limit=half-r.radius-.35;
    const state=r.ai?.level===r.aiLevel?r.ai:(r.ai={level:r.aiLevel,timer:0,offset:0});state.timer-=dt;
    const traffic=racers.filter(o=>o!==r).map(o=>({r:o,gap:gap(o.distance,r.distance)})).filter(o=>Math.abs(o.gap)<(hard?130:90)&&Math.abs(o.r.group.position.y-r.group.position.y)<1.7);
    if(state.timer<=0){
      state.timer=(hard?.035:.065)+(r.index%3)*(hard?.004:.009);
      const candidates=[ref.lane,ref.lane+state.offset,r.lane,ref.lane-3.5,ref.lane+3.5,-limit*.85,limit*.85,...(hard?[ref.lane-2.2,ref.lane+2.2,ref.lane-5,ref.lane+5]:[])].map(v=>clamp(v,-limit,limit));
      let best=clamp(ref.lane,-limit,limit),bestScore=Infinity;
      for(const lane of candidates){
        let score=(lane-ref.lane)**2*.09+(lane-r.lane)**2*.035+(lane-ref.lane-state.offset)**2*.07;
        for(const other of traffic){
          const t=other.r,closing=r.currentSpeed-t.currentSpeed,time=clamp(other.gap/Math.max(8,closing),.2,hard?1.55:1.05);
          const longitudinal=other.gap-closing*time,ownSide=r.lane+clamp(lane-r.lane,-(hard?14:11)*time,(hard?14:11)*time),otherSide=t.lane+clamp(t.laneVelocity||0,-6,6)*time*(hard?.60:.35);
          const width=r.radius+t.radius+.5,bodies=r.halfLength+t.halfLength+1.5;
          if(Math.abs(longitudinal)<bodies&&Math.abs(ownSide-otherSide)<width)score+=100*(1-Math.abs(ownSide-otherSide)/width);
          if(other.gap>0&&other.gap<30&&Math.abs(lane-t.lane)<width)score+=19*(1-other.gap/30);
          if(Math.abs(other.gap)<bodies&&Math.abs(lane-t.lane)<width)score+=120;
        }
        if(!r.item){let reward=0;for(const pick of pickups){const d=gap(pick.distance,r.distance);if(pick.respawn<=0&&d>5&&d<42)reward=Math.max(reward,(hard?.65:1.25)*(1-d/55)*Math.max(0,1-Math.abs(lane-pick.lane)/1.8));}score-=reward;}
        if(r.turboTime<=0&&ahead.speed>profile.maxSpeed+2)for(const pad of pads){const d=gap(pad.distance,r.distance);if(d>7&&d<65)score-=(hard?4:3.1)*(1-d/80)*Math.max(0,1-Math.abs(lane-pad.lane)/3.0);}
        for(const trap of hazards){
          const d=gap(trap.distance,r.distance),clearance=trap.radius+r.radius+.7;
          if(d>0&&d<52&&Math.abs(trap.position.y-r.group.position.y)<1.8&&Math.abs(lane-trap.lane)<clearance)
            score+=(hard?80:55)*(1-d/65)*(1-Math.abs(lane-trap.lane)/clearance);
        }
        if(score<bestScore){best=lane;bestScore=score;}
      }
      state.offset=best-ref.lane;
    }
    const targetLane=clamp(ref.lane+state.offset,-limit,limit);let target=Math.min(ref.speed,ahead.speed);
    for(const other of traffic){
      const t=other.r,width=r.radius+t.radius+.4;
      if(other.gap<=0||Math.abs(t.lane-r.lane)>width)continue;
      const free=other.gap-r.halfLength-t.halfLength-.8,closing=Math.max(0,r.currentSpeed-t.currentSpeed);
      const escape=Math.sqrt(2*Math.max(0,width-Math.abs(r.lane-t.lane))/(hard?36:28))+(hard?.055:.08);
      if(!(Math.abs(targetLane-t.lane)>width&&free>closing*escape))
        target=Math.min(target,Math.sqrt(Math.max(0,t.currentSpeed**2+2*profile.braking*(hard?1:.98)*Math.max(0,free))));
    }
    const room=target>profile.maxSpeed+(hard?1:2)&&r.stunTime<=0&&r.slowTime<=0;
    const wantsNitro=room&&(r.energy>=(hard?.23:.25)||r.boostLatch&&r.energy>.015);r.boostLatch=wantsNitro;r.aiTurboAllowed=room;
    const driftCurve=hard&&Math.abs(ref.curvature)<.004?ahead.curvature:ref.curvature;
    return {laneTarget:targetLane,targetSpeed:target,curvature:ref.curvature,wantsNitro,
      drift:Math.abs(driftCurve)>(r.drifting?(hard?.004:.006):(hard?.006:.009))&&(!r.drifting||Math.sign(driftCurve)===r.driftSign),driftCurvature:driftCurve,
      laneFeedForward:clamp(ref.slope*r.currentSpeed,-(hard?12:10),hard?12:10),laneAcceleration:hard?36:28,laneSpeed:hard?14:12,laneSpring:hard?9:8,laneDamping:hard?7:6};
  }
  return {plan};
}
