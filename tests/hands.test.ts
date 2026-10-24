import {describe,expect,it} from 'vitest';
import * as T from 'three';
import {HandShape,PALM,assignSides,focal,sideOf,solveTranslation,trackSides} from '../src/hands';
import {cameraUp,levelQuaternion,phoneAngles} from '../src/sensors';
import {Euro,PoseFilter} from '../src/filter';
import {DEMO_CAMERA,demoHand,demoHands,mirror,project} from '../src/demo';
import {V,sampleAt,type Frame} from '../src/viewer';
import {BONES,WORLD_FILTER,type Point} from '../src/types';
import {add,dist,mul,sub,unit} from '../src/math';
import type {HandSample} from '../src/tracker';

const poses:[string,Point[]][]=[['open',demoHand(0)],['half',demoHand(.5,30,-15)],['fist',demoHand(1,-40,20)],['left hand',mirror(demoHand(.3,20,10))]];
const places:Point[]=[{x:0,y:0,z:.4},{x:-.12,y:.05,z:.3},{x:.15,y:-.1,z:.6},{x:.05,y:.08,z:.25}];
const degrees=(a:Point,b:Point)=>new T.Vector3(a.x,a.y,a.z).angleTo(new T.Vector3(b.x,b.y,b.z))*180/Math.PI;

describe('camera model',()=>{
 it('turns a field of view across the long side into a focal length in frame heights',()=>{expect(focal(90,4/3)).toBeCloseTo(2/3);expect(focal(90,3/4)).toBeCloseTo(.5);expect(focal(70,16/9)).toBeCloseTo(16/9/2/Math.tan(35*Math.PI/180))});
 for(const [name,hand] of poses)it(`finds where the ${name} is in front of the camera`,()=>{
  for(const at of places)for(const cam of [DEMO_CAMERA,{f:focal(70,3/4),aspect:3/4}]){
   const found=solveTranslation(hand,project(hand,at,cam),cam.f,cam.aspect)!;expect(dist(found,at)).toBeLessThan(1e-6);
  }
 });
 it('stays within a few millimetres with pixel noise',()=>{
  const hand=demoHand(.4,25,10),at={x:.05,y:0,z:.45},image=project(hand,at,DEMO_CAMERA).map((p,i)=>({...p,x:p.x+.0008*Math.sin(i*2.3),y:p.y+.0008*Math.cos(i*1.7)}));// about one pixel at 1280×960
  expect(dist(solveTranslation(hand,image,DEMO_CAMERA.f,DEMO_CAMERA.aspect)!,at)).toBeLessThan(.005);
 });
 it('the 3D view from the phone lines the hand up with the camera image',()=>{
  const cam=DEMO_CAMERA,hand=demoHand(.6,-20,15),at={x:.1,y:-.04,z:.35},image=project(hand,at,cam),T0=solveTranslation(hand,image,cam.f,cam.aspect)!;
  const camera=new T.PerspectiveCamera(2*Math.atan(.5/cam.f)*180/Math.PI,cam.aspect,.01,10);camera.updateMatrixWorld();
  hand.forEach((p,i)=>{const s=V(add(p,T0)).project(camera);expect((s.x+1)/2).toBeCloseTo(image[i].x,6);expect((1-s.y)/2).toBeCloseTo(image[i].y,6)});
 });
});

describe('fixed finger lengths',()=>{
 /** The same pose with every bone stretched by its own factor, as MediaPipe's lengths wobble between frames. */
 const wobble=(p:Point[],k:number)=>{const out:Point[]=[{...p[0]}];BONES.forEach(([a,b],i)=>{out[b]=add(out[a],mul(unit(sub(p[b],p[a])),dist(p[a],p[b])*(1+.1*Math.sin(k*1.3+i*2.1))))});return out};
 it('keeps this frame\'s lengths until measured, then fixed lengths with every bone along its landmark direction',()=>{
  const shape=new HandShape(),hand=demoHand(.2,10,5);
  shape.solve(hand).forEach((p,i)=>expect(dist(p,hand[i])).toBeLessThan(1e-12));
  for(let k=0;k<30;k++)shape.calibrate(wobble(hand,k));expect(shape.calibrated).toBe(true);
  for(const [name,pose] of poses){const input=wobble(pose,7),out=shape.solve(input);
   BONES.forEach(([a,b],i)=>{expect(degrees(sub(out[b],out[a]),sub(input[b],input[a])),`${name} ${a}-${b}`).toBeLessThan(1e-4);expect(dist(out[a],out[b])).toBeCloseTo(shape.lengths![i],9)})}
  // The median removes the frame-to-frame wobble.
  BONES.forEach(([a,b],i)=>expect(Math.abs(shape.lengths![i]-dist(hand[a],hand[b]))/dist(hand[a],hand[b])).toBeLessThan(.02));
  shape.reset();expect(shape.calibrated).toBe(false);
 });
});

describe('left and right',()=>{
 const sample=(label:string,score=.9,n=21):HandSample=>({label,score,landmarks:demoHand().slice(0,n),world:demoHand().slice(0,n)});
 it('swaps MediaPipe\'s mirrored labels, since frames are never mirrored',()=>{expect(sideOf('Left')).toBe('right');expect(sideOf('Right')).toBe('left');expect(sideOf('')).toBeNull()});
 it('gives each side one hand and skips incomplete ones',()=>{
  expect(assignSides([sample('Left',.6),sample('Left',.9)]).map(h=>[h.side,h.hand.score])).toEqual([['right',.9],['left',.6]]);
  expect(assignSides([sample('Right'),sample('Left',.9,5)]).map(h=>h.side)).toEqual(['left']);
  expect(assignSides(demoHands(1)).map(h=>h.side).sort()).toEqual(['left','right']);
 });
 it('the demo\'s right hand appears on the image\'s left, as when facing the camera',()=>{const [right,left]=demoHands(0);expect(right.landmarks[0].x).toBeLessThan(.5);expect(left.landmarks[0].x).toBeGreaterThan(.5)});
 it('a fist folds the fingertips toward the palm',()=>{const open=demoHand(0),fist=demoHand(1);for(const tip of [8,12,16,20])expect(dist(fist[tip],fist[0])).toBeLessThan(dist(open[tip],open[0])*.75)});
});

describe('steadier tracking',()=>{
 it('solves the position from the palm alone',()=>{for(const [,hand] of poses)for(const at of places){const found=solveTranslation(hand,project(hand,at,DEMO_CAMERA),DEMO_CAMERA.f,DEMO_CAMERA.aspect,PALM)!;expect(dist(found,at)).toBeLessThan(1e-6)}});
 it('with fingertip noise, the palm solve keeps depth steadier than using every point',()=>{
  const hand=demoHand(.3,10,0),at={x:0,y:0,z:.45};let all=0,palm=0;
  for(let k=0;k<50;k++){const image=project(hand,at,DEMO_CAMERA).map((p,i)=>[4,8,12,16,20,3,7,11,15,19].includes(i)?{...p,x:p.x+.004*Math.sin(k*1.7+i),y:p.y+.004*Math.cos(k*2.3+i)}:p);
   all+=Math.abs(solveTranslation(hand,image,DEMO_CAMERA.f,DEMO_CAMERA.aspect)!.z-at.z);palm+=Math.abs(solveTranslation(hand,image,DEMO_CAMERA.f,DEMO_CAMERA.aspect,PALM)!.z-at.z)}
  expect(palm).toBeLessThan(all/10);
 });
 const hand=(label:string,x:number,score=.9):HandSample=>{const world=demoHand();return{label,score,world,landmarks:world.map((p,i)=>({...p,x:x+(i?.01:0),y:.5}))}};
 it('keeps each hand on its side when MediaPipe flips the labels for a frame',()=>{
  const seen={left:{x:.7,y:.5,t:1000},right:{x:.3,y:.5,t:1000}};
  const flipped=trackSides([hand('Left',.71),hand('Right',.31)],seen,1033);// labels say right=.71, left=.31: swapped
  expect(flipped.map(h=>[h.side,h.hand.landmarks[0].x])).toEqual([['left',.71],['right',.31]]);
  expect(trackSides([hand('Left',.69)],seen,1033).map(h=>h.side)).toEqual(['left']);// one hand, near where the left was
  expect(trackSides([hand('Left',.69)],seen,2000).map(h=>h.side)).toEqual(['right']);// long gone: the label decides again
 });
 it('blends between tracker results for display, and holds the newest',()=>{
  const frame=(t:number,x:number):Frame=>({t,joints:[new T.Vector3(x,0,0)]}),out=[new T.Vector3()],frames=[frame(0,0),frame(40,4),frame(80,8)];
  expect(sampleAt(frames,20,out)[0].x).toBeCloseTo(2);expect(sampleAt(frames,60,out)[0].x).toBeCloseTo(6);
  expect(sampleAt(frames,200,out)[0].x).toBe(8);expect(sampleAt(frames,-5,out)[0].x).toBe(0);expect(sampleAt([frame(5,3)],0,out)[0].x).toBe(3);
 });
 it('the per-hand filter bank gives the same result as one filter per coordinate',()=>{
  const bank=new PoseFilter(),single=[new Euro(),new Euro(),new Euro()];
  for(let k=0;k<20;k++){const p={x:Math.sin(k),y:Math.cos(k*.7),z:k*.01},out=bank.apply([p],k*33,WORLD_FILTER,'right')[0];
   expect([out.x,out.y,out.z]).toEqual([single[0].step(p.x,k*33,WORLD_FILTER),single[1].step(p.y,k*33,WORLD_FILTER),single[2].step(p.z,k*33,WORLD_FILTER)])}
 });
});

describe('phone tilt',()=>{
 const up=(beta:number,gamma:number)=>new T.Vector3(-Math.cos(beta*Math.PI/180)*Math.sin(gamma*Math.PI/180),Math.sin(beta*Math.PI/180),Math.cos(beta*Math.PI/180)*Math.cos(gamma*Math.PI/180));
 it('turns the gravity direction into the camera\'s pitch and roll',()=>{
  expect(phoneAngles(cameraUp(up(90,0),0,'user')!).pitchDeg).toBeCloseTo(0);// upright portrait: level
  expect(phoneAngles(cameraUp(up(70,0),0,'environment')!).pitchDeg).toBeCloseTo(-20);// tipped back: the rear lens points down
  expect(phoneAngles(cameraUp(up(70,0),0,'user')!).pitchDeg).toBeCloseTo(20);// …and the front lens up
  const landscape=phoneAngles(cameraUp(up(0,-90),90,'environment')!);expect(landscape.pitchDeg).toBeCloseTo(0);expect(landscape.rollDeg).toBeCloseTo(0);
  expect(cameraUp(null,0,'user')).toBeNull();
 });
 it('levels the scene: gravity in the camera frame becomes straight down',()=>{const u=cameraUp(up(65,12),0,'user')!;expect(u.clone().applyQuaternion(levelQuaternion(u)).angleTo(new T.Vector3(0,1,0))).toBeCloseTo(0,6);expect(levelQuaternion(null).equals(new T.Quaternion())).toBe(true)});
});
