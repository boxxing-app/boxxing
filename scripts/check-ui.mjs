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
 const context=await browser.newContext({viewport,isMobile:true,hasTouch:true,deviceScaleFactor:2,acceptDownloads:true,permissions:['camera']});
 const page=await context.newPage(),errors=[];
 page.on('console',m=>{if(m.type()==='error')errors.push(m.text())});page.on('pageerror',e=>errors.push(String(e)));
 await page.goto(base+query);return{page,errors,context};
}
const layout=page=>page.evaluate(()=>{
 const visible=[...document.querySelectorAll('body *')].filter(e=>{const r=e.getBoundingClientRect(),s=getComputedStyle(e);return r.width>0&&r.height>0&&s.visibility!=='hidden'&&s.display!=='none'&&!e.hidden&&!e.closest('[hidden]')});
 const rect=id=>{const r=document.getElementById(id).getBoundingClientRect();return{x:r.x,y:r.y,w:r.width,h:r.height}};
 return{scrollW:document.documentElement.scrollWidth,scrollH:document.documentElement.scrollHeight,w:innerWidth,h:innerHeight,
  text:document.body.innerText.replace(/\s+/g,' ').trim(),controls:visible.filter(e=>/^(BUTTON|INPUT|A|SELECT|TEXTAREA)$/.test(e.tagName)).map(e=>e.id),
  cam:rect('cam-view'),world:rect('world-view'),bar:document.querySelector('.bar').getBoundingClientRect().height,
  mirror:['cam-view','world-view'].map(id=>getComputedStyle(document.getElementById(id)).transform),status:document.getElementById('status').textContent};
});
const shot=(page,id)=>page.locator('#'+id).screenshot();

for(const [name,viewport] of [['portrait',{width:390,height:844}],['landscape',{width:844,height:390}]]){
 const {page,errors,context}=await open('?demo=1',viewport);await sleep(5000);
 const l=await layout(page);await page.screenshot({path:`${out}/demo-${name}.png`});
 check(l.scrollW<=l.w&&l.scrollH<=l.h,`${name}: fits one screen without scrolling (${l.scrollW}x${l.scrollH} in ${l.w}x${l.h})`);
 check(JSON.stringify(l.controls)===JSON.stringify(['match','save','export']),`${name}: only Match %, Save and Export are interactive (${l.controls})`);
 check(/^full · demo · \d+ fps( · stand still to calibrate| · no one in view)? Match % Save this position Export \(\d+\)$/.test(l.text),`${name}: nothing extra on screen ("${l.text}")`);
 const panes=name==='landscape'?l.cam.x<l.world.x&&Math.abs(l.cam.y-l.world.y)<1:l.cam.y<l.world.y&&Math.abs(l.cam.x-l.world.x)<1;
 check(panes&&l.cam.w*l.cam.h+l.world.w*l.world.h>.8*l.w*l.h,`${name}: camera ${name==='landscape'?'left':'top'}, 3D ${name==='landscape'?'right':'below'}, together ${(100*(l.cam.w*l.cam.h+l.world.w*l.world.h)/(l.w*l.h)).toFixed(0)}% of the screen`);
 const a=await shot(page,'world-view');await sleep(700);const b=await shot(page,'world-view');check(!a.equals(b),`${name}: the avatar moves`);
 check(l.mirror.every(t=>t.startsWith('matrix(-1')),`${name}: front camera mirrors both views (${l.mirror})`);
 check(!errors.length,`${name}: no console errors ${errors.join(' | ')}`);await context.close();
}

// Mirror flips only the display: a saved record has the same left/right as an unmirrored one.
async function saveOne(query){
 const {page,errors,context}=await open(query,{width:844,height:390});await sleep(1500);
 await page.click('#save');const nag=await page.textContent('#save');
 await page.fill('#match','64');await page.click('#save');await sleep(1200);const counting=await page.textContent('#save');
 await sleep(15000);const saved=await page.textContent('#save');
 const download=page.waitForEvent('download');await page.click('#export');const file=await(await download).path();
 const data=JSON.parse(fs.readFileSync(file,'utf8')),record=data.records.at(-1),l=await layout(page);
 await context.close();return{nag,counting,saved,record,mirror:l.mirror,errors,exportText:l.text};
}
const front=await saveOne('?demo=1'),rear=await saveOne('?demo=1&camera=rear');
check(front.nag==='Enter Match % first',`save needs Match % first ("${front.nag}")`);
check(/^Walk back · (9|10)$/.test(front.counting),`save counts down first ("${front.counting}")`);
check(/^Saved #\d+ · body angle 4\d°$/.test(front.saved),`save confirms ("${front.saved}")`);
check(rear.mirror.every(t=>t==='none'),`rear camera is not mirrored (${rear.mirror})`);
const leftRight=r=>{const f=r.hold.frames.find(f=>f.image.length);return f.image[11][0]-f.image[12][0]};
check(leftRight(front.record)>0&&leftRight(rear.record)>0&&Math.abs(front.record.bodyAngleDeg-rear.record.bodyAngleDeg)<3,`mirroring does not flip the data (left−right shoulder x ${leftRight(front.record).toFixed(3)} / ${leftRight(rear.record).toFixed(3)}, body angle ${front.record.bodyAngleDeg}° / ${rear.record.bodyAngleDeg}°)`);
check(front.record.matchPct===64&&front.record.hold.frames.length>=80&&front.record.posePct===100,`record holds Match %, 5 s of landmarks (${front.record.hold.frames.length} frames) and measurements`);
fs.writeFileSync(`${out}/demo-record.json`,JSON.stringify({...front.record,hold:{...front.record.hold,frames:front.record.hold.frames.slice(0,2)}},null,1));
check(!front.errors.length&&!rear.errors.length,`save and export: no console errors ${[...front.errors,...rear.errors].join(' | ')}`);

// Camera path with Chromium's fake camera: starts on load, loads the model, runs the tracker.
{const {page,errors,context}=await open('',{width:844,height:390});let status='';
 for(let i=0;i<120&&!/fps/.test(status);i++){await sleep(500);status=await page.textContent('#status')}
 await sleep(3000);status=await page.textContent('#status');
 const video=await page.evaluate(()=>{const v=document.querySelector('video');return{w:v.videoWidth,h:v.videoHeight,playing:!v.paused}});
 await page.screenshot({path:`${out}/fake-camera.png`});
 check(/^full · (GPU|CPU) · \d+ fps/.test(status)&&video.w>0&&video.playing,`fake camera: starts on load, model loads and tracking runs ("${status}", ${video.w}x${video.h})`);
 check(await page.isHidden('#start'),'fake camera: no Start camera overlay needed');
 check(!errors.length,`fake camera: no console errors ${errors.join(' | ')}`);await context.close();}

await browser.close();server.kill();
console.log(failures.length?`\n${failures.length} check(s) failed`:'\nAll checks passed');process.exit(failures.length?1:0);
