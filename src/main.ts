import './style.css';
import {parseConfig} from './config';
import {Tracker,type TrackingSample} from './tracker';
import {Euro,PoseFilter} from './filter';
import {COLORS,V,Viewer} from './viewer';
import {HandShape,assignSides,focal,solveTranslation,type Side} from './hands';
import {demoHands,DEMO_CAMERA} from './demo';
import {DEFAULT_SETTINGS,LINKS,POSITION_FILTER,type Facing,type Point} from './types';
import {add,quantile} from './math';

const store=(()=>{try{return localStorage}catch{return null}})();
const cfg=parseConfig(location.search,store);
const app=document.getElementById('app')!;
app.innerHTML=`<section class="pane cam"><div class="view" id="cam-view"><video id="video" muted playsinline></video><canvas id="overlay"></canvas></div><p class="status" id="status" role="status"></p><button class="start" id="start" hidden>Start camera</button></section>
<section class="pane world"><div class="view" id="world-view"></div></section>`;
const $=<E extends HTMLElement>(id:string)=>document.getElementById(id) as E;
const video=$<HTMLVideoElement>('video'),overlay=$<HTMLCanvasElement>('overlay'),statusLine=$('status'),startButton=$<HTMLButtonElement>('start');

let viewer:Viewer|null=null;
try{viewer=new Viewer($('world-view'))}catch(e){console.warn(e)}
const filter=new PoseFilter(),sides:Side[]=['left','right'];
const shapes:Record<Side,HandShape>={left:new HandShape(),right:new HandShape()};
const position:Record<Side,Euro[]>={left:[new Euro(),new Euro(),new Euro()],right:[new Euro(),new Euro(),new Euro()]};
if(viewer)viewer.onDoubleTap=()=>{for(const s of sides)shapes[s].reset()};// measure finger lengths again
let tracker:Tracker|null=null,facing:Facing=cfg.facing,statusText=viewer?'Starting…':'The 3D view needs WebGL, which this browser does not provide.',statusError=!viewer;
let last:TrackingSample|null=null;
const times:number[]=[],inference:number[]=[];

function setStatus(text:string,error=false){statusText=text;statusError=error;renderStatus()}
const live=()=>cfg.demo||!!tracker?.running;
function renderStatus(){
 let text=statusText,error=statusError;
 if(live()&&!error){
  const gaps=times.slice(1).map((t,i)=>t-times[i]),fps=gaps.length?1000/quantile(gaps,.5)!:0,hands=last?assignSides(last.hands):[];
  text=`hand · ${cfg.demo?'demo':tracker?.delegate} · ${fps.toFixed(0)} fps · ${hands.length?`${hands.length} hand${hands.length>1?'s':''}`:'no hands in view'}`;
  if(cfg.debug)text+=` · ${cfg.demo?'1280×960':`${video.videoWidth}×${video.videoHeight}`} · inference ${(quantile(inference,.5)??0).toFixed(0)} ms${hands.map(h=>` · ${h.side[0].toUpperCase()} ${h.hand.score.toFixed(2)}`).join('')}${sides.some(s=>!shapes[s].calibrated)?' · measuring':''}`;
 }
 statusLine.textContent=text;statusLine.classList.toggle('error',error);
}
setInterval(renderStatus,500);renderStatus();

function applyMirror(){const mirrored=facing==='user';for(const id of ['cam-view','world-view'])$(id).classList.toggle('mirror',mirrored);if(viewer)viewer.mirrored=mirrored}
const aspect=()=>cfg.demo?DEMO_CAMERA.aspect:(video.videoWidth||4)/(video.videoHeight||3);

function onSample(s:TrackingSample){
 const t=s.timestamp;times.push(t);inference.push(s.inferenceMs);if(times.length>30){times.shift();inference.shift()}
 last=s;const a=aspect(),f=focal(cfg.fov,a),hands=assignSides(s.hands);viewer?.setCamera(f,a);
 draw2d(hands.map(h=>({side:h.side,points:h.hand.landmarks})));
 for(const side of sides){
  const found=hands.find(h=>h.side===side);if(!found){viewer?.update(side,null);continue}
  const {world,landmarks}=found.hand,T0=solveTranslation(world,landmarks,f,a);if(!T0){viewer?.update(side,null);continue}
  // Shape and position are smoothed separately: depth from image size is noisier than the hand's shape.
  const [ex,ey,ez]=position[side],at={x:ex.step(T0.x,t,POSITION_FILTER),y:ey.step(T0.y,t,POSITION_FILTER),z:ez.step(T0.z,t,POSITION_FILTER)};
  shapes[side].calibrate(world);
  const joints=shapes[side].solve(filter.apply(world,t,cfg.world,side));
  viewer?.update(side,joints.map(p=>V(add(p,at))),cfg.debug?world.map(p=>V(add(p,T0))):null);
 }
}

function draw2d(hands:{side:Side;points:Point[]}[]){
 const w=cfg.demo?1280:video.videoWidth,h=cfg.demo?960:video.videoHeight;if(!w||!h)return;
 if(overlay.width!==w||overlay.height!==h){overlay.width=w;overlay.height=h}
 const ctx=overlay.getContext('2d')!;ctx.clearRect(0,0,w,h);if(cfg.demo){ctx.fillStyle='#1a2320';ctx.fillRect(0,0,w,h)}
 ctx.lineWidth=Math.max(2,h/240);ctx.lineCap='round';
 for(const {side,points:p} of hands){
  const color='#'+COLORS[side].toString(16).padStart(6,'0');ctx.strokeStyle=color;ctx.fillStyle=color;
  for(const [a,b] of LINKS){ctx.beginPath();ctx.moveTo(p[a].x*w,p[a].y*h);ctx.lineTo(p[b].x*w,p[b].y*h);ctx.stroke()}
  for(const q of p){ctx.beginPath();ctx.arc(q.x*w,q.y*h,h/200,0,Math.PI*2);ctx.fill()}
 }
}

let lock:WakeLockSentinel|null=null;
async function keepAwake(){try{if(document.visibilityState==='visible'&&'wakeLock' in navigator&&!lock)lock=await navigator.wakeLock.request('screen');lock?.addEventListener('release',()=>{lock=null})}catch{}}
document.addEventListener('visibilitychange',()=>void keepAwake());

async function startCamera(){
 startButton.hidden=true;
 tracker??=new Tracker(video,onSample,(message,error)=>setStatus(message,!!error));
 await tracker.start({...DEFAULT_SETTINGS,resolution:cfg.resolution,facing:cfg.facing,orientation:innerWidth>=innerHeight?'landscape':'portrait'});
 if(!tracker.running){startButton.hidden=false;return}
 const actual=tracker.cameraSettings?.facingMode;facing=actual==='user'||actual==='environment'?actual:cfg.facing;applyMirror();void keepAwake();
}
startButton.onclick=()=>void startCamera();

if(cfg.demo){
 // Synthetic hands at 30 fps, no camera.
 applyMirror();setStatus('Demo');const t0=performance.now();
 setInterval(()=>{const now=performance.now();onSample({timestamp:now,hands:demoHands((now-t0)/1000),inferenceMs:0,mediaTime:0,presentedFrames:null,captureTime:null,pipelineStart:now})},33);
}else{applyMirror();void startCamera()}
