import fs from 'node:fs';
import path from 'node:path';
// Small, dependency-free ZIP writer. The source bundle omits downloadable binary assets.
const crcTable=Array.from({length:256},(_,n)=>{for(let k=0;k<8;k++)n=n&1?0xedb88320^(n>>>1):n>>>1;return n>>>0});
const crc=b=>{let n=0xffffffff;for(const x of b)n=crcTable[(n^x)&255]^(n>>>8);return(n^0xffffffff)>>>0};
const roots=['src','tests','scripts','public/licenses','public/models/manifest.json','public/_headers','package.json','package-lock.json','tsconfig.json','vite.config.ts','index.html','README.md','LICENSE','THIRD_PARTY_NOTICES.md','.gitignore'];
const files=[];function collect(p){if(!fs.existsSync(p))return;if(fs.statSync(p).isDirectory()){for(const f of fs.readdirSync(p))collect(path.join(p,f))}else files.push(p)}roots.forEach(collect);
const body=[],central=[];let offset=0;
for(const name of files){const data=fs.readFileSync(name),nm=Buffer.from('boxxxing-motion-lab/'+name.replaceAll('\\','/')),c=crc(data),h=Buffer.alloc(30);h.writeUInt32LE(0x04034b50);h.writeUInt16LE(20,4);h.writeUInt32LE(c,14);h.writeUInt32LE(data.length,18);h.writeUInt32LE(data.length,22);h.writeUInt16LE(nm.length,26);body.push(h,nm,data);const d=Buffer.alloc(46);d.writeUInt32LE(0x02014b50);d.writeUInt16LE(20,4);d.writeUInt16LE(20,6);d.writeUInt32LE(c,16);d.writeUInt32LE(data.length,20);d.writeUInt32LE(data.length,24);d.writeUInt16LE(nm.length,28);d.writeUInt32LE(offset,42);central.push(d,nm);offset+=h.length+nm.length+data.length;}
const end=Buffer.alloc(22),cs=central.reduce((n,b)=>n+b.length,0);end.writeUInt32LE(0x06054b50);end.writeUInt16LE(files.length,8);end.writeUInt16LE(files.length,10);end.writeUInt32LE(cs,12);end.writeUInt32LE(offset,16);fs.mkdirSync('public',{recursive:true});fs.writeFileSync('public/source.zip',Buffer.concat([...body,...central,end]));fs.copyFileSync('README.md','public/README.md');console.log(`Source bundle: ${files.length} files`);
