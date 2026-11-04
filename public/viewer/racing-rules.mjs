// Baseline rules. A character's profile is identical for human and AI drivers.
export const RULES=Object.freeze({maxSpeed:42,boostSpeed:59,acceleration:22,boostAcceleration:33,braking:30,reverseSpeed:9,lateralGrip:34,
  nitroDrain:.48,nitroRecovery:.16,hoverHeight:.18,laps:3,driftGrip:80,driftMinSpeed:16});
export const ITEM_TYPES=Object.freeze([
  {id:'tnt',name:'Ящик ТНТ',symbol:'TNT',color:'#ff7865',description:'Оставляет взрывной ящик позади машины.'},
  {id:'rocket',name:'Ракета',symbol:'↗',color:'#ffac64',description:'Преследует ближайшего соперника впереди.'},
  {id:'mine',name:'Мина',symbol:'✳',color:'#ff6ca9',description:'Задержанная ловушка на дороге.'},
  {id:'oil',name:'Масло',symbol:'≈',color:'#b497ff',description:'Временно ухудшает сцепление и управление.'},
  {id:'shield',name:'Щит',symbol:'◇',color:'#78efff',description:'Защищает от одного попадания.'},
  {id:'emp',name:'Импульс',symbol:'ϟ',color:'#a6b7ff',description:'Замедляет соперников рядом.'},
  {id:'turbo',name:'Турбо',symbol:'»',color:'#72ffc9',description:'Дополнительный рывок без расхода запаса.'},
]);
export const ITEM_BY_ID=Object.fromEntries(ITEM_TYPES.map(item=>[item.id,item]));
export function initRacerRules(r){
  r.tuning=Object.freeze({...RULES,handling:1,driftChargeRate:1,miniTurbo:1,mass:1,...r.hero?.tuning});
  Object.assign(r,{energy:1,boosting:false,item:null,itemSince:0,turboTime:0,shieldTime:0,slowTime:0,oilTime:0,stunTime:0,
    itemCooldown:0,hitFlash:0,boostLatch:false,padCooldown:0,nitroLocked:false});
}
export function tickRacerRules(r,dt,wantsNitro){
  for(const key of ['turboTime','shieldTime','slowTime','oilTime','stunTime','itemCooldown','hitFlash','padCooldown'])r[key]=Math.max(0,r[key]-dt);
  const freeBoost=r.turboTime>0;
  if(r.energy<=.015)r.nitroLocked=true;
  if(r.energy>=.23)r.nitroLocked=false;
  const nitro=wantsNitro&&!r.nitroLocked&&r.energy>.015&&r.stunTime<=0;
  r.boosting=(freeBoost||nitro)&&r.stunTime<=0;
  const tuning=racerTuning(r);
  r.energy=Math.max(0,Math.min(1,r.energy+(nitro&&!freeBoost?-tuning.nitroDrain:tuning.nitroRecovery)*dt));
}
export function racerTuning(r){return r.tuning??RULES;}
export function speedLimit(r){const t=racerTuning(r);return (r.boosting?t.boostSpeed:t.maxSpeed)*(r.slowTime>0?.58:1)*(r.oilTime>0?.82:1)*(r.stunTime>0?.28:1);}
export function motorStep(r,velocity,dt,{throttle=0,brake=false,handbrake=false,curvature=0,onRoad=true,targetSpeed=null,drifting=false}={}){
  const t=racerTuning(r),cap=onRoad?speedLimit(r):12,acceleration=r.boosting?t.boostAcceleration:t.acceleration;
  if(targetSpeed!==null){
    const target=Math.min(cap,targetSpeed),change=target>velocity?acceleration:t.braking;
    velocity+=Math.max(-change*dt,Math.min(change*dt,target-velocity));
  }else{
    if(throttle>0)velocity+=acceleration*throttle*dt;
    if(brake)velocity-=(velocity>1?t.braking:9)*dt;
  }
  const drag=(onRoad?.55:5)+Math.abs(velocity)*(onRoad?.035:.35);
  velocity*=Math.exp(-(handbrake?7:drag/(Math.abs(velocity)+.8))*dt);
  if(onRoad&&Math.abs(curvature)>.0001){
    const corner=Math.sqrt((drifting?t.driftGrip:t.lateralGrip)/Math.abs(curvature));
    if(Math.abs(velocity)>corner)velocity= Math.sign(velocity)*(corner+(Math.abs(velocity)-corner)*Math.exp(-dt*5));
  }
  velocity=Math.max(-t.reverseSpeed,Math.min(cap,velocity));
  return Math.abs(velocity)<.025?0:velocity;
}
export function consumeShield(r){if(r.shieldTime<=0)return false;r.shieldTime=0;r.hitFlash=.25;return true;}
