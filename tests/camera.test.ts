import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {cameraPreflight,requestCamera,type CameraContext} from '../src/camera-access';
import {DEFAULT_SETTINGS} from '../src/types';
import {Tracker} from '../src/tracker';
const context:CameraContext={secure:true,api:true,embedded:false,policyAllowed:null,ios:true,chromeIOS:true};
const fakeStream=()=>{const track={stop:vi.fn(),getSettings:()=>({deviceId:'back'})};return{getTracks:()=>[track],getVideoTracks:()=>[track]} as unknown as MediaStream};
beforeEach(()=>vi.useFakeTimers());
afterEach(()=>{vi.useRealTimers();vi.unstubAllGlobals()});
function device(getUserMedia:ReturnType<typeof vi.fn>){vi.stubGlobal('navigator',{mediaDevices:{getUserMedia},userAgent:'iPhone CriOS/155',maxTouchPoints:5})}
describe('camera permissions',()=>{
 it('requests the camera synchronously from the tap, before any asynchronous work',async()=>{
  const stream=fakeStream(),get=vi.fn().mockResolvedValue(stream);device(get);
  const pending=requestCamera(DEFAULT_SETTINGS,new AbortController().signal,()=>{},context);
  expect(get).toHaveBeenCalledTimes(1);expect(get.mock.calls[0][0].audio).toBe(false);expect(await pending).toBe(stream);expect(vi.getTimerCount()).toBe(0);
 });
 it('does not retry denied iPhone permissions and tells the user where to enable Chrome',async()=>{
  const get=vi.fn().mockRejectedValue(new DOMException('Denied','NotAllowedError'));device(get);
  await expect(requestCamera(DEFAULT_SETTINGS,new AbortController().signal,()=>{},context)).rejects.toThrow('Privacy & Security → Camera and enable Chrome');
  expect(get).toHaveBeenCalledTimes(1);expect(vi.getTimerCount()).toBe(0);
 });
 it.each(['OverconstrainedError','NotFoundError'])('recovers from a stale lens returning %s',async name=>{
  const stream=fakeStream(),get=vi.fn().mockRejectedValueOnce(new DOMException('Unavailable',name)).mockResolvedValueOnce(stream);device(get);
  expect(await requestCamera({...DEFAULT_SETTINGS,deviceId:'old-camera'},new AbortController().signal,()=>{},context)).toBe(stream);
  expect(get).toHaveBeenCalledTimes(2);expect(get.mock.calls[1][0]).toEqual({audio:false,video:{facingMode:{ideal:DEFAULT_SETTINGS.facing}}});
 });
 it('does not retry a missing camera without a saved selection',async()=>{
  const get=vi.fn().mockRejectedValue(new DOMException('No device','NotFoundError'));device(get);
  await expect(requestCamera({...DEFAULT_SETTINGS,deviceId:''},new AbortController().signal,()=>{},context)).rejects.toThrow('No camera');expect(get).toHaveBeenCalledTimes(1);
 });
 it('explains policy-blocked embedded pages before calling the camera API',async()=>{
  const get=vi.fn();device(get);
  await expect(requestCamera(DEFAULT_SETTINGS,new AbortController().signal,()=>{},{...context,embedded:true,policyAllowed:false})).rejects.toThrow('new browser tab');expect(get).not.toHaveBeenCalled();
  expect(()=>cameraPreflight({...context,secure:false})).toThrow('HTTPS');
 });
 it('shows help while permission is pending without imposing a timeout',async()=>{
  let allow!:(stream:MediaStream)=>void;const get=vi.fn(()=>new Promise<MediaStream>(resolve=>{allow=resolve})),status=vi.fn();device(get);
  const pending=requestCamera(DEFAULT_SETTINGS,new AbortController().signal,status,context);
  await vi.advanceTimersByTimeAsync(240000);expect(get).toHaveBeenCalledTimes(1);expect(status).toHaveBeenCalledWith(expect.stringContaining('site settings'),true);
  const stream=fakeStream();allow(stream);expect(await pending).toBe(stream);
 });
 it('cancels promptly and closes a stream granted after cancellation',async()=>{
  let allow!:(stream:MediaStream)=>void;const get=vi.fn(()=>new Promise<MediaStream>(resolve=>{allow=resolve}));device(get);
  const abort=new AbortController(),result=requestCamera(DEFAULT_SETTINGS,abort.signal,()=>{},context).catch(e=>e);abort.abort();expect((await result).name).toBe('AbortError');
  const stream=fakeStream();allow(stream);await vi.advanceTimersByTimeAsync(10000);expect(stream.getTracks()[0].stop).toHaveBeenCalledOnce();expect(vi.getTimerCount()).toBe(0);
 });
 it('keeps the iPhone camera open and reports its connection before loading the model',async()=>{
  const stream=fakeStream(),get=vi.fn().mockResolvedValue(stream);device(get);
  const win={isSecureContext:true,self:{},top:{}};win.top=win.self;vi.stubGlobal('window',win);vi.stubGlobal('document',{});vi.stubGlobal('cancelAnimationFrame',vi.fn());
  const video={srcObject:null,muted:false,playsInline:false,play:vi.fn().mockResolvedValue(undefined),requestVideoFrameCallback:vi.fn(),cancelVideoFrameCallback:vi.fn()} as unknown as HTMLVideoElement;
  const statuses:string[]=[],tracker=new Tracker(video,()=>{},message=>statuses.push(message));
  vi.spyOn(tracker,'load').mockImplementation(async()=>{expect(video.srcObject).toBe(stream);expect(statuses.at(-1)).toContain('Camera connected');tracker.delegate='CPU'});
  await tracker.start({...DEFAULT_SETTINGS,deviceId:'',facing:'environment'});
  expect(get).toHaveBeenCalledTimes(1);expect(video.muted).toBe(true);expect(video.playsInline).toBe(true);expect(tracker.running).toBe(true);tracker.stop();expect(stream.getTracks()[0].stop).toHaveBeenCalledOnce();
 });
});
