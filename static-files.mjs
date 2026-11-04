import {createReadStream} from 'node:fs';
import {stat} from 'node:fs/promises';
import {resolve,sep,extname} from 'node:path';

const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.mjs':'text/javascript; charset=utf-8',
  '.css':'text/css; charset=utf-8','.json':'application/json; charset=utf-8','.glb':'model/gltf-binary',
  '.wasm':'application/wasm','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.webp':'image/webp',
  '.svg':'image/svg+xml','.mp3':'audio/mpeg','.ogg':'audio/ogg','.txt':'text/plain; charset=utf-8','.md':'text/markdown; charset=utf-8'};
const accepts=(header,name)=>header.split(',').some(part=>{
  const [encoding,...options]=part.trim().split(';');
  return encoding===name&&!options.some(o=>/^q\s*=\s*0(?:\.0*)?$/.test(o.trim()));
});
export function createStaticHandler(directory){
  const root=resolve(directory);
  return async function serve(req,res,url){
    if(!['GET','HEAD'].includes(req.method)){res.writeHead(405,{Allow:'GET, HEAD'});res.end();return;}
    if(url.pathname==='/'||url.pathname==='/viewer'){
      res.writeHead(302,{Location:'/viewer/','Cache-Control':'no-store'});res.end();return;
    }
    let path;
    try{path=decodeURIComponent(url.pathname);}catch{res.writeHead(400);res.end();return;}
    if(path.includes('\0')||path.includes('\\')||path.split('/').some(p=>p==='..'||p.startsWith('.'))){res.writeHead(404);res.end();return;}
    if(path.endsWith('/'))path+='index.html';
    const file=resolve(root,'.'+path);
    if(!file.startsWith(root+sep)){res.writeHead(404);res.end();return;}
    let info;
    try{info=await stat(file);if(!info.isFile())throw Error();}catch{res.writeHead(404);res.end();return;}
    const etag='W/"'+info.size.toString(16)+'-'+Math.trunc(info.mtimeMs).toString(16)+'"';
    const html=extname(file)==='.html';
    const versioned=['build','race','art'].some(key=>url.searchParams.has(key));
    const headers={'Content-Type':mime[extname(file)]??'application/octet-stream','X-Content-Type-Options':'nosniff',
      'Cache-Control':html?'no-cache':versioned?'public, max-age=31536000, immutable':'public, max-age=3600, must-revalidate',
      ETag:etag,'Last-Modified':info.mtime.toUTCString(),'Accept-Ranges':'bytes',Vary:'Accept-Encoding'};
    if(req.headers['if-none-match']?.split(',').map(v=>v.trim()).includes(etag)){
      res.writeHead(304,headers);res.end();return;
    }
    const ifRange=req.headers['if-range'];
    const range=req.headers.range&&(!ifRange||ifRange===info.mtime.toUTCString())?req.headers.range:null;
    if(range){
      const match=/^bytes=(\d*)-(\d*)$/.exec(range);
      let start,end;
      if(match&&(match[1]||match[2])){
        start=match[1]?Number(match[1]):Math.max(0,info.size-Number(match[2]));
        end=match[1]?(match[2]?Math.min(Number(match[2]),info.size-1):info.size-1):info.size-1;
      }
      if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start<0||start>end||start>=info.size){
        res.writeHead(416,{...headers,'Content-Range':'bytes */'+info.size});res.end();return;
      }
      res.writeHead(206,{...headers,'Content-Length':end-start+1,'Content-Range':`bytes ${start}-${end}/${info.size}`});
      if(req.method==='HEAD'){res.end();return;}
      stream(file,req,res,{start,end});return;
    }
    let source=file,size=info.size;
    for(const [encoding,suffix] of [['br','.br'],['gzip','.gz']]){
      if(!accepts(req.headers['accept-encoding']??'',encoding))continue;
      try{const compressed=await stat(file+suffix);if(compressed.isFile()){source=file+suffix;size=compressed.size;headers['Content-Encoding']=encoding;break;}}catch{}
    }
    res.writeHead(200,{...headers,'Content-Length':size});
    if(req.method==='HEAD'){res.end();return;}
    stream(source,req,res);
  };
}
function stream(file,req,res,options){
  const body=createReadStream(file,options);
  body.on('error',()=>res.destroy());res.on('close',()=>body.destroy());body.pipe(res);
}
