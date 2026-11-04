// Planar capsule collisions. The two-dimensional footprint follows the kart's
// heading; height separates airborne vehicles from traffic below.
const clamp01=n=>Math.max(0,Math.min(1,n));
function segment(body){
  const half=Math.max(0,body.halfLength-body.radius),dx=Math.sin(body.heading)*half,dz=Math.cos(body.heading)*half;
  return [body.x-dx,body.z-dz,body.x+dx,body.z+dz];
}
export function resolveCapsuleCollision(a,b,restitution=.18){
  if(Math.abs(a.y-b.y)>1.35)return null;
  const sa=segment(a),sb=segment(b),d1x=sa[2]-sa[0],d1z=sa[3]-sa[1],d2x=sb[2]-sb[0],d2z=sb[3]-sb[1],rx=sa[0]-sb[0],rz=sa[1]-sb[1];
  const aa=d1x*d1x+d1z*d1z,ee=d2x*d2x+d2z*d2z,ff=d2x*rx+d2z*rz;
  let s=0,t=0;
  if(aa<1e-10&&ee<1e-10){}
  else if(aa<1e-10)t=clamp01(ff/ee);
  else{
    const cc=d1x*rx+d1z*rz;
    if(ee<1e-10)s=clamp01(-cc/aa);
    else{
      const bb=d1x*d2x+d1z*d2z,den=aa*ee-bb*bb;
      s=den>1e-10?clamp01((bb*ff-cc*ee)/den):0;t=(bb*s+ff)/ee;
      if(t<0){t=0;s=clamp01(-cc/aa);}else if(t>1){t=1;s=clamp01((bb-cc)/aa);}
    }
  }
  let nx=sb[0]+d2x*t-sa[0]-d1x*s,nz=sb[1]+d2z*t-sa[1]-d1z*s;
  const limit=a.radius+b.radius,dist2=nx*nx+nz*nz;
  if(dist2>=limit*limit)return null;
  const distance=Math.sqrt(dist2);
  if(distance>1e-7){nx/=distance;nz/=distance;}
  else{
    nx=b.x-a.x;nz=b.z-a.z;let length=Math.hypot(nx,nz);
    if(length<1e-7){nx=a.vx-b.vx;nz=a.vz-b.vz;length=Math.hypot(nx,nz);}
    if(length<1e-7){nx=1;nz=0;}else{nx/=length;nz/=length;}
  }
  const ia=1/(a.mass||1),ib=1/(b.mass||1),sum=ia+ib,penetration=limit-distance;
  a.x-=nx*penetration*ia/sum;a.z-=nz*penetration*ia/sum;b.x+=nx*penetration*ib/sum;b.z+=nz*penetration*ib/sum;
  const relative=(b.vx-a.vx)*nx+(b.vz-a.vz)*nz;
  let impulse=0;
  if(relative<0){impulse=-(1+restitution)*relative/sum;a.vx-=nx*impulse*ia;a.vz-=nz*impulse*ia;b.vx+=nx*impulse*ib;b.vz+=nz*impulse*ib;}
  return {impulse,penetration};
}
