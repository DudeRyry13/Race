export function createTrackRoute(THREE,data){
  const points=data.points.map(p=>new THREE.Vector3(...p)),cumulative=[0];
  for(let i=0;i<points.length;i++)cumulative.push(cumulative[i]+points[i].distanceTo(points[(i+1)%points.length]));
  const length=cumulative.at(-1),wrap=u=>((u%1)+1)%1;
  const pads=(data.boostPads??[]).map(p=>({...p,origin:new THREE.Vector3(...p.origin),forward:new THREE.Vector3(...p.forward)}));
  const gaps=data.gaps??[],physical=!!data.physicalSurface;
  const collisionVertices=(data.collisionVertices??[]).map(p=>new THREE.Vector3(...p));
  const sections=(data.collisionSections??[]).map(list=>list.map(indices=>{
    const [a,b,c]=indices.map(i=>collisionVertices[i]),abx=b.x-a.x,abz=b.z-a.z,acx=c.x-a.x,acz=c.z-a.z;
    const determinant=abx*acz-abz*acx;
    return {a,abx,abz,acx,acz,determinant,
      gx:((b.y-a.y)*acz-(c.y-a.y)*abz)/determinant,
      gz:(abx*(c.y-a.y)-acx*(b.y-a.y))/determinant};
  }));
  function segmentAt(u){
    const distance=wrap(u)*length;let low=0,high=points.length;
    while(low+1<high){const m=(low+high)>>1;if(cumulative[m]<=distance)low=m;else high=m;}
    return {low,blend:(distance-cumulative[low])/(cumulative[low+1]-cumulative[low]),distance};
  }
  function getPointAt(u,target=new THREE.Vector3()){
    const {low,blend}=segmentAt(u);
    return target.copy(points[low]).lerp(points[(low+1)%points.length],blend);
  }
  function getTangentAt(u,target=new THREE.Vector3()){
    return target.copy(getPointAt(u+.65/length)).sub(getPointAt(u-.65/length)).normalize();
  }
  function surfaceAt(position,sample,onRoad=true){
    if(!onRoad)return {height:data.groundHeight+.04,roadHeight:sample.p.y+.04,gx:0,gz:0,onRoad:false,supported:false,physical};
    const t=sample.t??getTangentAt(sample.u),horizontal=t.x*t.x+t.z*t.z||1;
    const {low,blend,distance}=segmentAt(sample.u),bank=data.banks?THREE.MathUtils.lerp(data.banks[low],data.banks[(low+1)%points.length],blend):0;
    const h=Math.sqrt(horizontal);let gx=t.x*t.y/horizontal+bank*t.z/h,gz=t.z*t.y/horizontal-bank*t.x/h;
    let roadHeight=sample.p.y+gx*(position.x-sample.p.x)+gz*(position.z-sample.p.z)+.04,roadBank=bank;
    const gap=gaps.find(g=>distance>=g.start&&distance<g.end);
    if(!gap&&sections.length){
      let match=null;
      for(let offset=-3;offset<=3&&!match;offset++)for(const triangle of sections[(low+offset+sections.length)%sections.length]){
        const x=position.x-triangle.a.x,z=position.z-triangle.a.z;
        const b=(x*triangle.acz-z*triangle.acx)/triangle.determinant,c=(triangle.abx*z-triangle.abz*x)/triangle.determinant;
        if(b>=-.00001&&c>=-.00001&&b+c<=1.00001){match=triangle;break;}
      }
      if(match){
        gx=match.gx;gz=match.gz;roadHeight=match.a.y+gx*(position.x-match.a.x)+gz*(position.z-match.a.z)+.04;
        roadBank=gx*t.z/h-gz*t.x/h;
      }
    }
    return {height:gap?data.groundHeight+.04:roadHeight,roadHeight,gx,gz,bank:roadBank,onRoad:true,supported:!gap,physical,gap};
  }
  function gapAhead(distance,range=90){
    const d=wrap(distance/length)*length;
    return gaps.map(g=>({...g,ahead:(g.start-d+length)%length,inside:d>=g.start&&d<g.end})).find(g=>g.inside||g.ahead<range)??null;
  }
  function recoveryAt(u){
    const d=wrap(u)*length,gap=gaps.find(g=>(d-g.start+length)%length<g.end-g.start+85);
    return wrap((gap?gap.recover:d-12)/length);
  }
  return {name:data.name,width:data.width,groundHeight:data.groundHeight,worldScale:data.worldScale,points,distances:cumulative,pads,length,gaps,physical,
    obstacles:data.obstacles??[],getLength:()=>length,getPointAt,getTangentAt,surfaceAt,gapAhead,recoveryAt};
}

export function stepTrackHeight(body,surface,dt,vx,vz){
  if(surface.physical){
    const slopeVelocity=surface.gx*vx+surface.gz*vz;
    if(body.grounded&&surface.supported){
      body.y=surface.height;body.verticalSpeed=slopeVelocity;body.lastFloor=surface.height;return;
    }
    if(body.grounded){
      // A gap has no collision floor. Takeoff follows the Blender ramp tangent.
      body.grounded=false;
      if(surface.gap)body.verticalSpeed=Math.max(body.verticalSpeed,surface.gap.launchSlope*Math.hypot(vx,vz));
    }
    const old=body.y;
    body.y+=body.verticalSpeed*dt-12*dt*dt;body.verticalSpeed-=24*dt;
    if(surface.supported&&body.verticalSpeed<=slopeVelocity&&old>=surface.height-.18&&body.y<=surface.height+.04){
      body.y=surface.height;body.verticalSpeed=slopeVelocity;body.grounded=true;
    }
    body.lastFloor=surface.height;return;
  }
  const slopeVelocity=Math.max(-7,Math.min(6.5,surface.gx*vx+surface.gz*vz));
  if(surface.onRoad){body.y=surface.height;body.verticalSpeed=slopeVelocity;body.lastFloor=surface.height;body.grounded=true;return;}
  if(body.grounded&&surface.height>=body.lastFloor-.28){
    body.y=surface.height;body.verticalSpeed=slopeVelocity;body.lastFloor=surface.height;return;
  }
  body.grounded=false;const old=body.y;body.verticalSpeed-=24*dt;body.y+=body.verticalSpeed*dt;
  if(body.verticalSpeed<=slopeVelocity&&old>=surface.height-.16&&body.y<=surface.height+.02){
    body.y=surface.height;body.verticalSpeed=slopeVelocity;body.grounded=true;
  }
  body.lastFloor=surface.height;
}
