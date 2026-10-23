import {describe,expect,it} from 'vitest';
import * as T from 'three';
import {Humanoid,V} from '../src/rig';
import {RootMotion,cameraUp,levelQuaternion,phoneAngles} from '../src/motion';
import {DEMO_CAMERA,demoPose,duck,project,slip,turn,twist} from '../src/demo';
import {PoseFilter} from '../src/filter';
import {IMAGE_FILTER,WORLD_FILTER,type Point} from '../src/types';
import {mid} from '../src/math';

const cam=DEMO_CAMERA,level=new T.Quaternion();
const degrees=(a:T.Vector3,b:T.Vector3)=>a.angleTo(b)*180/Math.PI;
/** Bone position relative to the avatar mesh, in Three.js axes. */
const at=(rig:Humanoid,name:string)=>rig.mesh.worldToLocal(rig.byName[name].getWorldPosition(new T.Vector3()));
const meshQuaternion=(rig:Humanoid,name:string)=>rig.mesh.getWorldQuaternion(new T.Quaternion()).invert().multiply(rig.byName[name].getWorldQuaternion(new T.Quaternion()));
/** Largest angle between each rig bone and the landmark direction it should follow. */
function boneErrors(rig:Humanoid,p:Point[]){
 const r=rig.solve(p,project(p,{x:0,y:-.15,z:-3},cam),cam.aspect),w=(i:number)=>V(r.world[i]),d=(a:number,b:number)=>V(p[b]).sub(V(p[a]));
 const errors:Record<string,number>={};
 for(const [a,b] of [[11,13],[13,15],[12,14],[14,16],[23,25],[25,27],[24,26],[26,28],[27,31],[28,32],[11,12],[23,24]])errors[`${a}-${b}`]=degrees(w(b).sub(w(a)),d(a,b));
 const hipMid=V(mid(p[23],p[24])),shoulderMid=V(mid(p[11],p[12])),earMid=V(mid(p[7],p[8]));
 errors.spine=degrees(at(rig,'neck').sub(at(rig,'pelvis')),shoulderMid.clone().sub(hipMid));
 errors.neck=degrees(at(rig,'head').sub(at(rig,'neck')),earMid.clone().sub(shoulderMid));
 errors.headForward=degrees(at(rig,'nose').sub(at(rig,'head')),V(p[0]).sub(earMid));
 errors.headEars=degrees(new T.Vector3(1,0,0).applyQuaternion(meshQuaternion(rig,'head')),d(8,7));
 return errors;
}
const poses:Record<string,Point[]>={guard:demoPose(),jab:demoPose(.5,'jabSlow'),cross:demoPose(.5,'crossSlow'),twist:twist(demoPose(),30),duck:duck(demoPose(),.2),slip:slip(demoPose(),15,30),slipRight:slip(demoPose(),-12,-20)};

describe('avatar bones follow the landmarks',()=>{
 for(const angle of [0,45,90])for(const [name,pose] of Object.entries(poses))it(`${name} at ${angle}°: every bone within 1°`,()=>{
  const rig=new Humanoid(),errors=boneErrors(rig,turn(pose,angle));
  for(const [bone,error] of Object.entries(errors))expect(error,bone).toBeLessThan(1);rig.dispose();
 });
 it('the chest turns against the pelvis in a torso twist',()=>{
  const rig=new Humanoid(),p=twist(demoPose(),30);rig.solve(p,project(p,{x:0,y:-.15,z:-3},cam),cam.aspect);
  const chest=new T.Euler().setFromQuaternion(rig.byName.chest.quaternion,'YXZ');expect(Math.abs(chest.y*180/Math.PI)).toBeCloseTo(30,0);rig.dispose();
 });
 it('in a slip, the head moves relative to the chest',()=>{
  const rig=new Humanoid(),headInChest=(p:Point[])=>{rig.solve(p,project(p,{x:0,y:-.15,z:-3},cam),cam.aspect);return at(rig,'head').sub(at(rig,'chest')).applyQuaternion(meshQuaternion(rig,'chest').invert())};
  const guard=headInChest(turn(demoPose(),45)),slipped=headInChest(turn(slip(demoPose(),15,30),45));
  expect(guard.distanceTo(slipped)).toBeGreaterThan(.05);rig.dispose();
 });
});

/** Feed a sequence through the rig and the root motion, like the viewer does. */
function runner(d0:number){
 const rig=new Humanoid(),motion=new RootMotion(d0);let t=0;
 const step=(world:Point[],root:{x:number;y:number;z:number})=>{const image=project(world,root,cam),r=rig.solve(world,image,cam.aspect);t+=50;return{offset:motion.update({t,world,image,rig:r.world,scale:r.projection!.scale,aspect:cam.aspect,level,ready:rig.calibrated}).clone(),rig:r}};
 return{rig,motion,step,calibrate:(world:Point[],root:{x:number;y:number;z:number})=>{for(let i=0;i<30;i++)rig.calibrate(world,project(world,root,cam));let last;for(let i=0;i<40;i++)last=step(world,root);return last!}};
}
const lowest=(world:Point[],offset:T.Vector3,ids:number[])=>Math.min(...ids.map(i=>V(world[i]).y+offset.y));

describe('ground contact',()=>{
 it('in a duck, the feet stay on the floor and the hips drop',()=>{
  const stand=turn(demoPose(),45),{rig,motion,step,calibrate}=runner(3);
  const standing=calibrate(stand,{x:0,y:-.15,z:-3});expect(motion.calibrated).toBe(true);
  expect(lowest(stand,standing.offset,[27,29,31])).toBeCloseTo(0,2);
  const crouched=turn(duck(demoPose(),.2),45);let last=standing;for(let i=0;i<20;i++)last=step(crouched,{x:0,y:-.35,z:-3});
  expect(standing.offset.y-last.offset.y).toBeCloseTo(.2,1);expect(Math.abs(standing.offset.y-last.offset.y-.2)).toBeLessThan(.02);
  for(const foot of [[27,29,31],[28,30,32]]){expect(Math.abs(lowest(crouched,last.offset,foot))).toBeLessThan(.02);
   // The avatar's own feet (ankle or toe, whichever is lower) too.
   expect(Math.abs(Math.min(...[foot[0],foot[2]].map(i=>V(last.rig.world[i]).y+last.offset.y)))).toBeLessThan(.02)}
  expect(Math.hypot(last.offset.x,last.offset.z)).toBeLessThan(.02);rig.dispose();
 });
 it('levels the floor with the phone tilt',()=>{
  // Rear camera pitched 20° down in portrait: the hip-centred body looks tilted to the camera.
  const up=cameraUp({alpha:0,beta:70,gamma:0,screenAngle:0,at:0},'environment')!,q=levelQuaternion(up);
  expect(phoneAngles(up).pitchDeg).toBeCloseTo(-20);expect(phoneAngles(up).rollDeg).toBeCloseTo(0);
  const feet=V(mid(demoPose()[27],demoPose()[28]));const tilted=feet.clone().applyQuaternion(q.clone().invert());
  expect(tilted.applyQuaternion(q).y).toBeCloseTo(feet.y);expect(new T.Vector3(0,1,0).applyQuaternion(q.clone().invert()).angleTo(up)).toBeCloseTo(0);
  // The front camera points the other way, so the same phone tilt reads as looking up; upright portrait is level.
  expect(phoneAngles(cameraUp({alpha:0,beta:70,gamma:0,screenAngle:0,at:0},'user')!).pitchDeg).toBeCloseTo(20);
  expect(phoneAngles(cameraUp({alpha:0,beta:90,gamma:0,screenAngle:0,at:0},'user')!).pitchDeg).toBeCloseTo(0);
  // Landscape, phone upright: screen angle 90, top of the phone to the left.
  const landscape=phoneAngles(cameraUp({alpha:0,beta:0,gamma:-90,screenAngle:90,at:0},'environment')!);expect(landscape.pitchDeg).toBeCloseTo(0);expect(landscape.rollDeg).toBeCloseTo(0);
  expect(cameraUp(null,'user')).toBeNull();
 });
});

describe('steps on the floor (pinhole camera)',()=>{
 for(const angle of [0,45,90])it(`recovers steps within 5 cm at ${angle}°`,()=>{
  const pose=turn(demoPose(),angle),{rig,motion,step,calibrate}=runner(3);calibrate(pose,{x:0,y:-.15,z:-3});expect(motion.calibrated).toBe(true);
  for(const [x,z] of [[.2,-2.7],[-.3,-3.4],[.5,-2.5],[0,-3]]){let last;for(let i=0;i<30;i++)last=step(pose,{x,y:-.15,z});
   expect(Math.abs(last!.offset.x-x)).toBeLessThan(.05);expect(Math.abs(last!.offset.z-(z+3))).toBeLessThan(.05)}// closer to the phone = +z
  rig.dispose();
 });
 it('puts the 3D camera at the phone, lined up with the image',()=>{
  const pose=turn(demoPose(),45),{rig,motion,calibrate}=runner(3),root={x:.4,y:-.15,z:-3};calibrate(pose,root);
  const view=motion.view!,camera=new T.PerspectiveCamera(2*Math.atan(.5/view.f)*180/Math.PI,cam.aspect,.1,10);camera.position.copy(view.position);camera.quaternion.copy(view.quaternion);camera.updateMatrixWorld();
  // A world point drawn by the 3D camera lands where the camera image has it.
  const image=project(pose,root,cam),wrist=V(pose[15]).add(new T.Vector3(0,motion.standingHeight,0)).project(camera);
  expect((wrist.x+1)/2).toBeCloseTo(image[15].x,2);expect((1-wrist.y)/2).toBeCloseTo(image[15].y,2);rig.dispose();
 });
 it('waits for stillness before measuring the start position',()=>{
  const {rig,motion,step}=runner(3);for(let i=0;i<30;i++)rig.calibrate(demoPose(),project(demoPose(),{x:0,y:-.15,z:-3},cam));
  for(let i=0;i<60;i++)step(demoPose(),{x:.3*Math.sin(i/3),y:-.15,z:-3});expect(motion.calibrated).toBe(false);rig.dispose();
 });
});

describe('smoothing',()=>{
 /** Peak reach of a 45 cm jab that goes out in 150 ms and back in 150 ms, sampled at `fps`. */
 function reach(settings:typeof WORLD_FILTER,fps:number){const f=new PoseFilter();let peak=0;for(let t=0;t<=2000;t+=1000/fps){const s=t-500,v=s<0||s>300?0:.45*(1-Math.cos(Math.PI*Math.min(s,300-s)/150))/2;peak=Math.max(peak,f.apply([{x:v,y:0,z:0}],t,settings)[0].x)}return peak/.45}
 it('a 45 cm, 150 ms jab at 20 fps reaches at least 90% with the world defaults',()=>{expect(reach(WORLD_FILTER,20)).toBeGreaterThanOrEqual(.9);expect(reach({minCutoff:1,beta:.04,dCutoff:1},20)).toBeLessThan(.65)});
 it('keeps world and image filters separate',()=>{expect(WORLD_FILTER).toEqual({minCutoff:1.5,beta:5,dCutoff:2});expect(IMAGE_FILTER).not.toEqual(WORLD_FILTER);
  const f=new PoseFilter();f.apply([{x:0,y:0,z:0}],0,WORLD_FILTER,'world');f.apply([{x:0,y:0,z:0}],0,IMAGE_FILTER,'image');expect(f.apply([{x:1,y:0,z:0}],50,WORLD_FILTER,'world')[0].x).not.toBe(f.apply([{x:1,y:0,z:0}],50,IMAGE_FILTER,'image')[0].x)});
});
