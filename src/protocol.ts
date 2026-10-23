import {DEFAULT_SETTINGS,DEFAULT_WEIGHTS,type Settings,type Session,type Cue} from './types';
import {mean} from './math';
export function script(stance:Settings['stance']):Cue[]{const lead=stance==='orthodox'?'left':'right',rear=stance==='orthodox'?'right':'left';return[
{id:'neutral',text:'Face the tape line. Arms down.',seconds:5,kind:'hold'},
{id:'guardStart',text:'Fighting stance. Guard up. Hold still.',seconds:8,kind:'hold'},
{id:'tpose',text:'Face the tape line. Arms out in a T.',seconds:4,kind:'hold'},
{id:'leadForward',text:`Reach your ${lead} arm along the tape. Hold.`,seconds:3,kind:'hold',side:'lead'},
{id:'rearForward',text:`Reach your ${rear} arm along the tape. Hold.`,seconds:3,kind:'hold',side:'rear'},
{id:'jabSlow',text:`Five slow ${lead} jabs. Return to guard.`,seconds:10,kind:'punch',count:5,side:'lead'},
{id:'jabFast',text:`Five fast ${lead} jabs.`,seconds:5,kind:'punch',count:5,side:'lead'},
{id:'crossSlow',text:`Five slow ${rear} crosses.`,seconds:10,kind:'punch',count:5,side:'rear'},
{id:'crossFast',text:`Five fast ${rear} crosses.`,seconds:5,kind:'punch',count:5,side:'rear'},
{id:'hook',text:`Five slow ${lead} hooks.`,seconds:10,kind:'punch',count:5,side:'lead'},
{id:'uppercut',text:`Five slow ${rear} uppercuts.`,seconds:10,kind:'punch',count:5,side:'rear'},
{id:'slipLeft',text:'Slip left three times. Reset each time.',seconds:6,kind:'head',count:3},
{id:'slipRight',text:'Slip right three times. Reset each time.',seconds:6,kind:'head',count:3},
{id:'roll',text:'Roll three times. Reset each time.',seconds:6,kind:'head',count:3},
{id:'duck',text:'Duck three times. Reset each time.',seconds:6,kind:'head',count:3},
{id:'stepForward',text:'Step forward and back three times.',seconds:6,kind:'step',count:3},
{id:'stepSide',text:'Step left and right three times.',seconds:6,kind:'step',count:3},
{id:'guardEnd',text:'Guard up again. Hold still.',seconds:8,kind:'hold'}]}
export const score=(s:Session,w=DEFAULT_WEIGHTS):number|null=>{let n=0,d=0;for(const [k,v]of Object.entries(w)){if(v<=0)continue;const x=s.metrics?.scores[k];if(x===null||x===undefined)return null;n+=x*v;d+=v}return d?n/d:null};
export const combinationKey=(s:Settings)=>[s.angle,s.height,s.distance,s.orientation,s.model,s.resolution,s.stance,s.facing,s.deviceId,s.filter.minCutoff,s.filter.beta,s.filter.dCutoff].join('|');
export const placementLabel=(s:Settings)=>`${Math.abs(s.angle)}°${s.angle<0?' closed':''} · ${s.height} m high · ${s.distance} m away`;
export type PlanItem={settings:Settings;done:boolean;stage:string;index:number;total:number};
export function nextPlan(sessions:Session[],base:Settings=DEFAULT_SETTINGS):PlanItem|null{
const real=sessions.filter(s=>!s.synthetic&&s.complete&&s.settings.stance===base.stance&&s.settings.resolution===base.resolution&&s.settings.facing===base.facing&&s.settings.deviceId===base.deviceId&&JSON.stringify(s.settings.filter)===JSON.stringify(base.filter));
const make=(stage:string,over:Partial<Settings>)=>({...base,height:.9,distance:3,orientation:'landscape' as const,model:'full' as const,stage,...over,envelopeChecked:false});
const pending=(stage:string,configs:Settings[],repeat=1)=>{const i=configs.findIndex(c=>real.filter(s=>combinationKey(s.settings)===combinationKey(c)).length<repeat);return i<0?null:{settings:configs[i],done:false,stage,index:i+1,total:configs.length}};
const angles=[0,30,45,60,90,-45];const a=angles.map(angle=>make('A',{angle}));let p=pending('A',a);if(p)return p;
const ranked=(configs:Settings[])=>configs.map(c=>({c,v:mean(real.filter(s=>combinationKey(s.settings)===combinationKey(c)).map(s=>score(s)).filter((v):v is number=>v!==null))})).sort((a,b)=>(b.v??-1)-(a.v??-1));
const aRank=ranked(a).filter(x=>x.v!==null);if(aRank.length<2)return null;
const b=aRank.slice(0,2).flatMap(x=>[.3,.9,1.2,1.6].map(height=>make('B',{angle:x.c.angle,height})));p=pending('B',b);if(p)return p;
const bestB=ranked(b).find(x=>x.v!==null);if(!bestB)return null;
const c=[2,2.5,3,3.5].map(distance=>make('C',{angle:bestB.c.angle,height:bestB.c.height,distance}));p=pending('C',c);if(p)return p;
const bestC=ranked(c).find(x=>x.v!==null);if(!bestC)return null;
const d=(['landscape','portrait'] as const).flatMap(orientation=>(['lite','full','heavy'] as const).map(model=>({...bestC.c,orientation,model,stage:'D'})));p=pending('D',d);if(p)return p;
const configs=[...new Map([...a,...b,...c,...d].map(s=>[combinationKey(s),s])).values()];const top=ranked(configs).filter(x=>x.v!==null).slice(0,3).map(x=>({...x.c,stage:'Repeat'}));
let done=0;for(const cfg of top){const count=real.filter(s=>combinationKey(s.settings)===combinationKey(cfg)).length;done+=Math.min(2,Math.max(0,count-1));if(count<3)return{settings:cfg,stage:'Repeat',done:false,index:done+1,total:6}}
return null;
}
