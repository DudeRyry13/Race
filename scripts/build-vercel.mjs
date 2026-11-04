import {cp,mkdir,readFile,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {resolve,join,relative,isAbsolute,sep} from 'node:path';

const root=fileURLToPath(new URL('../',import.meta.url));
const source=resolve(root,'public');
const output=resolve(root,process.env.BABYLON_STATIC_OUTPUT||'dist-vercel');
const server=new URL(process.env.ONLINE_SERVER_URL||'https://race-yx4w.onrender.com');
if(server.protocol!=='https:'||server.username||server.password)throw Error('ONLINE_SERVER_URL must be a public HTTPS server URL.');
const contains=(parent,child)=>{const path=relative(parent,child);return path===''||(!isAbsolute(path)&&path!=='..'&&!path.startsWith('..'+sep));};
if(contains(source,output)||contains(output,source))throw Error('Build output must be separate from public.');
await mkdir(output,{recursive:true});
await cp(source,output,{recursive:true,filter:path=>!path.endsWith('.br')&&!path.endsWith('.gz')});
const index=join(output,'viewer','index.html');
const html=await readFile(index,'utf8');
await writeFile(index,html.replace(/<html\b[^>]*>/i,'<html lang="ru" data-hosted="true" data-online-server="'+server.origin+'">'));
console.log('Vercel static game prepared. Room service: '+server.origin);
