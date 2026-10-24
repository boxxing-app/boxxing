import {describe,expect,it} from 'vitest';
import {parseConfig,SMOOTHING_KEY} from '../src/config';
import {WORLD_FILTER} from '../src/types';
import {DEFAULT_FOV} from '../src/hands';

const memory=(init:Record<string,string>={})=>{const m=new Map(Object.entries(init));return{getItem:(k:string)=>m.get(k)??null,setItem:(k:string,v:string)=>void m.set(k,v),removeItem:(k:string)=>void m.delete(k),m}};
describe('URL settings',()=>{
 it('defaults to the front camera, the whole 4:3 sensor and a 70° field of view',()=>{expect(parseConfig('')).toEqual({facing:'user',resolution:'1280x960',fov:DEFAULT_FOV,world:WORLD_FILTER,debug:false,demo:false})});
 it('reads camera, resolution, field of view, debug and demo, and ignores bad values',()=>{
  expect(parseConfig('?camera=rear&res=1920x1440&fov=80&debug=1&demo=1')).toMatchObject({facing:'environment',resolution:'1920x1440',fov:80,debug:true,demo:true});
  expect(parseConfig('?camera=side&res=99x99&fov=500&minCutoff=-1&beta=x')).toMatchObject({facing:'user',resolution:'1280x960',fov:DEFAULT_FOV,world:WORLD_FILTER});
  expect(parseConfig('?res=1280x720').resolution).toBe('1280x720');
 });
 it('remembers smoothing from the URL under a new key and drops old settings',()=>{
  const store=memory({'boxxing.smoothing.world.v2':JSON.stringify({minCutoff:9,beta:9,dCutoff:9}),'motion-settings':'{}'});
  expect(parseConfig('',store).world).toEqual(WORLD_FILTER);expect(store.m.size).toBe(0);
  expect(parseConfig('?beta=3',store).world).toEqual({...WORLD_FILTER,beta:3});expect(JSON.parse(store.m.get(SMOOTHING_KEY)!).beta).toBe(3);
  expect(parseConfig('',store).world.beta).toBe(3);expect(parseConfig('?minCutoff=1.5&beta=5&dCutoff=2',store).world).toEqual(WORLD_FILTER);
 });
});
