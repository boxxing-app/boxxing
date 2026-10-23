import * as T from 'three';
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';
import {LINKS,type Point,type RigData} from './types';
import {dist,mid,quantile,visible} from './math';
/** MediaPipe (x right, y down, z away from the camera) → Three.js (y up, z toward the camera). MediaPipe's left is +x. */
export const V=(p:Point)=>new T.Vector3(p.x,-p.y,-p.z);
const P=(v:T.Vector3):Point=>({x:v.x,y:-v.y,z:-v.z});
const lengths={torso:.5,shoulder:.38,hip:.28,upperArm:.29,forearm:.26,thigh:.42,shin:.42,neck:.22,head:.16};
/** Rotation whose x axis is exactly `x` and whose y axis is `up` made perpendicular. */
const frameX=(x:T.Vector3,up:T.Vector3)=>{const X=x.clone().normalize(),Z=new T.Vector3().crossVectors(X,up).normalize(),Y=new T.Vector3().crossVectors(Z,X);return new T.Quaternion().setFromRotationMatrix(new T.Matrix4().makeBasis(X,Y,Z))};
/** Rotation whose y axis is exactly `up` and whose x axis is `x` made perpendicular. */
const frameY=(up:T.Vector3,x:T.Vector3)=>{const Y=up.clone().normalize(),Z=new T.Vector3().crossVectors(x,Y).normalize(),X=new T.Vector3().crossVectors(Y,Z);return new T.Quaternion().setFromRotationMatrix(new T.Matrix4().makeBasis(X,Y,Z))};
/** Rotation whose x axis is exactly `x` and whose z (forward) axis is `forward` made perpendicular. */
const frameXZ=(x:T.Vector3,forward:T.Vector3)=>{const X=x.clone().normalize(),Y=new T.Vector3().crossVectors(forward,X).normalize(),Z=new T.Vector3().crossVectors(X,Y);return new T.Quaternion().setFromRotationMatrix(new T.Matrix4().makeBasis(X,Y,Z))};
export class Humanoid{
mesh:T.SkinnedMesh; bones:T.Bone[]=[]; byName:Record<string,T.Bone>={}; map:Record<number,T.Bone>={}; dimensions={...lengths}; samples:Point[][]=[]; calibrated=false;
constructor(){this.mesh=this.build()}
private bone(name:string,parent:T.Bone|null,x:number,y:number,z:number,index?:number){const b=new T.Bone();b.name=name;b.position.set(x,y,z);if(parent)parent.add(b);this.bones.push(b);this.byName[name]=b;if(index!==undefined)this.map[index]=b;return b}
private build(){this.bones=[];this.byName={};this.map={};const d=this.dimensions;
// The pelvis follows the hip line; the chest (a child of the pelvis, pivoting at the hip centre) follows the shoulder line.
const pelvis=this.bone('pelvis',null,0,0,0),chest=this.bone('chest',pelvis,0,0,0),neck=this.bone('neck',chest,0,d.torso,0),head=this.bone('head',neck,0,d.neck,0);this.bone('nose',head,0,0,.1,0);
for(const side of [0,1]){const sign=side===0?1:-1;const tag=side===0?'left':'right';const sh=this.bone(tag+'Shoulder',chest,sign*d.shoulder/2,d.torso,0,11+side),el=this.bone(tag+'Elbow',sh,sign*d.upperArm,0,0,13+side);this.bone(tag+'Wrist',el,sign*d.forearm,0,0,15+side);const hip=this.bone(tag+'Hip',pelvis,sign*d.hip/2,0,0,23+side),knee=this.bone(tag+'Knee',hip,0,-d.thigh,0,25+side),ankle=this.bone(tag+'Ankle',knee,0,-d.shin,0,27+side);this.bone(tag+'Foot',ankle,0,-.04,.14,31+side)}
pelvis.updateMatrixWorld(true);const geometries:T.BufferGeometry[]=[];
const shape=(g:T.BufferGeometry,b:T.Bone,offset:T.Vector3,rotation?:T.Quaternion)=>{if(rotation)g.applyQuaternion(rotation);g.translate(offset.x,offset.y,offset.z);const p=g.getAttribute('position'),idx=this.bones.indexOf(b),si=[],sw=[];for(let i=0;i<p.count;i++){si.push(idx,0,0,0);sw.push(1,0,0,0)}g.setAttribute('skinIndex',new T.Uint16BufferAttribute(si,4));g.setAttribute('skinWeight',new T.Float32BufferAttribute(sw,4));geometries.push(g)};
const pos=(b:T.Bone)=>b.getWorldPosition(new T.Vector3());
const limb=(b:T.Bone,to:T.Vector3,radius:number)=>{const a=pos(b),len=a.distanceTo(to);shape(new T.CylinderGeometry(radius*.85,radius,len,10,1),b,a.clone().add(to).multiplyScalar(.5),new T.Quaternion().setFromUnitVectors(new T.Vector3(0,1,0),to.clone().sub(a).normalize()))};
limb(chest,pos(neck),.12);limb(neck,pos(head),.05);
for(const b of this.bones){if(!/Shoulder|Elbow|Hip|Knee|Ankle/.test(b.name))continue;for(const child of b.children)if(child instanceof T.Bone)limb(b,pos(child),b.name.includes('Hip')?.075:b.name.includes('Knee')?.055:b.name.includes('Shoulder')?.057:.043)}
shape(new T.SphereGeometry(.105,16,12).scale(.85,1.15,.9),head,pos(head).add(new T.Vector3(0,.05,-.02)));shape(new T.SphereGeometry(.028,8,6),head,pos(this.byName.nose));
shape(new T.SphereGeometry(.13,12,8).scale(d.shoulder/.26,.8,.75),chest,pos(neck).add(new T.Vector3(0,-.08,0)));shape(new T.SphereGeometry(.13,12,8).scale(d.hip/.24,.6,.7),pelvis,pos(pelvis));
for(const i of [13,14,15,16,25,26])shape(new T.SphereGeometry(i<17?.055:.065,10,8),this.map[i],pos(this.map[i]));
const mesh=new T.SkinnedMesh(mergeGeometries(geometries),new T.MeshStandardMaterial({color:0xd8e0d8,roughness:.65,metalness:.2}));geometries.forEach(g=>g.dispose());mesh.add(pelvis);mesh.bind(new T.Skeleton(this.bones));mesh.frustumCulled=false;return mesh;}
calibrate(p:Point[],image:Point[]){if(this.calibrated||!visible(image,[11,12,13,14,15,16,23,24,25,26,27,28]))return;this.samples.push(p);if(this.samples.length<30)return;const median=(fn:(p:Point[])=>number)=>quantile(this.samples.map(fn),.5)!;this.dimensions={...lengths,torso:median(p=>dist(mid(p[11],p[12]),mid(p[23],p[24]))),shoulder:median(p=>dist(p[11],p[12])),hip:median(p=>dist(p[23],p[24])),upperArm:median(p=>(dist(p[11],p[13])+dist(p[12],p[14]))/2),forearm:median(p=>(dist(p[13],p[15])+dist(p[14],p[16]))/2),thigh:median(p=>(dist(p[23],p[25])+dist(p[24],p[26]))/2),shin:median(p=>(dist(p[25],p[27])+dist(p[26],p[28]))/2),neck:median(p=>dist(mid(p[11],p[12]),mid(p[7],p[8])))};this.rebuild();this.calibrated=true;this.samples=[];}
resetCalibration(){this.calibrated=false;this.samples=[]}
setCalibration(d:Record<string,number>){for(const k of Object.keys(this.dimensions) as (keyof typeof lengths)[])if(Number.isFinite(d[k])&&d[k]>0)this.dimensions[k]=d[k];this.rebuild();this.calibrated=true;}
private rebuild(){const parent=this.mesh.parent,old=this.mesh,material=old.material as T.Material;parent?.remove(old);old.geometry.dispose();old.skeleton.dispose();this.mesh=this.build();(this.mesh.material as T.Material).dispose();this.mesh.material=material;parent?.add(this.mesh)}
/** Rotation of a bone relative to the mesh, so the solve does not depend on where the avatar's group is placed. */
private meshQ(o:T.Object3D|null){const q=new T.Quaternion();while(o&&o!==this.mesh){q.premultiply(o.quaternion);o=o.parent}return q}
solve(p:Point[],image:Point[],aspect=16/9):RigData{
const pelvis=this.byName.pelvis,chest=this.byName.chest,hipMid=V(mid(p[23],p[24])),shoulderMid=V(mid(p[11],p[12])),earMid=V(mid(p[7],p[8]));pelvis.position.copy(hipMid);
const up=shoulderMid.clone().sub(hipMid).normalize(),pelvisQ=frameX(V(p[23]).sub(V(p[24])),up);pelvis.quaternion.copy(pelvisQ);
chest.quaternion.copy(pelvisQ.clone().invert().multiply(frameY(up,V(p[11]).sub(V(p[12])))));
const aimAt=(b:T.Bone,direction:T.Vector3)=>{const child=b.children.find(x=>x instanceof T.Bone) as T.Bone|undefined;if(!child)return;const target=direction.clone().normalize().applyQuaternion(this.meshQ(b.parent).invert());b.quaternion.setFromUnitVectors(child.position.clone().normalize(),target)};
const aim=(b:T.Bone,a:number,c:number)=>aimAt(b,V(p[c]).sub(V(p[a])));
const neck=this.byName.neck,head=this.byName.head;aimAt(neck,earMid.clone().sub(shoulderMid));
head.quaternion.copy(this.meshQ(neck).invert().multiply(frameXZ(V(p[7]).sub(V(p[8])),V(p[0]).sub(earMid))));
for(const side of [0,1]){aim(this.map[11+side],11+side,13+side);aim(this.map[13+side],13+side,15+side);aim(this.map[23+side],23+side,25+side);aim(this.map[25+side],25+side,27+side);aim(this.map[27+side],27+side,31+side)}
this.mesh.updateMatrixWorld(true);const toMesh=this.mesh.matrixWorld.clone().invert(),world:Record<number,Point>={};for(const [i,b]of Object.entries(this.map))world[Number(i)]=P(new T.Vector3().setFromMatrixPosition(b.matrixWorld).applyMatrix4(toMesh));
const rotations=Object.fromEntries(this.bones.map(b=>[b.name,b.quaternion.toArray()]));
// Fit ONLY translation + uniform scale to the observed torso; no limb points fit.
// Weak perspective approximation, not a calibrated pinhole camera.
const ids=[11,12,23,24].filter(i=>visible(image,[i]));let projection:RigData['projection']=null;const projected:Record<number,Point>={};
if(ids.length>=3){const mx=ids.reduce((a,i)=>a+world[i].x,0)/ids.length,my=ids.reduce((a,i)=>a+world[i].y,0)/ids.length,ix=ids.reduce((a,i)=>a+image[i].x*aspect,0)/ids.length,iy=ids.reduce((a,i)=>a+image[i].y,0)/ids.length;let n=0,d=0;for(const i of ids){n+=(world[i].x-mx)*(image[i].x*aspect-ix)+(world[i].y-my)*(image[i].y-iy);d+=(world[i].x-mx)**2+(world[i].y-my)**2}const scale=n/Math.max(d,1e-8),tx=ix-scale*mx,ty=iy-scale*my;projection={scale,tx,ty};for(const [i,p]of Object.entries(world))projected[Number(i)]={x:(p.x*scale+tx)/aspect,y:p.y*scale+ty,z:0}}
return{rotations,world,projected,projection};}
dispose(){this.mesh.geometry.dispose();(this.mesh.material as T.Material).dispose();this.mesh.skeleton.dispose()}
}
