import {describe,it,expect} from 'vitest';
import {PoseFilter} from '../src/filter';
import {angle,bodyAngle} from '../src/math';
import {demoPose,turn} from '../src/demo';
import {Humanoid} from '../src/rig';
describe('geometry and filters',()=>{
it('measures straight and right-angle elbows',()=>{expect(angle({x:1,y:0,z:0},{x:0,y:0,z:0},{x:-1,y:0,z:0})).toBeCloseTo(180);expect(angle({x:1,y:0,z:0},{x:0,y:0,z:0},{x:0,y:1,z:0})).toBeCloseTo(90)});
it('calculates frontal torso and rotated angle',()=>{const p=demoPose(0,'neutral');expect(bodyAngle(p)).toBeCloseTo(0);const a=Math.PI/4;p.forEach(p=>{const x=p.x,z=p.z;p.x=x*Math.cos(a)-z*Math.sin(a);p.z=x*Math.sin(a)+z*Math.cos(a)});expect(bodyAngle(p)).toBeCloseTo(45)});
it('corrects the body angle when the body is off the camera axis',()=>{const p=turn(demoPose(0,'neutral'),45);
 // Facing toward image-right and standing 1 m to the camera's right at 3 m puts the camera 18.4° further to the front-right.
 expect(bodyAngle(p,{x:-1,z:-3})).toBeCloseTo(45+Math.atan2(1,3)*180/Math.PI,5);expect(bodyAngle(p,{x:0,z:-3})).toBeCloseTo(45)});
it('smooths without changing visibility and resets after a gap',()=>{const f=new PoseFilter(),cfg={minCutoff:1,beta:0,dCutoff:1};f.apply([{x:0,y:0,z:0,visibility:.8}],0,cfg);const p=f.apply([{x:1,y:0,z:0,visibility:.2}],33,cfg)[0];expect(p.x).toBeGreaterThan(0);expect(p.x).toBeLessThan(.3);expect(p.visibility).toBe(.2);expect(f.apply([{x:2,y:0,z:0}],1000,cfg)[0].x).toBe(2)});
});
describe('fixed-length rig',()=>{
it('has a skinned mesh with local bone rotations and fixed lengths',()=>{const rig=new Humanoid(),p=demoPose(0,'tpose'),img=p.map(p=>({...p,x:p.x*.4/(16/9)+.5,y:p.y*.4+.5}));const r=rig.solve(p,img);expect(rig.mesh.isSkinnedMesh).toBe(true);expect(rig.mesh.geometry.getAttribute('skinWeight').count).toBeGreaterThan(100);expect(r.rotations.leftElbow).toHaveLength(4);expect(r.projection?.scale).toBeCloseTo(.4);expect(r.projected[11].x).toBeCloseTo(img[11].x);const len=(q:typeof r)=>Math.hypot(q.world[13].x-q.world[15].x,q.world[13].y-q.world[15].y,q.world[13].z-q.world[15].z);const r2=rig.solve(demoPose(1,'jabSlow'),img);expect(len(r2)).toBeCloseTo(len(r));rig.dispose()});
it('can restore calibration',()=>{const rig=new Humanoid();rig.setCalibration({upperArm:.4,forearm:.3});expect(rig.dimensions.upperArm).toBe(.4);expect(rig.byName.leftElbow.position.x).toBe(.4);rig.dispose()});
});
