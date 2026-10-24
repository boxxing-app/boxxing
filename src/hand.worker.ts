import {FilesetResolver,HandLandmarker} from '@mediapipe/tasks-vision';
import type {Variant} from './types';
import {fetchAsset,type LoadProgress} from './asset-loader';
import {wasmOptions} from './wasm-bootstrap';
const origin=self.location.origin;
// Vite's base ('/' locally, '/<repo>/' on GitHub Pages), as an absolute URL ending in '/'.
const base=new URL(import.meta.env.BASE_URL,origin).href;
const originalFetch=self.fetch.bind(self);
self.fetch=(input:RequestInfo|URL,init?:RequestInit)=>{const url=new URL(input instanceof Request?input.url:String(input),origin);if(url.origin!==origin)return Promise.reject(new Error('External connections are disabled'));return originalFetch(input,init)};
const oldOpen=XMLHttpRequest.prototype.open;
XMLHttpRequest.prototype.open=function(this:XMLHttpRequest,method:string,url:string|URL,...rest:unknown[]){if(new URL(String(url),origin).origin!==origin)throw new Error('External connections disabled');return(oldOpen as Function).call(this,method,url,...rest)} as typeof oldOpen;
let model:HandLandmarker|null=null;
let lastProgress=0;
function progress(p:LoadProgress){const now=performance.now();if(p.loaded&&p.loaded!==p.total&&now-lastProgress<150)return;lastProgress=now;self.postMessage({type:'progress',...p})}
const errorText=(e:unknown)=>e instanceof Error?e.message:String(e);
async function initialize(variant:Variant,delegate:'GPU'|'CPU'){
 if(variant!=='hand')throw new Error('Unknown model variant.');
 if(typeof OffscreenCanvas==='undefined')throw new Error('This browser does not support the camera tracker in a worker. Please use current Android Chrome.');
 model?.close();let cache:Cache|null=null;try{cache=await caches.open('hand-tracker-mediapipe-1.1.1-r1')}catch{}
 const manifestBytes=await fetchAsset(base+'models/manifest.json',{label:'Reading model list',onProgress:progress});
 const manifest=JSON.parse(new TextDecoder().decode(manifestBytes)),item=manifest[variant];
 if(!item||!Array.isArray(item.parts)||!Number.isFinite(item.bytes))throw new Error('The model list is invalid. Reload the site.');
 const buffers:Uint8Array[]=[];
 for(let i=0;i<item.parts.length;i++){
  const name=item.parts[i];if(typeof name!=='string'||!/^\w+-\d+\.bin$/.test(name))throw new Error('Invalid model asset path.');
  const expected=Math.min(8*1024*1024,item.bytes-i*8*1024*1024);
  buffers.push(await fetchAsset(base+'models/'+name,{label:`Downloading ${variant} model (${i+1}/${item.parts.length})`,expectedBytes:expected,onProgress:progress,cache}));
 }
 const buffer=new Uint8Array(item.bytes);let offset=0;for(const p of buffers){buffer.set(p,offset);offset+=p.length}
 progress({phase:'verify',message:'Checking the model download…'});
 const digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',buffer))).map(x=>x.toString(16).padStart(2,'0')).join('');
 if(digest!==item.sha256){await Promise.all(item.parts.map((name:string)=>cache?.delete(base+'models/'+name)));throw new Error('Model download was corrupted. Cached copy cleared; tap Start camera to retry.')}
 const files=await FilesetResolver.forVisionTasks(base+'mediapipe',true);
 const binary=await fetchAsset(files.wasmBinaryPath,{label:'Downloading tracking engine',onProgress:progress,cache});
 progress({phase:'compile',message:'Preparing the tracking engine…'});
 let compiled:WebAssembly.Module;
 try{compiled=await WebAssembly.compile(binary)}catch(error){await cache?.delete(files.wasmBinaryPath).catch(()=>{});throw new Error(`The tracking engine could not compile: ${errorText(error)}. Cached engine cleared; retry the camera.`)}
 const wasmModule=await import(/* @vite-ignore */ files.wasmLoaderPath);
 const globals=self as unknown as {ModuleFactory:unknown;Module:ReturnType<typeof wasmOptions>|undefined;import:(url:string)=>Promise<unknown>};
 globals.ModuleFactory=wasmModule.default;
 globals.Module=wasmOptions(compiled);
 // MediaPipe may request the already imported module again. Preserve its factory
 // even when the browser returns a cached ES module without rerunning its body.
 globals.import=async url=>{const module=await import(/* @vite-ignore */ url);if(module.default)globals.ModuleFactory=module.default;return module};
 progress({phase:delegate==='GPU'?'gpu':'cpu',message:`Starting ${delegate==='GPU'?'GPU':'CPU'} tracking…`});
 model=await HandLandmarker.createFromOptions(files,{baseOptions:{modelAssetBuffer:buffer,delegate},canvas:new OffscreenCanvas(1,1),runningMode:'VIDEO',numHands:2,minHandDetectionConfidence:.5,minHandPresenceConfidence:.5,minTrackingConfidence:.5});
 self.postMessage({type:'ready',delegate});
}
const hands=(result:ReturnType<HandLandmarker['detectForVideo']>)=>result.landmarks.map((landmarks,i)=>({landmarks,world:result.worldLandmarks[i]??[],label:result.handedness[i]?.[0]?.categoryName??'',score:result.handedness[i]?.[0]?.score??0}));
// MediaPipe needs strictly increasing timestamps; use this worker's clock for both frame paths.
let lastStamp=0;const stamp=()=>lastStamp=Math.max(lastStamp+1,performance.now());
let reader:ReadableStreamDefaultReader<VideoFrame>|null=null;
/** Frames streamed straight from the camera track (MediaStreamTrackProcessor, newest frame only): no copy on the page's thread.
 * Results carry an absolute time (timeOrigin + now) so the page can convert it to its own clock. */
async function pump(readable:ReadableStream<VideoFrame>){
 const own=reader=readable.getReader();let first=true;
 while(reader===own){
  const {value:frame,done}=await own.read();if(done||!frame)break;
  try{
   if(first){first=false;self.postMessage({type:'streamFormat',width:frame.displayWidth,height:frame.displayHeight,rotation:(frame as VideoFrame&{rotation?:number}).rotation??0})}
   if(!model||reader!==own)continue;
   const t=stamp(),result=model.detectForVideo(frame,t);
   self.postMessage({type:'result',time:performance.timeOrigin+t,hands:hands(result),inferenceMs:performance.now()-t});
  }finally{frame.close()}
 }
}
self.onmessage=async(e:MessageEvent)=>{const m=e.data;try{
 if(m.type==='init')await initialize(m.variant,m.delegate??'GPU');
 else if(m.type==='stream')pump(m.readable).catch(error=>self.postMessage({type:'error',message:errorText(error)}));
 else if(m.type==='stopStream'){const old=reader;reader=null;await old?.cancel().catch(()=>{})}
 else if(m.type==='frame'&&model){const start=performance.now();try{const result=model.detectForVideo(m.bitmap,stamp());self.postMessage({type:'result',timestamp:m.timestamp,hands:hands(result),inferenceMs:performance.now()-start})}finally{m.bitmap.close()}}
}catch(error){self.postMessage({type:'error',message:errorText(error)})}};
