import {describe,it,expect} from 'vitest';
import {PoseFilter} from '../src/filter';
import {angle,placement,peaks,bodyAngle,signedAngle} from '../src/math';
import {DEFAULT_SETTINGS,DEFAULT_WEIGHTS,type Session,type Settings} from '../src/types';
import {nextPlan,score,script,combinationKey} from '../src/protocol';
import {demoPose,makeDemo} from '../src/demo';
import {Humanoid} from '../src/rig';
import {calculate} from '../src/metrics';
import {validateImport,csv} from '../src/storage';
const settings=structuredClone(DEFAULT_SETTINGS);
const fake=(over:Partial<Settings>={},value=75):Session=>({schemaVersion:1,id:crypto.randomUUID(),createdAt:new Date().toISOString(),settings:{...structuredClone(settings),...over},device:{userAgent:'test',platform:'test',camera:null,delegate:'test',runtime:'test'},frames:[],cues:[],duration:100000,complete:true,synthetic:false,notes:[],rigCalibration:null,videoAvailable:false,metrics:{values:{},perCue:{},scores:Object.fromEntries(Object.keys(DEFAULT_WEIGHTS).map(k=>[k,value]))}});
describe('geometry and filters',()=>{
it('measures straight and right-angle elbows',()=>{expect(angle({x:1,y:0,z:0},{x:0,y:0,z:0},{x:-1,y:0,z:0})).toBeCloseTo(180);expect(angle({x:1,y:0,z:0},{x:0,y:0,z:0},{x:0,y:1,z:0})).toBeCloseTo(90)});
it('places a 45 degree camera and mirrors southpaw',()=>{const p=placement({...settings,angle:45,distance:3});expect(p.forward).toBeCloseTo(3/Math.sqrt(2));expect(p.side).toBeCloseTo(3/Math.sqrt(2));expect(signedAngle({...settings,angle:45,stance:'southpaw'})).toBe(-45)});
it('calculates frontal torso and rotated angle',()=>{const p=demoPose(0,'neutral');expect(bodyAngle(p)).toBeCloseTo(0);const a=Math.PI/4;p.forEach(p=>{const x=p.x,z=p.z;p.x=x*Math.cos(a)-z*Math.sin(a);p.z=x*Math.sin(a)+z*Math.cos(a)});expect(bodyAngle(p)).toBeCloseTo(45)});
it('smooths without changing visibility and resets after a gap',()=>{const f=new PoseFilter(),cfg={minCutoff:1,beta:0,dCutoff:1};f.apply([{x:0,y:0,z:0,visibility:.8}],0,cfg);const p=f.apply([{x:1,y:0,z:0,visibility:.2}],33,cfg)[0];expect(p.x).toBeGreaterThan(0);expect(p.x).toBeLessThan(.3);expect(p.visibility).toBe(.2);expect(f.apply([{x:2,y:0,z:0}],1000,cfg)[0].x).toBe(2)});
it('counts distinct punch peaks, not frame noise',()=>{const xs=Array.from({length:201},(_,i)=>({t:i*50,v:.3-.25*Math.cos(i*50/1000*Math.PI)}));expect(peaks(xs,.4,.12,500)).toHaveLength(5)});
});
describe('fixed-length rig',()=>{
it('has a skinned mesh with local bone rotations and fixed lengths',()=>{const rig=new Humanoid(),p=demoPose(0,'tpose'),img=p.map(p=>({...p,x:p.x*.4/(16/9)+.5,y:p.y*.4+.5}));const r=rig.solve(p,img);expect(rig.mesh.isSkinnedMesh).toBe(true);expect(rig.mesh.geometry.getAttribute('skinWeight').count).toBeGreaterThan(100);expect(r.rotations.leftElbow).toHaveLength(4);expect(r.projection?.scale).toBeCloseTo(.4);expect(r.projected[11].x).toBeCloseTo(img[11].x);const len=(q:typeof r)=>Math.hypot(q.world[13].x-q.world[15].x,q.world[13].y-q.world[15].y,q.world[13].z-q.world[15].z);const r2=rig.solve(demoPose(1,'jabSlow'),img);expect(len(r2)).toBeCloseTo(len(r));rig.dispose()});
it('can restore calibration for faithful replay',()=>{const rig=new Humanoid();rig.setCalibration({upperArm:.4,forearm:.3});expect(rig.dimensions.upperArm).toBe(.4);expect(rig.byName.leftElbow.position.x).toBe(.4);rig.dispose()});
});
describe('staged search',()=>{
it('starts at angle zero and ignores synthetic sessions',()=>{const s=fake();s.synthetic=true;expect(nextPlan([s])?.settings.angle).toBe(0)});
it('moves through six angles and chooses the best two for height',()=>{const ss=[0,30,45,60,90,-45].map((angle,i)=>fake({angle},i===2?95:i===1?90:60));expect(nextPlan(ss)?.stage).toBe('B');expect(nextPlan(ss)?.settings.angle).toBe(45);expect(nextPlan(ss)?.settings.height).toBe(.3)});
it('does not mix cameras or incomplete sessions',()=>{const a=fake({deviceId:'another'}),b=fake();b.complete=false;expect(nextPlan([a,b])?.settings.angle).toBe(0)});
it('runs both orientations and all three models in D',()=>{const ss:Session[]=[];for(let i=0;i<40;i++){const p=nextPlan(ss);if(!p||p.stage==='Repeat')break;ss.push(fake(p.settings,p.settings.angle===45?90:60))}expect(ss.filter(s=>s.settings.stage==='D').some(s=>s.settings.orientation==='portrait'&&s.settings.model==='heavy')).toBe(true);const next=nextPlan(ss);expect(next?.stage).toBe('Repeat');for(let i=0;i<6;i++){const p=nextPlan(ss);if(p)ss.push(fake(p.settings,p.settings.angle===45?90:60))}expect(nextPlan(ss)).toBeNull();expect(new Set(ss.map(s=>combinationKey(s.settings))).size).toBeLessThan(ss.length)});
});
describe('metrics and file integrity',()=>{
it('never gives an empty session an accuracy score',()=>{const s=fake();s.metrics=calculate(s);expect(s.metrics.values.posePct).toBeNull();expect(score(s)).toBeNull()});
it('normalizes weights and rejects missing required metrics',()=>{const s=fake({},80);expect(score(s)).toBe(80);s.metrics!.scores.rig=null;expect(score(s)).toBeNull();expect(score(s,{...DEFAULT_WEIGHTS,rig:0})).toBe(80)});
it('rejects malformed imports',()=>{expect(()=>validateImport({schemaVersion:2})).toThrow();const s=fake();s.settings.angle=999;expect(()=>validateImport(s)).toThrow()});
it('produces complete synthetic sessions with finite bounded scores',()=>{const ss=makeDemo();expect(ss.length).toBe(4);for(const s of ss){expect(s.synthetic).toBe(true);expect(s.cues.length).toBe(script('orthodox').length);expect(s.frames.length).toBeGreaterThan(1000);expect(score(s)).not.toBeNull();expect(score(s)!).toBeGreaterThanOrEqual(0);expect(score(s)!).toBeLessThanOrEqual(100);expect(s.metrics!.values.captureToSubmitP95).toBeNull()}const imported=validateImport(JSON.parse(JSON.stringify(ss[0])));expect(imported[0].frames.length).toBe(ss[0].frames.length);expect(csv([ss[0]])).toContain('"session"');expect(csv([ss[0]])).toContain('"tpose"')});
});
