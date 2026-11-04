import {readdir,readFile,writeFile,stat} from 'node:fs/promises';
import {resolve,extname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {brotliCompress,constants} from 'node:zlib';
import {promisify} from 'node:util';

const root=fileURLToPath(new URL('../public/',import.meta.url)),compress=promisify(brotliCompress);
const types=new Set(['.html','.js','.mjs','.css','.json','.svg','.wasm']);
let total=0,saved=0;
async function walk(directory){
  for(const entry of await readdir(directory,{withFileTypes:true})){
    const file=resolve(directory,entry.name);
    if(entry.isDirectory()){await walk(file);continue;}
    if(!types.has(extname(file)))continue;
    const original=await readFile(file);if(original.length<1024)continue;
    const compressed=await compress(original,{params:{[constants.BROTLI_PARAM_QUALITY]:6}});
    if(compressed.length<original.length*.95){await writeFile(file+'.br',compressed);total++;saved+=original.length-compressed.length;}
  }
}
for(const id of ['mensari','monster','se1t','textured_00002','textured_00004','haakon','leona','mara','geekaton']){
  const info=await stat(resolve(root,id+'_animated.glb'));if(!info.isFile()||info.size===0)throw Error('Missing racer '+id);
}
await walk(root);console.log(`Web build ready: nine racers, ${total} compressed text/decoder assets, ${Math.round(saved/1024)} KiB saved.`);
