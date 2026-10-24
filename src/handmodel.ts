import * as T from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {palmQuaternion} from './physics';
const FINGER_NAMES=['index-finger','middle-finger','ring-finger','pinky-finger'];
/** The 25 WebXR hand joints and the MediaPipe landmark each one sits on. The four finger metacarpals have no landmark:
 * they stay where the model has them relative to the wrist and knuckles. */
const SOURCE:Record<string,number|null>={wrist:0,'thumb-metacarpal':1,'thumb-phalanx-proximal':2,'thumb-phalanx-distal':3,'thumb-tip':4,
 ...Object.fromEntries(FINGER_NAMES.flatMap((f,i)=>[[`${f}-metacarpal`,null],[`${f}-phalanx-proximal`,5+4*i],[`${f}-phalanx-intermediate`,6+4*i],[`${f}-phalanx-distal`,7+4*i],[`${f}-tip`,8+4*i]]))};
/** Each joint points at the next one in its finger; tips copy the joint before them. */
const NEXT:Record<string,string>={'thumb-metacarpal':'thumb-phalanx-proximal','thumb-phalanx-proximal':'thumb-phalanx-distal','thumb-phalanx-distal':'thumb-tip',
 ...Object.fromEntries(FINGER_NAMES.flatMap(f=>[[`${f}-metacarpal`,`${f}-phalanx-proximal`],[`${f}-phalanx-proximal`,`${f}-phalanx-intermediate`],[`${f}-phalanx-intermediate`,`${f}-phalanx-distal`],[`${f}-phalanx-distal`,`${f}-tip`]]))};
const ORDER=['wrist','thumb-metacarpal','thumb-phalanx-proximal','thumb-phalanx-distal','thumb-tip',...FINGER_NAMES.flatMap(f=>['metacarpal','phalanx-proximal','phalanx-intermediate','phalanx-distal','tip'].map(j=>`${f}-${j}`))];
/** A rigged, skinned hand (the WebXR "generic hand", MIT) posed from MediaPipe's 21 landmarks.
 * Each bone sits exactly on its landmark and points exactly at the next one; the hand's overall turn (from the palm)
 * carries the twist, and the mesh scales with the hand's size. */
export class HandModel{
 root:T.Object3D;mesh:T.SkinnedMesh;bones:Record<string,T.Bone>={};
 private restPos:Record<string,T.Vector3>={};private restQuat:Record<string,T.Quaternion>={};private restPalm:T.Quaternion;private restSize:number;
 constructor(scene:T.Object3D,color:number){
  this.root=scene;let mesh:T.SkinnedMesh|null=null;
  scene.traverse(o=>{if((o as T.SkinnedMesh).isSkinnedMesh)mesh=o as T.SkinnedMesh;if((o as T.Bone).isBone&&o.name in SOURCE)this.bones[o.name]=o as T.Bone});
  if(!mesh||ORDER.some(n=>!this.bones[n]))throw new Error('The hand model is missing its mesh or joints.');
  this.mesh=mesh;const old=this.mesh.material as T.Material;this.mesh.material=new T.MeshLambertMaterial({color});old.dispose();this.mesh.frustumCulled=false;
  // The joints are all direct children of the armature, so their local pose is their pose in the model.
  for(const n of ORDER){this.restPos[n]=this.bones[n].position.clone();this.restQuat[n]=this.bones[n].quaternion.clone()}
  const r=(i:number)=>this.restPos[ORDER.find(n=>SOURCE[n]===i)!];
  this.restPalm=palmQuaternion(Array.from({length:21},(_,i)=>[0,5,9,17].includes(i)?r(i):new T.Vector3()));this.restSize=r(9).distanceTo(r(0));
 }
 static async load(url:string,color:number){const gltf=await new GLTFLoader().loadAsync(url);return new HandModel(gltf.scene,color)}
 static async parse(data:ArrayBuffer,color:number){const gltf=await new GLTFLoader().parseAsync(data,'');return new HandModel(gltf.scene,color)}
 /** Pose from 21 landmark positions in the model's parent space (metres). */
 pose(p:T.Vector3[]){
  const turn=palmQuaternion(p).multiply(this.restPalm.clone().invert()),scale=p[9].distanceTo(p[0])/this.restSize;
  const at:Record<string,T.Vector3>={};
  for(const n of ORDER){const i=SOURCE[n];at[n]=i!==null?p[i].clone():p[0].clone().add(this.restPos[n].clone().sub(this.restPos.wrist).multiplyScalar(scale).applyQuaternion(turn))}
  for(const n of ORDER){
   const b=this.bones[n],next=NEXT[n];b.position.copy(at[n]);b.scale.setScalar(scale);
   if(next){
    // Turn with the hand, then aim exactly at the next joint.
    const rest=this.restPos[next].clone().sub(this.restPos[n]).applyQuaternion(turn).normalize(),want=at[next].clone().sub(at[n]);
    const aim=want.lengthSq()>1e-12?new T.Quaternion().setFromUnitVectors(rest,want.normalize()):new T.Quaternion();
    b.quaternion.copy(aim).multiply(turn).multiply(this.restQuat[n]);
   }else if(n==='wrist')b.quaternion.copy(turn).multiply(this.restQuat[n]);
  }
  // Tips keep their rest turn relative to the joint before them.
  for(const n of ORDER)if(n.endsWith('-tip')){const before=ORDER[ORDER.indexOf(n)-1];this.bones[n].quaternion.copy(this.bones[before].quaternion).multiply(this.restQuat[before].clone().invert()).multiply(this.restQuat[n])}
 }
 /** Unit vector from a joint toward the next one, after posing; for tests. */
 pointing(n:string){const next=NEXT[n];return this.restPos[next].clone().sub(this.restPos[n]).applyQuaternion(this.restQuat[n].clone().invert()).applyQuaternion(this.bones[n].quaternion).normalize()}
 static get joints(){return ORDER}
 static source(n:string){return SOURCE[n]}
 static next(n:string){return NEXT[n]}
}
