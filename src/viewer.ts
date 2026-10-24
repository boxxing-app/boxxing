import * as T from 'three';
import {LINKS,type Point} from './types';
import type {Side} from './hands';
/** MediaPipe camera axes (x right, y down, z forward) → Three.js (y up, z toward the viewer). */
export const V=(p:Point)=>new T.Vector3(p.x,-p.y,-p.z);
export const COLORS:Record<Side,number>={right:0xb9f47c,left:0x7cc8f4};
const PALM=[0,1,5,9,13,17];
class HandMesh{
 group=new T.Group();joints:T.Mesh[]=[];bones:T.Mesh[]=[];palm:T.Mesh;raw=new T.Group();rawLines:T.Mesh[]=[];
 constructor(color:number){
  const skin=new T.MeshStandardMaterial({color,roughness:.55,metalness:.1}),joint=new T.SphereGeometry(1,14,10),bone=new T.CylinderGeometry(1,1,1,12);
  for(let i=0;i<21;i++){const m=new T.Mesh(joint,skin);const r=i===0?.011:[4,8,12,16,20].includes(i)?.0075:.0085;m.scale.setScalar(r);this.joints.push(m);this.group.add(m)}
  for(const _ of LINKS){const m=new T.Mesh(bone,skin);this.bones.push(m);this.group.add(m)}
  const palm=new T.BufferGeometry();palm.setAttribute('position',new T.BufferAttribute(new Float32Array(PALM.length*3),3));palm.setIndex(PALM.slice(1,-1).flatMap((_,i)=>[0,i+1,i+2]));
  this.palm=new T.Mesh(palm,new T.MeshStandardMaterial({color,roughness:.7,transparent:true,opacity:.45,side:T.DoubleSide}));this.group.add(this.palm);
  const raw=new T.MeshBasicMaterial({color:0xffffff,depthTest:false,transparent:true,opacity:.8});
  for(const _ of LINKS){const m=new T.Mesh(bone,raw);m.renderOrder=2;this.rawLines.push(m);this.raw.add(m)}
  this.group.add(this.raw);this.group.visible=false;
 }
 private static place(m:T.Mesh,a:T.Vector3,b:T.Vector3,r:number){const d=b.clone().sub(a),len=d.length();m.position.copy(a).add(b).multiplyScalar(.5);m.scale.set(r,Math.max(len,1e-5),r);if(len>1e-6)m.quaternion.setFromUnitVectors(new T.Vector3(0,1,0),d.divideScalar(len))}
 update(joints:T.Vector3[],raw:T.Vector3[]|null){
  joints.forEach((p,i)=>this.joints[i].position.copy(p));
  LINKS.forEach(([a,b],i)=>HandMesh.place(this.bones[i],joints[a],joints[b],a===0||b-a!==1?.006:.0065));
  const pos=this.palm.geometry.getAttribute('position') as T.BufferAttribute;PALM.forEach((j,i)=>pos.setXYZ(i,joints[j].x,joints[j].y,joints[j].z));pos.needsUpdate=true;this.palm.geometry.computeVertexNormals();this.palm.geometry.computeBoundingSphere();
  this.raw.visible=!!raw;if(raw)LINKS.forEach(([a,b],i)=>HandMesh.place(this.rawLines[i],raw[a],raw[b],.002));
  this.group.visible=true;
 }
}
/** The 3D view: both hands where they are in front of the phone, seen from the phone by default.
 * Drag to orbit, pinch or scroll to zoom, double-tap to go back to the phone's view. */
export class Viewer{
 renderer:T.WebGLRenderer;scene=new T.Scene();camera=new T.PerspectiveCamera(50,1,.01,20);hands:Record<Side,HandMesh>={left:new HandMesh(COLORS.left),right:new HandMesh(COLORS.right)};
 orbiting=false;mirrored=false;f=1;frameAspect=4/3;onDoubleTap=()=>{};private resize:ResizeObserver;private frame=0;private target=new T.Vector3(0,0,-.4);private pointers=new Map<number,{x:number;y:number}>();private lastTap=0;private moved=0;
 constructor(private host:HTMLElement){
  this.renderer=new T.WebGLRenderer({antialias:true,alpha:true,powerPreference:'high-performance'});this.renderer.setPixelRatio(Math.min(devicePixelRatio,1.5));host.appendChild(this.renderer.domElement);
  this.scene.add(new T.HemisphereLight(0xf8fff7,0x32423d,2.2));const light=new T.DirectionalLight(0xffffff,2.5);light.position.set(.3,.6,.4);this.scene.add(light);
  // A faint 5 cm grid below the hands, for depth when orbiting.
  const grid=new T.GridHelper(1.2,24,0x3f5a4e,0x26332e);grid.position.set(0,-.25,-.5);this.scene.add(grid,this.hands.left.group,this.hands.right.group);
  this.bindPointer(this.renderer.domElement);this.resize=new ResizeObserver(()=>this.fit());this.resize.observe(host);this.resetView();this.animate();
 }
 /** Joint positions in Three.js coordinates (metres, phone at the origin); null hides that hand. raw is the debug skeleton. */
 update(side:Side,joints:T.Vector3[]|null,raw:T.Vector3[]|null=null){if(joints)this.hands[side].update(joints,raw);else this.hands[side].group.visible=false}
 /** The camera's focal length (frame heights) and frame shape. The 3D view shows exactly the camera's frame, letterboxed like the image. */
 setCamera(f:number,frameAspect:number){if(Math.abs(f-this.f)<1e-6&&Math.abs(frameAspect-this.frameAspect)<1e-6)return;this.f=f;this.frameAspect=frameAspect;this.fit()}
 resetView(){this.orbiting=false;this.camera.position.set(0,0,0);this.camera.quaternion.identity();this.fit()}
 fit(){const w=this.host.clientWidth,h=Math.max(1,this.host.clientHeight);this.renderer.setSize(w,h);this.camera.aspect=w/h;this.camera.fov=2*Math.atan(Math.max(1,this.frameAspect/this.camera.aspect)/2/this.f)*180/Math.PI;this.camera.updateProjectionMatrix()}
 private bindPointer(el:HTMLElement){
  el.style.touchAction='none';
  const centre=()=>{const shown=Object.values(this.hands).filter(h=>h.group.visible);if(!shown.length)return new T.Vector3(0,0,-.4);return shown.reduce((s,h)=>s.add(h.joints[9].position),new T.Vector3()).divideScalar(shown.length)};
  const orbit=(dx:number,dy:number)=>{
   if(!this.orbiting){this.orbiting=true;this.target.copy(centre())}
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
 private animate=()=>{this.renderer.render(this.scene,this.camera);this.frame=requestAnimationFrame(this.animate)};
 dispose(){cancelAnimationFrame(this.frame);this.resize.disconnect();this.scene.traverse(o=>{if(o instanceof T.Mesh){o.geometry.dispose();if(o.material instanceof T.Material)o.material.dispose()}});this.renderer.dispose();this.renderer.domElement.remove()}
}
