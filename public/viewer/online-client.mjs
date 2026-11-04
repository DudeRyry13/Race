import {createInputInbox} from './online-input.mjs?build=online-v17';
import {createPeerLink} from './online-peer.mjs?build=online-v17';
export const ONLINE_PROTOCOL='babylon-online-v1';
const hosted=globalThis.location?.protocol==='https:'||globalThis.document?.documentElement?.dataset?.hosted==='true';
const configuredServer=globalThis.document?.documentElement?.dataset?.onlineServer;
export const DEFAULT_ONLINE_SERVER=configuredServer||(hosted?globalThis.location.origin:'https://race-yx4w.onrender.com');
export const INPUT={gas:1,brake:2,left:4,right:8,boost:16,drift:32,use:64,drop:128};
export function decodeInput(mask=0){return Object.fromEntries(Object.entries(INPUT).map(([key,bit])=>[key,!!(mask&bit)]));}
export function encodeInput(input){return Object.entries(INPUT).reduce((mask,[key,bit])=>mask|(input[key]?bit:0),0);}
export function parseInvite(value){
  const url=new URL(value.trim()),fragment=new URLSearchParams(url.hash.slice(1));
  if(!(url.protocol==='https:'||(url.protocol==='http:'&&['localhost','127.0.0.1'].includes(url.hostname))))throw Error('Нужна HTTPS-ссылка комнаты.');
  const room=fragment.get('room'),key=fragment.get('key');
  if(!/^[a-f0-9]{12}$/.test(room??'')||!/^[a-f0-9]{48}$/.test(key??''))throw Error('В ссылке нет ключа комнаты. Скопируй её целиком.');
  const server=new URL(fragment.get('server')||url.origin);
  if(!(server.protocol==='https:'||(server.protocol==='http:'&&['localhost','127.0.0.1'].includes(server.hostname))))throw Error('В приглашении указан неподдерживаемый сервер.');
  return (server.protocol==='https:'?'wss://':'ws://')+server.host+'/ws?role=guest&room='+room+'&token='+key;
}
export function inviteForPage(value,pageUrl=globalThis.location?.href){
  const original=new URL(value),page=pageUrl?new URL(pageUrl):null;
  // Downloaded local copies keep the server's public link. Hosted copies keep
  // the player on the game site while the room service may live elsewhere.
  if(!page||page.protocol!=='https:'||page.origin===original.origin)return original.href;
  const shared=new URL('./',page),fragment=new URLSearchParams(original.hash.slice(1));
  fragment.set('server',original.origin);shared.hash=fragment.toString();return shared.href;
}
export function createOnlineClient({heroIds,getSelection,onRoom,onStart,onState,onEvent,onLobby,onPause,onDisconnect}){
  const $=id=>document.getElementById(id);
  let socket=null,role=null,room=null,race='',invite='',heartbeat=null,ping=0,closed=true,pending=[],outgoing=[],sequence=0,
    action=0,lastSend=0,lastSnapshot=0,lastSeen=0,lastSelection='',status='Одиночная игра',
    receive=()=>{},peerPing=0,peerOffset=0,bestPeerPing=Infinity,snapshotSequence=0,receivedSnapshot=0,lastInputMask=-1,lastPhase='';
  const inbox=createInputInbox();
  const peer=createPeerLink({signal:signal=>send({type:'signal',signal}),onPacket:m=>receive(m,true),onChange:()=>{
    peerPing=0;bestPeerPing=Infinity;peerOffset=0;render();
  }});
  const gameSend=(packet,important=false)=>{
    if(peer.ready){if(peer.send(packet,important))return;if(!important)return;}
    send(packet);
  };
  function ensurePeer(){if(role==='host'&&room?.players.filter(Boolean).length===2&&!peer.exists)peer.begin();}
  function latencyText(){
    const value=peerPing||(!peer.ready?ping:0);
    return (peer.ready?'НАПРЯМУЮ':'ЧЕРЕЗ СЕРВЕР')+(value?' · '+Math.round(value)+' мс':' · соединяемся');
  }
  const send=data=>{if(socket?.readyState===1&&socket.bufferedAmount<262144)socket.send(JSON.stringify(data));};
  const own=()=>room?.players.find(p=>p?.role===role);
  function render(){
    const active=!!role,peers=room?.players??[];
    $('onlineCreate').disabled=active;$('onlineJoin').disabled=active;$('onlineLeave').hidden=!active;
    $('onlineReady').hidden=!active;$('onlineReady').disabled=!getSelection().loaded||!own()?.loaded||room?.phase==='race';
    $('onlineReady').textContent=own()?.ready?'ГОТОВ ✓':'ГОТОВ';
    $('onlineStatus').textContent=status+(active?' · '+latencyText():'');
    $('onlineLatency').hidden=!active;$('onlineLatency').textContent=active?latencyText():'';
    $('onlineLatency').dataset.transport=peer.ready?'direct':'relay';
    $('onlineInvite').hidden=!invite;$('onlineInvite').value=invite;$('onlineCopy').hidden=!invite;
    $('onlinePlayers').textContent=active?peers.filter(Boolean).map(p=>(p.role===role?'Ты':'Соперник')+': '+(p.ready?'готов':p.loaded?'выбирает героя':'загружает трассу')).join(' · '):'Два игрока + семь ботов. У каждого должна быть эта версия игры.';
    if(!active)return;
    const guest=role==='guest';
    for(const b of $('trackGrid').querySelectorAll('button'))b.disabled=guest||!getSelection().loaded;
    for(const b of $('difficultyGrid').querySelectorAll('button'))b.disabled=guest||!getSelection().loaded;
    const taken=peers.find(p=>p&&p.role!==role)?.hero;
    for(const b of $('heroGrid').querySelectorAll('button'))b.disabled=b.dataset.hero===taken;
    $('podiumPreview').disabled=true;
    $('startRace').disabled=guest||peers.filter(p=>p?.ready&&p.loaded).length!==2||!getSelection().loaded;
    $('startRace').textContent=guest?'СТАРТУЕТ СОЗДАТЕЛЬ КОМНАТЫ':'НА СТАРТ ВДВОЁМ';
  }
  function clearTimers(){clearInterval(heartbeat);heartbeat=null;}
  async function leave(){
    closed=true;clearTimers();socket?.close();socket=null;role=null;room=null;race='';invite='';
    pending=[];outgoing=[];inbox.reset();peer.close();lastSelection='';status='Одиночная игра';render();
    for(const b of [...$('heroGrid').querySelectorAll('button'),...$('trackGrid').querySelectorAll('button'),...$('difficultyGrid').querySelectorAll('button')])b.disabled=!getSelection().loaded;
    $('podiumPreview').disabled=!getSelection().loaded;$('startRace').disabled=!getSelection().loaded;$('startRace').textContent='НА СТАРТ';
    onDisconnect();
  }
  function connect(url,asRole,started=performance.now()){
    clearInterval(heartbeat);
    lastSeen=performance.now();
    closed=false;role=asRole;status='Подключаемся…';socket=new WebSocket(url);render();
    receive=async(m,viaPeer=false)=>{
      if(!m||typeof m!=='object')return;
      lastSeen=performance.now();
      if(m.type==='signal'){peer.accept(m.signal);return;}
      if(m.type==='linkPing'){gameSend({type:'linkPong',time:m.time,remoteTime:performance.now(),route:m.route});return;}
      if(m.type==='linkPong'){
        if(m.route!==(peer.ready?'direct':'relay'))return;
        const now=performance.now(),rtt=now-m.time;
        if(rtt>=0&&rtt<10000){
          peerPing=peerPing?peerPing*.75+rtt*.25:rtt;
          if(rtt<bestPeerPing){bestPeerPing=rtt;peerOffset=m.remoteTime-(m.time+now)/2;}
          render();
        }
        return;
      }
      if(m.type==='welcome'){
        if(m.room.protocol!==ONLINE_PROTOCOL){status='Версии игры отличаются.';render();return;}
        room=m.room;role=m.role;
        const current=getSelection(),other=room.players.find(p=>p&&p.role!==role);
        const hero=current.hero===other?.hero?heroIds.find(id=>id!==other.hero):current.hero;
        await onRoom(room,role,hero);selectionChanged({hero});ensurePeer();status=role==='host'?'Ссылка готова — отправь её второму игроку':'Ты в комнате';render();
      }else if(m.type==='room'){
        room=m.room;await onRoom(room,role);ensurePeer();render();
      }else if(m.type==='start'){
        race=m.race;room=m.room;pending=[];outgoing=[];inbox.reset();sequence=action=snapshotSequence=receivedSnapshot=0;lastInputMask=-1;lastPhase='';lastSnapshot=0;
        onStart(m);render();
      }else if(m.type==='input'&&role==='host'&&m.race===race){
        inbox.receive(m.frames);
      }else if(m.type==='state'&&role==='guest'&&m.race===race){
        if(Number.isSafeInteger(m.snapshot)&&m.snapshot<=receivedSnapshot)return;
        receivedSnapshot=m.snapshot??receivedSnapshot;
        const estimated=Number.isFinite(bestPeerPing)&&Number.isFinite(m.sentAt)?(performance.now()+peerOffset-m.sentAt)/1000:(peerPing?peerPing/2000:ping/1000);
        m.transitSeconds=Math.max(0,Math.min(.25,estimated));onState(m);
      }
      else if(m.type==='event'&&role==='guest'&&m.race===race)onEvent(m.event);
      else if(m.type==='lobby'){race='';pending=[];inbox.reset();onLobby();}
      else if(m.type==='pause'||m.type==='pauseRequest'){onPause(!!m.paused,m.type==='pauseRequest');}
      else if(m.type==='pong'){ping=performance.now()-m.time;render();}
      else if(m.type==='peerLeft'){race='';pending=[];inbox.reset();peer.close();status='Соперник отключился. Ожидаем подключения.';onLobby();render();}
      else if(m.type==='error'){status=m.message;render();}
    };
    socket.onmessage=event=>{try{receive(JSON.parse(event.data)).catch(()=>{});}catch{}};
    socket.onclose=()=>{if(!closed){
      if(asRole==='guest'&&!room&&performance.now()-started<30000){
        status='Ждём, пока сервер комнаты станет доступен…';render();
        setTimeout(()=>{if(!closed)connect(url,asRole,started);},1500);return;
      }
      status='Соединение прервано. Подключись заново.';leave().then(()=>{status='Соединение прервано. Создай комнату или подключись заново.';render();});
    }};
    socket.onerror=()=>{status='Не удалось подключиться. Проверь ссылку и окно запуска у создателя.';render();};
    heartbeat=setInterval(()=>{
      send({type:'ping',time:performance.now()});
      if(room?.players.filter(Boolean).length===2){gameSend({type:'linkPing',time:performance.now(),route:peer.ready?'direct':'relay'});ensurePeer();}
      if(lastSeen&&performance.now()-lastSeen>15000)socket?.close();
    },1000);
  }
  function selectionChanged(overrides={}){
    if(!role)return;
    const selected={...getSelection(),...overrides};
    const payload={type:'profile',protocol:ONLINE_PROTOCOL,...selected};
    const key=JSON.stringify(payload);if(key!==lastSelection){lastSelection=key;send(payload);}
    render();
  }
  $('onlineCreate').onclick=async()=>{
    $('onlineCreate').disabled=true;status='Открываем комнату…';$('onlineStatus').textContent=status;
    try{
      const address=$('onlineServer').value.trim()||DEFAULT_ONLINE_SERVER;
      $('onlineServer').value=address;
      {
        const base=new URL(address);
        if(!(base.protocol==='https:'||(base.protocol==='http:'&&['localhost','127.0.0.1'].includes(base.hostname))))throw Error('Укажи HTTPS-адрес сервера.');
        status='Подключаемся к серверу. После простоя он может просыпаться около минуты.';$('onlineStatus').textContent=status;
        const response=await fetch(base.origin+'/api/online/create',{method:'POST',signal:AbortSignal.timeout(120000)});
        if(!response.ok)throw Error('Сервер не создал комнату. Проверь адрес и попробуй снова.');
        const data=await response.json();if(data.protocol!==ONLINE_PROTOCOL||!data.invite)throw Error('Это сервер другой версии игры.');
        localStorage.setItem('babylon-online-server',base.origin);invite=inviteForPage(data.invite);connect(data.hostUrl,'host');
        status='Ссылка готова — отправь её второму игроку';render();return;
      }
    }catch(e){status=e.message;render();}
  };
  $('onlineJoin').onclick=()=>{
    try{connect(parseInvite($('onlineAddress').value),'guest');}catch(e){status=e.message;render();}
  };
  $('onlineLeave').onclick=leave;
  $('onlineReady').onclick=()=>send({type:'ready',ready:!own()?.ready});
  const savedServer=localStorage.getItem('babylon-online-server')?.trim();
  const previousDefault=localStorage.getItem('babylon-online-default')||'https://race-pyfw.onrender.com';
  const configuredServer=savedServer&&savedServer!==previousDefault?savedServer:DEFAULT_ONLINE_SERVER;
  $('onlineServer').value=configuredServer;
  localStorage.setItem('babylon-online-default',DEFAULT_ONLINE_SERVER);
  localStorage.setItem('babylon-online-server',configuredServer);
  $('onlineCopy').onclick=async()=>{try{await navigator.clipboard.writeText(invite);status='Ссылка скопирована';}catch{$('onlineInvite').select();document.execCommand('copy');}render();};
  render();
  if(globalThis.location?.hash.includes('room=')){
    try{const url=parseInvite(globalThis.location.href);connect(url,'guest');}catch(e){status=e.message;render();}
  }
  return {
    get active(){return !!role;},get isHost(){return role==='host';},get isGuest(){return role==='guest';},
    get remoteId(){return room?.players.find(p=>p&&p.role!==role)?.hero;},get hostId(){return room?.players.find(p=>p?.role==='host')?.hero;},
    get running(){return !!race;},get room(){return room;},get ack(){return inbox.ack;},
    get metrics(){return {direct:peer.ready,serverRtt:ping,peerRtt:peerPing,pending:pending.length};},
    selectionChanged,render,leave,
    start(){send({type:'start'});},
    lobby(){if(role==='host')send({type:'lobby'});},
    pause(paused){send({type:role==='host'?'pause':'pauseRequest',paused});},
    action(backward){action|=backward?128:64;},
    record(dt,input){
      const frame=[++sequence,dt,encodeInput(input)|action];action=0;
      pending.push(frame);outgoing.push(frame);
      if(outgoing.length>6)outgoing.shift();
      if(pending.length>360){socket?.close();return;}
      if(performance.now()-lastSend>16||frame[2]!==lastInputMask||frame[2]&192){
        // Repeat recent steering samples on the lossy channel. Item actions also
        // use the reliable channel and are deduplicated by their input sequence.
        gameSend({type:'input',race,frames:outgoing.slice(-4)});
        if(frame[2]&192)gameSend({type:'input',race,frames:[frame]},true);
        lastInputMask=frame[2];lastSend=performance.now();
      }
      return frame;
    },
    nextInput(){
      return decodeInput(inbox.take());
    },
    reconcile(receivedAck){pending=pending.filter(f=>f[0]>receivedAck);return pending;},
    publish(state,force=false){
      if(role!=='host'||!race||(!force&&performance.now()-lastSnapshot<(peer.ready?33:50)))return;
      lastSnapshot=performance.now();
      const value=typeof state==='function'?state():state;
      const packet={type:'state',race,ack:inbox.ack,...value,snapshot:++snapshotSequence,sentAt:performance.now()};
      if(peer.ready&&value.phase!==lastPhase)send(packet);
      lastPhase=value.phase;gameSend(packet,value.phase==='finished');
    },
    event(event){if(role==='host'&&race)gameSend({type:'event',race,event},true);}
  };
}
