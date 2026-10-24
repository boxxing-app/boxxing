export type Point={x:number;y:number;z:number;visibility?:number;presence?:number};
export type Variant='hand';
export type Facing='user'|'environment';
export type FilterSettings={minCutoff:number;beta:number;dCutoff:number};
/** What the tracker needs to open the camera and load the model. */
export type Settings={model:Variant;resolution:string;facing:Facing;deviceId:string;orientation:'landscape'|'portrait'};
/** MediaPipe hand landmarks: 0 wrist; thumb 1–4; index 5–8; middle 9–12; ring 13–16; pinky 17–20. */
export const FINGERS=[[1,2,3,4],[5,6,7,8],[9,10,11,12],[13,14,15,16],[17,18,19,20]];
/** Each bone as [parent, child], in an order where every parent is placed before its child. */
export const BONES:[number,number][]=FINGERS.flatMap(f=>[[0,f[0]] as [number,number],...f.slice(1).map((j,i)=>[f[i],j] as [number,number])]);
/** Lines drawn on the camera image and in 3D: the bones plus the knuckle line across the palm. */
export const LINKS:[number,number][]=[...BONES,[5,9],[9,13],[13,17]];
export const DEFAULT_SETTINGS:Settings={model:'hand',resolution:'1280x960',facing:'user',deviceId:'',orientation:'landscape'};
/** Joint shapes, in metres relative to the hand centre. */
export const WORLD_FILTER:FilterSettings={minCutoff:1,beta:5,dCutoff:2};
/** Hand position in the camera frame, in metres. Steadier, because depth from image size is noisier than the shape. */
export const POSITION_FILTER:FilterSettings={minCutoff:1,beta:2,dCutoff:1};
