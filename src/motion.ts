import * as T from 'three';
import {Euro} from './filter';
import {FOOT,type Facing,type FilterSettings,type Point,type Tilt} from './types';
import {mid,quantile,visible} from './math';
import {V} from './rig';
/** Nominal phone distance. Only changes from the start position are shown, so a wrong guess just scales step sizes. */
export const NOMINAL_DISTANCE=3;
/** The pinhole position is noisy, so it gets a slower filter than the joints. */
export const ROOT_XZ:FilterSettings={minCutoff:.8,beta:2,dCutoff:1};
export const ROOT_Y:FilterSettings={minCutoff:3,beta:3,dCutoff:2};
const CALIBRATION_FRAMES=30;

/** Gravity "up" in the camera frame (Three.js axes: x image right, y image up, z out of the back of the lens), from deviceorientation.
 * Front camera frames are unmirrored, so their image right is the screen's left. */
export function cameraUp(t:Tilt|null,facing:Facing):T.Vector3|null{
 if(!t||t.beta===null||t.gamma===null)return null;
 const b=t.beta*Math.PI/180,g=t.gamma*Math.PI/180,a=(t.screenAngle||0)*Math.PI/180;
 const up=new T.Vector3(-Math.cos(b)*Math.sin(g),Math.sin(b),Math.cos(b)*Math.cos(g));// device axes: x screen-right, y screen-top, z out of the screen
 const screenUp=new T.Vector3(Math.sin(a),Math.cos(a),0),screenRight=new T.Vector3(Math.cos(a),-Math.sin(a),0);
 return facing==='user'?new T.Vector3(-up.dot(screenRight),up.dot(screenUp),-up.z):new T.Vector3(up.dot(screenRight),up.dot(screenUp),up.z);
}
/** Rotation from the camera frame to a level frame (gravity = -y), keeping the camera's heading. */
export const levelQuaternion=(up:T.Vector3|null)=>up?new T.Quaternion().setFromUnitVectors(up.clone().normalize(),new T.Vector3(0,1,0)):new T.Quaternion();
/** Pitch: the lens axis above the horizon (negative = pointing down). Roll: how far true vertical leans to the image right. */
export function phoneAngles(up:T.Vector3){const u=up.clone().normalize();return{pitchDeg:Math.asin(Math.max(-1,Math.min(1,-u.z)))*180/Math.PI,rollDeg:Math.atan2(u.x,u.y)*180/Math.PI}}

/** world/image: smoothed landmarks. rig: the avatar's solved joints (MediaPipe axes). scale: solve()'s weak-perspective torso scale. */
export type MotionInput={t:number;world:Point[];image:Point[];rig:Record<number,Point>;scale:number|null;aspect:number;level:T.Quaternion;ready:boolean};
export type PhoneView={position:T.Vector3;quaternion:T.Quaternion;f:number;aspect:number};
type Sample={u:number;v:number;s:number;h:number};
const range=(xs:number[])=>Math.max(...xs)-Math.min(...xs);
/** Paraperspective torso scale (frame heights per metre). When the body is off the lens axis by tan = (tx, ty), a point's depth also
 * shifts it sideways in the image; plain weak perspective reads that as size and gets the distance wrong by ~9 cm per 0.5 m sideways at 45°. */
export function torsoScale(rig:Record<number,Point>,image:Point[],aspect:number,tx:number,ty:number){
 const ids=[11,12,23,24].filter(i=>rig[i]&&visible(image,[i]));if(ids.length<3)return null;
 const e=ids.map(i=>({x:rig[i].x-tx*rig[i].z,y:rig[i].y-ty*rig[i].z,u:image[i].x*aspect,v:image[i].y})),m=(k:'x'|'y'|'u'|'v')=>e.reduce((a,p)=>a+p[k],0)/e.length;
 const mx=m('x'),my=m('y'),mu=m('u'),mv=m('v');let n=0,d=0;for(const p of e){n+=(p.x-mx)*(p.u-mu)+(p.y-my)*(p.v-mv);d+=(p.x-mx)**2+(p.y-my)**2}
 const s=n/Math.max(d,1e-8);return s>0?s:null;
}
/** Moves the hip-centred MediaPipe body around the floor.
 * Height: the lowest foot point always touches the floor (y = 0).
 * Floor position: a pinhole camera from the torso's image scale, relative to where you stood still at the start. */
export class RootMotion{
 calibrated=false;offset=new T.Vector3();view:PhoneView|null=null;
 s0=0;u0=0;v0=0;standingHeight=0;
 private window:Sample[]=[];private x=new Euro();private y=new Euro();private z=new Euro();
 constructor(public d0=NOMINAL_DISTANCE){}
 reset(){this.calibrated=false;this.window=[];this.view=null;this.x.reset();this.z.reset()}
 get f(){return this.s0*this.d0}
 /** Camera-frame position of the hip centre for an image position (in frame heights) and torso scale. */
 private cameraPoint(u:number,v:number,s:number,aspect:number){const Z=this.d0*this.s0/s,f=this.f;return new T.Vector3((u-aspect/2)*Z/f,-(v-.5)*Z/f,-Z)}
 update(m:MotionInput){
  let low=Infinity;for(const i of FOOT)low=Math.min(low,V(m.world[i]).applyQuaternion(m.level).y);
  const height=this.y.step(-low,m.t,ROOT_Y),hip=mid(m.image[23],m.image[24]),u=hip.x*m.aspect,v=hip.y;
  // Focal length in frame heights: measured at the start, or guessed from this frame at the nominal distance.
  const f=this.calibrated?this.f:(m.scale??0)*this.d0,scale=m.scale&&m.scale>0&&f>0?torsoScale(m.rig,m.image,m.aspect,(u-m.aspect/2)/f,(v-.5)/f):null;
  if(!this.calibrated){
   this.offset.set(0,height,0);
   if(!m.ready||!scale||!visible(m.image,[23,24,27,28])){this.window=[];return this.offset}
   this.window.push({u,v,s:scale,h:-low});if(this.window.length>CALIBRATION_FRAMES)this.window.shift();
   const w=this.window,s=w.map(x=>x.s),median=(xs:number[])=>quantile(xs,.5)!;
   if(w.length<CALIBRATION_FRAMES||range(w.map(x=>x.u))>.03||range(w.map(x=>x.v))>.03||range(s)>.06*median(s))return this.offset;
   this.s0=median(s);this.u0=median(w.map(x=>x.u));this.v0=median(w.map(x=>x.v));this.standingHeight=median(w.map(x=>x.h));this.calibrated=true;this.window=[];
   const hipInCamera=this.cameraPoint(this.u0,this.v0,this.s0,m.aspect).applyQuaternion(m.level);
   this.view={position:new T.Vector3(0,this.standingHeight,0).sub(hipInCamera),quaternion:m.level.clone(),f:this.f,aspect:m.aspect};
   return this.offset;
  }
  if(scale){
   const moved=this.cameraPoint(u,v,scale,m.aspect).sub(this.cameraPoint(this.u0,this.v0,this.s0,m.aspect)).applyQuaternion(m.level);
   this.offset.set(this.x.step(moved.x,m.t,ROOT_XZ),height,this.z.step(moved.z,m.t,ROOT_XZ));
  }else this.offset.y=height;
  return this.offset;
 }
}
