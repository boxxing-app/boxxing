import * as T from 'three';
import {LINKS,type Point} from './types';
import type {Side} from './hands';
import {HandModel} from './handmodel';
import {BOX_HALF,BoxWorld,TABLE,tablePose} from './physics';
/** MediaPipe camera axes (x right, y down, z forward) → Three.js (y up, z toward the viewer). */
export const V=(p:Point)=>new T.Vector3(p.x,-p.y,-p.z);
export const COLORS:Record<Side,number>={right:0xb9f47c,left:0x7cc8f4};
/** Skin tints for the rigged hands: neutral, with a hint of each side's colour. */
const SKIN:Record<Side,number>={right:0xd9e6cf,left:0xcfdce6};
const TIPS=[4,8,12,16,20];
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
/** One hand: the rigged model once it has loaded (an instanced skeleton until then), and the raw landmarks in debug. */
class HandView{
 group=new T.Group();skeleton=new T.Group();joints:T.InstancedMesh;bones:T.InstancedMesh;raw:T.InstancedMesh;model:HandModel|null=null;
 frames:Frame[]=[];shown:T.Vector3[]=Array.from({length:21},()=>new T.Vector3());rawJoints:T.Vector3[]|null=null;lastSeen=-Infinity;
 constructor(color:number){
  const material=new T.MeshLambertMaterial({color});
  this.joints=new T.InstancedMesh(new T.SphereGeometry(1,10,8),material,21);this.bones=new T.InstancedMesh(new T.CylinderGeometry(1,1,1,8),material,LINKS.length);
  this.raw=new T.InstancedMesh(new T.CylinderGeometry(1,1,1,5),new T.MeshBasicMaterial({color:0xffffff,depthTest:false,transparent:true,opacity:.8}),LINKS.length);this.raw.renderOrder=2;
  for(const m of [this.joints,this.bones,this.raw]){m.frustumCulled=false;m.instanceMatrix.setUsage(T.DynamicDrawUsage)}
  this.skeleton.add(this.joints,this.bones);this.group.add(this.skeleton,this.raw);this.group.visible=false;
 }
 setModel(model:HandModel){this.model=model;this.group.add(model.root);this.skeleton.visible=false}
 push(t:number,joints:T.Vector3[],raw:T.Vector3[]|null,now:number){if(now-this.lastSeen>HOLD_MS)this.frames=[];this.frames.push({t,joints});if(this.frames.length>4)this.frames.shift();this.rawJoints=raw;this.lastSeen=now}
 get visible(){return this.group.visible}
 /** Pose the hand as it was at time `at`. Returns false when it is hidden. */
 draw(at:number,now:number){
  if(!this.frames.length||now-this.lastSeen>HOLD_MS){this.group.visible=false;return false}
  const p=sampleAt(this.frames,at,this.shown);
  if(this.model)this.model.pose(p);
  else{for(let j=0;j<21;j++)this.joints.setMatrixAt(j,m4.compose(p[j],q.identity(),s3.setScalar(j===0?.011:TIPS.includes(j)?.0075:.0085)));LINKS.forEach(([x,y],j)=>this.bones.setMatrixAt(j,boneMatrix(p[x],p[y],.0065)));this.joints.instanceMatrix.needsUpdate=true;this.bones.instanceMatrix.needsUpdate=true}
  const raw=this.rawJoints;this.raw.visible=!!raw;if(raw){LINKS.forEach(([x,y],j)=>this.raw.setMatrixAt(j,boneMatrix(raw[x],raw[y],.002)));this.raw.instanceMatrix.needsUpdate=true}
  this.group.visible=true;return true;
 }
}
/** The 3D view, fixed at the phone: it sees exactly what the camera sees, levelled by the phone's tilt. Your hands (rigged models)
 * and a table with a box you can push and pinch-grab. The table appears under your hands once they are in view; double-tap moves it there again. */
export class Viewer{
 renderer:T.WebGLRenderer;scene=new T.Scene();camera=new T.PerspectiveCamera(50,1,.01,20);world=new T.Group();
 hands:Record<Side,HandView>={left:new HandView(COLORS.left),right:new HandView(COLORS.right)};
 box=new BoxWorld();table=new T.Group();private boxMesh:T.Mesh;private shadow:T.Mesh;private boxMaterial:T.MeshLambertMaterial;
 f=1;frameAspect=4/3;onDoubleTap=()=>{};pixelRatio:number;private maxPixelRatio:number;
 private level=new T.Quaternion();private levelTarget=new T.Quaternion();private levelKnown=false;
 /** Smoothed tracker delay (result arrival − capture) and frame interval, in ms: the view runs this far behind to blend between results. */
 private lag=30;private interval=40;private lastT=0;
 /** The table waits for your hands: it is placed under them once they have been in view for a moment. */
 private placed=false;private handsSince=0;
 private resize:ResizeObserver;private frame=0;private lastFrame=0;private dirty=true;private frameTimes:number[]=[];private goodWindows=0;private lastTap=0;
 constructor(private host:HTMLElement,base=import.meta.env.BASE_URL){
  // No MSAA: the edges are small at phone pixel densities, and it is the most expensive part of drawing this scene.
  this.renderer=new T.WebGLRenderer({antialias:false,alpha:true,powerPreference:'high-performance'});
  this.maxPixelRatio=Math.min(devicePixelRatio,1.5);this.pixelRatio=this.maxPixelRatio;this.renderer.setPixelRatio(this.pixelRatio);host.appendChild(this.renderer.domElement);
  this.scene.add(new T.HemisphereLight(0xf8fff7,0x32423d,2.2));const light=new T.DirectionalLight(0xffffff,2.2);light.position.set(.3,.8,.4);this.scene.add(light);
  // The table: a dim surface with a 5 cm grid, the box, and a soft shadow under it.
  const top=new T.Mesh(new T.PlaneGeometry(TABLE.halfX*2,TABLE.halfZ*2).rotateX(-Math.PI/2),new T.MeshLambertMaterial({color:0x22302b,transparent:true,opacity:.75}));
  const lines:number[]=[];for(let x=-TABLE.halfX;x<=TABLE.halfX+1e-6;x+=.05)lines.push(x,0,-TABLE.halfZ,x,0,TABLE.halfZ);for(let z=-TABLE.halfZ;z<=TABLE.halfZ+1e-6;z+=.04)lines.push(-TABLE.halfX,0,z,TABLE.halfX,0,z);
  const grid=new T.LineSegments(new T.BufferGeometry().setAttribute('position',new T.Float32BufferAttribute(lines,3)),new T.LineBasicMaterial({color:0x3f5a4e}));grid.position.y=.0005;
  this.boxMaterial=new T.MeshLambertMaterial({color:0xf4a259});this.boxMesh=new T.Mesh(new T.BoxGeometry(BOX_HALF*2,BOX_HALF*2,BOX_HALF*2),this.boxMaterial);
  this.boxMesh.add(new T.LineSegments(new T.EdgesGeometry(this.boxMesh.geometry),new T.LineBasicMaterial({color:0x5a3714})));
  this.shadow=new T.Mesh(new T.CircleGeometry(BOX_HALF*1.6,20).rotateX(-Math.PI/2),new T.MeshBasicMaterial({color:0x000000,transparent:true,opacity:.35,depthWrite:false}));this.shadow.position.y=.001;
  this.table.add(top,grid,this.shadow,this.boxMesh);this.scene.add(this.table,this.world);this.world.add(this.hands.left.group,this.hands.right.group);
  for(const side of ['left','right'] as Side[])HandModel.load(`${base}hands/${side}.glb`,SKIN[side]).then(m=>{this.hands[side].setModel(m);this.dirty=true}).catch(e=>console.warn('Hand model unavailable; showing the skeleton.',e));
  this.renderer.domElement.style.touchAction='manipulation';
  this.renderer.domElement.addEventListener('pointerup',()=>{const now=performance.now();if(now-this.lastTap<350){this.lastTap=0;this.reset();this.onDoubleTap()}else this.lastTap=now});
  this.resize=new ResizeObserver(()=>this.fit());this.resize.observe(host);this.table.visible=false;this.fit();this.animate();
 }
 /** A tracker result: joint positions in the camera frame (Three.js axes, metres), captured at time t (performance.now()). */
 update(side:Side,t:number,joints:T.Vector3[]|null,raw:T.Vector3[]|null=null){
  if(!joints)return;const now=performance.now();
  if(t>this.lastT){if(this.lastT)this.interval+=.1*(Math.min(200,t-this.lastT)-this.interval);this.lag+=.1*(Math.min(300,now-t)-this.lag);this.lastT=t}
  this.hands[side].push(t,joints,raw,now);
 }
 /** Rotation from the camera frame to a level frame (from the phone's tilt), or null while unknown. The view eases toward it. */
 setLevel(level:T.Quaternion|null){if(!level)return;this.levelTarget.copy(level);if(!this.levelKnown){this.levelKnown=true;this.level.copy(level);this.reset()}}
 /** The camera's focal length (frame heights) and frame shape. The 3D view shows exactly the camera's frame, letterboxed like the image. */
 setCamera(f:number,frameAspect:number){if(Math.abs(f-this.f)<1e-6&&Math.abs(frameAspect-this.frameAspect)<1e-6)return;this.f=f;this.frameAspect=frameAspect;this.fit()}
 /** Take the table away until your hands are in view again, then place it under them with a fresh box. */
 reset(){this.placed=false;this.handsSince=0;this.table.visible=false;this.box.reset();this.dirty=true}
 private placeUnder(palms:T.Vector3[]){const pose=tablePose(palms,new T.Vector3(0,0,-1).applyQuaternion(this.levelTarget));this.table.position.copy(pose.position);this.table.quaternion.copy(pose.quaternion);this.table.visible=true;this.placed=true;this.box.reset();this.dirty=true}
 fit(){const w=this.host.clientWidth,h=Math.max(1,this.host.clientHeight);this.renderer.setSize(w,h);this.camera.aspect=w/h;this.camera.fov=2*Math.atan(Math.max(1,this.frameAspect/this.camera.aspect)/2/this.f)*180/Math.PI;this.camera.updateProjectionMatrix();this.dirty=true}
 /** Lower the resolution when frames take too long, raise it again when there is room. */
 private adapt(dt:number){
  this.frameTimes.push(dt);if(this.frameTimes.length<60)return;
  const sorted=[...this.frameTimes].sort((a,b)=>a-b),median=sorted[30];this.frameTimes=[];
  let next=this.pixelRatio;
  if(median>22){next=Math.max(.75,this.pixelRatio-.25);this.goodWindows=0}else if(median<17.5&&++this.goodWindows>=3){next=Math.min(this.maxPixelRatio,this.pixelRatio+.25);this.goodWindows=0}
  if(next!==this.pixelRatio){this.pixelRatio=next;this.renderer.setPixelRatio(next);this.fit()}
 }
 private animate=()=>{
  const now=performance.now(),dt=this.lastFrame?(now-this.lastFrame)/1000:1/60;this.lastFrame=now;
  const turning=this.level.angleTo(this.levelTarget)>1e-4;if(turning)this.level.slerp(this.levelTarget,.15);
  this.world.quaternion.copy(this.level);this.camera.quaternion.copy(this.level);
  const at=now-this.lag-this.interval;let shown=false;for(const h of Object.values(this.hands)){const was=h.visible;shown=h.draw(at,now)||shown;if(was!==h.visible)this.dirty=true}
  // Physics in the table's frame: hands go camera frame → level → table.
  const toTable=this.table.quaternion.clone().invert(),hands=(['left','right'] as Side[]).filter(s=>this.hands[s].visible).map(side=>({side,joints:this.hands[side].shown.map(p=>p.clone().applyQuaternion(this.level).sub(this.table.position).applyQuaternion(toTable))}));
  if(!this.placed){
   if(!hands.length)this.handsSince=0;else if(!this.handsSince)this.handsSince=now;
   else if(now-this.handsSince>300)this.placeUnder((['left','right'] as Side[]).filter(side=>this.hands[side].visible).map(side=>this.hands[side].shown[9].clone().applyQuaternion(this.level)));
  }
  const busy=this.placed&&(this.box.moving||hands.length>0);
  if(busy){
   this.box.step(dt,hands);this.boxMesh.position.copy(this.box.pos);this.boxMesh.quaternion.copy(this.box.quat);
   this.boxMaterial.color.setHex(this.box.grabbed?0xffd166:hands.some(h=>this.box.isPinching(h.side))?0xf7b97a:0xf4a259);
   const height=Math.max(0,this.box.pos.y-BOX_HALF);this.shadow.position.set(this.box.pos.x,.001,this.box.pos.z);(this.shadow.material as T.MeshBasicMaterial).opacity=.35*Math.max(0,1-height/.3);
  }
  // Draw only when something changed: hands on screen, the box moving, the phone turning, or a resize.
  if(shown||busy||turning||this.dirty){this.renderer.render(this.scene,this.camera);this.dirty=false;this.adapt(dt*1000)}
  this.frame=requestAnimationFrame(this.animate);
 };
 dispose(){cancelAnimationFrame(this.frame);this.resize.disconnect();this.scene.traverse(o=>{if(o instanceof T.Mesh){o.geometry.dispose();if(o.material instanceof T.Material)o.material.dispose()}});this.renderer.dispose();this.renderer.domElement.remove()}
}
