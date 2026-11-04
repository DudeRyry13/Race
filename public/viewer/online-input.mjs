// Steering is a current state, not a FIFO of every rendered frame.
// Keep one-shot actions separately so discarding old motion cannot lose a shot.
export function createInputInbox(now=()=>performance.now()){
  let newest=0,applied=0,mask=0,received=-Infinity,actions=0;
  const actionIds=new Set();
  return {
    receive(frames){
      let accepted=false;
      for(const f of (Array.isArray(frames)?frames:[]).slice(0,12)){
        if(!Array.isArray(f)||!Number.isSafeInteger(f[0])||f[0]<=0||!Number.isFinite(f[1])||!Number.isInteger(f[2])||f[2]<0||f[2]>255)continue;
        if((f[2]&192)&&f[0]>newest-256&&!actionIds.has(f[0])){
          actionIds.add(f[0]);actions|=f[2]&192;
        }
        if(f[0]>newest){newest=f[0];mask=f[2]&63;received=now();accepted=true;}
      }
      if(actionIds.size>256)for(const id of actionIds)if(id<newest-256)actionIds.delete(id);
      return accepted;
    },
    take(){
      applied=newest;
      const value=(now()-received<350?mask:0)|actions;actions=0;return value;
    },
    get ack(){return applied;},
    reset(){newest=applied=mask=actions=0;received=-Infinity;actionIds.clear();}
  };
}
