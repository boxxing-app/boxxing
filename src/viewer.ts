import * as T from 'three';
import {LINKS,type Point,type RigData} from './types';
import {Humanoid,V} from './rig';
import {RootMotion,type PhoneView} from './motion';
const DEFAULT_VIEW:PhoneView={position:new T.Vector3(0,1,3),quaternion:new T.Quaternion().setFromEuler(new T.Euler(-.03,0,0)),f:1.25,aspect:16/9};
/** The 3D world: avatar on a floor grid, seen from the phone by default. Drag to orbit, pinch or scroll to zoom, double-tap to go back to the phone's view. */
export class Viewer{
 renderer:T.WebGLRenderer;scene=new T.Scene();camera=new T.PerspectiveCamera(45,1,.05,60);rig=new Humanoid();motion=new RootMotion();
 body=new T.Group();raw=new T.Group();spheres:T.Mesh[]=[];lines:T.Mesh[]=[];
 orbiting=false;mirrored=false;private resize:ResizeObserver;private frame=0;private target=new T.Vector3(0,.9,0);private pointers=new Map<number,{x:number;y:number}>();private lastTap=0;private moved=0;
 constructor(private host:HTMLElement,public debug=false){
  this.renderer=new T.WebGLRenderer({antialias:true,alpha:true,powerPreference:'high-performance'});this.renderer.setPixelRatio(Math.min(devicePixelRatio,1.5));host.appendChild(this.renderer.domElement);
  this.scene.add(new T.HemisphereLight(0xf8fff7,0x32423d,2.5));const light=new T.DirectionalLight(0xffffff,3);light.position.set(2,4,3);this.scene.add(light);
  const grid=new T.GridHelper(10,20,0x5d7a6b,0x2c3b35);this.scene.add(grid,this.body);this.body.add(this.rig.mesh,this.raw);
  const material=new T.MeshBasicMaterial({color:0x5dff6a,depthTest:false,transparent:true,opacity:.9});
  for(let i=0;i<33;i++){const m=new T.Mesh(new T.SphereGeometry(.022,8,6),material);m.renderOrder=2;this.spheres.push(m);this.raw.add(m)}
  for(const _ of LINKS){const m=new T.Mesh(new T.CylinderGeometry(.01,.01,1,6),material);m.renderOrder=2;this.lines.push(m);this.raw.add(m)}
  this.raw.visible=false;this.body.visible=false;this.bindPointer(this.renderer.domElement);
  this.resize=new ResizeObserver(()=>this.fit());this.resize.observe(host);this.fit();this.animate();
 }
 /** Feed one tracker frame. raw = unfiltered world points (debug skeleton), smoothed world/image points drive the avatar. */
 update(raw:Point[],smoothed:Point[],image:Point[],t:number,aspect:number,level:T.Quaternion):RigData|null{
  if(smoothed.length!==33){this.body.visible=false;return null}
  this.body.visible=true;this.rig.calibrate(smoothed,image);const r=this.rig.solve(smoothed,image,aspect);
  const hadView=!!this.motion.view,offset=this.motion.update({t,world:smoothed,image,rig:r.world,scale:r.projection?.scale??null,aspect,level,ready:this.rig.calibrated});
  this.body.quaternion.copy(level);this.body.position.copy(offset);
  if(!hadView&&this.motion.view&&!this.orbiting)this.applyView();
  this.raw.visible=this.debug;
  if(this.debug){raw.forEach((p,i)=>this.spheres[i].position.copy(V(p)));LINKS.forEach(([a,b],i)=>{const start=V(raw[a]),end=V(raw[b]),m=this.lines[i];m.position.copy(start).add(end).multiplyScalar(.5);m.scale.y=Math.max(1e-4,start.distanceTo(end));m.quaternion.setFromUnitVectors(new T.Vector3(0,1,0),end.sub(start).normalize())})}
  return r;
 }
 /** Start over: re-measure the floor, the start position and the bone lengths, and return to the phone's view. */
 recalibrate(){this.motion.reset();this.rig.resetCalibration();this.resetView()}
 resetView(){this.orbiting=false;this.applyView()}
 private get view(){return this.motion.view??DEFAULT_VIEW}
 private applyView(){const v=this.view;this.camera.position.copy(v.position);this.camera.quaternion.copy(v.quaternion);this.fit()}
 fit(){const w=this.host.clientWidth,h=Math.max(1,this.host.clientHeight);this.renderer.setSize(w,h);this.camera.aspect=w/h;
  // The phone camera's vertical field of view fills the pane's height, so the avatar is as tall as you are in the camera image (only the sides differ).
  this.camera.fov=2*Math.atan(.5/this.view.f)*180/Math.PI;this.camera.updateProjectionMatrix()}
 private bindPointer(el:HTMLElement){
  el.style.touchAction='none';
  const orbit=(dx:number,dy:number)=>{
   if(!this.orbiting){this.orbiting=true;this.target.set(this.body.position.x,this.motion.standingHeight||.9,this.body.position.z)}
   const offset=this.camera.position.clone().sub(this.target),s=new T.Spherical().setFromVector3(offset),k=2*Math.PI/Math.max(1,el.clientHeight);
   // A mirrored view flips screen x, so flip horizontal drags to keep the scene under the finger.
   s.theta-=dx*k*(this.mirrored?-1:1);s.phi=Math.min(Math.PI-.05,Math.max(.05,s.phi-dy*k));
   this.camera.position.copy(this.target).add(new T.Vector3().setFromSpherical(s));this.camera.lookAt(this.target);
  };
  const zoom=(factor:number)=>{if(!this.orbiting)orbit(0,0);const offset=this.camera.position.clone().sub(this.target);offset.setLength(Math.min(15,Math.max(.8,offset.length()*factor)));this.camera.position.copy(this.target).add(offset)};
  el.addEventListener('pointerdown',e=>{el.setPointerCapture(e.pointerId);this.pointers.set(e.pointerId,{x:e.clientX,y:e.clientY});if(this.pointers.size===1)this.moved=0});
  el.addEventListener('pointermove',e=>{const last=this.pointers.get(e.pointerId);if(!last)return;
   if(this.pointers.size===1){const dx=e.clientX-last.x,dy=e.clientY-last.y;this.moved+=Math.abs(dx)+Math.abs(dy);if(this.moved>6)orbit(dx,dy)}
   else if(this.pointers.size===2){const other=[...this.pointers.entries()].find(([id])=>id!==e.pointerId)![1],before=Math.hypot(last.x-other.x,last.y-other.y),after=Math.hypot(e.clientX-other.x,e.clientY-other.y);this.moved=99;if(before>0&&after>0)zoom(before/after)}
   this.pointers.set(e.pointerId,{x:e.clientX,y:e.clientY})});
  const up=(e:PointerEvent)=>{if(!this.pointers.delete(e.pointerId))return;if(this.pointers.size||this.moved>6)return;const now=performance.now();if(now-this.lastTap<350){this.lastTap=0;this.motion.reset();this.resetView()}else this.lastTap=now};
  el.addEventListener('pointerup',up);el.addEventListener('pointercancel',e=>{this.pointers.delete(e.pointerId)});
  el.addEventListener('wheel',e=>{e.preventDefault();zoom(Math.exp(e.deltaY*.001))},{passive:false});
 }
 private animate=()=>{this.renderer.render(this.scene,this.camera);this.frame=requestAnimationFrame(this.animate)};
 dispose(){cancelAnimationFrame(this.frame);this.resize.disconnect();this.rig.dispose();this.scene.traverse(o=>{if(o instanceof T.Mesh&&o!==this.rig.mesh){o.geometry.dispose();if(o.material instanceof T.Material)o.material.dispose()}});this.renderer.dispose();this.renderer.domElement.remove()}
}
