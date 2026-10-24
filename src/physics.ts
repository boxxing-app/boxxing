import * as T from 'three';
import {BONES} from './types';
import type {Side} from './hands';
/** Half the box's edge (a 6 cm cube). */
export const BOX_HALF=.03;
/** The table's top is the plane y = 0 of the physics frame; the box lives inside these x/z bounds and falls off outside them. */
export const TABLE={halfX:.3,halfZ:.28};
const G=9.81,PINCH_ON=.025,PINCH_OFF=.04,GRAB_REACH=.03,FINGER_R=.011,FRICTION=5,MAX_SPEED=3;
/** One hand's 21 joints in the physics frame (metres). */
export type HandInput={side:Side;joints:T.Vector3[]};
/** How far below your palms the table's top goes, and how close to the camera's height it may come (level frame, metres). */
export const TABLE_BELOW_HANDS=.12,TABLE_BELOW_CAMERA=.06;
/** Where the table goes (level frame, camera at the origin): centred under your palms, its top 12 cm below them but always
 * below the camera, and turned to face the camera's heading (`ahead` = the camera's forward direction). */
export function tablePose(palms:T.Vector3[],ahead:T.Vector3){
 const centre=palms.reduce((s,p)=>s.add(p),new T.Vector3()).divideScalar(Math.max(1,palms.length));
 centre.y=Math.min(centre.y-TABLE_BELOW_HANDS,-TABLE_BELOW_CAMERA);
 const flat=new T.Vector3(ahead.x,0,ahead.z);if(flat.lengthSq()<1e-6)flat.set(0,0,-1);
 return{position:centre,quaternion:new T.Quaternion().setFromUnitVectors(new T.Vector3(0,0,-1),flat.normalize())};
}
/** A hand's frame: origin at `origin`, y along the middle finger's knuckle, x across the knuckles (index side). */
export function palmQuaternion(p:T.Vector3[]){const y=p[9].clone().sub(p[0]).normalize(),x0=p[5].clone().sub(p[17]),z=x0.clone().cross(y).normalize(),x=y.clone().cross(z);return new T.Quaternion().setFromRotationMatrix(new T.Matrix4().makeBasis(x,y,z))}
const isPinching=(p:T.Vector3[],was:boolean)=>{const d=p[4].distanceTo(p[8]);return was?d<PINCH_OFF:d<PINCH_ON};
/** A box on a table that hands can push and pinch-grab. Kinematic hands: they are never pushed back. */
export class BoxWorld{
 pos=new T.Vector3();vel=new T.Vector3();quat=new T.Quaternion();spin=0;grabbed:Side|null=null;onTable=true;
 private pinching:Record<Side,boolean>={left:false,right:false};private previous:Partial<Record<Side,T.Vector3[]>>={};
 private holdPos=new T.Vector3();private holdQuat=new T.Quaternion();private gripVel=new T.Vector3();private lastGrip:T.Vector3|null=null;
 constructor(){this.reset()}
 reset(){this.pos.set(0,BOX_HALF,0);this.vel.set(0,0,0);this.quat.identity();this.spin=0;this.grabbed=null;this.lastGrip=null}
 get moving(){return this.grabbed!==null||this.vel.lengthSq()>1e-8||Math.abs(this.spin)>1e-3||!this.onTable}
 /** Distance from a point to the box's surface (0 inside). */
 distanceTo(p:T.Vector3){const l=p.clone().sub(this.pos).applyQuaternion(this.quat.clone().invert());return new T.Vector3(Math.max(0,Math.abs(l.x)-BOX_HALF),Math.max(0,Math.abs(l.y)-BOX_HALF),Math.max(0,Math.abs(l.z)-BOX_HALF)).length()}
 isPinching(side:Side){return this.pinching[side]}
 step(dt:number,hands:HandInput[]){
  dt=Math.min(Math.max(dt,1e-4),1/30);
  const speeds=new Map<Side,T.Vector3[]>();
  for(const {side,joints} of hands){const prev=this.previous[side];speeds.set(side,joints.map((p,i)=>prev?p.clone().sub(prev[i]).divideScalar(dt):new T.Vector3()));this.previous[side]=joints.map(p=>p.clone())}
  for(const side of ['left','right'] as Side[])if(!hands.some(h=>h.side===side)){delete this.previous[side];this.pinching[side]=false}
  for(const {side,joints} of hands){
   const was=this.pinching[side],now=isPinching(joints,was);this.pinching[side]=now;
   const grip=joints[4].clone().add(joints[8]).multiplyScalar(.5);
   if(!was&&now&&this.grabbed===null&&this.distanceTo(grip)<GRAB_REACH){
    // Remember the box's pose in the hand's frame, so it turns and moves with the hand.
    const hand=palmQuaternion(joints).invert();this.holdQuat.copy(hand).multiply(this.quat);this.holdPos.copy(this.pos).sub(grip).applyQuaternion(hand);
    this.grabbed=side;this.lastGrip=grip;this.gripVel.set(0,0,0);this.spin=0;
   }
  }
  if(this.grabbed){
   const hand=hands.find(h=>h.side===this.grabbed);
   if(hand&&this.pinching[this.grabbed]){
    const grip=hand.joints[4].clone().add(hand.joints[8]).multiplyScalar(.5),q=palmQuaternion(hand.joints);
    if(this.lastGrip)this.gripVel.lerp(grip.clone().sub(this.lastGrip).divideScalar(dt),.5);this.lastGrip=grip;
    this.pos.copy(grip).add(this.holdPos.clone().applyQuaternion(q));this.quat.copy(q).multiply(this.holdQuat);this.vel.set(0,0,0);this.onTable=false;return;
   }
   // Let go: the box keeps the hand's speed (a throw).
   this.vel.copy(this.gripVel).clampLength(0,MAX_SPEED);this.grabbed=null;this.lastGrip=null;
  }
  this.vel.y-=G*dt;this.pos.addScaledVector(this.vel,dt);this.quat.premultiply(new T.Quaternion().setFromAxisAngle(new T.Vector3(0,1,0),this.spin*dt));
  for(const {side,joints} of hands)this.push(joints,speeds.get(side)!);
  this.rest(dt);
 }
 /** Every joint and the middle of every bone is a small sphere that shoves the box out of the way at the hand's speed. */
 private push(joints:T.Vector3[],speeds:T.Vector3[]){
  const spheres:[T.Vector3,T.Vector3][]=[...joints.map((p,i):[T.Vector3,T.Vector3]=>[p,speeds[i]]),...BONES.map(([a,b]):[T.Vector3,T.Vector3]=>[joints[a].clone().add(joints[b]).multiplyScalar(.5),speeds[a].clone().add(speeds[b]).multiplyScalar(.5)])];
  const inv=this.quat.clone().invert();
  for(const [c,v] of spheres){
   const l=c.clone().sub(this.pos).applyQuaternion(inv),near=l.clone().clampScalar(-BOX_HALF,BOX_HALF),gap=l.clone().sub(near),d=gap.length();
   let n:T.Vector3,depth:number;
   if(d>1e-9){if(d>=FINGER_R)continue;n=gap.divideScalar(d);depth=FINGER_R-d}
   else{const a=(['x','y','z'] as const).reduce((m,k)=>BOX_HALF-Math.abs(l[k])<BOX_HALF-Math.abs(l[m])?k:m,'x' as 'x'|'y'|'z');n=new T.Vector3();n[a]=Math.sign(l[a])||1;depth=FINGER_R+BOX_HALF-Math.abs(l[a])}
   n.applyQuaternion(this.quat);// from the box toward the finger
   this.pos.addScaledVector(n,-depth);
   const into=-v.dot(n),box=-this.vel.dot(n);
   if(into>box){const dv=n.clone().multiplyScalar(-(into-box));this.vel.add(dv);const arm=c.clone().addScaledVector(n,-FINGER_R).sub(this.pos);this.spin+=.75*arm.cross(dv).y/(BOX_HALF*BOX_HALF)}
  }
  this.vel.clampLength(0,MAX_SPEED);this.spin=Math.max(-20,Math.min(20,this.spin));
 }
 /** Table contact, friction, settling flat, and a fresh box if it falls off. */
 private rest(dt:number){
  const m=new T.Matrix4().makeRotationFromQuaternion(this.quat).elements,extent=BOX_HALF*(Math.abs(m[1])+Math.abs(m[5])+Math.abs(m[9]));
  const over=Math.abs(this.pos.x)<=TABLE.halfX&&Math.abs(this.pos.z)<=TABLE.halfZ;
  this.onTable=false;
  if(over&&this.pos.y-extent<=1e-4&&this.pos.y>-extent){
   this.pos.y=extent;this.vel.y=this.vel.y<-.5?-this.vel.y*.25:Math.max(0,this.vel.y);this.onTable=this.vel.y===0;
   const k=Math.exp(-FRICTION*dt);this.vel.x*=k;this.vel.z*=k;this.spin*=k;
   if(this.vel.lengthSq()<1e-6){this.vel.set(0,0,0)}if(Math.abs(this.spin)<.05)this.spin=0;
   // Settle onto the face that is closest to down.
   const axes=[new T.Vector3(1,0,0),new T.Vector3(0,1,0),new T.Vector3(0,0,1)].map(a=>a.applyQuaternion(this.quat)),up=axes.reduce((a,b)=>Math.abs(b.y)>Math.abs(a.y)?b:a),target=new T.Vector3(0,Math.sign(up.y)||1,0);
   if(up.angleTo(target)>1e-4)this.quat.premultiply(new T.Quaternion().slerpQuaternions(new T.Quaternion(),new T.Quaternion().setFromUnitVectors(up,target),Math.min(1,12*dt)));
  }
  if(this.pos.y<-.6)this.reset();
 }
}
