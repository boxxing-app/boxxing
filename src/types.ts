export type Point={x:number;y:number;z:number;visibility?:number;presence?:number};
export type Variant='lite'|'full'|'heavy';
export type Facing='user'|'environment';
export type FilterSettings={minCutoff:number;beta:number;dCutoff:number};
/** What the tracker needs to open the camera and load a model. */
export type Settings={model:Variant;resolution:string;facing:Facing;deviceId:string;orientation:'landscape'|'portrait'};
export type Tilt={alpha:number|null;beta:number|null;gamma:number|null;screenAngle:number;at:number};
export type RigData={rotations:Record<string,number[]>;world:Record<number,Point>;projected:Record<number,Point>;projection:{scale:number;tx:number;ty:number}|null};
export const KEYS=[0,11,12,13,14,15,16,23,24,25,26,27,28];
export const NAMES:Record<number,string>={0:'nose',11:'leftShoulder',12:'rightShoulder',13:'leftElbow',14:'rightElbow',15:'leftWrist',16:'rightWrist',23:'leftHip',24:'rightHip',25:'leftKnee',26:'rightKnee',27:'leftAnkle',28:'rightAnkle'};
/** Heels 29/30, foot index 31/32 and ankles 27/28: the points that can touch the floor. */
export const FOOT=[27,28,29,30,31,32];
export const LINKS:[number,number][]=[[11,12],[11,13],[13,15],[12,14],[14,16],[11,23],[12,24],[23,24],[23,25],[25,27],[24,26],[26,28],[27,29],[29,31],[27,31],[28,30],[30,32],[28,32],[0,7],[0,8]];
export const DEFAULT_SETTINGS:Settings={model:'full',resolution:'1280x960',facing:'user',deviceId:'',orientation:'landscape'};
/** World points are metres. Tuned so a 45 cm, 150 ms jab keeps >90% of its reach at 20 fps. */
export const WORLD_FILTER:FilterSettings={minCutoff:1.5,beta:5,dCutoff:2};
/** Image points are 0–1 of the frame. About 2.5 m per frame height at 3 m, so beta is scaled to match the world setting. */
export const IMAGE_FILTER:FilterSettings={minCutoff:1.5,beta:12,dCutoff:2};
