// Responsive motor, tyres and race effects, synthesised locally with Web Audio.
const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
export function createRaceAudio({effectsEnabled=true,musicEnabled=true}={}){
  let context=null,bus=null,compressor=null,engine=null,noiseBuffer=null,music=null,paused=false,phase='select',musicFailed=false;
  let lastGear=1,gearDip=0,duckUntil=0,startedBoost=false;const last=new Map();
  const musicUrl=new URL('./assets/audio/race-theme.mp3',import.meta.url).href;
  function buffer(){
    const out=context.createBuffer(1,context.sampleRate*2,context.sampleRate),data=out.getChannelData(0);
    let brown=0;for(let i=0;i<data.length;i++){const white=Math.random()*2-1;brown=(brown+.025*white)/1.025;data[i]=white*.65+brown*2;}
    return out;
  }
  function tone(frequency,duration,gain=.1,{type='sine',end=frequency,delay=0}={}){
    const start=context.currentTime+delay,osc=context.createOscillator(),volume=context.createGain();osc.type=type;
    osc.frequency.setValueAtTime(Math.max(12,frequency),start);osc.frequency.exponentialRampToValueAtTime(Math.max(12,end),start+duration);
    volume.gain.setValueAtTime(.0001,start);volume.gain.exponentialRampToValueAtTime(Math.max(.0002,gain),start+.008);volume.gain.exponentialRampToValueAtTime(.0001,start+duration);
    osc.connect(volume);volume.connect(bus);osc.start(start);osc.stop(start+duration+.02);osc.onended=()=>{osc.disconnect();volume.disconnect();};
  }
  function noise(duration,gain=.1,{frequency=800,type='lowpass',end=frequency,delay=0}={}){
    const start=context.currentTime+delay,source=context.createBufferSource(),filter=context.createBiquadFilter(),volume=context.createGain();
    source.buffer=noiseBuffer;filter.type=type;filter.Q.value=.7;filter.frequency.setValueAtTime(frequency,start);filter.frequency.exponentialRampToValueAtTime(Math.max(30,end),start+duration);
    volume.gain.setValueAtTime(.0001,start);volume.gain.linearRampToValueAtTime(gain,start+.006);volume.gain.exponentialRampToValueAtTime(.0001,start+duration);
    source.connect(filter);filter.connect(volume);volume.connect(bus);source.start(start,Math.random()*.5);source.stop(start+duration+.02);
    source.onended=()=>{source.disconnect();filter.disconnect();volume.disconnect();};
  }
  function continuousNoise(frequency,type){
    const source=context.createBufferSource(),filter=context.createBiquadFilter(),volume=context.createGain();source.buffer=noiseBuffer;source.loop=true;
    filter.type=type;filter.frequency.value=frequency;filter.Q.value=.8;volume.gain.value=0;source.connect(filter);filter.connect(volume);volume.connect(bus);source.start();return {source,filter,volume};
  }
  function buildEngine(){
    const input=context.createGain(),filter=context.createBiquadFilter(),volume=context.createGain(),drive=context.createWaveShaper();
    filter.type='lowpass';filter.frequency.value=700;filter.Q.value=.8;volume.gain.value=0;
    const curve=new Float32Array(1024);for(let i=0;i<curve.length;i++){const x=2*i/(curve.length-1)-1;curve[i]=Math.tanh(2*x)/Math.tanh(2);}drive.curve=curve;drive.oversample='2x';
    input.connect(drive);drive.connect(filter);filter.connect(volume);volume.connect(bus);
    const voices=[['sawtooth',1,.26],['triangle',2,.13],['sine',.5,.18]].map(([type,ratio,gain],i)=>{
      const osc=context.createOscillator(),amp=context.createGain();osc.type=type;osc.frequency.value=52*ratio;osc.detune.value=i===1?7:0;amp.gain.value=gain;osc.connect(amp);amp.connect(input);osc.start();return {osc,amp,ratio};
    });
    return {input,filter,volume,drive,voices,wind:continuousNoise(650,'lowpass'),tyres:continuousNoise(2100,'bandpass'),boost:continuousNoise(1700,'highpass')};
  }
  function syncMusic(){
    if(!music)return;
    if(!musicEnabled||paused){music.pause();return;}
    if(music.paused&&!musicFailed){const promise=music.play();promise?.catch(()=>{musicFailed=true;});}
  }
  function unlock(){
    if(!context){
      const Constructor=globalThis.AudioContext||globalThis.webkitAudioContext;if(!Constructor)return;
      try{
        context=new Constructor();bus=context.createGain();bus.gain.value=effectsEnabled&&!paused?.72:0;
        compressor=context.createDynamicsCompressor();compressor.threshold.value=-14;compressor.knee.value=18;compressor.ratio.value=4;compressor.attack.value=.003;compressor.release.value=.18;
        bus.connect(compressor);compressor.connect(context.destination);noiseBuffer=buffer();engine=buildEngine();
        music=new Audio(musicUrl);music.loop=true;music.preload='auto';music.volume=.12;music.addEventListener('error',()=>{musicFailed=true;});
      }catch{context=null;return;}
    }
    context.resume()?.catch(()=>{});musicFailed=false;syncMusic();
  }
  function setEffectsEnabled(value){effectsEnabled=Boolean(value);if(bus)bus.gain.setTargetAtTime(effectsEnabled&&!paused?.72:0,context.currentTime,.03);}
  function setMusicEnabled(value){musicEnabled=Boolean(value);musicFailed=false;syncMusic();}
  function setPaused(value){paused=Boolean(value);if(bus)bus.gain.setTargetAtTime(effectsEnabled&&!paused?.72:0,context.currentTime,.025);syncMusic();}
  function play(kind,strength=1){
    if(!context||!effectsEnabled||paused||context.state==='closed')return;
    const now=context.currentTime,cooldown={collision:.13,scrape:.25,menu:.05,gear:.10,drift:.15,pickup:.08}[kind]??.09;
    if(now-(last.get(kind)??-100)<cooldown)return;last.set(kind,now);strength=clamp(strength,.15,1);
    if(kind==='menu'){tone(650,.055,.045,{end:850});return;}
    if(kind==='count'){tone(480,.12,.11);tone(960,.07,.025);return;}
    if(kind==='go'||kind==='pickup'||kind==='win'){
      const notes=kind==='pickup'?[660,880,1320]:kind==='win'?[523,659,784,1047]:[523,659,784];
      notes.forEach((note,i)=>tone(note,kind==='win'?.42:.19,kind==='pickup'?.12:.15,{delay:i*(kind==='win'?.14:.055)}));
      if(kind==='win')duckUntil=now+2;return;
    }
    if(kind==='finish'){[660,523,440].forEach((note,i)=>tone(note,.35,.10,{delay:i*.15,type:'triangle'}));duckUntil=now+1.5;return;}
    if(kind==='collision'||kind==='hit'){
      tone(125,.24,.22*strength,{end:37,type:'sine'});noise(.19,.23*strength,{frequency:1500,end:200});tone(310,.10,.035*strength,{end:70,type:'triangle'});return;
    }
    if(kind==='scrape'){noise(.2,.07*strength,{type:'bandpass',frequency:900,end:400});return;}
    if(kind==='explosion'){noise(.7,.35,{frequency:1800,end:70});tone(85,.6,.25,{end:22});return;}
    if(kind==='rocket'){noise(.42,.16,{type:'bandpass',frequency:500,end:3000});tone(500,.28,.04,{type:'sawtooth',end:1200});return;}
    if(kind==='turbo'){noise(.55,.095,{type:'highpass',frequency:700,end:2900});tone(210,.3,.075,{type:'triangle',end:650});return;}
    if(kind==='drift'){noise(.19,.08,{type:'bandpass',frequency:1900,end:2600});return;}
    if(kind==='gear'){noise(.065,.035,{frequency:240});return;}
    if(kind==='drop'){noise(.09,.13,{frequency:500});tone(190,.13,.10,{end:85,type:'triangle'});return;}
    if(kind==='shield'){[880,1320,1760].forEach((f,i)=>tone(f,.35,.055,{delay:i*.055}));return;}
    if(kind==='shieldBreak'){noise(.28,.12,{type:'highpass',frequency:2200});tone(1400,.28,.07,{end:300});return;}
    if(kind==='emp'){tone(950,.55,.11,{type:'sawtooth',end:55});noise(.4,.10,{type:'bandpass',frequency:600,end:100});return;}
    if(kind==='oil'){noise(.45,.08,{type:'bandpass',frequency:650,end:1400});tone(240,.4,.035,{end:100,type:'triangle'});}
  }
  function update(r,{phase:nextPhase='select',paused:nextPaused=false,dt=.016,throttle=false,brake=false}={}){
    if(!context||!engine)return;
    if(nextPaused!==paused)setPaused(nextPaused);
    if(phase!==nextPhase){phase=nextPhase;syncMusic();}
    const now=context.currentTime,active=Boolean(r)&&!paused&&(phase==='race'||phase==='countdown');
    const speed=active?Math.abs(r.currentSpeed):0,tuning=r?.tuning??{maxSpeed:42,boostSpeed:59},ratio=clamp(speed/tuning.boostSpeed,0,1);
    const gear=Math.min(5,1+Math.floor(speed/(tuning.maxSpeed/5))),rev=gear===5?clamp(.5+ratio*.5,0,1):.34+.66*((speed/(tuning.maxSpeed/5))%1);
    if(active&&gear!==lastGear){gearDip=.13;if(speed>8)play('gear');}lastGear=gear;gearDip=Math.max(0,gearDip-dt);
    const pitch=(r?.id==='se1t'?.81:r?.id==='textured_00002'?1.13:1),rpm=(44+rev*104+(throttle?12:0)+(r?.boosting?28:0))*pitch*(gearDip>0?.79:1);
    engine.voices.forEach(v=>v.osc.frequency.setTargetAtTime(rpm*v.ratio,now,.06));
    engine.filter.frequency.setTargetAtTime(420+ratio*1800+(throttle?550:0),now,.08);
    engine.volume.gain.setTargetAtTime(active?(phase==='countdown'?.07:.15+ratio*.13+(throttle?.08:0)):0,now,.10);
    engine.wind.volume.gain.setTargetAtTime(active?ratio*ratio*.06:0,now,.12);
    engine.tyres.volume.gain.setTargetAtTime(active&&speed>9&&(r.drifting||brake)?(.035+ratio*.055):0,now,.05);
    engine.tyres.filter.frequency.setTargetAtTime(1500+ratio*1700,now,.08);
    engine.boost.volume.gain.setTargetAtTime(active&&r.boosting?.055:0,now,.08);
    if(active&&r.boosting&&!startedBoost)play('turbo');startedBoost=active&&r.boosting;
    if(music){const target=musicEnabled&&!paused?(now<duckUntil?.055:phase==='race'?.18:phase==='countdown'?.13:.09):0;music.volume=clamp(music.volume+(target-music.volume)*(1-Math.exp(-dt*4)),0,1);}
  }
  function dispose(){music?.pause();context?.close();context=null;engine=null;}
  return {unlock,play,update,setPaused,setEffectsEnabled,setMusicEnabled,dispose};
}
