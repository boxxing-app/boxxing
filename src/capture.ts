import type * as T from 'three';
import {KEYS,NAMES,type Facing,type FilterSettings,type Point,type Variant} from './types';
import {bodyAngle,mean,mid,quantile} from './math';
import {phoneAngles} from './motion';
export const COUNTDOWN_S=10,HOLD_S=5;
/** One tracker result during the hold. scale = the rig's weak-perspective torso scale (frame heights per metre). */
export type HoldSample={t:number;image:Point[];world:Point[];inferenceMs:number;scale:number|null;up:T.Vector3|null};
export type CameraInfo={facing:Facing;label:string;width:number;height:number;frameRate:number|null};
export type PositionRecord={
 id?:number;version:1;savedAt:string;matchPct:number;synthetic:boolean;
 /** Torso facing angle to the camera. Positive = the phone is to your front-right. */
 bodyAngleDeg:number|null;
 phone:{pitchDeg:number|null;rollDeg:number|null};
 camera:CameraInfo;model:Variant;delegate:string;
 medianFps:number|null;p95InferenceMs:number|null;
 frames:number;posePct:number;
 /** Mean MediaPipe visibility (0–1) of each key joint over the frames with a pose. */
 visibility:Record<string,number|null>;meanVisibility:number|null;
 /** High-frequency noise of the raw world points, per key joint and averaged (mm). */
 jitterMm:Record<string,number|null>;meanJitterMm:number|null;
 smoothing:{world:FilterSettings;image:FilterSettings};
 screen:{width:number;height:number;orientation:'portrait'|'landscape'};userAgent:string;
 /** The raw hold: t in ms from the start of the hold; points as [x,y,z,visibility,presence]; empty arrays where no pose was found. */
 hold:{durationMs:number;frames:{t:number;inferenceMs:number;image:number[][];world:number[][]}[]};
};
const r=(x:number,d:number)=>Math.round(x*10**d)/10**d;
const pack=(ps:Point[],d:number)=>ps.map(p=>[r(p.x,d),r(p.y,d),r(p.z,d),r(p.visibility??0,3),r(p.presence??0,3)]);
const median=(xs:number[])=>quantile(xs,.5);
/** Jitter of one joint: RMS of the second difference x[t]-(x[t-1]+x[t+1])/2 over consecutive frames, divided by √1.5,
 * which is the per-frame noise for white noise and ignores slow, smooth movement such as breathing or a sway. */
export function jitter(track:(Point|null)[]){let sum=0,n=0;for(let i=1;i+1<track.length;i++){const a=track[i-1],b=track[i],c=track[i+1];if(!a||!b||!c)continue;sum+=(b.x-(a.x+c.x)/2)**2+(b.y-(a.y+c.y)/2)**2+(b.z-(a.z+c.z)/2)**2;n++}return n?Math.sqrt(sum/n/1.5)*1000:null}
export type Context={matchPct:number;synthetic:boolean;camera:CameraInfo;model:Variant;delegate:string;aspect:number;distance:number;smoothing:PositionRecord['smoothing'];screen:PositionRecord['screen'];userAgent:string;savedAt:Date};
export function summarize(samples:HoldSample[],c:Context):PositionRecord{
 const start=samples[0]?.t??0,poses=samples.filter(s=>s.world.length===33&&s.image.length===33);
 const gaps=samples.slice(1).map((s,i)=>s.t-samples[i].t).filter(dt=>dt>0);
 const fps=median(gaps.map(dt=>1000/dt));
 // Direction from the body to the camera: the hip centre is (u-cx)/s metres to the side and about `distance` away.
 const angles=poses.map(s=>{const hip=mid(s.image[23],s.image[24]),side=s.scale&&s.scale>0?(hip.x-.5)*c.aspect/s.scale:0;return bodyAngle(s.world,{x:-side,z:-c.distance})});
 const tilts=samples.flatMap(s=>s.up?[phoneAngles(s.up)]:[]);
 const visibility:Record<string,number|null>={},jitterMm:Record<string,number|null>={};
 for(const i of KEYS){visibility[NAMES[i]]=mean(poses.map(s=>s.image[i].visibility??0));jitterMm[NAMES[i]]=jitter(samples.map(s=>s.world.length===33?s.world[i]:null))}
 const finite=(xs:(number|null)[])=>xs.filter((x):x is number=>x!==null);
 const round=(x:number|null,d=1)=>x===null?null:r(x,d);
 return{version:1,savedAt:c.savedAt.toISOString(),matchPct:c.matchPct,synthetic:c.synthetic,
  bodyAngleDeg:round(median(angles)),
  phone:{pitchDeg:round(median(tilts.map(t=>t.pitchDeg))),rollDeg:round(median(tilts.map(t=>t.rollDeg)))},
  camera:c.camera,model:c.model,delegate:c.delegate,
  medianFps:round(fps),p95InferenceMs:round(quantile(samples.map(s=>s.inferenceMs),.95)),
  frames:samples.length,posePct:samples.length?r(100*poses.length/samples.length,1):0,
  visibility:Object.fromEntries(Object.entries(visibility).map(([k,v])=>[k,round(v,3)])),meanVisibility:round(mean(finite(Object.values(visibility))),3),
  jitterMm:Object.fromEntries(Object.entries(jitterMm).map(([k,v])=>[k,round(v)])),meanJitterMm:round(mean(finite(Object.values(jitterMm)))),
  smoothing:c.smoothing,screen:c.screen,userAgent:c.userAgent,
  hold:{durationMs:samples.length?Math.round(samples[samples.length-1].t-start):0,frames:samples.map(s=>({t:Math.round(s.t-start),inferenceMs:r(s.inferenceMs,1),image:pack(s.image,5),world:pack(s.world,4)}))}};
}
