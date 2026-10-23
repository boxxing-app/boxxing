import type {Point} from './types';
import {mid} from './math';
/** A synthetic MediaPipe-style world pose (metres, hip-centred, x right, y down, z away from the camera), facing the camera. */
export function demoPose(t=0,cue='guardStart'):Point[]{const p:Point[]=Array.from({length:33},()=>({x:0,y:-.7,z:0,visibility:.99,presence:.99}));const set=(i:number,x:number,y:number,z=0)=>p[i]={x,y,z,visibility:.99,presence:.99};set(0,0,-.78,-.04);set(7,.07,-.76);set(8,-.07,-.76);for(const side of [0,1]){const s=side?-1:1;set(11+side,s*.19,-.5);set(23+side,s*.14,0);set(25+side,s*.17,.4);set(27+side,s*.2,.81);set(29+side,s*.2,.85,.05);set(31+side,s*.2,.85,-.16);set(13+side,s*.29,-.27,-.07);set(15+side,s*.22,-.52,-.27);if(cue==='neutral'){set(13+side,s*.22,-.22);set(15+side,s*.24,.04)}if(cue==='tpose'){set(13+side,s*.48,-.5);set(15+side,s*.74,-.5)}if((cue==='leadForward'&&side===0)||(cue==='rearForward'&&side===1)){set(13+side,s*.19,-.5,-.29);set(15+side,s*.19,-.5,-.55)}const isPunch=(cue.startsWith('jab')&&side===0)||(cue.startsWith('cross')&&side===1)||(cue==='hook'&&side===0)||(cue==='uppercut'&&side===1);if(isPunch){const phase=(Math.sin(t*Math.PI*(cue.includes('Fast')?2:1)-Math.PI/2)+1)/2;set(13+side,s*(.29-.1*phase),-.27-.23*phase,-.07-.22*phase);set(15+side,s*(.22-.03*phase),-.52+.02*phase,-.27-.28*phase)}}if(['slipLeft','slipRight','roll','duck'].includes(cue)){const phase=(1-Math.cos(t*Math.PI))/2;const x=cue==='slipLeft'?.12*phase:cue==='slipRight'?-.12*phase:cue==='roll'?.12*Math.sin(t*Math.PI):0;for(let i=0;i<23;i++){p[i].x+=x;p[i].y+=cue==='duck'||cue==='roll'?.16*phase:0}}return p}

const UPPER=Array.from({length:23},(_,i)=>i),HEAD=Array.from({length:11},(_,i)=>i);
const rotate=(p:Point[],ids:number[],axis:'y'|'z',deg:number,c:Point={x:0,y:0,z:0})=>{const a=deg*Math.PI/180,cs=Math.cos(a),sn=Math.sin(a);for(const i of ids){const q=p[i],x=q.x-c.x,y=q.y-c.y,z=q.z-c.z;if(axis==='y'){q.x=c.x+x*cs-z*sn;q.z=c.z+x*sn+z*cs}else{q.x=c.x+x*cs-y*sn;q.y=c.y+x*sn+y*cs}}return p};
const copy=(p:Point[])=>p.map(q=>({...q}));
/** Turn the whole body about the vertical axis. Positive = the camera ends up to the body's front-right. */
export const turn=(p:Point[],deg:number)=>rotate(copy(p),p.map((_,i)=>i),'y',deg);
/** Turn the upper body (shoulders, arms, head) against the hips. */
export const twist=(p:Point[],deg:number)=>rotate(copy(p),UPPER,'y',deg);
/** Slip: bend the upper body sideways about the hips, and tip the head further about the neck. */
export function slip(p:Point[],deg:number,headDeg=deg){const q=rotate(copy(p),UPPER,'z',deg);return rotate(q,HEAD,'z',headDeg,mid(q[11],q[12]))}
/** Duck: bend the knees so the hips drop by `depth` metres with the feet planted. Hip-centred, so the feet rise. */
export function duck(p:Point[],depth:number){
 const q=copy(p);
 for(const side of [0,1]){
  const H=q[23+side],K=q[25+side],A=q[27+side],l1=Math.hypot(K.x-H.x,K.y-H.y,K.z-H.z),l2=Math.hypot(A.x-K.x,A.y-K.y,A.z-K.z);
  for(const i of [27,29,31])q[i+side].y-=depth;
  const ax=A.x-H.x,ay=A.y-H.y,az=A.z-H.z,D=Math.hypot(ax,ay,az),e={x:ax/D,y:ay/D,z:az/D};
  // The knee goes forward: toward the camera when facing it (MediaPipe -z).
  const f={x:0,y:0,z:-1},fe=f.x*e.x+f.y*e.y+f.z*e.z,n0={x:f.x-fe*e.x,y:f.y-fe*e.y,z:f.z-fe*e.z},nn=Math.hypot(n0.x,n0.y,n0.z),n={x:n0.x/nn,y:n0.y/nn,z:n0.z/nn};
  const along=(l1*l1-l2*l2+D*D)/(2*D),h=Math.sqrt(Math.max(0,l1*l1-along*along));
  K.x=H.x+e.x*along+n.x*h;K.y=H.y+e.y*along+n.y*h;K.z=H.z+e.z*along+n.z*h;
 }
 return q;
}
export type Pinhole={f:number;aspect:number};
/** Project a hip-centred world pose standing with its hip centre at `root` (camera frame, Three.js axes, metres) into 0–1 image points. */
export function project(world:Point[],root:{x:number;y:number;z:number},cam:Pinhole):Point[]{return world.map(p=>{const x=root.x+p.x,y=root.y-p.y,z=-(root.z-p.z);return{x:.5+cam.f*x/z/cam.aspect,y:.5-cam.f*y/z,z:p.z,visibility:p.visibility,presence:p.presence}})}
export const DEMO_CAMERA:Pinhole={f:1.25,aspect:16/9};
/** A looping routine for ?demo=1: stand still, then jab, cross, slips, a duck and steps, at 45° to the camera. */
export function demoFrame(t:number):{world:Point[];image:Point[]}{
 const cycle=12,s=t<3?-1:(t-3)%cycle,phase=(a:number,b:number)=>s>=a&&s<b?(1-Math.cos((s-a)/(b-a)*2*Math.PI))/2:0;
 let p=demoPose(s>=0&&s<1?s*2:s>=1&&s<2?(s-1)*2:0,s>=0&&s<1?'jabFast':s>=1&&s<2?'crossFast':'guardStart');
 p=slip(p,14*(phase(2,3)-phase(3,4)),20*(phase(2,3)-phase(3,4)));
 p=duck(p,.22*phase(4,5.5));p=twist(p,-25*phase(5.5,6.5));
 const step=phase(7,9.5),side=phase(9.5,12);
 const root={x:.3*side,y:-.15-.22*phase(4,5.5),z:-3+.45*step};
 const world=turn(p,45);return{world,image:project(world,root,DEMO_CAMERA)};
}
