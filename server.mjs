import http from 'node:http';
import {randomBytes,timingSafeEqual} from 'node:crypto';
import {WebSocketServer,WebSocket} from 'ws';
import {fileURLToPath} from 'node:url';
import {createStaticHandler} from './static-files.mjs';

const PROTOCOL='babylon-online-v1',PORT=Number(process.env.PORT)||3000,rooms=new Map(),limits=new Map();
const serveStatic=createStaticHandler(fileURLToPath(new URL('./public/',import.meta.url)));
const heroes=new Set(['mensari','monster','se1t','textured_00002','textured_00004','haakon','leona','mara','geekaton']);
const tracks=new Set(['app1','app2','app3','app4']),levels=new Set(['easy','medium','hard']);
const secret=bytes=>randomBytes(bytes).toString('hex');
const equal=(a,b)=>typeof a==='string'&&typeof b==='string'&&a.length===b.length&&timingSafeEqual(Buffer.from(a),Buffer.from(b));
const players=room=>[room.host,room.guest].filter(Boolean);
const publicRoom=room=>({id:room.id,track:room.track,difficulty:room.difficulty,phase:room.phase,race:room.race,protocol:PROTOCOL,
  players:[room.host,room.guest].map(p=>p?{role:p.role,hero:p.hero,loaded:p.loaded,ready:p.ready}:null)});
const send=(peer,data)=>{
  if(peer?.ws.readyState===WebSocket.OPEN){
    if(peer.ws.bufferedAmount>262144){peer.ws.close(1013,'Slow connection');return;}
    peer.ws.send(typeof data==='string'?data:JSON.stringify(data));
  }
};
const broadcast=(room,data)=>players(room).forEach(p=>send(p,data));
const update=room=>broadcast(room,{type:'room',room:publicRoom(room)});
function reply(res,status,data){
  res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store',
    'Access-Control-Allow-Origin':'*','Access-Control-Allow-Methods':'GET,POST,OPTIONS','Access-Control-Allow-Headers':'Content-Type'});
  res.end(JSON.stringify(data));
}
function originFor(req){
  if(process.env.PUBLIC_URL||process.env.RENDER_EXTERNAL_URL)return new URL(process.env.PUBLIC_URL||process.env.RENDER_EXTERNAL_URL).origin;
  const host=req.headers.host??'localhost:'+PORT;
  return new URL((host.startsWith('localhost:')||host.startsWith('127.0.0.1:')?'http:':'https:')+'//'+host).origin;
}
const server=http.createServer((req,res)=>{
  const path=new URL(req.url,'http://localhost').pathname;
  if(req.method==='OPTIONS')return reply(res,204,{});
  if(path==='/health'&&req.method==='GET')return reply(res,200,{game:'Babylon Racing',protocol:PROTOCOL,status:'ready',networkVersion:2,webVersion:21,region:process.env.GAME_REGION??null});
  if(path==='/api/online/create'&&req.method==='POST'){
    const ip=(req.headers['x-forwarded-for']??req.socket.remoteAddress??'local').toString().split(',')[0],now=Date.now();
    const entry=limits.get(ip)??{at:now,count:0};if(now-entry.at>60000){entry.at=now;entry.count=0;}limits.set(ip,entry);
    if(++entry.count>8||rooms.size>=500)return reply(res,429,{error:'Слишком много комнат. Попробуй через минуту.'});
    const room={id:secret(6),key:secret(24),hostKey:secret(24),host:null,guest:null,track:'app1',difficulty:'easy',phase:'lobby',race:'',lastSeen:now};
    rooms.set(room.id,room);
    const origin=originFor(req),wsOrigin=origin.replace(/^http/,'ws');
    return reply(res,200,{protocol:PROTOCOL,hostUrl:wsOrigin+'/ws?role=host&room='+room.id+'&token='+room.hostKey,
      invite:origin+'/viewer/#room='+room.id+'&key='+room.key});
  }
  serveStatic(req,res,new URL(req.url,'http://localhost')).catch(()=>{if(!res.headersSent)reply(res,500,{error:'file_error'});else res.destroy();});
});
const wss=new WebSocketServer({noServer:true,maxPayload:196608,perMessageDeflate:false});
server.on('upgrade',(req,socket,head)=>{
  const url=new URL(req.url,'http://localhost'),room=rooms.get(url.searchParams.get('room')),role=url.searchParams.get('role');
  const reject=code=>{socket.end('HTTP/1.1 '+code+' Rejected\r\nConnection: close\r\nContent-Length: 0\r\n\r\n');};
  if(url.pathname!=='/ws'||!room||!['host','guest'].includes(role)||!equal(url.searchParams.get('token'),role==='host'?room.hostKey:room.key))return reject(403);
  if(room[role])return reject(409);
  wss.handleUpgrade(req,socket,head,ws=>{
    req.socket.setNoDelay(true);
    const peer={ws,role,hero:role==='host'?'mensari':room.host?.hero==='monster'?'mensari':'monster',loaded:false,ready:false,alive:true,window:Date.now(),count:0};
    room[role]=peer;room.lastSeen=Date.now();ws.on('pong',()=>peer.alive=true);
    send(peer,{type:'welcome',role,room:publicRoom(room)});update(room);
    ws.on('message',(raw,binary)=>{
      if(binary)return ws.close(1003,'JSON only');
      const now=Date.now();if(now-peer.window>1000){peer.window=now;peer.count=0;}if(++peer.count>150)return ws.close(1008,'Rate limit');
      let m;try{m=JSON.parse(raw.toString());}catch{return ws.close(1007,'Invalid JSON');}
      if(!m||typeof m!=='object'||Array.isArray(m))return;
      room.lastSeen=now;
      const other=role==='host'?room.guest:room.host;
      if(m.type==='ping')return send(peer,{type:'pong',time:m.time});
      if(['signal','linkPing','linkPong'].includes(m.type)&&raw.length<40000)return send(other,raw.toString());
      if(m.type==='profile'){
        if(m.protocol!==PROTOCOL)return send(peer,{type:'error',message:'Версии игры отличаются. Обновите обе копии.'});
        if(room.phase==='race'||!heroes.has(m.hero))return;
        if(m.hero===other?.hero)return send(peer,{type:'error',message:'Этот гонщик уже выбран вторым игроком.'});
        if(peer.hero!==m.hero||!m.loaded)peer.ready=false;
        peer.hero=m.hero;peer.loaded=m.loaded===true;
        if(role==='host'&&tracks.has(m.track)&&levels.has(m.difficulty)&&(room.track!==m.track||room.difficulty!==m.difficulty)){
          room.track=m.track;room.difficulty=m.difficulty;peer.ready=false;if(other){other.ready=false;other.loaded=false;}
        }
        return update(room);
      }
      if(m.type==='ready'&&room.phase!=='race'){peer.ready=peer.loaded&&m.ready===true;return update(room);}
      if(m.type==='start'&&role==='host'){
        if(!room.host?.ready||!room.guest?.ready||!room.host.loaded||!room.guest.loaded||room.host.hero===room.guest.hero)
          return send(peer,{type:'error',message:'Оба игрока должны загрузить трассу и нажать «Готов».'});
        room.phase='race';room.race=secret(8);broadcast(room,{type:'start',race:room.race,room:publicRoom(room)});return update(room);
      }
      if(m.type==='lobby'&&role==='host'){
        room.phase='lobby';players(room).forEach(p=>p.ready=false);broadcast(room,{type:'lobby'});return update(room);
      }
      if(m.type==='input'&&role==='guest'&&room.phase==='race'&&m.race===room.race&&raw.length<=24000)return send(other,raw.toString());
      if(m.type==='state'&&role==='host'&&m.race===room.race){
        if(m.phase==='finished'&&room.phase!=='finished'){room.phase='finished';update(room);}
        return send(other,raw.toString());
      }
      if(m.type==='event'&&role==='host'&&m.race===room.race)return send(other,raw.toString());
      if(m.type==='pause'&&role==='host'||m.type==='pauseRequest'&&role==='guest')send(other,raw.toString());
    });
    ws.on('error',()=>{});
    ws.on('close',()=>{
      if(rooms.get(room.id)!==room)return;
      room[role]=null;
      if(role==='host'){rooms.delete(room.id);room.guest?.ws.close(1001,'Host left');}
      else{room.phase='lobby';if(room.host)room.host.ready=false;broadcast(room,{type:'peerLeft',role});update(room);}
    });
  });
});
const timer=setInterval(()=>{
  for(const room of rooms.values()){
    if(Date.now()-room.lastSeen>600000){players(room).forEach(p=>p.ws.close(1001,'Expired'));rooms.delete(room.id);continue;}
    for(const p of players(room)){if(!p.alive){p.ws.terminate();continue;}p.alive=false;p.ws.ping();}
  }
  for(const [ip,v] of limits)if(Date.now()-v.at>120000)limits.delete(ip);
},20000);
timer.unref();
server.listen(PORT,'0.0.0.0',()=>console.log('Babylon Racing room server listening on port '+PORT));
function shutdown(){clearInterval(timer);for(const room of rooms.values())players(room).forEach(p=>p.ws.close(1001,'Server restarting'));server.close();setTimeout(()=>process.exit(),1500).unref();}
process.on('SIGTERM',shutdown);process.on('SIGINT',shutdown);
