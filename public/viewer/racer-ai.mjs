import {createMediumRaceAI} from './racer-ai-medium.mjs';

export function createRaceAI(options){
  const advanced=options.difficulty==='medium'||options.difficulty==='hard';
  const brain=advanced?createMediumRaceAI(options):createEasyRaceAI(options);
  return {plan(r,...args){
    if(!advanced)r.aiLevel='easy';
    const result=brain.plan(r,...args),jump=options.route.gapAhead?.(r.distance,75);
    if(jump){
      // Set up a straight takeoff and keep lateral changes modest in the air.
      result.drift=false;
      if(jump.inside){result.laneTarget=r.lane;result.laneFeedForward=0;result.laneSpeed=4;}
      else if(jump.ahead<50){
        result.laneTarget=options.THREE.MathUtils.clamp(result.laneTarget,-6,6);
        result.wantsNitro=r.energy>.08&&r.stunTime<=0;r.aiTurboAllowed=true;
      }
    }
    return result;
  }};
}

// Preserve the original opponent behaviour as the easy mode.
function createEasyRaceAI({THREE,route,rules}){
  const clamp=THREE.MathUtils.clamp,length=route.length,count=Math.max(240,Math.ceil(length/2.5));
  const step=length/count,limit=route.width/2-1.6,wrap=i=>(i%count+count)%count;
  const nodes=Array.from({length:count},(_,i)=>{
    const centre=route.getPointAt(i/count),t=route.getTangentAt(i/count);
    return {centre,left:new THREE.Vector3(t.z,0,-t.x).normalize(),p:centre.clone(),lane:0};
  });
  function shape(i){
    const a=nodes[wrap(i-1)].p,b=nodes[wrap(i)].p,c=nodes[wrap(i+1)].p;
    const ax=b.x-a.x,az=b.z-a.z,bx=c.x-b.x,bz=c.z-b.z;
    const d0=Math.hypot(ax,az),d1=Math.hypot(bx,bz),distance=Math.max(.05,(d0+d1)/2);
    return {distance,curvature:Math.atan2(bx*az-bz*ax,ax*bx+az*bz)/distance};
  }
  function setLane(i,lane){const node=nodes[wrap(i)];node.lane=lane;node.p.copy(node.centre).addScaledVector(node.left,lane);}
  function localCost(i){
    let cost=0;
    for(let j=i-1;j<=i+1;j++){
      const s=shape(j),laneDelta=nodes[wrap(j)].lane-nodes[wrap(j+1)].lane;
      const velocity=Math.min(rules.maxSpeed,Math.sqrt(rules.driftGrip/Math.max(.0001,Math.abs(s.curvature))));
      cost+=s.distance/velocity+laneDelta*laneDelta*.004;
    }
    return cost;
  }
  // Optimise the line within the actual road, then smooth small lane changes.
  for(const amount of [1,.5,.25])for(let pass=0;pass<8;pass++)for(let n=0;n<count;n++){
    const i=pass%2?n:count-1-n,original=nodes[i].lane;let best=original,cost=localCost(i);
    for(const direction of [-1,1]){
      const candidate=clamp(original+amount*direction,-limit,limit);setLane(i,candidate);
      const value=localCost(i);if(value<cost-1e-7){cost=value;best=candidate;}
    }
    setLane(i,best);
  }
  for(let pass=0;pass<3;pass++){
    const lanes=nodes.map((n,i)=>(nodes[wrap(i-1)].lane+2*n.lane+nodes[wrap(i+1)].lane)/4);
    lanes.forEach((lane,i)=>setLane(i,lane));
  }
  const safe=new Float64Array(count),roadCurves=new Float64Array(count),distances=new Float64Array(count);
  for(let i=0;i<count;i++){
    const s=shape(i);nodes[i].curvature=s.curvature;
    safe[i]=Math.min(rules.boostSpeed,Math.sqrt(rules.driftGrip*.97/Math.max(.0001,Math.abs(s.curvature))));
    distances[i]=nodes[i].p.distanceTo(nodes[wrap(i+1)].p);
    const a=nodes[wrap(i-1)].centre,b=nodes[i].centre,c=nodes[wrap(i+1)].centre;
    roadCurves[i]=Math.atan2((c.x-b.x)*(b.z-a.z)-(c.z-b.z)*(b.x-a.x),(b.x-a.x)*(c.x-b.x)+(b.z-a.z)*(c.z-b.z))/step;
  }
  // A future corner only slows a kart once its real braking distance requires it.
  for(let pass=0;pass<3;pass++)for(let i=count-1;i>=0;i--)
    safe[i]=Math.min(safe[i],Math.sqrt(safe[wrap(i+1)]**2+2*rules.braking*.88*distances[i]));
  const profiles=new Map();
  function pace(profile){
    const key=[profile.boostSpeed,profile.driftGrip,profile.braking].join(':');
    if(!profiles.has(key)){
      const values=new Float64Array(count);
      for(let i=0;i<count;i++)values[i]=Math.min(profile.boostSpeed,Math.sqrt(profile.driftGrip*.97/Math.max(.0001,Math.abs(nodes[i].curvature))));
      for(let pass=0;pass<3;pass++)for(let i=count-1;i>=0;i--)values[i]=Math.min(values[i],Math.sqrt(values[wrap(i+1)]**2+2*profile.braking*.88*distances[i]));
      profiles.set(key,values);
    }
    return profiles.get(key);
  }
  function reference(distance,profile=rules){
    const speeds=pace(profile);
    const at=((distance/length)%1+1)%1*count,i=Math.floor(at),next=wrap(i+1),f=at-i,a=nodes[i],b=nodes[next];
    return {lane:THREE.MathUtils.lerp(a.lane,b.lane,f),speed:Math.min(speeds[i],speeds[next]),
      curvature:THREE.MathUtils.lerp(a.curvature,b.curvature,f),roadCurvature:THREE.MathUtils.lerp(roadCurves[i],roadCurves[next],f)};
  }
  const gap=(a,b)=>{let d=(a-b)%length;if(d>length/2)d-=length;if(d<-length/2)d+=length;return d;};
  const pads=route.pads.map(pad=>{
    let closest=0,distance=Infinity;
    for(let i=0;i<count;i++){const d=nodes[i].centre.distanceToSquared(pad.origin);if(d<distance){distance=d;closest=i;}}
    return {distance:closest*step,lane:pad.origin.clone().sub(nodes[closest].centre).dot(nodes[closest].left)};
  });
  function plan(r,racers,pickups,hazards,dt){
    const profile=r.tuning??rules,ref=reference(r.distance,profile),future=reference(r.distance+Math.max(1,r.currentSpeed*.04),profile);
    const bound=route.width/2-r.radius-.4,state=r.ai??(r.ai={timer:0,laneTarget:ref.lane});state.timer-=dt;
    const traffic=racers.filter(other=>other!==r).map(other=>({r:other,gap:gap(other.distance,r.distance)})).filter(t=>Math.abs(t.gap)<65);
    if(state.timer<=0){
      state.timer=.14+r.index*.012;
      const candidates=[ref.lane,state.laneTarget,r.lane,ref.lane-3.4,ref.lane+3.4,-bound*.78,0,bound*.78].map(lane=>clamp(lane,-bound,bound));
      let best=clamp(ref.lane,-bound,bound),bestScore=Infinity;
      for(const lane of candidates){
        let score=(lane-ref.lane)**2*.07+(lane-r.lane)**2*.08+(lane-state.laneTarget)**2*.025;
        for(const t of traffic){
          const other=t.r;if(Math.abs(other.group.position.y-r.group.position.y)>1.6)continue;
          const closing=r.currentSpeed-other.currentSpeed,horizon=clamp(t.gap/Math.max(6,closing),.25,1.1);
          const longitudinal=t.gap-closing*horizon,side=r.lane+clamp(lane-r.lane,-5*horizon,5*horizon)-other.lane;
          const clearance=r.radius+other.radius+.65,bodies=r.halfLength+other.halfLength+2;
          if(Math.abs(longitudinal)<bodies&&Math.abs(side)<clearance)score+=(1-Math.abs(side)/clearance)*70;
          if(t.gap>0&&t.gap<22&&Math.abs(lane-other.lane)<clearance)score+=16*(1-t.gap/22);
          if(Math.abs(t.gap)<bodies&&Math.abs(lane-other.lane)<clearance)score+=90;
        }
        if(!r.item){
          let reward=0;
          for(const pick of pickups){const d=gap(pick.distance,r.distance);if(pick.respawn<=0&&d>6&&d<55)reward=Math.max(reward,3.2*(1-d/70)*Math.max(0,1-Math.abs(lane-pick.lane)/2));}
          score-=reward;
        }
        if(r.turboTime<=0&&future.speed>profile.maxSpeed+2)for(const pad of pads){const d=gap(pad.distance,r.distance);if(d>7&&d<55)score-=2.5*(1-d/65)*Math.max(0,1-Math.abs(lane-pad.lane)/2.7);}
        for(const trap of hazards){
          const d=gap(trap.distance,r.distance);if(d<0||d>42||Math.abs(trap.position.y-r.group.position.y)>1.8)continue;
          const clearance=trap.radius+r.radius+.6;if(Math.abs(lane-trap.lane)<clearance)score+=28*(1-d/50)*(1-Math.abs(lane-trap.lane)/clearance);
        }
        if(score<bestScore){bestScore=score;best=lane;}
      }
      state.laneTarget=best;
    }
    let target=future.speed;
    for(const t of traffic){
      const other=t.r,clearance=r.radius+other.radius+.4;
      if(t.gap<=0||Math.abs(other.group.position.y-r.group.position.y)>1.5||Math.abs(other.lane-r.lane)>clearance)continue;
      const free=t.gap-r.halfLength-other.halfLength-1,closing=Math.max(0,r.currentSpeed-other.currentSpeed);
      const escape=Math.sqrt(2*Math.max(0,clearance-Math.abs(r.lane-other.lane))/8)+.12;
      const changingClear=Math.abs(state.laneTarget-other.lane)>clearance&&free>closing*escape;
      if(!changingClear)target=Math.min(target,Math.sqrt(Math.max(0,other.currentSpeed**2+2*rules.braking*.9*Math.max(0,free))));
    }
    const boostRoom=target>profile.maxSpeed+2&&r.stunTime<=0&&r.slowTime<=0;
    const wantsNitro=boostRoom&&r.currentSpeed>12&&(r.energy>=.24||r.boostLatch&&r.energy>.015);
    r.boostLatch=wantsNitro;r.aiTurboAllowed=boostRoom&&r.currentSpeed>10;
    return {laneTarget:state.laneTarget,targetSpeed:target,curvature:ref.curvature,roadCurvature:ref.roadCurvature,wantsNitro};
  }
  return {plan};
}
