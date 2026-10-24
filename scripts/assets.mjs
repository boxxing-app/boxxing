import fs from 'node:fs/promises';
import crypto from 'node:crypto';
// Copies the MediaPipe WASM and downloads the hand model into public/, split into 8 MB parts with a checksum.
await fs.rm('public/models',{recursive:true,force:true});
await fs.mkdir('public/models',{recursive:true});await fs.mkdir('public/mediapipe',{recursive:true});
await fs.cp('node_modules/@mediapipe/tasks-vision/wasm','public/mediapipe',{recursive:true});
const manifest={};
for(const [variant,url] of [['hand','https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task']]){
const response=await fetch(url);if(!response.ok)throw new Error(`${response.status}: ${url}`);
const bytes=Buffer.from(await response.arrayBuffer());const parts=[];
for(let i=0;i<bytes.length;i+=8*1024*1024){const name=`${variant}-${parts.length}.bin`;await fs.writeFile(`public/models/${name}`,bytes.subarray(i,i+8*1024*1024));parts.push(name)}
manifest[variant]={url,bytes:bytes.length,sha256:crypto.createHash('sha256').update(bytes).digest('hex'),parts};console.log(variant,bytes.length);
}
await fs.writeFile('public/models/manifest.json',JSON.stringify(manifest,null,2));
