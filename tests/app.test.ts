import {describe,expect,it} from 'vitest';
import {parseConfig,SMOOTHING_KEY} from '../src/config';
import {jitter,summarize,type Context,type HoldSample} from '../src/capture';
import {DEMO_CAMERA,demoPose,project,turn} from '../src/demo';
import {cameraUp} from '../src/motion';
import {IMAGE_FILTER,WORLD_FILTER,type Point} from '../src/types';

const memory=(init:Record<string,string>={})=>{const m=new Map(Object.entries(init));return{getItem:(k:string)=>m.get(k)??null,setItem:(k:string,v:string)=>void m.set(k,v),removeItem:(k:string)=>void m.delete(k),m}};
describe('URL settings',()=>{
 it('defaults to the front camera, full model and the whole 4:3 sensor',()=>{expect(parseConfig('')).toEqual({facing:'user',model:'full',resolution:'1280x960',world:WORLD_FILTER,image:IMAGE_FILTER,debug:false,demo:false})});
 it('reads camera, model, resolution, debug and demo, and ignores bad values',()=>{
  expect(parseConfig('?camera=rear&model=heavy&res=1920x1080&debug=1&demo=1')).toMatchObject({facing:'environment',model:'heavy',resolution:'1920x1080',debug:true,demo:true});
  expect(parseConfig('?camera=side&model=huge&res=99x99&minCutoff=-1&beta=x')).toMatchObject({facing:'user',model:'full',resolution:'1280x960',world:WORLD_FILTER});
  expect(parseConfig('?res=1280x720').resolution).toBe('1280x720');
 });
 it('remembers smoothing from the URL under a new key and drops the old pixel-tuned settings',()=>{
  const store=memory({'motion-settings':JSON.stringify({filter:{minCutoff:1,beta:.04,dCutoff:1}})});
  expect(parseConfig('',store).world).toEqual(WORLD_FILTER);expect(store.m.has('motion-settings')).toBe(false);
  expect(parseConfig('?beta=3',store).world).toEqual({...WORLD_FILTER,beta:3});expect(JSON.parse(store.m.get(SMOOTHING_KEY)!).beta).toBe(3);
  expect(parseConfig('',store).world.beta).toBe(3);expect(parseConfig('?minCutoff=1.5&beta=5&dCutoff=2',store).world).toEqual(WORLD_FILTER);
 });
});

const context:Context={matchPct:70,synthetic:true,camera:{facing:'user',label:'Front',width:1280,height:720,frameRate:30},model:'full',delegate:'GPU',aspect:16/9,distance:3,smoothing:{world:WORLD_FILTER,image:IMAGE_FILTER},screen:{width:800,height:360,orientation:'landscape'},userAgent:'test',savedAt:new Date('2026-10-23T10:00:00Z')};
describe('saved record',()=>{
 const noisy=(p:Point[],k:number)=>p.map((q,i)=>({...q,x:q.x+.002*Math.sin(k*2.1+i),y:q.y+.002*Math.cos(k*1.7+i)}));
 function hold(angle:number,fps=25,poseEvery=1){
  const world=turn(demoPose(),angle),image=project(world,{x:0,y:-.15,z:-3},DEMO_CAMERA),scale=DEMO_CAMERA.f/3;
  return Array.from({length:5*fps},(_,k):HoldSample=>k%poseEvery===poseEvery-1&&poseEvery>1?{t:1000+k*1000/fps,image:[],world:[],inferenceMs:20,scale:null,up:null}:{t:1000+k*1000/fps,image,world:noisy(world,k),inferenceMs:k===3?90:20,scale,up:cameraUp({alpha:0,beta:80,gamma:0,screenAngle:0,at:0},'environment')});
 }
 it('measures body angle, phone tilt, fps, inference and pose rate',()=>{
  const r=summarize(hold(45,25,4),context);
  expect(r.bodyAngleDeg).toBeCloseTo(45,0);expect(r.phone.pitchDeg).toBeCloseTo(-10,0);expect(r.phone.rollDeg).toBeCloseTo(0,0);
  expect(r.medianFps).toBeCloseTo(25,0);expect(r.p95InferenceMs).toBe(20);expect(r.frames).toBe(125);expect(r.posePct).toBeCloseTo(75,0);
  expect(r.visibility.leftWrist).toBeCloseTo(.99);expect(r.hold.frames).toHaveLength(125);expect(r.hold.frames[0].t).toBe(0);expect(r.hold.frames[0].world[0]).toHaveLength(5);expect(r.hold.frames[3].world).toEqual([]);
  expect(r.matchPct).toBe(70);expect(r.camera.label).toBe('Front');
 });
 it('takes the off-axis position into account for the body angle',()=>{
  const world=turn(demoPose(),45),image=project(world,{x:1,y:-.15,z:-3},DEMO_CAMERA);
  const r=summarize(Array.from({length:10},(_,k)=>({t:k*40,image,world,inferenceMs:10,scale:DEMO_CAMERA.f/3,up:null})),context);
  expect(r.bodyAngleDeg).toBeCloseTo(45+Math.atan2(1,3)*180/Math.PI,0);expect(r.phone.pitchDeg).toBeNull();
 });
 it('reports jitter in mm and ignores smooth movement',()=>{
  const still=Array.from({length:50},(_,k)=>({x:.001*(k%2?1:-1),y:0,z:0}));expect(jitter(still)).toBeCloseTo(Math.sqrt(4/1.5),1);// ±1 mm alternation: second difference 2 mm
  const sway=Array.from({length:50},(_,k)=>({x:.05*Math.sin(k/20),y:0,z:0}));expect(jitter(sway)!).toBeLessThan(.2);
  expect(jitter([null,{x:0,y:0,z:0},null])).toBeNull();
 });
});
