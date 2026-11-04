// Only signaling uses the room server. No microphone/camera is requested.
export function createPeerLink({signal,onPacket,onChange=()=>{},PeerConnection=globalThis.RTCPeerConnection}){
  let pc=null,epoch=null,pending=[],fast=null,reliable=null,initiator=false;
  const ready=()=>pc?.connectionState==='connected'&&fast?.readyState==='open'&&reliable?.readyState==='open';
  function close(){
    const old=pc;pc=null;fast=reliable=null;epoch=null;pending=[];
    if(old){old.onconnectionstatechange=null;old.onicecandidate=null;old.close();}
    onChange(false);
  }
  function bind(channel){
    if(channel.label==='race-state')fast=channel;
    else if(channel.label==='race-control')reliable=channel;
    else{channel.close();return;}
    channel.onopen=channel.onclose=()=>onChange(ready());
    channel.onerror=()=>{};
    channel.onmessage=event=>{
      if(typeof event.data!=='string'||event.data.length>196608)return;
      try{onPacket(JSON.parse(event.data));}catch{}
    };
  }
  function setup(id,host){
    epoch=id;initiator=host;
    const connection=pc=new PeerConnection({iceServers:[
      {urls:'stun:stun.l.google.com:19302'},
      {urls:'stun:stun.cloudflare.com:3478'}
    ],bundlePolicy:'max-bundle'});
    connection.onicecandidate=event=>{
      if(pc===connection&&event.candidate)signal({epoch:id,candidate:event.candidate.toJSON()});
    };
    connection.ondatachannel=event=>{if(pc===connection)bind(event.channel);};
    connection.onconnectionstatechange=()=>{
      if(pc!==connection)return;
      if(['failed','closed'].includes(connection.connectionState))close();
      else onChange(ready());
    };
    if(host){
      bind(connection.createDataChannel('race-state',{ordered:false,maxRetransmits:0}));
      bind(connection.createDataChannel('race-control',{ordered:true}));
    }
    return connection;
  }
  async function begin(){
    if(!PeerConnection||pc)return;
    const id=Date.now().toString(36)+'-'+Math.random().toString(36).slice(2),connection=setup(id,true);
    try{
      await connection.setLocalDescription(await connection.createOffer());
      if(pc===connection)signal({epoch:id,description:connection.localDescription.toJSON()});
    }catch{if(pc===connection)close();}
  }
  async function accept(message){
    if(!PeerConnection||!message||typeof message.epoch!=='string')return;
    try{
      if(message.description){
        const d=message.description;if(!['offer','answer'].includes(d.type)||typeof d.sdp!=='string'||d.sdp.length>32768)return;
        if(d.type==='offer'){
          if(pc&&epoch!==message.epoch)close();
          const connection=pc??setup(message.epoch,false);
          await connection.setRemoteDescription(d);
          for(const candidate of pending.splice(0))await connection.addIceCandidate(candidate);
          await connection.setLocalDescription(await connection.createAnswer());
          if(pc===connection)signal({epoch,description:connection.localDescription.toJSON()});
        }else if(pc&&initiator&&epoch===message.epoch){
          const connection=pc;await connection.setRemoteDescription(d);
          for(const candidate of pending.splice(0))await connection.addIceCandidate(candidate);
        }
      }else if(message.candidate){
        if(epoch&&epoch!==message.epoch)return;
        if(!epoch)epoch=message.epoch;
        if(pc?.remoteDescription)await pc.addIceCandidate(message.candidate);
        else if(pending.length<64)pending.push(message.candidate);
      }
    }catch{onChange(false);}
  }
  return {
    begin,accept,close,get ready(){return ready();},get exists(){return !!pc;},
    send(packet,important=false){
      if(!ready())return false;
      const channel=important?reliable:fast;
      if(channel.bufferedAmount>(important?65536:16384))return false;
      try{channel.send(JSON.stringify(packet));return true;}catch{return false;}
    }
  };
}
