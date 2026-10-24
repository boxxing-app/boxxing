import * as T from 'three';
import type {Facing} from './types';
type Reading={x:number;y:number;z:number};
type GenericSensor=Reading&{start():void;stop():void;addEventListener(type:string,fn:()=>void):void};
type Orientation=typeof DeviceOrientationEvent&{requestPermission?:()=>Promise<string>};
/** The phone's tilt: gravity "up" in device axes (x screen-right, y screen-top, z out of the screen).
 * Uses Chrome's GravitySensor where available (smooth, 30 Hz), else deviceorientation. Never position: integrating
 * the accelerometer drifts by metres within seconds. */
export class Tilt{
 up:T.Vector3|null=null;source:'gravity sensor'|'orientation'|null=null;private gravityAt=0;
 /** Starts every source that needs no prompt. On iOS, call requestPermission() from a tap. */
 start(){
  const G=(globalThis as {GravitySensor?:new(o:{frequency:number})=>GenericSensor}).GravitySensor;
  if(G)try{const s=new G({frequency:30});s.addEventListener('reading',()=>{this.gravityAt=performance.now();this.set(s,'gravity sensor')});s.addEventListener('error',()=>s.stop());s.start()}catch{}
  if(!this.needsPermission)this.listen();
 }
 get needsPermission(){return typeof (globalThis.DeviceOrientationEvent as Orientation|undefined)?.requestPermission==='function'}
 /** iOS only. Must run inside a tap handler. */
 async requestPermission(){const C=globalThis.DeviceOrientationEvent as Orientation|undefined;if(C?.requestPermission&&await C.requestPermission()==='granted')this.listen()}
 private listening=false;
 private listen(){if(this.listening||typeof window==='undefined')return;this.listening=true;window.addEventListener('deviceorientation',e=>{
  if(e.beta===null||e.gamma===null||performance.now()-this.gravityAt<1000)return;// the gravity sensor wins while it is delivering
  const b=e.beta*Math.PI/180,g=e.gamma*Math.PI/180;this.set({x:-Math.cos(b)*Math.sin(g),y:Math.sin(b),z:Math.cos(b)*Math.cos(g)},'orientation')})}
 private set(r:Reading,source:Tilt['source']){const v=new T.Vector3(r.x,r.y,r.z);if(v.lengthSq()<1e-6)return;this.up=v.normalize();this.source=source}
}
export const screenAngle=()=>typeof screen!=='undefined'?screen.orientation?.angle??0:0;
/** Gravity "up" in the camera frame (Three.js axes: x image right, y image up, z out of the back of the lens).
 * Front camera frames are unmirrored, so their image right is the screen's left. */
export function cameraUp(deviceUp:T.Vector3|null,angleDeg:number,facing:Facing):T.Vector3|null{
 if(!deviceUp)return null;const a=angleDeg*Math.PI/180,up=deviceUp;
 const screenUp=new T.Vector3(Math.sin(a),Math.cos(a),0),screenRight=new T.Vector3(Math.cos(a),-Math.sin(a),0);
 return facing==='user'?new T.Vector3(-up.dot(screenRight),up.dot(screenUp),-up.z):new T.Vector3(up.dot(screenRight),up.dot(screenUp),up.z);
}
/** Rotation from the camera frame to a level frame (gravity = -y), keeping the camera's heading. */
export const levelQuaternion=(up:T.Vector3|null)=>up?new T.Quaternion().setFromUnitVectors(up.clone().normalize(),new T.Vector3(0,1,0)):new T.Quaternion();
/** Pitch: the lens axis above the horizon (negative = pointing down). Roll: how far true vertical leans to the image right. */
export function phoneAngles(up:T.Vector3){const u=up.clone().normalize();return{pitchDeg:Math.asin(Math.max(-1,Math.min(1,-u.z)))*180/Math.PI,rollDeg:Math.atan2(u.x,u.y)*180/Math.PI}}
