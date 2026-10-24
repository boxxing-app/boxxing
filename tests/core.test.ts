import {describe,it,expect} from 'vitest';
import {PoseFilter} from '../src/filter';
import {angle} from '../src/math';
describe('geometry and filters',()=>{
it('measures straight and right-angle joints',()=>{expect(angle({x:1,y:0,z:0},{x:0,y:0,z:0},{x:-1,y:0,z:0})).toBeCloseTo(180);expect(angle({x:1,y:0,z:0},{x:0,y:0,z:0},{x:0,y:1,z:0})).toBeCloseTo(90)});
it('smooths without changing visibility and resets after a gap',()=>{const f=new PoseFilter(),cfg={minCutoff:1,beta:0,dCutoff:1};f.apply([{x:0,y:0,z:0,visibility:.8}],0,cfg);const p=f.apply([{x:1,y:0,z:0,visibility:.2}],33,cfg)[0];expect(p.x).toBeGreaterThan(0);expect(p.x).toBeLessThan(.3);expect(p.visibility).toBe(.2);expect(f.apply([{x:2,y:0,z:0}],1000,cfg)[0].x).toBe(2)});
it('keeps each hand in its own filter',()=>{const f=new PoseFilter(),cfg={minCutoff:1,beta:0,dCutoff:1};f.apply([{x:0,y:0,z:0}],0,cfg,'left');f.apply([{x:5,y:0,z:0}],0,cfg,'right');expect(f.apply([{x:0,y:0,z:0}],33,cfg,'left')[0].x).toBe(0)});
});
