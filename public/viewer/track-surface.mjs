// Collision queries use the baked road triangles and the baked terrain grid.
// In particular, neither bridges nor sand are an infinite plane at the route height.
export function createTrackSurface(THREE,data,{points,cumulative,segmentAt,getTangentAt}){
  const source=data.collisionVertices??[],size=16,grid=new Map(),count=points.length;
  for(let section=0;section<(data.collisionSections?.length??0);section++)for(const ids of data.collisionSections[section]){
    const [a,b,c]=ids.map(i=>source[i]),abx=b[0]-a[0],abz=b[2]-a[2],acx=c[0]-a[0],acz=c[2]-a[2],det=abx*acz-abz*acx;
    if(Math.abs(det)<1e-8)continue;
    const triangle={a,abx,abz,acx,acz,det,section,gx:((b[1]-a[1])*acz-(c[1]-a[1])*abz)/det,gz:(abx*(c[1]-a[1])-acx*(b[1]-a[1]))/det};
    const minX=Math.floor(Math.min(a[0],b[0],c[0])/size),maxX=Math.floor(Math.max(a[0],b[0],c[0])/size),minZ=Math.floor(Math.min(a[2],b[2],c[2])/size),maxZ=Math.floor(Math.max(a[2],b[2],c[2])/size);
    for(let x=minX;x<=maxX;x++)for(let z=minZ;z<=maxZ;z++){const key=x+','+z;if(!grid.has(key))grid.set(key,[]);grid.get(key).push(triangle);}
  }
  function terrainAt(position){
    const g=data.terrain;if(!g)return null;
    const x=(position.x-g.minX)/g.step,z=(position.z-g.minZ)/g.step,ix=Math.floor(x),iz=Math.floor(z);
    if(ix<0||iz<0||ix>=g.columns-1||iz>=g.rows-1)return null;
    const fx=x-ix,fz=z-iz,a=g.heights[iz*g.columns+ix],b=g.heights[(iz+1)*g.columns+ix],c=g.heights[(iz+1)*g.columns+ix+1],d=g.heights[iz*g.columns+ix+1];
    // PlaneGeometry's diagonal is b--d, not a bilinear patch.
    const dx=fx+fz<=1?d-a:c-b,dz=fx+fz<=1?b-a:c-d;
    const height=(fx+fz<=1?a+fx*dx+fz*dz:c+(fx-1)*dx+(fz-1)*dz)+.06;
    const hazard=height<(g.minimumDriveHeight??-Infinity)||Math.hypot(position.x,position.z)>(g.arenaRadius??Infinity);
    return {height,gx:dx/g.step,gz:dz/g.step,bank:0,kind:hazard?'hazard':'sand',onRoad:false,supported:true,physical:true,speedFactor:.58,gripFactor:.62,accelerationFactor:.7};
  }
  function roadAt(position,sample,{placement=false}={}){
    const {low}=segmentAt(sample.u),t=sample.t??getTangentAt(sample.u),h=Math.hypot(t.x,t.z)||1;
    const candidates=grid.get(Math.floor(position.x/size)+','+Math.floor(position.z/size))??[];
    let best=null,score=Infinity;
    for(const triangle of candidates){
      let delta=Math.abs(triangle.section-low);delta=Math.min(delta,count-delta);
      // Adjacent strips may cover a banked corner; another lap of the helix may not.
      if(delta>Math.max(24,Math.ceil(data.width*count/cumulative.at(-1)*1.5)))continue;
      const x=position.x-triangle.a[0],z=position.z-triangle.a[2],b=(x*triangle.acz-z*triangle.acx)/triangle.det,c=(triangle.abx*z-triangle.abz*x)/triangle.det;
      if(b<-.00002||c<-.00002||b+c>1.00002)continue;
      const height=triangle.a[1]+triangle.gx*x+triangle.gz*z+.045;
      if(!placement&&height>position.y+.95)continue;
      const error=Math.abs(height-(placement?sample.p.y:position.y));
      if(error<score){score=error;best={height,gx:triangle.gx,gz:triangle.gz,bank:triangle.gx*t.z/h-triangle.gz*t.x/h,kind:'road',onRoad:true,supported:true,physical:true};}
    }
    return best;
  }
  return {roadAt,terrainAt};
}
