export type LoadPhase = 'download'|'verify'|'compile'|'gpu'|'cpu';
export type LoadProgress = {phase:LoadPhase;message:string;loaded?:number;total?:number;timeoutMs?:number};
export type FetchAssetOptions = {label:string;expectedBytes?:number;idleMs?:number;retries?:number;onProgress:(p:LoadProgress)=>void;fetcher?:typeof fetch;cache?:Cache|null};
const mb=(n:number)=>(n/1_000_000).toFixed(1);
export const backoff=(base:number,attempt:number)=>base*2**Math.min(attempt,3);
class RetryableAssetError extends Error{}
export async function fetchAsset(url:string,options:FetchAssetOptions):Promise<Uint8Array<ArrayBuffer>>{
 const {label,onProgress,expectedBytes,cache}=options;
 const cached=await cache?.match(url).catch(()=>undefined);
 if(cached){try{const bytes=new Uint8Array(await cached.arrayBuffer());if(!expectedBytes||bytes.length===expectedBytes){onProgress({phase:'download',message:`${label} · ready from this device`,loaded:bytes.length,total:bytes.length});return bytes}}catch{}await cache?.delete(url).catch(()=>{})}
 const retries=options.retries??3;
 for(let attempt=0;;attempt++){
 try{return await fetchAttempt(url,options,backoff(options.idleMs??30000,attempt))}
 catch(error){
  if(attempt>=retries||!(error instanceof RetryableAssetError||error instanceof TypeError))throw error;
  const delay=backoff(1000,attempt),nextIdle=backoff(options.idleMs??30000,attempt+1);
  onProgress({phase:'download',message:`${label} · retry ${attempt+1}/${retries} in ${delay/1000}s (stall limit ${nextIdle/1000}s)`,timeoutMs:delay+15000});
  await new Promise(resolve=>setTimeout(resolve,delay));
 }
 }
}
async function fetchAttempt(url:string,options:FetchAssetOptions,idleMs:number):Promise<Uint8Array<ArrayBuffer>>{
 const {label,onProgress,expectedBytes,cache}=options;
 const controller=new AbortController();let idle:ReturnType<typeof setTimeout>|undefined;let timedOut=false;let received=0;
 const reset=()=>{clearTimeout(idle);idle=setTimeout(()=>{timedOut=true;controller.abort()},idleMs)};reset();
 const report=(total?:number)=>onProgress({phase:'download',message:`${label} · ${mb(received)}${total?` / ${mb(total)}`:''} MB`,loaded:received,total,timeoutMs:idleMs+15000});
 report(expectedBytes);
 try{
  const response=await(options.fetcher??fetch)(url,{signal:controller.signal,credentials:'same-origin'});
  if(!response.ok){const message=response.status===401||response.status===403?`${label}: access expired. Reload the page and sign in again.`:`${label}: server returned HTTP ${response.status}.`;throw [408,429,500,502,503,504].includes(response.status)?new RetryableAssetError(message):new Error(message)}
  if((response.headers.get('content-type')??'').includes('text/html'))throw new Error(`${label}: the server returned a page instead of the required file. Reload and sign in again.`);
  reset();const length=expectedBytes||Number(response.headers.get('content-length'))||undefined;
  const chunks:Uint8Array[]=[],reader=response.body?.getReader();
  if(reader){while(true){const {done,value}=await reader.read();if(done)break;received+=value.byteLength;chunks.push(value);reset();report(length)}}else{const b=new Uint8Array(await response.arrayBuffer());received=b.length;chunks.push(b);report(length)}
  clearTimeout(idle);
  if(expectedBytes&&received!==expectedBytes)throw new RetryableAssetError(`${label}: incomplete download (${received} of ${expectedBytes} bytes). Retry the camera.`);
  const bytes=new Uint8Array(received);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length}
  if(cache)await cache.put(url,new Response(bytes,{headers:{'Content-Type':response.headers.get('content-type')??'application/octet-stream'}})).catch(()=>{});
  return bytes;
 }catch(error){if(timedOut)throw new RetryableAssetError(`${label}: download stalled at ${mb(received)} MB after ${idleMs/1000}s without progress. Check the connection and retry.`);throw error}
 finally{clearTimeout(idle);controller.abort()}
}
export function loadBudget(phase:LoadPhase,attempt=0){return backoff(phase==='gpu'?30000:phase==='cpu'?60000:phase==='compile'?90000:phase==='verify'?30000:60000,attempt)}
