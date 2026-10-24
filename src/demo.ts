import type {Point} from './types';
import type {HandSample} from './tracker';
/** Segment lengths (m) per finger, thumb first, and where each finger starts relative to the wrist, for an open right hand
 * with the palm to the camera and the fingers up (MediaPipe axes: x right, y down, z away from the camera). */
const BASES=[{x:.025,y:-.025,z:-.005},{x:.024,y:-.09,z:0},{x:.003,y:-.095,z:0},{x:-.017,y:-.09,z:0},{x:-.035,y:-.08,z:0}];
const SEGMENTS=[[.04,.032,.028],[.04,.025,.02],[.045,.028,.022],[.042,.026,.021],[.033,.02,.018]];
/** A synthetic right hand in MediaPipe world coordinates, centred like MediaPipe's (mean of the wrist and the knuckles).
 * curl 0 = open, 1 = fist; yaw/pitch turn the hand about its centre (degrees). */
export function demoHand(curl=0,yaw=0,pitch=0):Point[]{
 const p:Point[]=[{x:0,y:0,z:0}];
 SEGMENTS.forEach((segments,f)=>{
  let at={...BASES[f]},bend=0;p[1+4*f]={...at};
  segments.forEach((len,k)=>{
   if(f===0){// thumb: swings across the palm toward the little finger as it curls
    const a=(30+40*curl+20*k*curl)*Math.PI/180;at={x:at.x+len*Math.sin(a)*(1-1.6*curl),y:at.y-len*Math.cos(a),z:at.z-len*.45*curl};
   }else{bend+=(k===0?1:k===1?1.1:.7)*curl*Math.PI/2;at={x:at.x,y:at.y-len*Math.cos(bend),z:at.z-len*Math.sin(bend)}}// fingers fold toward the camera (the palm side)
   p[2+4*f+k]={...at};
  });
 });
 const c=[0,5,9,13,17].reduce((s,i)=>({x:s.x+p[i].x/5,y:s.y+p[i].y/5,z:s.z+p[i].z/5}),{x:0,y:0,z:0});
 const ya=yaw*Math.PI/180,pa=pitch*Math.PI/180;
 return p.map(q=>{let x=q.x-c.x,y=q.y-c.y,z=q.z-c.z;[x,z]=[x*Math.cos(ya)-z*Math.sin(ya),x*Math.sin(ya)+z*Math.cos(ya)];[y,z]=[y*Math.cos(pa)-z*Math.sin(pa),y*Math.sin(pa)+z*Math.cos(pa)];return{x,y,z,visibility:.99,presence:.99}});
}
/** The same hand mirrored into a left hand. */
export const mirror=(p:Point[])=>p.map(q=>({...q,x:-q.x}));
export type Pinhole={f:number;aspect:number};
/** Image points (0–1) of a hand whose origin is at T (camera frame, MediaPipe axes, metres). */
export const project=(world:Point[],T:Point,cam:Pinhole):Point[]=>world.map(p=>{const z=T.z+p.z;return{x:.5+cam.f*(T.x+p.x)/z/cam.aspect,y:.5+cam.f*(T.y+p.y)/z,z:p.z,visibility:p.visibility,presence:p.presence}});
/** 4:3 frame with a 70° field of view across the long side. */
export const DEMO_CAMERA:Pinhole={f:(4/3)/2/Math.tan(35*Math.PI/180),aspect:4/3};
/** Two hands for ?demo=1, about 45 cm away: opening and closing, turning, and moving in depth. Labels follow MediaPipe's mirrored convention. */
export function demoHands(t:number):HandSample[]{
 const wave=(period:number,phase=0)=>(1-Math.cos(2*Math.PI*(t/period+phase)))/2;
 const right=demoHand(wave(3),-30+40*wave(5),10*Math.sin(t)),left=mirror(demoHand(wave(3,.5),-30+40*wave(5,.3),-10*Math.sin(t*1.3)));
 // Facing the camera, your right hand is on the image's left.
 const hand=(world:Point[],T:Point,label:string):HandSample=>({world,landmarks:project(world,T,DEMO_CAMERA),label,score:.97});
 return[hand(right,{x:-.11,y:.02,z:.42+.1*wave(7)},'Left'),hand(left,{x:.11,y:.02+.03*Math.sin(t*.8),z:.45},'Right')];
}
