import type {Point} from './types';
export const add=(a:Point,b:Point):Point=>({x:a.x+b.x,y:a.y+b.y,z:a.z+b.z});
export const sub=(a:Point,b:Point):Point=>({x:a.x-b.x,y:a.y-b.y,z:a.z-b.z});
export const mul=(a:Point,s:number):Point=>({x:a.x*s,y:a.y*s,z:a.z*s});
export const dot=(a:Point,b:Point)=>a.x*b.x+a.y*b.y+a.z*b.z;
export const norm=(a:Point)=>Math.hypot(a.x,a.y,a.z);
export const unit=(a:Point)=>mul(a,1/Math.max(norm(a),1e-9));
export const cross=(a:Point,b:Point):Point=>({x:a.y*b.z-a.z*b.y,y:a.z*b.x-a.x*b.z,z:a.x*b.y-a.y*b.x});
export const mid=(a:Point,b:Point)=>mul(add(a,b),.5);
export const dist=(a:Point,b:Point)=>norm(sub(a,b));
export const clamp=(x:number,a=0,b=1)=>Math.min(b,Math.max(a,x));
export const angle=(a:Point,b:Point,c:Point)=>Math.acos(clamp(dot(unit(sub(a,b)),unit(sub(c,b))),-1,1))*180/Math.PI;
export const mean=(xs:number[]):number|null=>xs.length?xs.reduce((a,b)=>a+b,0)/xs.length:null;
export const quantile=(xs:number[],p:number):number|null=>{if(!xs.length)return null;const s=[...xs].sort((a,b)=>a-b);const n=(s.length-1)*p;return s[Math.floor(n)]+(s[Math.ceil(n)]-s[Math.floor(n)])*(n%1)};
export const sd=(xs:number[]):number|null=>{const m=mean(xs);return m===null?null:Math.sqrt(xs.reduce((a,x)=>a+(x-m)**2,0)/Math.max(1,xs.length-1))};
export const visible=(ps:Point[],ids:number[])=>ids.every(i=>ps[i]&&(ps[i].visibility??0)>=.5);
export function bodyAxes(p:Point[]){const up=unit(sub(mid(p[11],p[12]),mid(p[23],p[24])));const right=unit(add(sub(p[12],p[11]),sub(p[24],p[23])));return{up,right,forward:unit(cross(up,right))}}
/** Torso facing angle to the camera, in MediaPipe world axes. 0 = facing the camera; positive = the camera is to the body's front-right.
 * toCamera is the horizontal direction from the body to the camera (x right, z away from the camera); by default straight down the optical axis. */
export const bodyAngle=(p:Point[],toCamera={x:0,z:-1})=>{const f=bodyAxes(p).forward,c=Math.hypot(toCamera.x,toCamera.z)||1,cx=toCamera.x/c,cz=toCamera.z/c;return Math.atan2(f.z*cx-f.x*cz,f.x*cx+f.z*cz)*180/Math.PI};
export const angularDiff=(a:number,b:number)=>Math.abs(((a-b+540)%360)-180);
