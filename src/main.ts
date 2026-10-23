import './style.css';
import type * as T from 'three';
import {parseConfig} from './config';
import {Tracker,enableTilt,tilt,type TrackingSample} from './tracker';
import {PoseFilter} from './filter';
import {Viewer} from './viewer';
import {cameraUp,levelQuaternion} from './motion';
import {demoFrame} from './demo';
import {DEFAULT_SETTINGS,KEYS,LINKS,type Facing,type Point} from './types';
import {quantile,visible} from './math';
import {COUNTDOWN_S,HOLD_S,summarize,type HoldSample} from './capture';
import {countPositions,download,listPositions,savePosition} from './storage';

const store=(()=>{try{return localStorage}catch{return null}})();
const cfg=parseConfig(location.search,store);
const app=document.getElementById('app')!;
app.innerHTML=`<section class="pane cam"><div class="view" id="cam-view"><video id="video" muted playsinline></video><canvas id="overlay"></canvas></div><p class="status" id="status" role="status"></p><button class="start" id="start" hidden>Start camera</button></section>
<section class="pane world"><div class="view" id="world-view"></div></section>
<footer class="bar"><label class="match"><span>Match&nbsp;%</span><input id="match" type="number" inputmode="numeric" min="0" max="100" step="1" placeholder="0–100"></label><button class="save" id="save">Save this position</button><a class="export" id="export" href="#">Export (0)</a></footer>`;
const $=<E extends HTMLElement>(id:string)=>document.getElementById(id) as E;
const video=$<HTMLVideoElement>('video'),overlay=$<HTMLCanvasElement>('overlay'),statusLine=$('status'),startButton=$<HTMLButtonElement>('start'),match=$<HTMLInputElement>('match'),saveButton=$<HTMLButtonElement>('save'),exportLink=$<HTMLAnchorElement>('export');

let viewer:Viewer|null=null;
try{viewer=new Viewer($('world-view'),cfg.debug)}catch(e){console.warn(e)}
const filter=new PoseFilter();
let tracker:Tracker|null=null,facing:Facing=cfg.facing,statusText=viewer?'Starting…':'The 3D view needs WebGL, which this browser does not provide.',statusError=!viewer;
let smoothedUp:T.Vector3|null=null,lostSince=0,lastLandmarks:Point[]=[];
const times:number[]=[],inference:number[]=[];

function setStatus(text:string,error=false){statusText=text;statusError=error;renderStatus()}
const live=()=>cfg.demo||!!tracker?.running;
function renderStatus(){
 let text=statusText,error=statusError;
 if(live()&&!error){
  const gaps=times.slice(1).map((t,i)=>t-times[i]),fps=gaps.length?1000/quantile(gaps,.5)!:0;
  text=`${cfg.model} · ${cfg.demo?'demo':tracker?.delegate} · ${fps.toFixed(0)} fps`;
  if(cfg.debug){const p=lastLandmarks,v=(i:number)=>p[i]?(p[i].visibility??0).toFixed(2):'–';text+=` · ${cfg.demo?'1280×720':`${video.videoWidth}×${video.videoHeight}`} · inference ${(quantile(inference,.5)??0).toFixed(0)} ms · wrist vis L ${v(15)} R ${v(16)}`}
  if(lastLandmarks.length!==33)text+=' · no one in view';else if(viewer&&!viewer.motion.calibrated)text+=' · stand still to calibrate';
 }
 statusLine.textContent=text;statusLine.classList.toggle('error',error);
}
setInterval(renderStatus,500);renderStatus();

function applyMirror(){const mirrored=facing==='user';for(const id of ['cam-view','world-view'])$(id).classList.toggle('mirror',mirrored);if(viewer)viewer.mirrored=mirrored}
const aspect=()=>cfg.demo?16/9:(video.videoWidth||16)/(video.videoHeight||9);
function currentUp(){const up=cameraUp(tilt,facing);if(!up)return smoothedUp;smoothedUp=smoothedUp?smoothedUp.lerp(up,.2).normalize():up;return smoothedUp}

function onSample(s:TrackingSample){
 const t=s.timestamp;times.push(t);inference.push(s.inferenceMs);if(times.length>30){times.shift();inference.shift()}
 const pose=s.world.length===33&&s.landmarks.length===33,up=currentUp();
 const held:HoldSample|null=save?.phase==='hold'?{t,image:s.landmarks,world:s.world,inferenceMs:s.inferenceMs,scale:null,up:up?.clone()??null}:null;
 if(held)save!.samples.push(held);
 lastLandmarks=s.landmarks;draw2d(pose?s.landmarks:[]);
 if(!pose){
  // Out of view for 2 s (for example, walking to the phone): measure the start position again when you are back.
  if(!lostSince)lostSince=t;else if(t-lostSince>2000&&viewer?.motion.calibrated)viewer.motion.reset();
  viewer?.update([],[],[],t,aspect(),levelQuaternion(up));return;
 }
 lostSince=0;
 const world=filter.apply(s.world,t,cfg.world,'world'),image=filter.apply(s.landmarks,t,cfg.image,'image');
 const rig=viewer?.update(s.world,world,image,t,aspect(),levelQuaternion(up));
 if(held)held.scale=rig?.projection?.scale??null;
}

function draw2d(p:Point[]){
 const w=cfg.demo?1280:video.videoWidth,h=cfg.demo?720:video.videoHeight;if(!w||!h)return;
 if(overlay.width!==w||overlay.height!==h){overlay.width=w;overlay.height=h}
 const ctx=overlay.getContext('2d')!;ctx.clearRect(0,0,w,h);if(cfg.demo){ctx.fillStyle='#1a2320';ctx.fillRect(0,0,w,h)}
 ctx.strokeStyle='#b9f47c';ctx.fillStyle='#b9f47c';ctx.lineWidth=Math.max(2,h/160);ctx.lineCap='round';
 for(const [a,b] of LINKS){if(!visible(p,[a,b]))continue;ctx.beginPath();ctx.moveTo(p[a].x*w,p[a].y*h);ctx.lineTo(p[b].x*w,p[b].y*h);ctx.stroke()}
 for(const i of KEYS){if(!visible(p,[i]))continue;ctx.beginPath();ctx.arc(p[i].x*w,p[i].y*h,h/110,0,Math.PI*2);ctx.fill()}
}

let lock:WakeLockSentinel|null=null;
async function keepAwake(){try{if(document.visibilityState==='visible'&&'wakeLock' in navigator&&!lock)lock=await navigator.wakeLock.request('screen');lock?.addEventListener('release',()=>{lock=null})}catch{}}
document.addEventListener('visibilitychange',()=>void keepAwake());

async function startCamera(){
 startButton.hidden=true;
 tracker??=new Tracker(video,onSample,(message,error)=>setStatus(message,!!error));
 await tracker.start({...DEFAULT_SETTINGS,model:cfg.model,resolution:cfg.resolution,facing:cfg.facing,orientation:innerWidth>=innerHeight?'landscape':'portrait'});
 if(!tracker.running){startButton.hidden=false;return}
 const actual=tracker.cameraSettings?.facingMode;facing=actual==='user'||actual==='environment'?actual:cfg.facing;applyMirror();void keepAwake();
}
startButton.onclick=()=>void startCamera();

// Tilt: Android delivers it without asking; iOS needs a tap, so it is requested on the first Save press.
type Orientation=typeof DeviceOrientationEvent&{requestPermission?:()=>Promise<string>};
const tiltNeedsPermission=typeof (globalThis.DeviceOrientationEvent as Orientation|undefined)?.requestPermission==='function';
let tiltAsked=false;if(!tiltNeedsPermission){tiltAsked=true;void enableTilt().catch(()=>false)}

let audio:AudioContext|null=null;
function unlockAudio(){try{audio??=new AudioContext();void audio.resume()}catch{audio=null}}
function beep(delay=0,frequency=880){if(!audio)return;const t=audio.currentTime+delay,o=audio.createOscillator(),g=audio.createGain();o.frequency.value=frequency;o.connect(g);g.connect(audio.destination);g.gain.setValueAtTime(.2,t);g.gain.exponentialRampToValueAtTime(.001,t+.09);o.start(t);o.stop(t+.1)}

const SAVE_LABEL='Save this position';
let save:{phase:'countdown'|'hold';start:number;beeps:number;timer:number;matchPct:number;samples:HoldSample[]}|null=null,flashTimer=0;
function flash(text:string,ms:number){clearTimeout(flashTimer);saveButton.textContent=text;flashTimer=window.setTimeout(()=>{if(!save)saveButton.textContent=SAVE_LABEL},ms)}
function stopSave(){if(save)clearInterval(save.timer);save=null;saveButton.classList.remove('busy')}
saveButton.onclick=()=>{
 if(save){stopSave();flash('Cancelled',1500);return}
 const pct=match.value.trim()===''?NaN:Number(match.value);
 if(!(Number.isFinite(pct)&&pct>=0&&pct<=100)){match.classList.add('needed');match.focus();flash('Enter Match % first',2000);return}
 if(!live()){flash('Camera is not running',2000);return}
 match.classList.remove('needed');match.blur();unlockAudio();
 if(!tiltAsked){tiltAsked=true;void enableTilt().catch(()=>false)}// must run inside the tap
 // You may have moved the phone: measure the floor and start position again once you stand still.
 viewer?.motion.reset();
 clearTimeout(flashTimer);saveButton.classList.add('busy');
 save={phase:'countdown',start:performance.now(),beeps:0,timer:window.setInterval(tick,50),matchPct:pct,samples:[]};tick();
};
function tick(){
 if(!save)return;const now=performance.now(),elapsed=(now-save.start)/1000;
 if(save.phase==='countdown'){
  while(save.beeps<COUNTDOWN_S&&save.beeps<=elapsed){beep();save.beeps++}
  if(elapsed>=COUNTDOWN_S){save.phase='hold';save.start=now;save.samples=[]}
  else{saveButton.textContent=`Walk back · ${COUNTDOWN_S-Math.floor(elapsed)}`;return}
 }
 const held=(now-save.start)/1000;saveButton.textContent=`Hold your stance · ${Math.max(1,Math.ceil(HOLD_S-held))}`;
 if(held>=HOLD_S)void finishSave();
}
async function finishSave(){
 const s=save!;stopSave();beep(0,1320);beep(.18,1320);
 if(!s.samples.length){flash('Nothing recorded: no camera frames',3000);return}
 const track=tracker?.stream?.getVideoTracks()[0];
 const record=summarize(s.samples,{matchPct:s.matchPct,synthetic:cfg.demo,model:cfg.model,delegate:cfg.demo?'demo':tracker?.delegate??'',aspect:aspect(),distance:viewer?.motion.d0??3,
  camera:cfg.demo?{facing,label:'Synthetic demo',width:1280,height:720,frameRate:20}:{facing,label:track?.label??'',width:video.videoWidth,height:video.videoHeight,frameRate:tracker?.cameraSettings?.frameRate??null},
  smoothing:{world:cfg.world,image:cfg.image},screen:{width:innerWidth,height:innerHeight,orientation:innerWidth>=innerHeight?'landscape':'portrait'},userAgent:navigator.userAgent,savedAt:new Date()});
 try{const n=await savePosition(record);flash(`Saved #${n} · body angle ${record.bodyAngleDeg===null?'–':Math.round(record.bodyAngleDeg)+'°'}`,3000);void updateCount()}
 catch(e){flash('Could not save',3000);setStatus('Saving failed: '+String(e),true)}
}

async function updateCount(){try{exportLink.textContent=`Export (${await countPositions()})`}catch{exportLink.textContent='Export (–)'}}
exportLink.onclick=async e=>{e.preventDefault();try{const records=await listPositions(),stamp=new Date().toISOString().slice(0,16).replace(/[-:T]/g,'');download(`boxxing-positions-${stamp}.json`,JSON.stringify({app:'boxxing-position-finder',version:1,exportedAt:new Date().toISOString(),records}))}catch(error){setStatus('Export failed: '+String(error),true)}};
void updateCount();

if(cfg.demo){
 // Synthetic poses at 20 fps, no camera.
 applyMirror();setStatus('Demo');const t0=performance.now();
 setInterval(()=>{const now=performance.now(),f=demoFrame((now-t0)/1000);onSample({timestamp:now,landmarks:f.image,world:f.world,inferenceMs:0,mediaTime:0,presentedFrames:null,captureTime:null,pipelineStart:now})},50);
}else{applyMirror();void startCamera()}
