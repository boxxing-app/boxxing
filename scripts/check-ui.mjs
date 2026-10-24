// Browser check of the built site, like a user on a phone. Needs Playwright with Chromium (preinstalled in Claude Code cloud sessions):
//   BASE_PATH=/boxxing/ npm run build && node scripts/check-ui.mjs [outDir]
// Serves dist/ under /boxxing/ (as GitHub Pages does), then checks ?demo=1 in portrait and landscape and the camera path with Chromium's fake camera.
import {execSync,spawn} from 'node:child_process';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import fs from 'node:fs';
// Playwright is not a project dependency: use a local install if there is one, else the global one.
const playwright=await import('playwright').catch(()=>import(pathToFileURL(path.join(execSync('npm root -g').toString().trim(),'playwright','index.js')).href)),chromium=playwright.chromium??playwright.default.chromium;
const out=process.argv[2]??'check-ui';fs.mkdirSync(out,{recursive:true});
const port=4174,base=`http://localhost:${port}/boxxing/`;
const server=spawn('npx',['vite','preview','--port',String(port),'--strictPort'],{env:{...process.env,BASE_PATH:'/boxxing/'},stdio:'ignore'});
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
for(let i=0;;i++){try{if((await fetch(base)).ok)break}catch{}if(i>50)throw new Error('preview server did not start');await sleep(200)}
const failures=[],check=(ok,message)=>{console.log(`${ok?'ok  ':'FAIL'} ${message}`);if(!ok)failures.push(message)};
const browser=await chromium.launch({args:['--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
async function open(query,viewport){
 const context=await browser.newContext({viewport,isMobile:true,hasTouch:true,deviceScaleFactor:2,permissions:['camera']});
 const page=await context.newPage(),errors=[];
 page.on('console',m=>{if(m.type()==='error')errors.push(m.text())});page.on('pageerror',e=>errors.push(String(e)));
 await page.goto(base+query);return{page,errors,context};
}
const layout=page=>page.evaluate(()=>{
 const visible=[...document.querySelectorAll('body *')].filter(e=>{const r=e.getBoundingClientRect(),s=getComputedStyle(e);return r.width>0&&r.height>0&&s.visibility!=='hidden'&&s.display!=='none'&&!e.closest('[hidden]')});
 const rect=id=>{const r=document.getElementById(id).getBoundingClientRect();return{x:r.x,y:r.y,w:r.width,h:r.height}};
 return{scrollW:document.documentElement.scrollWidth,scrollH:document.documentElement.scrollHeight,w:innerWidth,h:innerHeight,
  text:document.body.innerText.replace(/\s+/g,' ').trim(),controls:visible.filter(e=>/^(BUTTON|INPUT|A|SELECT|TEXTAREA)$/.test(e.tagName)).map(e=>e.id),
  cam:rect('cam-view'),world:rect('world-view'),mirror:['cam-view','world-view'].map(id=>getComputedStyle(document.getElementById(id)).transform)};
});
const shot=(page,id)=>page.locator('#'+id).screenshot();

for(const [name,viewport,query] of [['portrait',{width:390,height:844},'?demo=1'],['landscape',{width:844,height:390},'?demo=1'],['landscape debug',{width:844,height:390},'?demo=1&debug=1']]){
 const {page,errors,context}=await open(query,viewport);await sleep(3000);
 const l=await layout(page),file=name.replace(' ','-');await page.screenshot({path:`${out}/demo-${file}.png`});
 check(l.scrollW<=l.w&&l.scrollH<=l.h,`${name}: fits one screen without scrolling (${l.scrollW}x${l.scrollH} in ${l.w}x${l.h})`);
 check(l.controls.length===0,`${name}: no buttons or fields (${l.controls})`);
 const status=name.includes('debug')?/^hand · demo · \d+ fps · 2 hands · 1280×960 · inference \d+ ms · [LR] 0\.97 · [LR] 0\.97( · measuring)?$/:/^hand · demo · \d+ fps · 2 hands$/;
 check(status.test(l.text),`${name}: only the status line ("${l.text}")`);
 const side=name.startsWith('landscape')?l.cam.x<l.world.x&&Math.abs(l.cam.y-l.world.y)<1:l.cam.y<l.world.y&&Math.abs(l.cam.x-l.world.x)<1;
 check(side&&Math.abs(l.cam.w*l.cam.h+l.world.w*l.world.h-l.w*l.h)<2,`${name}: camera ${name.startsWith('landscape')?'left':'top'}, 3D ${name.startsWith('landscape')?'right':'below'}, filling the screen`);
 const a=await shot(page,'world-view');await sleep(600);const b=await shot(page,'world-view');check(!a.equals(b),`${name}: the 3D hands move`);
 check(l.mirror.every(t=>t.startsWith('matrix(-1')),`${name}: front camera mirrors both views`);
 check(!errors.length,`${name}: no console errors ${errors.join(' | ')}`);await context.close();
}
{const {page,context}=await open('?demo=1&camera=rear',{width:844,height:390});await sleep(1000);const l=await layout(page);check(l.mirror.every(t=>t==='none'),`rear camera is not mirrored (${l.mirror})`);await context.close()}

// Camera path with Chromium's fake camera: starts on load, loads the hand model, runs the tracker.
{const {page,errors,context}=await open('',{width:844,height:390});let status='';
 for(let i=0;i<120&&!/fps/.test(status);i++){await sleep(500);status=await page.textContent('#status')}
 await sleep(3000);status=await page.textContent('#status');
 const video=await page.evaluate(()=>{const v=document.querySelector('video');return{w:v.videoWidth,h:v.videoHeight,playing:!v.paused}});
 await page.screenshot({path:`${out}/fake-camera.png`});
 check(/^hand · (GPU|CPU) · \d+ fps · no hands in view$/.test(status)&&video.w>0&&video.playing,`fake camera: starts on load, the hand model loads and tracking runs ("${status}", ${video.w}x${video.h})`);
 check(await page.isHidden('#start'),'fake camera: no Start camera overlay needed');
 check(!errors.length,`fake camera: no console errors ${errors.join(' | ')}`);await context.close();}

await browser.close();server.kill();
console.log(failures.length?`\n${failures.length} check(s) failed`:'\nAll checks passed');process.exit(failures.length?1:0);
