import {BONES,type Point} from './types';
import {add,dist,mul,quantile,sub,unit} from './math';
import type {HandSample} from './tracker';
export type Side='left'|'right';
/** Default field of view across the frame's long side; typical for phone cameras. Only depth scale depends on it. */
export const DEFAULT_FOV=70;
/** Focal length in frame heights, for a field of view (degrees) across the frame's long side. */
export const focal=(fovDeg:number,aspect:number)=>Math.max(aspect,1)/2/Math.tan(fovDeg*Math.PI/360);
/** MediaPipe labels handedness as if the image were mirrored (selfie). The app never mirrors frames, so the label is swapped. */
export const sideOf=(label:string):Side|null=>label==='Left'?'right':label==='Right'?'left':null;
/** One hand per side. If both get the same label, the less certain one becomes the other side. */
export function assignSides(hands:HandSample[]):{side:Side;hand:HandSample}[]{
 const known=hands.filter(h=>h.landmarks.length===21&&h.world.length===21&&sideOf(h.label)).sort((a,b)=>b.score-a.score).slice(0,2);
 const out:{side:Side;hand:HandSample}[]=[];
 for(const hand of known){let side=sideOf(hand.label)!;if(out.some(o=>o.side===side))side=side==='left'?'right':'left';out.push({side,hand})}
 return out;
}
/** Pinhole camera: the position T of the hand's origin (camera frame, MediaPipe axes: x right, y down, z forward, metres)
 * that projects the hand's 3D shape onto its image points. Exact linear least squares, no weak-perspective approximation.
 * Each point gives f·(Tx+wx) = (u−cx)·(Tz+wz), and the same for y. f is in frame heights. */
export function solveTranslation(world:Point[],image:Point[],f:number,aspect:number):Point|null{
 const A=[[0,0,0],[0,0,0],[0,0,0]],b=[0,0,0];
 const row=(r:number[],rhs:number)=>{for(let i=0;i<3;i++){for(let j=0;j<3;j++)A[i][j]+=r[i]*r[j];b[i]+=r[i]*rhs}};
 for(let i=0;i<Math.min(world.length,image.length);i++){const w=world[i],du=image[i].x*aspect-aspect/2,dv=image[i].y-.5;row([f,0,-du],du*w.z-f*w.x);row([0,f,-dv],dv*w.z-f*w.y)}
 const det=(m:number[][])=>m[0][0]*(m[1][1]*m[2][2]-m[1][2]*m[2][1])-m[0][1]*(m[1][0]*m[2][2]-m[1][2]*m[2][0])+m[0][2]*(m[1][0]*m[2][1]-m[1][1]*m[2][0]);
 const d=det(A);if(Math.abs(d)<1e-12)return null;
 const t=[0,1,2].map(k=>det(A.map((r,i)=>r.map((v,j)=>j===k?b[i]:v)))/d);
 return t[2]>0?{x:t[0],y:t[1],z:t[2]}:null;
}
const CALIBRATION_FRAMES=30;
/** A hand with fixed bone lengths: the median of the first frames. Every bone points exactly along its landmark direction. */
export class HandShape{
 lengths:number[]|null=null;private samples:number[][]=[];
 get calibrated(){return this.lengths!==null}
 reset(){this.lengths=null;this.samples=[]}
 calibrate(world:Point[]){if(this.lengths)return;this.samples.push(BONES.map(([a,b])=>dist(world[a],world[b])));if(this.samples.length>=CALIBRATION_FRAMES){this.lengths=BONES.map((_,k)=>quantile(this.samples.map(s=>s[k]),.5)!);this.samples=[]}}
 /** Joint positions, built outward from the wrist. Before calibration the bones keep this frame's lengths. */
 solve(world:Point[]):Point[]{const out:Point[]=[];out[0]={...world[0]};BONES.forEach(([a,b],k)=>{out[b]=add(out[a],mul(unit(sub(world[b],world[a])),this.lengths?.[k]??dist(world[a],world[b])))});return out}
}
