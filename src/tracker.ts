import type {Point,Settings,Tilt} from './types';
import {backoff,loadBudget,type LoadPhase} from './asset-loader';
import {cameraContext,requestCamera} from './camera-access';
export type TrackingSample={timestamp:number;landmarks:Point[];world:Point[];inferenceMs:number;mediaTime:number;presentedFrames:number|null;captureTime:number|null;pipelineStart:number};
export class Tracker{
 worker:Worker|null=null;stream:MediaStream|null=null;delegate='';running=false;busy=false;ready=false;request=0;lastTime=-1;cameraSettings:MediaTrackSettings|null=null;generation=0;
 private cancelLoading:(()=>void)|null=null;
 private cameraRequest:AbortController|null=null;
 private pending:Omit<TrackingSample,'landmarks'|'world'|'inferenceMs'>|null=null;
 constructor(public video:HTMLVideoElement,private onSample:(s:TrackingSample)=>void,private onStatus:(s:string,error?:boolean,cameraHelp?:boolean)=>void){}
 async start(s:Settings){
  this.stop();const generation=this.generation,request=new AbortController();this.cameraRequest=request;this.onStatus('Requesting camera permission…');let cameraConnected=false;
  try{
   const context=cameraContext(),status=(message:string,help?:boolean)=>this.onStatus(message,false,help);
   let stream=await requestCamera(s,request.signal,status,context);
   const stale=()=>{if(generation===this.generation)return false;stream.getTracks().forEach(t=>t.stop());return true};
   if(stale())return;this.stream=stream;
   if(!s.deviceId&&s.facing==='environment'&&!context.ios){
    const devices=await navigator.mediaDevices.enumerateDevices().catch(()=>[]);if(stale())return;
    const wide=devices.find(d=>d.kind==='videoinput'&&/wide|0[.,]5/i.test(d.label)&&!(/front|user|face/i.test(d.label)));
    if(wide&&wide.deviceId!==stream.getVideoTracks()[0].getSettings().deviceId){stream.getTracks().forEach(t=>t.stop());stream=await requestCamera({...s,deviceId:wide.deviceId},request.signal,status,context);if(stale())return;this.stream=stream}
   }
   this.video.muted=true;this.video.playsInline=true;this.video.srcObject=stream;this.onStatus('Camera allowed. Starting preview…');await this.video.play();if(stale())return;cameraConnected=true;
   this.cameraSettings=stream.getVideoTracks()[0].getSettings();this.onStatus('Camera connected · loading '+s.model+' model…');await this.load(s.model);
   if(generation!==this.generation)return;this.running=true;this.onStatus('Camera live · '+this.delegate);this.loop();
  }catch(e){if(generation!==this.generation)return;this.stop();this.onStatus(e instanceof Error?e.message:String(e),true,!cameraConnected)}
 }
 load(variant:Settings['model']){
  return new Promise<void>((resolve,reject)=>{
   let settled=false,phase:LoadPhase='download',message='Starting the tracking worker',mode:'GPU'|'CPU'='GPU',attempt=0;
   let timer:ReturnType<typeof setTimeout>|undefined,retryTimer:ReturnType<typeof setTimeout>|undefined;
   const clear=()=>{clearTimeout(timer);clearTimeout(retryTimer)};
   const fail=(error:Error)=>{if(settled)return;settled=true;clear();this.cancelLoading=null;this.worker?.terminate();this.worker=null;reject(error)};
   const retry=(reason:string)=>{
    if(attempt>=2){fail(new Error(`${reason} Startup failed after 3 attempts. Retry with Lite or another browser.`));return}
    clear();this.worker?.terminate();this.worker=null;
    const gpu=phase==='gpu';if(gpu)mode='CPU';const delay=backoff(1000,attempt++);
    this.onStatus(`${gpu?'GPU did not start. Switching to CPU.':reason} Retrying in ${delay/1000}s with a longer timeout (attempt ${attempt+1}/3)…`);
    retryTimer=setTimeout(launch,delay);
   };
   const arm=(timeoutMs?:number)=>{clearTimeout(timer);timer=setTimeout(()=>retry(`${message}: no response.`),timeoutMs??loadBudget(phase,attempt))};
   const launch=()=>{
    if(settled)return;phase='download';message='Starting the tracking worker';arm();
    let worker:Worker;try{worker=new Worker(new URL('./pose.worker.ts',import.meta.url),{type:'module'})}catch(e){fail(new Error(`Tracking worker could not start: ${String(e)}`));return}
    this.worker=worker;
    worker.onerror=e=>{if(this.worker!==worker)return;const text=e.message||'Tracking worker failed';if(settled){this.stop();this.onStatus(text,true)}else if(phase==='gpu')retry(text);else fail(new Error(text))};
    worker.onmessageerror=()=>{if(this.worker!==worker)return;const text='The browser could not read a tracking-worker message.';if(settled){this.stop();this.onStatus(text,true)}else fail(new Error(text))};
    worker.onmessage=e=>{
     if(this.worker!==worker)return;const m=e.data;
     if(m.type==='progress'&&!settled){phase=m.phase;message=m.message;this.onStatus(message);arm(m.timeoutMs)}
     else if(m.type==='ready'&&!settled){settled=true;clear();this.cancelLoading=null;this.delegate=m.delegate;this.ready=true;resolve()}
     else if(m.type==='result'){this.busy=false;if(this.pending)this.onSample({...m,...this.pending});this.pending=null}
     else if(m.type==='error'){if(settled){this.stop();this.onStatus(m.message,true)}else if(phase==='gpu')retry(m.message);else fail(new Error(m.message))}
    };
    worker.postMessage({type:'init',variant,delegate:mode});
   };
   this.cancelLoading=()=>fail(new Error('Model loading cancelled.'));
   launch();
  });
 }
 private loop=()=>{
  if(!this.running)return;
  if('requestVideoFrameCallback'in this.video)this.request=this.video.requestVideoFrameCallback((_,meta)=>{void this.send(meta);this.loop()});
  else this.request=requestAnimationFrame(()=>{if(this.video.currentTime!==this.lastTime){this.lastTime=this.video.currentTime;void this.send(null)}this.loop()});
 };
 private async send(meta:VideoFrameCallbackMetadata|null){
  if(this.busy||!this.running||!this.worker)return;this.busy=true;const generation=this.generation,t=performance.now();
  try{const bitmap=await createImageBitmap(this.video);if(!this.running||generation!==this.generation){bitmap.close();return}
   const capture=(meta as(VideoFrameCallbackMetadata&{captureTime?:number})|null)?.captureTime;
   this.pending={timestamp:t,pipelineStart:t,mediaTime:meta?.mediaTime??this.video.currentTime,presentedFrames:meta?.presentedFrames??null,captureTime:capture??null};
   this.worker!.postMessage({type:'frame',bitmap,timestamp:t},[bitmap]);
  }catch(e){this.busy=false;this.onStatus('Could not read camera frame: '+String(e),true)}
 }
 stop(){this.generation++;this.running=false;this.ready=false;this.cameraRequest?.abort();this.cameraRequest=null;this.cancelLoading?.();this.cancelLoading=null;this.worker?.terminate();this.worker=null;this.stream?.getTracks().forEach(t=>t.stop());this.stream=null;if('cancelVideoFrameCallback'in this.video)this.video.cancelVideoFrameCallback(this.request);cancelAnimationFrame(this.request);this.busy=false;this.pending=null;this.lastTime=-1;this.video.srcObject=null;}
}
export let tilt:Tilt|null=null;
export async function enableTilt(){type OrientationConstructor=typeof DeviceOrientationEvent&{requestPermission?:()=>Promise<string>};const C=globalThis.DeviceOrientationEvent as OrientationConstructor|undefined;if(!C)return false;if(C.requestPermission&&await C.requestPermission()!=='granted')return false;window.addEventListener('deviceorientation',e=>{tilt={alpha:e.alpha,beta:e.beta,gamma:e.gamma,screenAngle:screen.orientation?.angle??0,at:performance.now()}});return true}
export function screenTilt(t:Tilt|null){if(!t||t.beta===null||t.gamma===null)return null;const b=t.beta*Math.PI/180,g=t.gamma*Math.PI/180;return Math.asin(Math.max(-1,Math.min(1,Math.cos(b)*Math.cos(g))))*180/Math.PI}
