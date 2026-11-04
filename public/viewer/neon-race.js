import * as THREE from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {DRACOLoader} from 'three/addons/loaders/DRACOLoader.js';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';
import {RoomEnvironment} from 'three/addons/environments/RoomEnvironment.js';
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';
import {resolveCapsuleCollision} from './collision.mjs';
import {createTrackRoute,stepTrackHeight} from './race-track.mjs?build=surfaces-v22';
import {RULES,ITEM_TYPES,ITEM_BY_ID,initRacerRules,tickRacerRules,speedLimit,motorStep,racerTuning} from './racing-rules.mjs?build=surfaces-v22';
import {RACERS,racerDisplayStats} from './racer-data.mjs';
import {createRaceAudio} from './race-audio.mjs';
import {createRaceItems} from './race-items.mjs?build=surfaces-v22';
import {createRaceAI} from './racer-ai.mjs';
import {createTrackObstacles} from './track-obstacles.mjs?build=online-v17';
import {createOnlineClient,decodeInput} from './online-client.mjs?build=server-v22';
import {packRacer,applyRacer} from './online-state.mjs?build=surfaces-v22';
import {preserveLocalPose,settleLocalPose} from './online-motion.mjs?build=online-v17';
import {resetDrift,stepDrift,createDriftEffects} from './drift.mjs?build=surfaces-v22';
import {createPodium} from './podium.mjs?build=podium-no-headlights-v7';
import {createRaceIntro,RACE_INTRO_SECONDS,CHASE_CAMERA} from './race-intro.mjs?build=camera-v22';
import {prepareRaceGraphics} from './render-preparation.mjs?build=web-v19';

const $=id=>document.getElementById(id),clamp=THREE.MathUtils.clamp,damp=THREE.MathUtils.damp;
const HEROES=RACERS;
let selectedId=localStorage.getItem('neon-racer')||'mensari';if(!HEROES.some(h=>h.id===selectedId))selectedId='mensari';
const TRACKS=[{id:'app1',name:'Caritas · Neon Circuit',tag:'Неоновый город',short:'APP1',assetVersion:'uniform-no-jumps-v3'},
  {id:'app2',name:'Fortitudo · Noir Circuit',tag:'Ночной город и тоннели',short:'APP2',assetVersion:'uniform-no-jumps-v3'},
  {id:'app3',name:'Audentia · Skybreak Circuit',tag:'Три разрыва · виадук · ловушки',short:'APP3',jumps:true,assetVersion:'audentia-v13'},
  {id:'app4',name:'Sunstone · Colosseum GP',tag:'Каньон · песчаная арена · тоннель · прыжок',short:'APP4',jumps:true,assetVersion:'sunstone-v22'}];
let selectedTrackId=localStorage.getItem('neon-track')||'app1';if(!TRACKS.some(t=>t.id===selectedTrackId))selectedTrackId='app1';
const DIFFICULTIES=[{id:'easy',name:'Лёгкий',description:'Прежний темп соперников'},
  {id:'medium',name:'Средний',description:'Позднее торможение, уверенные обгоны и дрифт'},
  {id:'hard',name:'Сложный',description:'Точная траектория, быстрая реакция и агрессивная борьба'}];
let difficulty=localStorage.getItem('neon-difficulty')||'easy';if(!DIFFICULTIES.some(d=>d.id===difficulty))difficulty='easy';
let phase='select',ready=false,paused=false,player=null,raceTime=0,worldTime=0,countdown=0,countLabel='',goFlash=0,toastTime=0,lastContact=-10,cameraMode=0,boostHeld=false,driftHeld=false;
let online=null,replaying=false,simulationBudget=0;
const predictedItemFeedback=new Map();
const SIMULATION_STEP=1/90;
let soundEnabled=localStorage.getItem('babylon-sound')!=='off';
const raceAudio=createRaceAudio({effectsEnabled:soundEnabled,musicEnabled:localStorage.getItem('babylon-music')!=='off'});
const keys=new Set(),racers=[],finishers=[];
const N=2400;let trackData,route,LENGTH,HALF,samples,botAI,trackObstacles,mapBounds,mapCentre,mapScale,trackGroup=null;
function configureTrack(data){
  trackData=data;route=createTrackRoute(THREE,data);LENGTH=route.length;HALF=route.width/2;
  samples=Array.from({length:N},(_,i)=>{const u=i/N,p=route.getPointAt(u),t=route.getTangentAt(u);return {u,p,t,left:new THREE.Vector3(t.z,0,-t.x).normalize()};});
  botAI=createRaceAI({THREE,route,rules:RULES,difficulty});mapBounds=new THREE.Box3().setFromPoints(route.points);mapCentre=mapBounds.getCenter(new THREE.Vector3());
  trackObstacles=createTrackObstacles({route,racers,getPlayer:()=>player,sound:sfx,isHuman});
  mapScale=Math.min(390/(mapBounds.max.x-mapBounds.min.x),170/(mapBounds.max.z-mapBounds.min.z));
}
configureTrack(await (await fetch(`./assets/${selectedTrackId}-route.json?build=surfaces-v22`,{cache:'no-store'})).json());

const scene=new THREE.Scene();scene.background=new THREE.Color('#070b1b');scene.fog=new THREE.Fog('#070b1b',400,1350);
const renderer=new THREE.WebGLRenderer({antialias:true,powerPreference:'high-performance'});renderer.domElement.id='world';renderer.setSize(innerWidth,innerHeight);renderer.setPixelRatio(Math.min(devicePixelRatio,1.35));
renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1.15;renderer.shadowMap.type=THREE.PCFSoftShadowMap;renderer.shadowMap.enabled=false;document.body.prepend(renderer.domElement);
const camera=new THREE.PerspectiveCamera(56,innerWidth/innerHeight,.12,2400),orbit=new OrbitControls(camera,renderer.domElement);orbit.enabled=false;orbit.enableDamping=true;orbit.maxDistance=1400;
const environment=new THREE.PMREMGenerator(renderer),room=new RoomEnvironment();scene.environment=environment.fromScene(room,.02).texture;scene.environmentIntensity=.46;room.dispose();environment.dispose();
const skyLight=new THREE.HemisphereLight(0xa3c2ff,0x231333,1.25);scene.add(skyLight);
const sun=new THREE.DirectionalLight(0xb5caff,1.55);sun.castShadow=true;sun.shadow.mapSize.set(2048,2048);sun.shadow.normalBias=.025;Object.assign(sun.shadow.camera,{left:-17,right:17,top:17,bottom:-17,near:.5,far:100});scene.add(sun,sun.target);
// Keep the light count fixed: hiding a distant kart must not recompile shaders.
const kartLights=Array.from({length:3},()=>{const light=new THREE.PointLight(0xffffff,0,5.5,2);scene.add(light);return light;});
const draco=new DRACOLoader().setDecoderPath(new URL('./vendor/draco/',import.meta.url).href).setWorkerLimit(2);
const loader=new GLTFLoader().setDRACOLoader(draco),clock=new THREE.Clock(),lookTarget=new THREE.Vector3(),desiredCamera=new THREE.Vector3();
const map=$('map'),mapContext=map.getContext('2d');
const driftEffects=createDriftEffects({THREE,scene}),podium=createPodium({THREE,raceScene:scene,racers,camera,hoverHeight:RULES.hoverHeight});
const intro=createRaceIntro({THREE,camera,getRacers:()=>racers,getPlayer:()=>player,onName:name=>{if($('introRacer').textContent!==name)$('introRacer').textContent=name;}});
let fpsTime=0,fpsFrames=0,frame=0;

function sfx(kind,strength=1){if(replaying)return;if(soundEnabled)raceAudio.play(kind,strength);}
let pickupAnimation=null;
function clearPickupFlash(){pickupAnimation?.cancel();pickupAnimation=null;$('pickupFlash').hidden=true;}
function showPickupFlash(item){
  clearPickupFlash();$('pickupFlashIcon').textContent=item.symbol;$('pickupFlashName').textContent=item.name;$('pickupFlash').style.setProperty('--pickup-color',item.color);$('pickupFlash').hidden=false;
  const animation=$('pickupFlash').animate([{opacity:0,transform:'translate(-50%,-50%) scale(.65)'},{opacity:.82,offset:.12,transform:'translate(-50%,-50%) scale(1.08)'},{opacity:.66,offset:.64,transform:'translate(-50%,-50%) scale(1)'},{opacity:0,transform:'translate(-50%,-50%) scale(.92)'}],{duration:1000,easing:'ease-out'});
  pickupAnimation=animation;animation.onfinish=()=>{if(pickupAnimation===animation){$('pickupFlash').hidden=true;pickupAnimation=null;}};
}
function notify(message,color='#b4f6ff'){if(replaying)return;$('toast').textContent=message;$('toast').style.setProperty('--toast-color',color);$('toast').classList.add('visible');toastTime=2.0;}
function surfaceFor(r){const p=route.getPointAt(r.u),t=route.getTangentAt(r.u);return route.surfaceAt(r.group.position,{p,t,u:r.u},r.onRoad!==false);}
function placeHeight(r,surface,dt,vx,vz,snap=false){
  r.y=r.group.position.y;
  if(snap){r.y=surface.height;r.verticalSpeed=0;r.lastFloor=surface.height;r.grounded=true;}
  else stepTrackHeight(r,surface,dt,vx,vz);
  r.group.position.y=r.y;
}
function createAnimation(r){
  r.mixer.stopAllAction();r.actions.Idle.reset().play();r.steer=r.actions.Steering;
  r.steer.reset().setLoop(THREE.LoopOnce,1).play();r.steer.clampWhenFinished=true;r.steer.paused=true;r.steer.time=1;r.actions.Idle.time=r.index*.61;r.mixer.update(0);
}
function glowTexture(){
  const c=document.createElement('canvas');c.width=c.height=128;const x=c.getContext('2d'),g=x.createRadialGradient(64,64,4,64,64,64);g.addColorStop(0,'#ffffffbb');g.addColorStop(.4,'#ffffff55');g.addColorStop(1,'#ffffff00');x.fillStyle=g;x.fillRect(0,0,128,128);return new THREE.CanvasTexture(c);
}
const glowMap=glowTexture(),bubbleGeometry=new THREE.SphereGeometry(1,24,16),jetGeometry=new THREE.ConeGeometry(.14,.85,10);
function addKartLights(r){
  const color=new THREE.Color(r.hero.color),glow=new THREE.Mesh(new THREE.PlaneGeometry(2.4,3.3),new THREE.MeshBasicMaterial({map:glowMap,color,transparent:true,opacity:.65,depthWrite:false,blending:THREE.AdditiveBlending}));glow.rotation.x=-Math.PI/2;scene.add(glow);r.glow=glow;
  const shield=new THREE.Mesh(bubbleGeometry,new THREE.MeshBasicMaterial({color:0x7aeaff,transparent:true,opacity:.13,depthWrite:false,wireframe:true}));shield.position.y=1;shield.scale.set(1.35,1.23,1.55);shield.visible=false;r.group.add(shield);r.shieldMesh=shield;
  r.jets=[];for(const side of [-1,1]){
    const jet=new THREE.Mesh(jetGeometry,new THREE.MeshBasicMaterial({color:0x8bbcff,transparent:true,opacity:.88,depthWrite:false,blending:THREE.AdditiveBlending}));jet.rotation.x=-Math.PI/2;jet.position.set(side*.3,.4,-r.halfLength-.35);jet.visible=false;r.group.add(jet);r.jets.push(jet);
  }
}
async function loadTrack(data=trackData,id=selectedTrackId){
  const gltf=await loader.loadAsync(`./assets/${id}-circuit.glb?build=${TRACKS.find(track=>track.id===id).assetVersion}`);gltf.scene.scale.setScalar(data.worldScale);gltf.scene.updateMatrixWorld(true);
  const group=new THREE.Group(),batches=new Map();group.name=id+' supplied circuit';
  const meshes=[];gltf.scene.traverse(o=>{if(o.isMesh)meshes.push(o);});
  for(const source of meshes){
    const geometry=source.geometry.clone().applyMatrix4(source.matrixWorld),material=source.material;
    if(material.transparent||Array.isArray(material)){const mesh=new THREE.Mesh(geometry,material);mesh.receiveShadow=true;group.add(mesh);continue;}
    const signature=Object.entries(geometry.attributes).map(([name,a])=>`${name}:${a.itemSize}:${a.normalized}`).sort().join('|'),key=material.uuid+signature+!!geometry.index;
    if(!batches.has(key))batches.set(key,{material,geometries:[]});batches.get(key).geometries.push(geometry);
  }
  for(const {material,geometries} of batches.values()){
    const merged=geometries.length===1?geometries[0]:mergeGeometries(geometries,false);
    for(const geometry of merged?[merged]:geometries){const mesh=new THREE.Mesh(geometry,material);mesh.castShadow=true;mesh.receiveShadow=true;group.add(mesh);}
  }
  return group;
}
let items=null;
function updateTrackMenu(){
  const track=TRACKS.find(t=>t.id===selectedTrackId);$('trackBadge').textContent=track.short+' · '+track.tag;
  $('selection').style.setProperty('--track-backdrop',`url('./assets/${selectedTrackId}-preview.png')`);
  for(const b of $('trackGrid').querySelectorAll('button'))b.setAttribute('aria-pressed',String(b.dataset.track===selectedTrackId));
}
function disposeTrack(group){
  scene.remove(group);const geometries=new Set(),materials=new Set(),textures=new Set();
  group.traverse(o=>{if(!o.isMesh)return;geometries.add(o.geometry);for(const m of Array.isArray(o.material)?o.material:[o.material])materials.add(m);});
  for(const material of materials)for(const value of Object.values(material))if(value?.isTexture)textures.add(value);
  for(const value of [...geometries,...materials,...textures])value.dispose();
}
async function selectTrack(id,fromNetwork=false){
  if(online?.isGuest&&!fromNetwork)return;
  if(!ready||phase!=='select'||id===selectedTrackId||!TRACKS.some(t=>t.id===id))return;
  online?.selectionChanged({track:id,loaded:false});
  ready=false;$('startRace').disabled=true;$('loadLabel').textContent='Меняем трассу…';
  for(const b of $('trackGrid').querySelectorAll('button'))b.disabled=true;
  for(const b of $('difficultyGrid').querySelectorAll('button'))b.disabled=true;
  const previous={data:trackData,group:trackGroup,items,id:selectedTrackId};let candidate=null,nextItems=null;
  try{
    const response=await fetch(`./assets/${id}-route.json?build=surfaces-v22`,{cache:'no-store'});if(!response.ok)throw Error('Track data '+response.status);
    const data=await response.json();candidate=await loadTrack(data,id);
    configureTrack(data);scene.remove(previous.group);scene.add(candidate);
    nextItems=createRaceItems({THREE,scene,route,racers,getPlayer:()=>player,getTime:()=>raceTime,notify,sound:sfx,onPickup:showPickupFlash,isHuman,onEvent:event=>online?.event(event)});items=nextItems;
    await prepareGraphics();
    previous.items.dispose();disposeTrack(previous.group);trackGroup=candidate;
    selectedTrackId=id;localStorage.setItem('neon-track',id);ready=true;resetGrid();updateTrackMenu();$('loadLabel').textContent='Готово · '+TRACKS.find(t=>t.id===id).name;
  }catch(error){
    console.error(error);nextItems?.dispose();if(candidate)disposeTrack(candidate);
    configureTrack(previous.data);applyTrackAppearance();trackGroup=previous.group;scene.add(trackGroup);items=previous.items;selectedTrackId=previous.id;
    ready=true;resetGrid();updateTrackMenu();notify('Не удалось загрузить выбранную трассу');$('loadLabel').textContent='Предыдущая трасса готова. Можно повторить выбор.';
  }
  $('startRace').disabled=false;for(const b of $('trackGrid').querySelectorAll('button'))b.disabled=false;
  for(const b of $('difficultyGrid').querySelectorAll('button'))b.disabled=false;
  online?.selectionChanged();online?.render();
}
function selectDifficulty(id,fromNetwork=false){
  if(online?.isGuest&&!fromNetwork)return;
  if(!ready||phase!=='select'||!DIFFICULTIES.some(d=>d.id===id))return;
  difficulty=id;localStorage.setItem('neon-difficulty',id);botAI=createRaceAI({THREE,route,rules:RULES,difficulty});
  for(const b of $('difficultyGrid').querySelectorAll('button'))b.setAttribute('aria-pressed',String(b.dataset.difficulty===id));
  resetGrid();online?.selectionChanged();
}
async function loadAll(){
  try{
    $('loadLabel').textContent='Подготавливаем трассу и гонщиков…';
    async function loadRacerAssets(){
      const models=new Array(HEROES.length);let next=0,completed=0;
      async function worker(){
        while(next<HEROES.length){
          const index=next++;
          models[index]=await loader.loadAsync(`../${HEROES[index].id}_animated.glb?race=web-v18`);
          completed++;$('loadLabel').textContent=`Гонщики готовы: ${completed} / ${HEROES.length}`;$('loadFill').style.width=`${12+80*completed/HEROES.length}%`;
        }
      }
      await Promise.all([worker(),worker()]);return models;
    }
    const [track,models]=await Promise.all([loadTrack(),loadRacerAssets()]);trackGroup=track;scene.add(trackGroup);
    for(let index=0;index<HEROES.length;index++){
      const hero=HEROES[index],gltf=models[index],group=new THREE.Group(),model=gltf.scene,box=new THREE.Box3().setFromObject(model),size=box.getSize(new THREE.Vector3()),scale=1.65/size.y;
      model.scale.setScalar(scale);model.position.set(-(box.min.x+box.max.x)*.5*scale,-box.min.y*scale+RULES.hoverHeight,-(box.min.z+box.max.z)*.5*scale);
      model.traverse(o=>{if(o.isMesh){o.castShadow=true;o.receiveShadow=true;}});group.add(model);scene.add(group);
      const r={id:hero.id,hero,index,group,model,baseModelY:model.position.y,baseModelPosition:model.position.clone(),baseModelQuaternion:model.quaternion.clone(),netOffset:new THREE.Vector3(),netRotation:new THREE.Quaternion(),netHeadingOffset:0,mixer:new THREE.AnimationMixer(model),actions:{},currentSpeed:0,heading:0,motionHeading:0,steering:0,distance:0,u:0,nearest:0,lastU:0,lane:0,laneTarget:0,laneVelocity:0,
        hit:new THREE.Vector3(),radius:Math.max(.45,Math.min(1.05,size.x*scale*.47)),halfLength:size.z*scale*.5,y:0,verticalSpeed:0,lastFloor:0,grounded:true,onRoad:true,finished:false};
      gltf.animations.forEach(clip=>r.actions[clip.name]=r.mixer.clipAction(clip));initRacerRules(r);resetDrift(r);createAnimation(r);addKartLights(r);racers.push(r);
    }
    items=createRaceItems({THREE,scene,route,racers,getPlayer:()=>player,getTime:()=>raceTime,notify,sound:sfx,onPickup:showPickupFlash,isHuman,onEvent:event=>online?.event(event)});
    await prepareGraphics();ready=true;
    $('loadLabel').textContent='Все гонщики готовы';$('loadFill').style.width='100%';$('startRace').disabled=false;$('podiumPreview').disabled=false;$('startRace').textContent='НА СТАРТ';for(const b of [...$('trackGrid').querySelectorAll('button'),...$('difficultyGrid').querySelectorAll('button')])b.disabled=false;selectHero(selectedId);if(online?.room)await handleOnlineRoom(online.room,online.isHost?'host':'guest');online?.selectionChanged();
  }catch(error){console.error(error);$('loadLabel').textContent='Не удалось загрузить гонку. Обнови страницу и проверь соединение.';$('loadLabel').classList.add('error');}
}
async function prepareGraphics(){
  applyTrackAppearance();
  $('loadLabel').textContent='Готовим гонку…';
  await prepareRaceGraphics({THREE,renderer,scene,camera,racers,items,onProgress:progress=>{$('loadFill').style.width=`${92+8*progress}%`;}});
  // Do not carry loading time into the first countdown frame.
  clock.getDelta();
}
function applyTrackAppearance(){
  const light=trackData.lighting??{};
  scene.background.set(light.background??'#070b1b');scene.fog.color.set(light.fog??'#070b1b');
  skyLight.color.set(light.sky??0xa3c2ff);skyLight.groundColor.set(light.ground??0x231333);skyLight.intensity=light.hemisphereIntensity??1.25;
  sun.color.set(light.sun??0xb5caff);sun.intensity=light.sunIntensity??1.55;
  scene.environmentIntensity=light.environmentIntensity??.46;renderer.toneMappingExposure=light.exposure??1.15;
}
function sampleDistance(distance){const u=((distance/LENGTH)%1+1)%1,p=route.getPointAt(u),t=route.getTangentAt(u);return {u,p,t,left:new THREE.Vector3(t.z,0,-t.x).normalize()};}
function placeAI(r,dt=0,snap=false){
  const s=sampleDistance(r.distance),oldHeading=r.motionHeading,forward=Math.sqrt(Math.max(0,r.currentSpeed*r.currentSpeed-r.laneVelocity*r.laneVelocity));
  r.u=s.u;r.motionHeading=Math.atan2(s.t.x,s.t.z)+Math.atan2(r.laneVelocity,Math.max(1,forward));r.heading=r.motionHeading+r.driftAngle;r.group.position.x=s.p.x+s.left.x*r.lane;r.group.position.z=s.p.z+s.left.z*r.lane;
  if(dt>0&&r.currentSpeed>4){const turn=Math.atan2(Math.sin(r.motionHeading-oldHeading),Math.cos(r.motionHeading-oldHeading));r.pathCurvature=damp(r.pathCurvature||0,turn/(r.currentSpeed*dt),8,dt);}
  const surface=snap?(route.roadSurfaceAt(r.group.position,s)??route.surfaceAt(r.group.position,s)):route.surfaceAt(r.group.position,s);r.surfaceKind=surface.kind??'road';placeHeight(r,surface,dt,Math.sin(r.motionHeading)*r.currentSpeed,Math.cos(r.motionHeading)*r.currentSpeed,snap);
  const pitch=r.grounded?-Math.atan(surface.gx*Math.sin(r.heading)+surface.gz*Math.cos(r.heading)):-Math.atan2(r.verticalSpeed,Math.max(8,Math.abs(r.currentSpeed)));
  r.group.rotation.set(clamp(pitch,-.4,.4),r.heading,Math.atan(surface.bank??0)+(r.drifting?-r.driftSign*.10:clamp(-r.laneVelocity*.012,-.07,.07)),'YXZ');
  const ahead=route.getTangentAt((r.u+12/LENGTH)%1),angle=Math.atan2(ahead.x*s.t.z-ahead.z*s.t.x,ahead.x*s.t.x+ahead.z*s.t.z);
  r.steering=clamp(angle/.35+r.laneVelocity*.10,-1,1);r.steer.time=1-r.steering;
  if(dt>0&&route.physical&&r.group.position.y<surface.roadHeight-12)recoverRacer(r);
}
function recoverRacer(r){
  const u=route.recoveryAt(r.u);let back=(r.u-u+1)%1;if(back>.5)back-=1;
  r.distance-=back*LENGTH;r.currentSpeed=0;r.laneVelocity=0;r.lane=clamp(r.lane,-HALF*.55,HALF*.55);r.hit.set(0,0,0);resetDrift(r);
  placeAI(r,0,true);r.nearest=Math.round(r.u*N)%N;r.lastU=r.u;r.onRoad=true;
}
function resetGrid(){
  simulationBudget=0;predictedItemFeedback.clear();
  if(!ready)return;clearPickupFlash();podium.hide();player=racers.find(r=>r.id===selectedId);raceTime=0;worldTime=0;finishers.length=0;lastContact=-10;keys.clear();boostHeld=false;driftHeld=false;items.reset();trackObstacles.reset();driftEffects.clear();
  const grid=racers.filter(r=>r!==player);grid.splice(Math.min(3,grid.length),0,player);
  for(const [slot,r] of grid.entries()){
    initRacerRules(r);resetDrift(r);r.model.position.copy(r.baseModelPosition);r.model.quaternion.copy(r.baseModelQuaternion);r.netOffset.set(0,0,0);r.netRotation.identity();r.netHeadingOffset=0;r.netMotion=null;r.currentSpeed=0;r.steering=0;r.laneVelocity=0;r.pathCurvature=0;r.ai=null;r.aiTurboAllowed=false;r.hit.set(0,0,0);r.finished=false;r.onRoad=true;
    r.distance=-6-Math.floor(slot/2)*5.2;r.lane=(slot%2?1:-1)*Math.min(3.7,HALF*.42);
    r.laneTarget=r.lane;placeAI(r,0,true);r.nearest=Math.round(r.u*N)%N;r.lastU=r.u;createAnimation(r);
  }
  player.nearest=Math.round(player.u*N)%N;player.lastU=player.u;cameraMode=0;orbit.enabled=false;$('cameraBtn').textContent='Камера: сзади';updateCamera(1,true);drawMap();
}
function setPhase(next){phase=next;document.body.dataset.phase=next;$('selection').hidden=next!=='select';$('raceHud').hidden=next==='select'||next==='finished';$('results').hidden=next!=='finished';if(next!=='race'){document.body.classList.remove('boosting');clearPickupFlash();}if(next!=='countdown')$('introRacer').textContent='';}
function selectHero(id,fromNetwork=false){
  if(online?.active&&!fromNetwork&&id===online.remoteId)return;
  selectedId=id;localStorage.setItem('neon-racer',id);const hero=HEROES.find(h=>h.id===id);$('heroName').textContent=hero.name;$('heroTag').textContent=hero.tag;$('heroDescription').textContent=hero.description;
  const stats=racerDisplayStats(hero);$('statSpeed').textContent=stats.speed;$('statSpeed').title=`Турбо: ${stats.boost} км/ч`;$('statAcceleration').textContent=stats.accelerationRating+' / 5';$('statDrift').textContent=stats.driftRating+' / 5';
  $('statSpeedBar').style.width=stats.speedRating*20+'%';$('statAccelerationBar').style.width=stats.accelerationRating*20+'%';$('statDriftBar').style.width=stats.driftRating*20+'%';$('heroLore').textContent=hero.lore;$('heroTurbo').textContent=`ТУРБО · ${stats.boost} КМ/Ч`;
  $('heroPreview').src=`./assets/selection/${id}.png?art=babylon-v12`;$('heroPreview').alt=`${hero.name} и его карт`;document.documentElement.style.setProperty('--hero-color',hero.color);
  for(const button of $('heroGrid').querySelectorAll('button'))button.setAttribute('aria-pressed',String(button.dataset.hero===id));
  if(ready&&phase==='select')resetGrid();online?.selectionChanged();
}
function beginRace(fromNetwork=false){
  if(online?.active&&!fromNetwork){if(online.isHost)online.start();else notify('Стартует создатель комнаты');return;}
  if(!ready)return;
  raceAudio.unlock();raceAudio.setPaused(false);resetGrid();paused=false;$('settingsPanel').hidden=true;countdown=RACE_INTRO_SECONDS;countLabel='';goFlash=0;setPhase('countdown');$('countdownValue').textContent=String(RACE_INTRO_SECONDS);$('countdown').hidden=false;intro.begin();
}
function backToSelection(fromNetwork=false){if(online?.active&&!fromNetwork){if(online.isHost)online.lobby();else online.leave();return;}setPhase('select');paused=false;raceAudio.setPaused(false);$('settingsPanel').hidden=true;$('countdown').hidden=true;resetGrid();}
function openPodiumPreview(){
  if(!ready||phase!=='select')return;
  const first=racers.find(r=>r.id===selectedId),order=[first,...racers.filter(r=>r!==first)];
  keys.clear();boostHeld=false;driftHeld=false;orbit.enabled=false;setPhase('finished');
  $('resultTitle').textContent='ПОДИУМ';$('resultTime').textContent='';
  $('resultList').innerHTML=order.map((r,i)=>`<li class="${r===first?'you':''}"><span>${i+1}</span><img src="./assets/selection/${r.id}.png?art=babylon-v12" alt=""><b>${r.hero.name}</b><small></small></li>`).join('');
  podium.show(order);
}
function closestTrack(r){
  let best=r.nearest,bestDistance=Infinity;
  const score=p=>{const dy=r.group.position.y-p.y,wrongLevel=route.terrain&&r.grounded&&r.surfaceKind==='sand'&&dy<-2.5;return (r.group.position.x-p.x)**2+(r.group.position.z-p.z)**2+(dy*(route.terrain?1.5:.4))**2+(wrongLevel?100000:0);};
  for(let d=-85;d<=85;d++){const i=(r.nearest+d+N)%N,distance=score(samples[i].p);if(distance<bestDistance){bestDistance=distance;best=i;}}
  if(bestDistance>500)for(let i=0;i<N;i+=3){const d=score(samples[i].p);if(d<bestDistance){bestDistance=d;best=i;}}
  r.nearest=best;return samples[best];
}
function aiPlan(r,dt){
  const s=sampleDistance(r.distance),before=route.getTangentAt(r.u-.9/LENGTH),after=route.getTangentAt(r.u+.9/LENGTH);
  const signed=Math.atan2(after.x*before.z-after.z*before.x,after.x*before.x+after.z*before.z)/1.8;
  const plan=botAI.plan(r,racers,items.pickups,[...items.hazards,...trackObstacles.hazards],dt);r.laneTarget=plan.laneTarget;tickRacerRules(r,dt,plan.wantsNitro);
  const holdDrift=plan.drift??(Math.abs(plan.curvature)>(r.drifting?.009:.015)&&(!r.drifting||Math.sign(plan.curvature)===r.driftSign));
  stepDrift(r,dt,{held:holdDrift&&r.grounded,steering:clamp((plan.driftCurvature??plan.curvature)/.035,-1,1)});
  const pathFactor=Math.max(.2,1-signed*r.lane),curvature=Math.abs(r.pathCurvature||plan.curvature);
  r.currentSpeed=motorStep(r,r.currentSpeed,dt,{targetSpeed:Math.min(speedLimit(r),plan.targetSpeed),curvature,drifting:r.drifting||Math.abs(r.driftAngle)>.18});
  r.hit.multiplyScalar(Math.exp(-dt*4));
  const control=r.stunTime>0?.3:1,handling=racerTuning(r).handling,acceleration=(plan.laneAcceleration??9)*handling,spring=plan.laneSpring??5,damping=plan.laneDamping??4.4;
  r.laneVelocity+=clamp((r.laneTarget-r.lane)*spring+((plan.laneFeedForward??0)/pathFactor-r.laneVelocity)*damping,-acceleration,acceleration)*dt*control;
  if(r.oilTime>0)r.laneVelocity+=Math.sin(raceTime*8+r.index)*dt*2;
  const lateralLimit=Math.min((plan.laneSpeed??5)*handling,Math.abs(r.currentSpeed));r.laneVelocity=clamp(r.laneVelocity,-lateralLimit,lateralLimit);
  const forwardSpeed=Math.sqrt(Math.max(0,r.currentSpeed*r.currentSpeed-r.laneVelocity*r.laneVelocity));
  r.distance+=(forwardSpeed+r.hit.dot(s.t))*dt/pathFactor;r.lane+=(r.laneVelocity+r.hit.dot(s.left))*dt;r.lane=clamp(r.lane,-HALF+r.radius+.1,HALF-r.radius-.1);placeAI(r,dt);
}
function playerStep(dt,r=player,input=readLocalInput()){
  const {gas,brake,left,right}=input;
  tickRacerRules(r,dt,input.boost);
  const target=left!==right?(left?1:-1):0;r.steering=damp(r.steering,target,16,dt);
  const s=closestTrack(r),delta=r.group.position.clone().sub(s.p),lateral=delta.dot(s.left);r.lane=lateral;
  let onRoad=Math.abs(lateral)<HALF+.4,wall=HALF+.1-r.radius*.8;
  if(!route.terrain&&Math.abs(lateral)>wall&&Math.abs(lateral)<HALF+5&&r.group.position.y<s.p.y+1.4&&r.group.position.y>s.p.y-.6){r.group.position.addScaledVector(s.left,clamp(lateral,-wall,wall)-lateral);r.currentSpeed*=Math.exp(-dt*6);r.hit.addScaledVector(s.left,-Math.sign(lateral)*dt*8);onRoad=true;sfx('scrape',.4);}
  const contact=route.surfaceAt(r.group.position,s,onRoad),sand=contact.kind==='sand'&&r.grounded&&Math.abs(contact.height-r.group.position.y)<.8;
  const drivable=onRoad||sand||contact.onRoad||!!contact.gap;
  const wasDrifting=r.drifting,drift=stepDrift(r,dt,{held:input.drift,steering:r.steering,onRoad:onRoad&&r.grounded&&!sand});
  if(r===player&&!wasDrifting&&r.drifting)sfx('drift');
  if(r===player&&drift.released){notify(`ДРИФТ-ТУРБО · ${drift.released}`,'#ffce83');sfx('turbo');}
  const grip=1/(1+Math.max(0,Math.abs(r.currentSpeed)-20)*.025),normalCurve=r.steering*.14*racerTuning(r).handling*grip*(sand?.78:1)*(r.oilTime>0?.6:1)*(r.stunTime>0?.3:1);
  const curvature=drift.curvature===null?normalCurve:THREE.MathUtils.lerp(normalCurve,drift.curvature,drift.blend);
  r.currentSpeed=motorStep(r,r.currentSpeed,dt,{throttle:gas?1:0,brake,curvature,onRoad:drivable,surface:sand?contact:null,drifting:r.drifting||Math.abs(r.driftAngle)>.18});r.motionHeading+=curvature*r.currentSpeed*dt;r.heading=r.motionHeading+r.driftAngle;
  r.hit.multiplyScalar(Math.exp(-dt*4));if(r.oilTime>0)r.hit.addScaledVector(s.left,Math.sin(raceTime*8+r.index)*dt*1.6);
  const oldX=r.group.position.x,oldZ=r.group.position.z,vx=Math.sin(r.motionHeading)*r.currentSpeed+r.hit.x,vz=Math.cos(r.motionHeading)*r.currentSpeed+r.hit.z;r.group.position.x+=vx*dt;r.group.position.z+=vz*dt;
  if(route.terrain&&!route.canLeaveRoad(s.u,lateral)&&r.group.position.y<s.p.y+1.8&&r.group.position.y>s.p.y-1.2){
    const nextLane=r.group.position.clone().sub(s.p).dot(s.left),rail=route.barrierHalfWidth??HALF+.1,inside=Math.abs(lateral)<rail,limit=rail+(inside?-1:1)*r.radius*.8;
    if(inside?Math.abs(nextLane)>limit:Math.abs(nextLane)<limit){
      r.group.position.addScaledVector(s.left,Math.sign(lateral||nextLane)*limit-nextLane);r.currentSpeed*=Math.exp(-dt*6);sfx('scrape',.4);
    }
  }
  let surface=route.surfaceAt(r.group.position,s,onRoad);
  if(route.terrain&&r.grounded&&surface.kind!=='road'&&surface.height-r.group.position.y>.7){r.group.position.x=oldX;r.group.position.z=oldZ;r.currentSpeed*=Math.exp(-dt*12);surface=route.surfaceAt(r.group.position,s,onRoad);}
  placeHeight(r,surface,dt,vx,vz);r.surfaceKind=surface.kind??(onRoad?'road':'air');
  const pitch=r.grounded?-Math.atan(surface.gx*Math.sin(r.heading)+surface.gz*Math.cos(r.heading)):-Math.atan2(r.verticalSpeed,Math.max(8,Math.abs(r.currentSpeed)));
  r.group.rotation.set(damp(r.group.rotation.x,clamp(pitch,-.4,.4),9,dt),r.heading,Math.atan(surface.bank??0)+(r.drifting?-r.driftSign*.10:-r.steering*Math.min(.045,Math.abs(r.currentSpeed)*.001)),'YXZ');
  const u=s.u;let du=u-r.lastU;if(du<-.5)du+=1;if(du>.5)du-=1;if(onRoad||surface.kind==='sand')r.distance+=du*LENGTH;r.lastU=u;r.u=u;r.onRoad=route.terrain?surface.onRoad:onRoad;
  if(route.physical&&((surface.kind!=='sand'&&r.group.position.y<surface.roadHeight-12)||r.group.position.y<route.groundHeight-3||surface.kind==='hazard'&&r.grounded)){recoverRacer(r);notify('ВОЗВРАЩЕНИЕ НА ТРАССУ');}
  else if(!route.physical&&(r.group.position.y<route.groundHeight-3||!onRoad&&r.group.position.y<route.groundHeight+.3)){r.group.position.copy(s.p);placeHeight(r,route.surfaceAt(s.p,s),0,0,0,true);r.currentSpeed=0;r.hit.set(0,0,0);resetDrift(r);r.motionHeading=r.heading=Math.atan2(s.t.x,s.t.z);notify('ВОЗВРАЩЕНИЕ НА ТРАССУ');}
  r.steer.time=1-r.steering;
}
function contacts(predicted=false,at=0){
  const bodies=racers.filter(r=>!r.finished).map(r=>{
    const pose=predicted&&r!==player?r.netMotion?.predict(at):null;
    return {r,x:pose?.p[0]??r.group.position.x,z:pose?.p[2]??r.group.position.z,y:pose?.p[1]??r.group.position.y,heading:pose?.rot[1]??r.heading,radius:r.radius,halfLength:r.halfLength,mass:racerTuning(r).mass,
      vx:pose?.vel[0]??Math.sin(r.motionHeading)*r.currentSpeed+r.hit.x,vz:pose?.vel[2]??Math.cos(r.motionHeading)*r.currentSpeed+r.hit.z,touched:false};
  });
  for(let pass=0;pass<3;pass++)for(let i=0;i<bodies.length;i++)for(let j=i+1;j<bodies.length;j++){
    if(predicted&&bodies[i].r!==player&&bodies[j].r!==player)continue;
    const a=bodies[i],b=bodies[j],hit=resolveCapsuleCollision(a,b);if(hit){a.touched=b.touched=true;if(hit.impulse>1&&(a.r===player||b.r===player)){lastContact=raceTime;sfx('collision',Math.min(1,hit.impulse/12));}}
  }
  for(const b of bodies){if(!b.touched||predicted&&b.r!==player)continue;const r=b.r,fx=Math.sin(r.motionHeading),fz=Math.cos(r.motionHeading);r.currentSpeed=clamp(b.vx*fx+b.vz*fz,-RULES.reverseSpeed,speedLimit(r));
    if(isHuman(r)){r.group.position.x=b.x;r.group.position.z=b.z;r.hit.set(b.vx-fx*r.currentSpeed,0,b.vz-fz*r.currentSpeed);}
    else{const s=sampleDistance(r.distance),dx=b.x-r.group.position.x,dz=b.z-r.group.position.z;r.distance+=dx*s.t.x+dz*s.t.z;r.lane+=dx*s.left.x+dz*s.left.z;r.lane=clamp(r.lane,-HALF+r.radius,HALF-r.radius);r.laneVelocity=clamp(b.vx*s.left.x+b.vz*s.left.z,-6,6);placeAI(r);}
  }
}
function predictPlayerStep(dt,input,mask=0,at=performance.now()){
  playerStep(dt,player,input);
  if((mask&64)&&player.itemCooldown<=0&&['turbo','shield'].includes(player.item)){
    const item=player.item;player.item=null;player.itemCooldown=.35;
    if(item==='turbo')player.turboTime=Math.max(player.turboTime,2.4);else player.shieldTime=6;
    if(!replaying){predictedItemFeedback.set(item,performance.now()+1500);sfx(item);}
  }
  contacts(true,at);trackObstacles.step(dt,player,true);
}
function checkFinish(){
  for(const r of racers)if(!r.finished&&r.distance>=RULES.laps*LENGTH){r.finished=true;finishers.push({racer:r,time:raceTime-(r.distance-RULES.laps*LENGTH)/Math.max(.1,Math.abs(r.currentSpeed))});}
  const humans=online?.running?racers.filter(isHuman):[player];
  if(phase==='race'&&humans.every(r=>r.finished))showRaceResults();
}
function showRaceResults(){
  finishers.sort((a,b)=>a.time-b.time);
  const place=finishers.findIndex(f=>f.racer===player)+1,time=finishers.find(f=>f.racer===player)?.time??raceTime;
  setPhase('finished');keys.clear();boostHeld=false;
  $('resultTitle').textContent=place===1?'ПОБЕДА!':'ФИНИШ · '+place+' МЕСТО';$('resultTime').textContent=formatTime(time)+' · '+RULES.laps+' круга';
  sfx(place===1?'win':'finish');
  const order=[...finishers.map(f=>f.racer),...racers.filter(r=>!r.finished).sort((a,b)=>b.distance-a.distance)];
  $('resultList').innerHTML=order.map((r,i)=>'<li class="'+(r===player?'you':'')+'"><span>'+(i+1)+'</span><img src="./assets/selection/'+r.id+'.png" alt=""><b>'+r.hero.name+'</b><small>'+(finishers.find(f=>f.racer===r)?formatTime(finishers.find(f=>f.racer===r).time):'на трассе')+'</small></li>').join('');
  for(const r of racers){r.currentSpeed=0;r.boosting=false;r.shieldMesh.visible=false;for(const jet of r.jets)jet.visible=false;r.hit.set(0,0,0);r.netOffset.set(0,0,0);r.netRotation.identity();r.netHeadingOffset=0;r.netMotion=null;r.model.position.copy(r.baseModelPosition);r.model.quaternion.copy(r.baseModelQuaternion);}
  orbit.enabled=false;podium.show(order);
}

function step(dt){
  if(phase!=='race'||paused)return;raceTime+=dt;
  const input=readLocalInput();
  if(online?.isGuest){
    if(!player.finished){const frame=online.record(dt,input);predictPlayerStep(dt,input,frame?.[2]??0);}return;
  }
  if(!player.finished)playerStep(dt,player,input);
  const remote=online?.running?racers.find(r=>r.id===online.remoteId):null;
  if(remote&&!remote.finished){
    const controls=online.nextInput();playerStep(dt,remote,controls);
    if(controls.use)items.use(remote,false);if(controls.drop)items.use(remote,true);
  }
  for(const r of racers)if(r!==player&&r!==remote&&!r.finished)aiPlan(r,dt);
  contacts();trackObstacles.step(dt);items.step(dt);checkFinish();
}
function updateCamera(dt,snap=false){
  if(!player)return;const position=player.group.position.clone().add(player.netOffset);lookTarget.copy(position).add(new THREE.Vector3(0,1.05,0));
  if(cameraMode===3){const size=mapBounds.getSize(new THREE.Vector3()),extent=Math.max(size.x,size.z);lookTarget.set(mapCentre.x,2,mapCentre.z);desiredCamera.copy(lookTarget).add(new THREE.Vector3(extent*.18,extent*.58,extent*.72));camera.position.lerp(desiredCamera,snap?1:1-Math.exp(-dt*4));camera.lookAt(lookTarget);return;}
  if(cameraMode===2){orbit.target.lerp(lookTarget,1-Math.exp(-dt*4));orbit.update();return;}
  const front=cameraMode===1,heading=player.motionHeading+player.netHeadingOffset,direction=new THREE.Vector3(Math.sin(heading),0,Math.cos(heading)),ratio=clamp(Math.abs(player.currentSpeed)/racerTuning(player).boostSpeed,0,1);
  if(!front)lookTarget.addScaledVector(direction,2.2+ratio*1.5);
  desiredCamera.copy(position).addScaledVector(direction,front?3.1:-(CHASE_CAMERA.distance+ratio*CHASE_CAMERA.speedDistance));desiredCamera.y+=front?1.75:CHASE_CAMERA.height+ratio*CHASE_CAMERA.speedHeight;
  camera.position.lerp(desiredCamera,snap?1:1-Math.exp(-dt*6));camera.lookAt(lookTarget);
  const fov=front?52:56+ratio*12+(player.boosting?5:0);camera.fov=damp(camera.fov,fov,5,dt);camera.updateProjectionMatrix();
}
function drawMap(){
  const c=mapContext,project=p=>[220+(p.x-mapCentre.x)*mapScale,110+(p.z-mapCentre.z)*mapScale];c.clearRect(0,0,map.width,map.height);
  c.beginPath();let pen=false;route.points.forEach((p,i)=>{
    if(route.gaps.some(g=>route.distances[i]>=g.start&&route.distances[i]<g.end)){pen=false;return;}
    const [x,y]=project(p);pen?c.lineTo(x,y):c.moveTo(x,y);pen=true;
  });if(!route.gaps.length)c.closePath();c.lineWidth=9;c.strokeStyle='#375165';c.stroke();c.lineWidth=2;c.strokeStyle='#76dced';c.stroke();
  c.fillStyle='#ff9e74';for(const h of trackObstacles.hazards){const [x,y]=project(h.position);c.fillRect(x-1.5,y-1.5,3,3);}
  if(items)for(const pick of items.pickups)if(pick.respawn===0){const [x,y]=project(pick.base);c.fillStyle='#c2a0ff';c.fillRect(x-1.8,y-1.8,3.6,3.6);}
  for(const r of racers){const [x,y]=project(r.group.position);c.beginPath();c.arc(x,y,r===player?5.2:3.7,0,Math.PI*2);c.fillStyle=r===player?'#fff':r.hero.color;c.fill();if(r===player){c.strokeStyle='#74ffd0';c.lineWidth=2;c.stroke();}}
}
function formatTime(seconds){const ticks=Math.floor(Math.max(0,seconds)*100);return `${Math.floor(ticks/6000)}:${String(Math.floor(ticks/100)%60).padStart(2,'0')}.${String(ticks%100).padStart(2,'0')}`;}
function updateHud(){
  if(!player)return;const r=player,place=1+racers.filter(other=>other!==r&&other.distance>r.distance).length;
  $('raceTotal').textContent='/ '+racers.length;
  $('racePlace').textContent=place;$('raceLap').textContent=`${Math.min(RULES.laps,Math.max(1,Math.floor(r.distance/LENGTH)+1))} / ${RULES.laps}`;$('raceClock').textContent=formatTime(raceTime);
  $('speed').textContent=Math.round(Math.abs(r.currentSpeed)*3.6);$('nitroFill').style.transform=`scaleX(${r.energy})`;$('nitroText').textContent=r.boosting?'ТУРБО':`${Math.round(r.energy*100)}%`;
  const item=ITEM_BY_ID[r.item];$('itemName').textContent=item?.name??'Подбери ящик';$('itemSymbol').textContent=item?.symbol??'?';$('itemDescription').textContent=item?.description??'Светящиеся ящики дают один из семи предметов.';$('itemSlot').style.setProperty('--item-color',item?.color??'#9d9cb8');$('useItem').disabled=!item;$('dropItem').disabled=!item;
  $('raceState').textContent=r.shieldTime>0?'ЩИТ':r.stunTime>0?'ПОПАДАНИЕ':r.oilTime>0?'МАСЛО':r.surfaceKind==='sand'&&r.grounded?'ПЕСОК':r.drifting?'ДРИФТ':raceTime-lastContact<.6?'КОНТАКТ':TRACKS.find(t=>t.id===selectedTrackId).short;
  $('driftFill').style.transform=`scaleX(${Math.min(1,r.driftCharge/1.9)})`;$('driftText').textContent=r.drifting?(r.driftTier?'ТУРБО '+r.driftTier:'ЗАРЯДКА'):'SHIFT + ПОВОРОТ';
  document.body.classList.toggle('boosting',r.boosting&&phase==='race');
}
function updateKartVisuals(dt){
  for(const r of racers){
    settleLocalPose(r,dt);
    r.model.position.copy(r.baseModelPosition).applyQuaternion(r.netRotation);
    r.model.quaternion.copy(r.netRotation).multiply(r.baseModelQuaternion);
    if(r.netOffset.lengthSq()>.000001){const offset=r.netOffset.clone().applyQuaternion(r.group.quaternion.clone().invert());r.model.position.add(offset);}
    r.model.position.y+=(r.driftHop>0?Math.sin(r.driftHop/.24*Math.PI)*.12:0);
    const visible=!player||r===player||r.group.position.distanceTo(player.group.position)<155;r.group.visible=visible;r.glow.visible=visible;
    if(visible){r.mixer.update(dt*(.9+Math.abs(r.currentSpeed)/racerTuning(r).maxSpeed*.3));const surface=surfaceFor(r);if(surface.supported===false)r.glow.visible=false;r.glow.position.copy(r.group.position);r.glow.position.y=surface.height+.015;r.glow.rotation.z=-r.heading;r.glow.material.opacity=clamp(.72-(r.group.position.y-surface.height)*.12,.12,.72);}
    r.shieldMesh.visible=r.shieldTime>0;r.shieldMesh.rotation.y+=dt*.5;
    for(const jet of r.jets){jet.visible=r.boosting;jet.scale.y=.8+Math.sin(worldTime*40+r.index)*.15+(Math.abs(r.currentSpeed)/racerTuning(r).boostSpeed)*.6;}
  }
  const lit=player?[player,...racers.filter(r=>r!==player&&r.group.visible).sort((a,b)=>a.group.position.distanceToSquared(player.group.position)-b.group.position.distanceToSquared(player.group.position))]:[];
  for(let i=0;i<kartLights.length;i++){
    const light=kartLights[i],r=lit[i];light.intensity=r?(r.boosting?65:30):0;
    if(r){light.color.set(r.hero.color);light.position.copy(r.group.position);light.position.y+=.42;}
  }
}
function tick(){
  requestAnimationFrame(tick);const elapsed=clock.getDelta(),dt=Math.min(elapsed,.12);worldTime+=dt;frame++;fpsTime+=elapsed;fpsFrames++;
  if(fpsTime>=1){$('fps').textContent=`${Math.round(fpsFrames/fpsTime)} FPS`;fpsTime=0;fpsFrames=0;}
  raceAudio.update(player,{phase,paused:paused||document.hidden||!document.hasFocus(),dt,throttle:keys.has('KeyW')||keys.has('ArrowUp'),brake:keys.has('KeyS')||keys.has('ArrowDown')});
  if(phase==='countdown'&&!paused){
    countdown=Math.max(0,countdown-elapsed);const label=countdown>0?String(Math.ceil(countdown)):'ВПЕРЁД!';
    if(label!==countLabel){countLabel=label;$('countdownValue').textContent=label;$('countdownValue').animate([{transform:'scale(1.35)',opacity:.25},{transform:'scale(1)',opacity:1}],{duration:350,easing:'ease-out'});sfx(label==='ВПЕРЁД!'?'go':'count');}
    if(countdown<=0&&!online?.isGuest){setPhase('race');goFlash=.65;}
  }
  if(phase==='race'&&!paused){
    simulationBudget=Math.min(.15,simulationBudget+dt);
    while(simulationBudget>=SIMULATION_STEP){step(SIMULATION_STEP);simulationBudget-=SIMULATION_STEP;}
  }else simulationBudget=0;
  if(goFlash>0&&!paused){goFlash-=dt;if(goFlash<=0)$('countdown').hidden=true;}
  if(toastTime>0){toastTime-=dt;if(toastTime<=0)$('toast').classList.remove('visible');}
  if(online?.isHost&&online.running)online.publish(captureOnlineState);
  if(online?.isGuest)interpolateOnlineRacers(dt);
  if(ready&&phase==='finished'){podium.update(dt);renderer.render(podium.scene,camera);}
  else if(ready&&phase!=='select'){
    if(!paused){updateKartVisuals(dt);items.animate(dt);driftEffects.update(dt,racers);}if(phase==='countdown')intro.update(RACE_INTRO_SECONDS-countdown);else updateCamera(dt);updateHud();if(frame%3===0)drawMap();
    sun.position.copy(player.group.position).add(new THREE.Vector3(-20,35,10));sun.target.position.copy(player.group.position);renderer.render(scene,camera);
  }
}
function toggleSettings(){
  if(phase==='select'||phase==='finished')return;
  if(online?.isGuest){online.pause(!paused);return;}
  setOnlinePause(!paused);if(online?.isHost)online.pause(paused);
}
function cycleCamera(){if(phase==='finished'||phase==='countdown')return;cameraMode=(cameraMode+1)%4;orbit.enabled=cameraMode===2;$('cameraBtn').textContent=`Камера: ${['сзади','спереди','свободная','вся трасса'][cameraMode]}`;updateCamera(1,true);}
function usePlayerItem(backward=false){if(phase==='race'&&!paused){if(online?.isGuest)online.action(backward);else items.use(player,backward);}}
function bindHold(element,down,up){element.addEventListener('pointerdown',e=>{e.preventDefault();element.setPointerCapture(e.pointerId);down();});for(const type of ['pointerup','pointercancel','lostpointercapture'])element.addEventListener(type,up);}
$('heroGrid').style.setProperty('--hero-count',HEROES.length);
$('heroGrid').innerHTML=HEROES.map(hero=>`<button class="hero-card" type="button" data-hero="${hero.id}" aria-pressed="false"><img src="./assets/selection/${hero.id}.png?art=babylon-v12" alt="${hero.name}"><span>${hero.name}</span><small>${hero.tag}</small></button>`).join('');
$('heroGrid').addEventListener('click',event=>{const button=event.target.closest('[data-hero]');if(button)selectHero(button.dataset.hero);});
$('trackGrid').innerHTML=TRACKS.map(track=>`<button type="button" class="track-card" data-track="${track.id}" aria-pressed="false" disabled><img src="./assets/${track.id}-preview.png" alt=""><span><b>${track.name}</b><small>${track.tag}${track.jumps?'':' · без трамплинов'}</small></span></button>`).join('');
$('trackGrid').addEventListener('click',event=>{const b=event.target.closest('[data-track]');if(b)selectTrack(b.dataset.track);});updateTrackMenu();
$('difficultyGrid').innerHTML=DIFFICULTIES.map(d=>`<button type="button" data-difficulty="${d.id}" aria-pressed="${d.id===difficulty}" disabled><b>${d.name}</b><span>${d.description}</span></button>`).join('');
$('difficultyGrid').addEventListener('click',event=>{const b=event.target.closest('[data-difficulty]');if(b)selectDifficulty(b.dataset.difficulty);});
$('itemLegend').innerHTML=ITEM_TYPES.map(item=>`<span title="${item.description}" style="--item-color:${item.color}"><b>${item.symbol}</b>${item.name}</span>`).join('');
$('startRace').onclick=()=>beginRace();$('restartRace').onclick=()=>beginRace();$('raceAgain').onclick=()=>beginRace();$('returnToSelect').onclick=()=>backToSelection();$('changeHero').onclick=()=>backToSelection();$('settingsBtn').onclick=toggleSettings;$('cameraBtn').onclick=cycleCamera;
$('podiumPreview').onclick=openPodiumPreview;
$('resumeRace').onclick=()=>{if(paused)toggleSettings();};
$('useItem').onclick=()=>usePlayerItem(false);$('dropItem').onclick=()=>usePlayerItem(true);bindHold($('boostBtn'),()=>boostHeld=true,()=>boostHeld=false);
bindHold($('driftBtn'),()=>driftHeld=true,()=>driftHeld=false);
$('shadows').onchange=event=>renderer.shadowMap.enabled=event.target.checked;$('sound').checked=soundEnabled;
$('sound').onchange=event=>{soundEnabled=event.target.checked;raceAudio.setEffectsEnabled(soundEnabled);localStorage.setItem('babylon-sound',soundEnabled?'on':'off');};
$('music').checked=localStorage.getItem('babylon-music')!=='off';$('music').onchange=event=>{raceAudio.setMusicEnabled(event.target.checked);localStorage.setItem('babylon-music',event.target.checked?'on':'off');};
for(const button of $('touchControls').querySelectorAll('[data-key]'))bindHold(button,()=>keys.add(button.dataset.key),()=>keys.delete(button.dataset.key));
addEventListener('keydown',event=>{
  if(/INPUT|TEXTAREA|SELECT/.test(event.target.tagName))return;
  if(['ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Space'].includes(event.code))event.preventDefault();
  if(phase==='select'){
    if(event.code==='Enter'&&!event.target.closest('button')){event.preventDefault();beginRace();}
    if(event.code==='ArrowLeft'||event.code==='ArrowRight'){const i=HEROES.findIndex(h=>h.id===selectedId);selectHero(HEROES[(i+(event.code==='ArrowLeft'?HEROES.length-1:1))%HEROES.length].id);}return;
  }
  keys.add(event.code);if(event.repeat)return;
  if(event.code==='KeyE')usePlayerItem(false);if(event.code==='KeyQ')usePlayerItem(true);if(event.code==='KeyC')cycleCamera();if(event.code==='KeyH'||event.code==='Escape')toggleSettings();if(event.code==='KeyR')beginRace();
});
function pauseWhenAway(){raceAudio.setPaused(true);keys.clear();boostHeld=false;driftHeld=false;if((phase==='race'||phase==='countdown')&&!paused)toggleSettings();}
addEventListener('keyup',event=>keys.delete(event.code));addEventListener('blur',pauseWhenAway);
document.addEventListener('visibilitychange',()=>{if(document.hidden)pauseWhenAway();});
document.addEventListener('click',event=>{if(event.target.closest('button')){raceAudio.unlock();sfx('menu');event.target.closest('button').blur();}});
addEventListener('resize',()=>{camera.aspect=innerWidth/innerHeight;camera.updateProjectionMatrix();renderer.setSize(innerWidth,innerHeight);});

function isHuman(r){return r===player||!!(online?.running&&r.id===online.remoteId);}
function readLocalInput(){return {
  gas:keys.has('KeyW')||keys.has('ArrowUp'),brake:keys.has('KeyS')||keys.has('ArrowDown'),
  left:keys.has('KeyA')||keys.has('ArrowLeft'),right:keys.has('KeyD')||keys.has('ArrowRight'),
  boost:boostHeld||keys.has('Space'),drift:driftHeld||keys.has('ShiftLeft')||keys.has('ShiftRight')
};}
function setOnlinePause(value){
  paused=value;raceAudio.setPaused(value);if(!value)raceAudio.unlock();$('settingsPanel').hidden=!value;keys.clear();boostHeld=false;driftHeld=false;
}
async function handleOnlineRoom(room,role,hero=null){
  if(hero&&hero!==selectedId)selectHero(hero,true);
  if(!ready||phase!=='select')return;
  if(role==='guest'){
    if(room.track!==selectedTrackId)await selectTrack(room.track,true);
    if(room.difficulty!==difficulty)selectDifficulty(room.difficulty,true);
  }
  online?.selectionChanged();
}
function captureOnlineState(){
  return {phase,paused,countdown,raceTime,worldTime,racers:racers.map(r=>packRacer(r,worldTime)),
    finishers:finishers.map(f=>({id:f.racer.id,time:f.time})),items:items.networkSnapshot()};
}
function receiveOnlineState(state){
  if(!ready||!online?.running)return;
  const previousPhase=phase,oldHit=player.hitFlash,receivedAt=performance.now();
  const previous={position:player.group.position.clone().add(player.netOffset),rotation:player.group.quaternion.clone().multiply(player.netRotation),heading:player.motionHeading+player.netHeadingOffset};
  replaying=true;
  try{
    raceTime=state.raceTime;worldTime=state.worldTime;countdown=state.countdown;
    if(paused!==state.paused)setOnlinePause(state.paused);
    for(const packed of state.racers){
      const r=racers.find(r=>r.id===packed.id);if(r)applyRacer(r,packed,{interpolate:r!==player&&previousPhase===state.phase&&state.phase==='race'&&!state.paused,transitSeconds:state.transitSeconds??0,sourceTime:state.sentAt/1000,receivedAt});
    }
    const pending=online.reconcile(state.ack);
    if(state.phase==='race'&&!state.paused&&!player.finished){
      let remaining=pending.reduce((sum,f)=>sum+f[1],0);
      for(const frame of pending){remaining-=frame[1];raceTime+=frame[1];predictPlayerStep(frame[1],decodeInput(frame[2]),frame[2],receivedAt-remaining*1000);}
    }
    if(state.phase==='race'&&previousPhase==='race')preserveLocalPose(player,previous);
    else{player.netOffset.set(0,0,0);player.netRotation.identity();player.netHeadingOffset=0;}
    finishers.length=0;for(const entry of state.finishers){const racer=racers.find(r=>r.id===entry.id);if(racer)finishers.push({racer,time:entry.time});}
    items.applyNetwork(state.items,{sourceTime:state.sentAt/1000,transitSeconds:state.transitSeconds??0,receivedAt,paused:state.paused});
  }finally{replaying=false;}
  if(player.hitFlash>oldHit+.1)sfx('hit');
  if(state.phase!==phase){
    if(state.phase==='finished')showRaceResults();
    else{setPhase(state.phase);if(state.phase==='race'){goFlash=.65;$('countdownValue').textContent='ВПЕРЁД!';}}
  }
  if(state.phase==='race'&&player.finished)$('raceState').textContent='ФИНИШ · ЖДЁМ СОПЕРНИКА';
}
function interpolateOnlineRacers(dt){
  if(phase==='finished'||paused)return;
  const now=performance.now();
  for(const r of racers)if(r!==player&&r.netMotion){
    const present=r.netMotion.predict(now);
    const separation=present?Math.hypot(present.p[0]-player.group.position.x,present.p[2]-player.group.position.z):40;
    // Nearby karts share the predicted contact position. Distant traffic can use
    // the full jitter buffer without making a close collision happen in midair.
    r.netMotion.setDelayScale(clamp((separation-12)/28,0,1),now);
    const pose=r.netMotion.sample(now);if(!pose)continue;
    r.group.position.fromArray(pose.p);r.group.rotation.set(...pose.rot,'YXZ');
  }
}
function onlineEvent(event){
  if(event.racer!==player?.id)return;
  if(event.kind==='pickup'){showPickupFlash(ITEM_BY_ID[event.item]);sfx('pickup');items.burst(player.group.position,ITEM_BY_ID[event.item].color);}
  else if(event.kind==='hit')sfx(event.oil?'oil':'hit');
  else if(event.kind==='use'){
    if((predictedItemFeedback.get(event.item)??0)>performance.now()){predictedItemFeedback.delete(event.item);return;}
    sfx(event.item==='rocket'?'rocket':['mine','tnt','oil'].includes(event.item)?'drop':event.item);
  }
}
online=createOnlineClient({
  heroIds:HEROES.map(h=>h.id),
  getSelection:()=>({hero:selectedId,track:selectedTrackId,difficulty,loaded:ready&&(!online?.isGuest||selectedTrackId===online.room?.track&&difficulty===online.room?.difficulty)}),
  onRoom:handleOnlineRoom,onStart:()=>beginRace(true),onState:receiveOnlineState,onEvent:onlineEvent,
  onLobby:()=>backToSelection(true),
  onPause:(value,request)=>{setOnlinePause(value);if(request&&online.isHost)online.pause(value);},
  onDisconnect:()=>backToSelection(true)
});
selectHero(selectedId);setPhase('select');loadAll();tick();
