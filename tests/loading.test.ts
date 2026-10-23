import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {fetchAsset,type LoadProgress} from '../src/asset-loader';
import {Tracker} from '../src/tracker';

beforeEach(()=>vi.useFakeTimers());
afterEach(()=>{vi.useRealTimers();vi.unstubAllGlobals()});

describe('model downloads',()=>{
 it('keeps a progressing download alive beyond the old total deadlines',async()=>{
  const progress:LoadProgress[]=[];
  const fetcher=vi.fn(async()=>new Response(new ReadableStream({start(controller){
   let sent=0;const timer=setInterval(()=>{controller.enqueue(new Uint8Array([++sent]));if(sent===40){clearInterval(timer);controller.close()}},20000);
  }})));
  const pending=fetchAsset('/model',{label:'Full',expectedBytes:40,onProgress:p=>progress.push(p),fetcher});
  await vi.advanceTimersByTimeAsync(800000);
  expect((await pending).length).toBe(40);expect(fetcher).toHaveBeenCalledTimes(1);
  expect(progress.at(-1)?.loaded).toBe(40);expect(vi.getTimerCount()).toBe(0);
 });
 it('backs off both retry delays and idle timeouts, then succeeds',async()=>{
  const attempts:number[]=[],progress:LoadProgress[]=[];
  const fetcher=vi.fn((_url:RequestInfo|URL,init?:RequestInit):Promise<Response>=>{
   attempts.push(Date.now());
   if(attempts.length===3)return Promise.resolve(new Response(new Uint8Array([1,2])));
   return new Promise((_,reject)=>init?.signal?.addEventListener('abort',()=>reject(new DOMException('aborted','AbortError'))));
  });
  const start=Date.now(),pending=fetchAsset('/model',{label:'Full',expectedBytes:2,onProgress:p=>progress.push(p),fetcher});
  await vi.advanceTimersByTimeAsync(93000);
  expect(Array.from(await pending)).toEqual([1,2]);
  expect(attempts.map(t=>t-start)).toEqual([0,31000,93000]);
  expect(progress.some(p=>p.message.includes('stall limit 120s'))).toBe(true);
  expect(vi.getTimerCount()).toBe(0);
 });
 it('bounds retries and reports a useful terminal stall error',async()=>{
  const fetcher=vi.fn((_url:RequestInfo|URL,init?:RequestInit)=>new Promise<Response>((_,reject)=>init?.signal?.addEventListener('abort',()=>reject(new DOMException('aborted','AbortError')))));
  const result=fetchAsset('/model',{label:'Full',onProgress:()=>{},fetcher}).catch(e=>e);
  await vi.advanceTimersByTimeAsync(457000);
  expect((await result).message).toContain('240s without progress');expect(fetcher).toHaveBeenCalledTimes(4);expect(vi.getTimerCount()).toBe(0);
 });
 it.each([401,403,404])('does not retry permanent HTTP %s errors',async status=>{
  const fetcher=vi.fn(async()=>new Response('',{status}));
  await expect(fetchAsset('/model',{label:'Full',onProgress:()=>{},fetcher})).rejects.toThrow(status===404?'HTTP 404':'sign in');
  expect(fetcher).toHaveBeenCalledTimes(1);expect(vi.getTimerCount()).toBe(0);
 });
 it('rejects an HTML login page instead of feeding it to WASM',async()=>{
  const fetcher=vi.fn(async()=>new Response('<html>Sign in</html>',{headers:{'Content-Type':'text/html'}}));
  await expect(fetchAsset('/model',{label:'Full',onProgress:()=>{},fetcher})).rejects.toThrow('page instead');
  expect(fetcher).toHaveBeenCalledTimes(1);
 });
 it('retries incomplete files and reuses only complete cached downloads',async()=>{
  const cache={match:vi.fn(async()=>new Response(new Uint8Array([0]))),delete:vi.fn(async()=>true),put:vi.fn(async()=>{})};
  const fetcher=vi.fn().mockResolvedValueOnce(new Response(new Uint8Array([1]))).mockResolvedValueOnce(new Response(new Uint8Array([1,2])));
  const pending=fetchAsset('/model',{label:'Full',expectedBytes:2,onProgress:()=>{},cache:cache as unknown as Cache,fetcher});
  await vi.advanceTimersByTimeAsync(1000);expect(Array.from(await pending)).toEqual([1,2]);
  expect(cache.delete).toHaveBeenCalledWith('/model');expect(cache.put).toHaveBeenCalledTimes(1);expect(fetcher).toHaveBeenCalledTimes(2);
  cache.match.mockResolvedValue(new Response(new Uint8Array([1,2])));
  expect(Array.from(await fetchAsset('/model',{label:'Full',expectedBytes:2,onProgress:()=>{},cache:cache as unknown as Cache,fetcher}))).toEqual([1,2]);
  expect(fetcher).toHaveBeenCalledTimes(2);
 });
});

class FakeWorker{
 static all:FakeWorker[]=[];
 onmessage:((event:{data:unknown})=>void)|null=null;onerror:((event:{message:string})=>void)|null=null;onmessageerror:(()=>void)|null=null;
 postMessage=vi.fn();terminate=vi.fn();
 constructor(){FakeWorker.all.push(this)}
 send(data:unknown){this.onmessage?.({data})}
}
describe('tracking startup watchdog',()=>{
 let tracker:Tracker;
 beforeEach(()=>{FakeWorker.all=[];vi.stubGlobal('Worker',FakeWorker);vi.stubGlobal('cancelAnimationFrame',vi.fn());tracker=new Tracker({srcObject:null} as HTMLVideoElement,()=>{},vi.fn())});
 it('allows continuing progress without a total loading deadline',async()=>{
  const pending=tracker.load('full'),worker=FakeWorker.all[0];
  for(let i=0;i<40;i++){worker.send({type:'progress',phase:'download',message:'Downloading Full',timeoutMs:45000});await vi.advanceTimersByTimeAsync(20000)}
  expect(worker.terminate).not.toHaveBeenCalled();expect(FakeWorker.all).toHaveLength(1);
  worker.send({type:'ready',delegate:'GPU'});await pending;expect(tracker.ready).toBe(true);expect(vi.getTimerCount()).toBe(0);tracker.stop();
 });
 it('respects a backed-off download stall limit',async()=>{
  const pending=tracker.load('full'),worker=FakeWorker.all[0];
  worker.send({type:'progress',phase:'download',message:'Retrying download',timeoutMs:255000});
  await vi.advanceTimersByTimeAsync(240000);expect(worker.terminate).not.toHaveBeenCalled();
  worker.send({type:'ready',delegate:'GPU'});await pending;tracker.stop();
 });
 it('retries a GPU hang on CPU with increasing startup limits and bounded attempts',async()=>{
  const result=tracker.load('full').catch(e=>e),gpu=FakeWorker.all[0];
  gpu.send({type:'progress',phase:'gpu',message:'Starting GPU'});
  await vi.advanceTimersByTimeAsync(30000);expect(gpu.terminate).toHaveBeenCalledOnce();expect(FakeWorker.all).toHaveLength(1);
  await vi.advanceTimersByTimeAsync(1000);const cpu=FakeWorker.all[1];expect(cpu.postMessage).toHaveBeenCalledWith({type:'init',variant:'full',delegate:'CPU'});
  gpu.send({type:'ready',delegate:'GPU'});expect(tracker.ready).toBe(false);
  cpu.send({type:'progress',phase:'cpu',message:'Starting CPU'});
  await vi.advanceTimersByTimeAsync(119999);expect(cpu.terminate).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(2001);const last=FakeWorker.all[2];last.send({type:'progress',phase:'cpu',message:'Starting CPU'});
  await vi.advanceTimersByTimeAsync(239999);expect(last.terminate).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(1);expect((await result).message).toContain('after 3 attempts');expect(vi.getTimerCount()).toBe(0);expect(FakeWorker.all).toHaveLength(3);
 });
 it('cancels pending backoff without launching another worker',async()=>{
  const result=tracker.load('full').catch(e=>e),worker=FakeWorker.all[0];worker.send({type:'progress',phase:'gpu',message:'Starting GPU'});
  await vi.advanceTimersByTimeAsync(30000);tracker.stop();await vi.advanceTimersByTimeAsync(1000000);
  expect((await result).message).toContain('cancelled');expect(FakeWorker.all).toHaveLength(1);expect(vi.getTimerCount()).toBe(0);
 });
});
