/// <reference types="node" />
import {describe,expect,it} from 'vitest';
import fs from 'node:fs';
import * as T from 'three';
import {BOX_HALF,BOX_SPAWN,BoxWorld,TABLE,TABLE_BELOW_CAMERA,TABLE_BELOW_HANDS,palmQuaternion,tablePose,type HandInput} from '../src/physics';
import {HandModel} from '../src/handmodel';
import {demoHand,mirror} from '../src/demo';
import {V} from '../src/viewer';

/** A synthetic hand (Three.js axes) with its palm centre at `at`. curl 0 = open, 1 = fist. */
const hand=(at:T.Vector3,curl=0,yaw=0,pitch=0,side:'left'|'right'='right')=>{const p=side==='right'?demoHand(curl,yaw,pitch):mirror(demoHand(curl,yaw,pitch));return p.map(q=>V(q).add(at))};
/** A pinching hand: the thumb and index tips moved together onto `grip`. */
const pinch=(grip:T.Vector3,open=false)=>{const p=hand(grip.clone().add(new T.Vector3(0,-.02,.06)),.2);const gap=open?.03:.005;p[4].copy(grip).add(new T.Vector3(gap,0,0));p[8].copy(grip).add(new T.Vector3(-gap,0,0));return p};
const run=(world:BoxWorld,seconds:number,hands:(t:number)=>HandInput[]=()=>[])=>{for(let t=0;t<seconds;t+=1/60)world.step(1/60,hands(t))};

describe('box on the table',()=>{
 it('falls onto the table and comes to rest on a face',()=>{const w=new BoxWorld();w.pos.set(.05,.3,0);w.quat.setFromEuler(new T.Euler(.4,.2,.3));run(w,2);
  expect(w.pos.y).toBeCloseTo(BOX_HALF,3);expect(w.moving).toBe(false);const up=new T.Vector3(0,1,0).applyQuaternion(w.quat);expect(Math.max(Math.abs(up.x),Math.abs(up.y),Math.abs(up.z))).toBeCloseTo(1,3)});
 it('a finger moving into its side pushes it along, without passing through',()=>{
  const w=new BoxWorld();run(w,.2);
  // A pointing hand sweeps along +x at 0.5 m/s through where the box is.
  run(w,.6,t=>{const tip=new T.Vector3(-.12+.5*t,BOX_HALF,BOX_SPAWN.z),p=hand(new T.Vector3(0,.5,0));for(let k=0;k<4;k++)p[8-k].copy(tip).add(new T.Vector3(-.025*k,0,0));return[{side:'right',joints:p}]});// one straight index finger along x; the rest of the hand far above
  expect(w.pos.x).toBeGreaterThan(.1);expect(Math.abs(w.pos.z-BOX_SPAWN.z)).toBeLessThan(.005);expect(w.pos.x-BOX_HALF).toBeGreaterThan(-.12+.5*.6-.002);// ahead of the fingertip
  run(w,2);expect(w.moving).toBe(false);expect(w.pos.y).toBeCloseTo(BOX_HALF,3);
 });
 it('pinching at the box picks it up; it moves with the hand and drops when let go',()=>{
  const w=new BoxWorld();run(w,.2);
  const start=w.pos.clone().add(new T.Vector3(0,BOX_HALF+.005,0));
  run(w,.1,()=>[{side:'right',joints:pinch(start,true)}]);expect(w.grabbed).toBeNull();
  run(w,.1,()=>[{side:'right',joints:pinch(start)}]);expect(w.grabbed).toBe('right');
  const lift=new T.Vector3(.08,.15,-.05),before=w.pos.clone();
  run(w,.5,t=>[{side:'right',joints:pinch(start.clone().addScaledVector(lift,Math.min(1,t/.4)))}]);
  expect(w.pos.distanceTo(before.clone().add(lift))).toBeLessThan(.002);
  run(w,.05,()=>[{side:'right',joints:pinch(start.clone().add(lift),true)}]);expect(w.grabbed).toBeNull();
  run(w,2);expect(w.pos.y).toBeCloseTo(BOX_HALF,3);expect(w.pos.x).toBeCloseTo(before.x+lift.x,1);
 });
 it('a pinch away from the box does not grab it, and a box that falls off the table comes back',()=>{
  const w=new BoxWorld();run(w,.2,()=>[{side:'left',joints:pinch(new T.Vector3(.2,.1,0))}]);expect(w.grabbed).toBeNull();
  w.pos.set(TABLE.halfX+.1,.2,0);run(w,1.5);expect(w.pos.x).toBe(0);expect(w.pos.z).toBe(BOX_SPAWN.z);expect(w.pos.y).toBeCloseTo(BOX_HALF,3);
 });
 it('the table goes under your palms, below the camera, facing the camera, even when the phone looks up',()=>{
  const palms=[new T.Vector3(-.1,-.05,-.4),new T.Vector3(.1,-.03,-.44)],level=new T.Vector3(0,0,-1);
  const a=tablePose(palms,level);expect(a.position.x).toBeCloseTo(0);expect(a.position.z).toBeCloseTo(-.42);expect(a.position.y).toBeCloseTo(-.04-TABLE_BELOW_HANDS);
  expect(new T.Vector3(0,0,-1).applyQuaternion(a.quaternion).angleTo(level)).toBeCloseTo(0);
  // Phone leaning back (lens 30° up) with the hands raised above it: still below the camera, still level, still facing it.
  const up=new T.Vector3(0,Math.sin(Math.PI/6),-Math.cos(Math.PI/6)),b=tablePose([new T.Vector3(.05,.1,-.4)],up);
  expect(b.position.y).toBeCloseTo(-TABLE_BELOW_CAMERA);expect(new T.Vector3(0,1,0).applyQuaternion(b.quaternion).y).toBeCloseTo(1);expect(new T.Vector3(0,0,-1).applyQuaternion(b.quaternion).angleTo(level)).toBeCloseTo(0);
  // Turned to the side: the table turns with the camera's heading.
  const side=new T.Vector3(-1,-.3,-1),c=tablePose(palms,side);expect(new T.Vector3(0,0,-1).applyQuaternion(c.quaternion).angleTo(new T.Vector3(-1,0,-1).normalize())).toBeCloseTo(0);
 });
 it('the palm frame turns with the hand',()=>{const a=palmQuaternion(hand(new T.Vector3(),0,0)),b=palmQuaternion(hand(new T.Vector3(),0,40));expect(a.angleTo(b)*180/Math.PI).toBeCloseTo(40,0)});
});

describe('rigged hand model',()=>{
 const load=async(side:string)=>{const b=fs.readFileSync(`public/hands/${side}.glb`);return HandModel.parse(b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength) as ArrayBuffer,0xffffff)};
 for(const side of ['right','left'] as const)it(`${side}: every joint sits on its landmark and points at the next one`,async()=>{
  const model=await load(side);
  for(const [curl,yaw,pitch] of [[0,0,0],[.5,35,-20],[1,-50,25]]){
   const p=hand(new T.Vector3(.05,-.02,-.4),curl,yaw,pitch,side);model.pose(p);model.root.updateMatrixWorld(true);
   for(const n of HandModel.joints){const i=HandModel.source(n);if(i!==null)expect(model.bones[n].position.distanceTo(p[i])).toBeLessThan(1e-9);
    const next=HandModel.next(n);if(next)expect(model.pointing(n).angleTo(model.bones[next].position.clone().sub(model.bones[n].position).normalize())*180/Math.PI,`${n}`).toBeLessThan(1e-3)}
   // The skinned mesh follows: the skin nearest the index tip at rest ends up next to the tracked tip.
   const mesh=model.mesh,pos=mesh.geometry.getAttribute('position');
   const fresh=await load(side);fresh.root.updateMatrixWorld(true);const restTip=fresh.bones['index-finger-tip'].getWorldPosition(new T.Vector3());
   let best=0,bestD=Infinity;for(let k=0;k<pos.count;k++){const d=new T.Vector3().fromBufferAttribute(pos,k).distanceTo(restTip);if(d<bestD){bestD=d;best=k}}
   const v=mesh.applyBoneTransform(best,new T.Vector3().fromBufferAttribute(pos,best));expect(v.distanceTo(p[8])).toBeLessThan(.02);
  }
 });
});
