import {BONES,type Point} from './types';
import {add,dist,mul,quantile,sub,unit} from './math';
import type {HandSample} from './tracker';
export type Side='left'|'right';
/** Default field of view across the frame's long side; typical for phone cameras. Only depth scale depends on it. */
export const DEFAULT_FOV=70;
/** Focal length in frame heights, for a field of view (degrees) across the frame's long side. */
export const focal=(fovDeg:number,aspect:number)=>Math.max(aspect,1)/2/Math.tan(fovDeg*Math.PI/360);
/** MediaPipe's handedness label. The frames are never mirrored, and on a real hand (Oct 2026) the Tasks API's label matched the
 * actual hand, so it is used as is. (An earlier version swapped it, which put the left-hand model on the right hand.) */
export const sideOf=(label:string):Side|null=>label==='Left'?'left':label==='Right'?'right':null;
/** One hand per side. If both get the same label, the less certain one becomes the other side. */
export function assignSides(hands:HandSample[]):{side:Side;hand:HandSample}[]{
 const known=hands.filter(h=>h.landmarks.length===21&&h.world.length===21&&sideOf(h.label)).sort((a,b)=>b.score-a.score).slice(0,2);
 const out:{side:Side;hand:HandSample}[]=[];
 for(const hand of known){let side=sideOf(hand.label)!;if(out.some(o=>o.side===side))side=side==='left'?'right':'left';out.push({side,hand})}
 return out;
}
export type Seen={x:number;y:number;t:number};
/** Keeps each hand on its side from frame to frame. MediaPipe's label can flip for a frame, which would swap the hands;
 * so when a side was seen in the last `memoryMs`, hands are matched to where their wrists were, and labels only decide new hands. */
export function trackSides(hands:HandSample[],seen:Partial<Record<Side,Seen>>,now:number,memoryMs=300):{side:Side;hand:HandSample}[]{
 const labelled=assignSides(hands),recent=(['left','right'] as Side[]).filter(s=>seen[s]&&now-seen[s]!.t<=memoryMs);
 const gap=(h:HandSample,s:Side)=>Math.hypot(h.landmarks[0].x-seen[s]!.x,h.landmarks[0].y-seen[s]!.y);
 if(labelled.length===2&&recent.length===2){const [a,b]=labelled.map(l=>l.hand),keep=gap(a,'left')+gap(b,'right'),swap=gap(a,'right')+gap(b,'left');return keep<=swap?[{side:'left',hand:a},{side:'right',hand:b}]:[{side:'right',hand:a},{side:'left',hand:b}]}
 if(labelled.length===1&&recent.length){const h=labelled[0].hand,near=recent.reduce((x,y)=>gap(h,x)<=gap(h,y)?x:y);if(gap(h,near)<.15)return[{side:near,hand:h}]}
 return labelled;
}
/** Wrist and knuckles: the rigid part of the hand, whose points are steadier than the fingertips. Used for the position solve. */
export const PALM=[0,1,5,9,13,17];
/** Pinhole camera: the position T of the hand's origin (camera frame, MediaPipe axes: x right, y down, z forward, metres)
 * that projects the hand's 3D shape onto its image points. Exact linear least squares, no weak-perspective approximation.
 * Each point gives f·(Tx+wx) = (u−cx)·(Tz+wz), and the same for y. f is in frame heights. */
export function solveTranslation(world:Point[],image:Point[],f:number,aspect:number,ids:number[]=world.map((_,i)=>i)):Point|null{
 const A=[[0,0,0],[0,0,0],[0,0,0]],b=[0,0,0];
 const row=(r:number[],rhs:number)=>{for(let i=0;i<3;i++){for(let j=0;j<3;j++)A[i][j]+=r[i]*r[j];b[i]+=r[i]*rhs}};
 for(const i of ids){if(!world[i]||!image[i])continue;const w=world[i],du=image[i].x*aspect-aspect/2,dv=image[i].y-.5;row([f,0,-du],du*w.z-f*w.x);row([0,f,-dv],dv*w.z-f*w.y)}
 const det=(m:number[][])=>m[0][0]*(m[1][1]*m[2][2]-m[1][2]*m[2][1])-m[0][1]*(m[1][0]*m[2][2]-m[1][2]*m[2][0])+m[0][2]*(m[1][0]*m[2][1]-m[1][1]*m[2][0]);
 const d=det(A);if(Math.abs(d)<1e-12)return null;
 const t=[0,1,2].map(k=>det(A.map((r,i)=>r.map((v,j)=>j===k?b[i]:v)))/d);
 return t[2]>0?{x:t[0],y:t[1],z:t[2]}:null;
}
/** Bone lengths: the median of the last 2 s (60 frames), from 30 frames on, updated every 10 frames. A rolling window instead of
 * the first frames, which are the worst (the hand is still entering the picture) and used to fix a bad shape for good. */
const CALIBRATION_FRAMES=30,WINDOW=60,EVERY=10;
/** A hand with steady bone lengths (a rolling median). Every bone points exactly along its landmark direction. */
export class HandShape{
 lengths:number[]|null=null;private samples:number[][]=[];private count=0;
 get calibrated(){return this.lengths!==null}
 reset(){this.lengths=null;this.samples=[];this.count=0}
 calibrate(world:Point[]){
  this.samples.push(BONES.map(([a,b])=>dist(world[a],world[b])));if(this.samples.length>WINDOW)this.samples.shift();
  if(this.samples.length>=CALIBRATION_FRAMES&&(!this.lengths||++this.count%EVERY===0))this.lengths=BONES.map((_,k)=>quantile(this.samples.map(s=>s[k]),.5)!);
 }
 /** Joint positions, built outward from the wrist. Before calibration the bones keep this frame's lengths. */
 solve(world:Point[]):Point[]{const out:Point[]=[];out[0]={...world[0]};BONES.forEach(([a,b],k)=>{out[b]=add(out[a],mul(unit(sub(world[b],world[a])),this.lengths?.[k]??dist(world[a],world[b])))});return out}
}
