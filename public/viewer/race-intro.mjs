// Eight-second starting sequence: grid, faces, then orbit behind the player.
export const RACE_INTRO_SECONDS=8;
export const CHASE_CAMERA={distance:7.1,height:3.55,speedDistance:1.9,speedHeight:.5};
export function createRaceIntro({THREE,camera,getRacers,getPlayer,onName}){
  let order=[];
  const up=new THREE.Vector3(0,1,0),position=new THREE.Vector3(),look=new THREE.Vector3();
  function basis(r){const forward=new THREE.Vector3(Math.sin(r.motionHeading),0,Math.cos(r.motionHeading));return {forward,left:new THREE.Vector3(forward.z,0,-forward.x)};}
  function face(r){
    const head=r.model.getObjectByName('Head');
    return head?head.getWorldPosition(new THREE.Vector3()).addScaledVector(up,.27):r.group.position.clone().addScaledVector(up,1.3);
  }
  function begin(){const player=getPlayer();order=[...getRacers().filter(r=>r!==player),player];update(0);}
  function update(seconds){
    const t=Math.max(0,Math.min(RACE_INTRO_SECONDS,seconds)),player=getPlayer();if(!player||!order.length)return;
    if(t<.35){
      const centre=new THREE.Vector3();for(const r of order)centre.add(r.group.position);centre.multiplyScalar(1/order.length);
      const {forward,left}=basis(player);position.copy(centre).addScaledVector(forward,12).addScaledVector(left,3.0).addScaledVector(up,6.4);
      look.copy(centre).addScaledVector(up,1.0);camera.fov=50;onName('');
    }else if(t<6.6){
      const step=(6.6-.35)/order.length,shot=Math.min(order.length-1,Math.floor((t-.35)/step)),r=order[shot],fraction=((t-.35)/step)-shot;
      const {forward,left}=basis(r);look.copy(face(r));position.copy(look).addScaledVector(forward,2.35).addScaledVector(left,.30+fraction*.25).addScaledVector(up,.12);
      camera.fov=42;onName(r.hero.name);
    }else{
      const u=(t-6.6)/(RACE_INTRO_SECONDS-6.6),p=u*u*(3-2*u),angle=p*Math.PI,{forward,left}=basis(player),distance=2.35+(CHASE_CAMERA.distance-2.35)*p;
      position.copy(player.group.position).addScaledVector(forward,Math.cos(angle)*distance).addScaledVector(left,Math.sin(angle)*distance).addScaledVector(up,1.5+(CHASE_CAMERA.height-1.5)*p);
      const end=player.group.position.clone().addScaledVector(up,1.05).addScaledVector(forward,2.2);
      look.copy(face(player)).lerp(end,p);camera.fov=42+14*p;onName('');
    }
    camera.position.copy(position);camera.lookAt(look);camera.updateProjectionMatrix();
  }
  return {begin,update};
}
