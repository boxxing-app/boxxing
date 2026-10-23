import type {PositionRecord} from './capture';
// A new database: the prototype's sessions (boxxxing-motion-lab) are not read.
let database:Promise<IDBDatabase>|undefined;
function db(){return database??=new Promise((resolve,reject)=>{const r=indexedDB.open('boxxing-positions',1);r.onupgradeneeded=()=>{r.result.createObjectStore('positions',{keyPath:'id',autoIncrement:true})};r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error)})}
async function operation<T>(mode:IDBTransactionMode,fn:(s:IDBObjectStore)=>IDBRequest<T>):Promise<T>{const d=await db();return new Promise((resolve,reject)=>{const tx=d.transaction('positions',mode);const r=fn(tx.objectStore('positions'));tx.oncomplete=()=>resolve(r.result);tx.onerror=()=>reject(tx.error??r.error);tx.onabort=()=>reject(tx.error??new Error('Storage transaction aborted'))})}
/** Saves a record and returns its number (#n). */
export const savePosition=(record:PositionRecord)=>operation('readwrite',s=>s.add(record)) as Promise<number>;
export const listPositions=()=>operation<PositionRecord[]>('readonly',s=>s.getAll());
export const countPositions=()=>operation<number>('readonly',s=>s.count());
export function download(name:string,data:string,type='application/json'){const url=URL.createObjectURL(new Blob([data],{type}));const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),10000)}
