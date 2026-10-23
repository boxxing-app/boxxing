import type {Settings} from './types';

type Policy={allowsFeature:(feature:string)=>boolean};
export type CameraContext={secure:boolean;api:boolean;embedded:boolean;policyAllowed:boolean|null;ios:boolean;chromeIOS:boolean};
export function cameraContext():CameraContext{
 const nav=navigator,doc=document as Document&{permissionsPolicy?:Policy;featurePolicy?:Policy};
 let policyAllowed:boolean|null=null;try{policyAllowed=(doc.permissionsPolicy??doc.featurePolicy)?.allowsFeature('camera')??null}catch{}
 const ios=/iPhone|iPad|iPod/.test(nav.userAgent)||(/Macintosh/.test(nav.userAgent)&&nav.maxTouchPoints>1);
 return {secure:window.isSecureContext,api:typeof nav.mediaDevices?.getUserMedia==='function',embedded:window.self!==window.top,policyAllowed,ios,chromeIOS:ios&&/CriOS/.test(nav.userAgent)};
}
export function cameraPreflight(context:CameraContext){
 if(!context.secure)throw new Error('Camera access needs HTTPS. Open the published site directly in your browser.');
 if(context.policyAllowed===false)throw new Error(context.embedded?'This embedded page is not allowed to request the camera. Open the camera page in a new browser tab.':'The page permission policy blocks camera access. Open the published site directly; if it persists, report this message.');
 if(!context.api)throw new Error('Camera access is unavailable in this browser view. Open the published link directly in Chrome or Safari.');
}
export function cameraError(error:unknown,context:CameraContext){
 const name=error&&typeof error==='object'&&'name'in error?String(error.name):'';
 if(name==='NotAllowedError'||name==='PermissionDeniedError')return context.embedded?'Camera permission was blocked. Open the camera page in a new browser tab, then tap Start camera.':context.chromeIOS?'Camera permission was blocked (NotAllowedError). On iPhone, open Settings → Privacy & Security → Camera and enable Chrome. Also check the camera icon in Chrome’s address bar, if shown. Then return and tap Start camera.':context.ios?'Camera permission was blocked (NotAllowedError). Allow camera access in your browser’s site settings and iPhone Settings, then tap Start camera again.':'Camera permission was blocked (NotAllowedError). Allow camera access in your browser’s site settings and device settings, then tap Start camera again.';
 if(name==='NotFoundError'||name==='DevicesNotFoundError')return 'No camera is available (NotFoundError). Check that camera access is enabled on this device.';
 if(name==='NotReadableError'||name==='TrackStartError')return 'The camera could not start (NotReadableError). Close other camera apps or calls, then retry.';
 if(name==='OverconstrainedError')return 'This camera cannot use the requested settings. Select Automatic lens and a lower resolution, then retry.';
 if(name==='SecurityError')return 'Camera access is disabled by this browser or device policy (SecurityError). Open the published site directly and check camera permissions.';
 return error instanceof Error?error.message:String(error);
}

function requestOnce(constraints:MediaStreamConstraints,signal:AbortSignal):Promise<MediaStream>{
 return new Promise((resolve,reject)=>{
  const cancel=()=>reject(new DOMException('Camera request cancelled.','AbortError'));
  if(signal.aborted){cancel();return}
  signal.addEventListener('abort',cancel,{once:true});
  const clean=()=>signal.removeEventListener('abort',cancel);
  // Run immediately in the tap handler; do not await permission queries or model work.
  try{navigator.mediaDevices.getUserMedia(constraints).then(stream=>{
   clean();if(signal.aborted){stream.getTracks().forEach(track=>track.stop());return}resolve(stream);
  },error=>{clean();reject(error)})}catch(error){clean();reject(error)}
 });
}

export async function requestCamera(settings:Settings,signal:AbortSignal,onStatus:(message:string,help?:boolean)=>void,context=cameraContext()){
 cameraPreflight(context);
 const [width,height]=settings.resolution.split('x').map(Number),portrait=settings.orientation==='portrait';
 // resizeMode 'none': use a real camera format instead of letting the browser crop and scale to the requested size.
 // With a 4:3 request that is the whole sensor; a 16:9 request crops it (to under half its area in portrait).
 const video:MediaTrackConstraints&{resizeMode?:ConstrainDOMString}={width:{ideal:portrait?height:width},height:{ideal:portrait?width:height},frameRate:{ideal:30},resizeMode:{ideal:'none'},...(settings.deviceId?{deviceId:{exact:settings.deviceId}}:{facingMode:{ideal:settings.facing}})};
 const hint=setTimeout(()=>{if(!signal.aborted)onStatus('Waiting for camera permission. If no prompt appears, check the camera permission in the browser site settings. You can cancel and retry.',true)},8000);
 try{
  let stream:MediaStream;
  try{stream=await requestOnce({audio:false,video},signal)}catch(error){
   if(signal.aborted)throw error;
   const name=error&&typeof error==='object'&&'name'in error?String(error.name):'';
   if(name!=='OverconstrainedError'&&!(name==='NotFoundError'&&settings.deviceId))throw error;
   onStatus('Saved camera settings are unavailable. Requesting the automatic camera…');
   stream=await requestOnce({audio:false,video:{facingMode:{ideal:settings.facing}}},signal);
  }
  if(signal.aborted){stream.getTracks().forEach(track=>track.stop());throw new DOMException('Camera request cancelled.','AbortError')}
  return stream;
 }catch(error){if(signal.aborted)throw error;throw new Error(cameraError(error,context))}
 finally{clearTimeout(hint)}
}
