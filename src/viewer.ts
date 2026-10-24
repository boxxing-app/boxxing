import * as T from 'three';
import {LINKS,type Point} from './types';
import type {Side} from './hands';
/** MediaPipe camera axes (x right, y down, z forward) → Three.js (y up, z toward the viewer). */
export const V=(p:Point)=>new T.Vector3(p.x,-p.y,-p.z);
export const COLORS:Record<Side,number>={right:0xb9f47c,left:0x7cc8f4};
const PALM_OUTLINE=[0,1,5,9,13,17],TIPS=[4,8,12,16,20];
/** A lost hand stays on screen this long, so a missed frame or two does not make it flicker. */
const HOLD_MS=250;
export type Frame={t:number;joints:T.Vector3[]};
/** Joints at time `at`, blended between the two tracker results around it (frames in time order); the newest if `at` is later. */
export function sampleAt(frames:Frame[],at:number,out:T.Vector3[]){
 let i=frames.length-1;while(i>0&&frames[i-1].t>at)i--;
 const b=frames[i],a=frames[Math.max(0,i-1)],k=b.t>a.t?Math.min(1,Math.max(0,(at-a.t)/(b.t-a.t))):1;
 for(let j=0;j<out.length;j++)out[j].lerpVectors(a.joints[j],b.joints[j],k);
 return out;
}
const Y=new T.Vector3(0,1,0),m4=new T.Matrix4(),q=new T.Quaternion(),s3=new T.Vector3(),d3=new T.Vector3(),c3=new T.Vector3();
/** Cylinder (unit radius, unit height along y) from a to b. */
function boneMatrix(a:T.Vector3,b:T.Vector3,r:number){d3.subVectors(b,a);const len=d3.length();q.setFromUnitVectors(Y,len>1e-9?d3.divideScalar(len):Y);return m4.compose(c3.addVectors(a,b).multiplyScalar(.5),q,s3.set(r,Math.max(len,1e-5),r))}
/** One hand in two draw calls (instanced joints and bones) plus the palm. */
class HandMesh{
 group=new T.Group();joints:T.InstancedMesh;bones:T.InstancedMesh;palm:T.Mesh;raw:T.InstancedMesh;
 frames:Frame[]=[];shown:T.Vector3[]=Array.from({length:21},()=>new T.Vector3());rawJoints:T.Vector3[]|null=null;lastSeen=-Infinity;
 constructor(color:number){
  const skin=new T.MeshStandardMaterial({color,roughness:.55,metalness:.1});
  this.joints=new T.InstancedMesh(new T.SphereGeometry(1,14,10),skin,21);this.bones=new T.InstancedMesh(new T.CylinderGeometry(1,1,1,12),skin,LINKS.length);
  const palm=new T.BufferGeometry();palm.setAttribute('position',new T.BufferAttribute(new Float32Array(PALM_OUTLINE.length*3),3));palm.setIndex(PALM_OUTLINE.slice(1,-1).flatMap((_,i)=>[0,i+1,i+2]));
  this.palm=new T.Mesh(palm,new T.MeshStandardMaterial({color,roughness:.7,transparent:true,opacity:.45,side:T.DoubleSide}));
  this.raw=new T.InstancedMesh(new T.CylinderGeometry(1,1,1,6),new T.MeshBasicMaterial({color:0xffffff,depthTest:false,transparent:true,opacity:.8}),LINKS.length);this.raw.renderOrder=2;
  for(const m of [this.joints,this.bones,this.raw]){m.frustumCulled=false;m.instanceMatrix.setUsage(T.DynamicDrawUsage)}
  this.group.add(this.joints,this.bones,this.palm,this.raw);this.group.visible=false;
 }
 push(t:number,joints:T.Vector3[],raw:T.Vector3[]|null,now:number){if(now-this.lastSeen>HOLD_MS)this.frames=[];this.frames.push({t,joints});if(this.frames.length>4)this.frames.shift();this.rawJoints=raw;this.lastSeen=now}
 /** Show the hand as it was at time `at`, blended between the two tracker results around it. */
 draw(at:number,now:number){
  if(!this.frames.length||now-this.lastSeen>HOLD_MS){this.group.visible=false;return}
  const p=sampleAt(this.frames,at,this.shown);
  for(let j=0;j<21;j++)this.joints.setMatrixAt(j,m4.compose(p[j],q.identity(),s3.setScalar(j===0?.011:TIPS.includes(j)?.0075:.0085)));
  LINKS.forEach(([x,y],j)=>this.bones.setMatrixAt(j,boneMatrix(p[x],p[y],x===0||y-x!==1?.006:.0065)));
  this.joints.instanceMatrix.needsUpdate=true;this.bones.instanceMatrix.needsUpdate=true;
  const pos=this.palm.geometry.getAttribute('position') as T.BufferAttribute;PALM_OUTLINE.forEach((j,n)=>pos.setXYZ(n,p[j].x,p[j].y,p[j].z));pos.needsUpdate=true;this.palm.geometry.computeVertexNormals();this.palm.geometry.computeBoundingSphere();
  const raw=this.rawJoints;this.raw.visible=!!raw;if(raw){LINKS.forEach(([x,y],j)=>this.raw.setMatrixAt(j,boneMatrix(raw[x],raw[y],.002)));this.raw.instanceMatrix.needsUpdate=true}
  this.group.visible=true;
 }
}
/** The 3D view: both hands where they are in front of the phone, seen from the phone by default, levelled by the phone's tilt.
 * Drag to orbit, pinch or scroll to zoom, double-tap to go back to the phone's view. */
export class Viewer{
 renderer:T.WebGLRenderer;scene=new T.Scene();camera=new T.PerspectiveCamera(50,1,.01,20);world=new T.Group();grid:T.GridHelper;
 hands:Record<Side,HandMesh>={left:new HandMesh(COLORS.left),right:new HandMesh(COLORS.right)};
 orbiting=false;mirrored=false;f=1;frameAspect=4/3;onDoubleTap=()=>{};
 private level=new T.Quaternion();private levelTarget=new T.Quaternion();
 /** Smoothed tracker delay (result arrival − capture) and frame interval, in ms: the view runs this far behind to blend between results. */
 private lag=30;private interval=40;private lastT=0;
 private resize:ResizeObserver;private frame=0;private target=new T.Vector3(0,0,-.4);private pointers=new Map<number,{x:number;y:number}>();private lastTap=0;private moved=0;
 constructor(private host:HTMLElement){
  this.renderer=new T.WebGLRenderer({antialias:true,alpha:true,powerPreference:'high-performance'});this.renderer.setPixelRatio(Math.min(devicePixelRatio,1.5));host.appendChild(this.renderer.domElement);
  this.scene.add(new T.HemisphereLight(0xf8fff7,0x32423d,2.2));const light=new T.DirectionalLight(0xffffff,2.5);light.position.set(.3,.6,.4);this.scene.add(light);
  // A faint 5 cm grid below the hands, level with the real floor when the phone's tilt is known.
  this.grid=new T.GridHelper(1.2,24,0x3f5a4e,0x26332e);this.scene.add(this.grid,this.world);this.world.add(this.hands.left.group,this.hands.right.group);
  this.bindPointer(this.renderer.domElement);this.resize=new ResizeObserver(()=>this.fit());this.resize.observe(host);this.resetView();this.animate();
 }
 /** A tracker result: joint positions in the camera frame (Three.js axes, metres), captured at time t (performance.now()). null = not seen. */
 update(side:Side,t:number,joints:T.Vector3[]|null,raw:T.Vector3[]|null=null){
  if(!joints)return;const now=performance.now();
  if(t>this.lastT){if(this.lastT)this.interval+=.1*(Math.min(200,t-this.lastT)-this.interval);this.lag+=.1*(Math.min(300,now-t)-this.lag);this.lastT=t}
  this.hands[side].push(t,joints,raw,now);
 }
 /** Rotation from the camera frame to a level frame (from the phone's tilt). The view eases toward it. */
 setLevel(level:T.Quaternion){this.levelTarget.copy(level)}
 /** The camera's focal length (frame heights) and frame shape. The 3D view shows exactly the camera's frame, letterboxed like the image. */
 setCamera(f:number,frameAspect:number){if(Math.abs(f-this.f)<1e-6&&Math.abs(frameAspect-this.frameAspect)<1e-6)return;this.f=f;this.frameAspect=frameAspect;this.fit()}
 resetView(){this.orbiting=false;this.camera.position.set(0,0,0);this.camera.quaternion.copy(this.level);this.fit()}
 fit(){const w=this.host.clientWidth,h=Math.max(1,this.host.clientHeight);this.renderer.setSize(w,h);this.camera.aspect=w/h;this.camera.fov=2*Math.atan(Math.max(1,this.frameAspect/this.camera.aspect)/2/this.f)*180/Math.PI;this.camera.updateProjectionMatrix()}
 private centre(){const shown=Object.values(this.hands).filter(h=>h.group.visible);if(!shown.length)return new T.Vector3(0,0,-.4).applyQuaternion(this.level);return shown.reduce((s,h)=>s.add(h.shown[9]),new T.Vector3()).divideScalar(shown.length).applyQuaternion(this.level)}
 private bindPointer(el:HTMLElement){
  el.style.touchAction='none';
  const orbit=(dx:number,dy:number)=>{
   if(!this.orbiting){this.orbiting=true;this.target.copy(this.centre())}
   const s=new T.Spherical().setFromVector3(this.camera.position.clone().sub(this.target)),k=2*Math.PI/Math.max(1,el.clientHeight);
   // A mirrored view flips screen x, so flip horizontal drags to keep the scene under the finger.
   s.theta-=dx*k*(this.mirrored?-1:1);s.phi=Math.min(Math.PI-.05,Math.max(.05,s.phi-dy*k));
   this.camera.position.copy(this.target).add(new T.Vector3().setFromSpherical(s));this.camera.lookAt(this.target);
  };
  const zoom=(factor:number)=>{if(!this.orbiting)orbit(0,0);const offset=this.camera.position.clone().sub(this.target);offset.setLength(Math.min(3,Math.max(.1,offset.length()*factor)));this.camera.position.copy(this.target).add(offset)};
  el.addEventListener('pointerdown',e=>{el.setPointerCapture(e.pointerId);this.pointers.set(e.pointerId,{x:e.clientX,y:e.clientY});if(this.pointers.size===1)this.moved=0});
  el.addEventListener('pointermove',e=>{const last=this.pointers.get(e.pointerId);if(!last)return;
   if(this.pointers.size===1){const dx=e.clientX-last.x,dy=e.clientY-last.y;this.moved+=Math.abs(dx)+Math.abs(dy);if(this.moved>6)orbit(dx,dy)}
   else if(this.pointers.size===2){const other=[...this.pointers.entries()].find(([id])=>id!==e.pointerId)![1],before=Math.hypot(last.x-other.x,last.y-other.y),after=Math.hypot(e.clientX-other.x,e.clientY-other.y);this.moved=99;if(before>0&&after>0)zoom(before/after)}
   this.pointers.set(e.pointerId,{x:e.clientX,y:e.clientY})});
  const up=(e:PointerEvent)=>{if(!this.pointers.delete(e.pointerId))return;if(this.pointers.size||this.moved>6)return;const now=performance.now();if(now-this.lastTap<350){this.lastTap=0;this.resetView();this.onDoubleTap()}else this.lastTap=now};
  el.addEventListener('pointerup',up);el.addEventListener('pointercancel',e=>{this.pointers.delete(e.pointerId)});
  el.addEventListener('wheel',e=>{e.preventDefault();zoom(Math.exp(e.deltaY*.001))},{passive:false});
 }
 private animate=()=>{
  const now=performance.now();
  this.level.slerp(this.levelTarget,.15);this.world.quaternion.copy(this.level);
  if(!this.orbiting){this.camera.quaternion.copy(this.level);const ahead=new T.Vector3(0,0,-1).applyQuaternion(this.level);ahead.y=0;if(ahead.lengthSq()>1e-6)ahead.setLength(.5);this.grid.position.set(ahead.x,-.25,ahead.z)}
  const at=now-this.lag-this.interval;for(const h of Object.values(this.hands))h.draw(at,now);
  this.renderer.render(this.scene,this.camera);this.frame=requestAnimationFrame(this.animate);
 };
 dispose(){cancelAnimationFrame(this.frame);this.resize.disconnect();this.scene.traverse(o=>{if(o instanceof T.Mesh){o.geometry.dispose();if(o.material instanceof T.Material)o.material.dispose()}});this.renderer.dispose();this.renderer.domElement.remove()}
}
