import {IMAGE_FILTER,WORLD_FILTER,type Facing,type FilterSettings,type Variant} from './types';
export type Config={facing:Facing;model:Variant;resolution:string;world:FilterSettings;image:FilterSettings;debug:boolean;demo:boolean};
export const RESOLUTIONS=['640x480','1280x720','1920x1080'];
/** New key: the prototype's 'motion-settings' held pixel-tuned values that must not come back. */
export const SMOOTHING_KEY='boxxing.smoothing.world.v2';
const OLD_KEYS=['motion-settings','motion-weights'];
type Store=Pick<Storage,'getItem'|'setItem'|'removeItem'>;
/** Settings come only from the URL: ?camera=rear ?model=lite|full|heavy ?res=WxH ?minCutoff= &beta= &dCutoff= ?debug=1 ?demo=1.
 * Smoothing values given in the URL are remembered on this device; give the defaults (1.5, 5, 2) to go back. */
export function parseConfig(search:string,store:Store|null=null):Config{
 const q=new URLSearchParams(search),flag=(k:string)=>['1','true','yes','on'].includes((q.get(k)??'').toLowerCase());
 const model=q.get('model'),res=q.get('res');
 let world={...WORLD_FILTER};
 try{for(const k of OLD_KEYS)store?.removeItem(k);const saved=JSON.parse(store?.getItem(SMOOTHING_KEY)??'null');if(saved)world=pick(world,saved)}catch{}
 const fromUrl=pick({},Object.fromEntries((['minCutoff','beta','dCutoff'] as const).filter(k=>q.has(k)).map(k=>[k,Number(q.get(k))])));
 if(Object.keys(fromUrl).length){world={...world,...fromUrl};try{store?.setItem(SMOOTHING_KEY,JSON.stringify(world))}catch{}}
 return{facing:q.get('camera')==='rear'?'environment':'user',model:model==='lite'||model==='heavy'?model:'full',resolution:res&&RESOLUTIONS.includes(res)?res:'1280x720',world,image:{...IMAGE_FILTER},debug:flag('debug'),demo:flag('demo')};
}
/** Keeps only valid filter numbers: minCutoff and dCutoff > 0, beta >= 0. */
function pick<T extends Partial<FilterSettings>>(base:T,v:Record<string,unknown>):T{const out:Partial<FilterSettings>={...base};for(const k of ['minCutoff','beta','dCutoff'] as const){const x=v[k];if(typeof x==='number'&&Number.isFinite(x)&&(k==='beta'?x>=0:x>0))out[k]=x}return out as T}
