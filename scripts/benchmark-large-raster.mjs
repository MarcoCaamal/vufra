// Unit31: large, deterministic RGB PNG reused between six independent PDFs.
// Three serial documents and three concurrent async documents. PNG is about
// 5MiB of incompressible pixels, generated locally without external modules.
// Usage: node scripts/benchmark-large-raster.mjs REGULAR.ttf [runs=3] [size=1280] [png|jpeg]
 // JPEG mode uses an installed ImageMagick "magick" binary only to create fixture bytes.
import {createRequire} from 'node:module';
import {readFileSync,writeFileSync,mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {deterministicPng} from './lib/deterministic-png.mjs';
import {performance} from 'node:perf_hooks';
const require=createRequire(import.meta.url);
const {createVufra}=require('../packages/vufra/dist/index.js');
const [fontFile,runArg='3',widthArg='1280',format='png']=process.argv.slice(2);
if(!fontFile)throw Error('usage benchmark-large-raster.mjs REGULAR.ttf [runs=3] [width=1280]');
async function runOne(){
 const w=Number(widthArg);
 if(!Number.isInteger(w)||w<500||w>1800)throw Error('width 500..1800');
 if(!['png','jpeg'].includes(format))throw Error('format must be png or jpeg');
 const png=deterministicPng(w);
 const picture=format==='jpeg'?execFileSync('magick',
   ['png:-','-quality','90','jpeg:-'],{input:png,maxBuffer:16*1024*1024}):png;
 if(picture.byteLength>8*1024*1024)throw Error('image exceeds 8 MiB limit');
 const app=createVufra({font:readFileSync(fontFile)});
 const docs=Array.from({length:6},(_,i)=>
  app.document({title:'Big raster '+i,page:'Letter'})
   .heading('LARGE_RASTER_'+String(i).padStart(2,'0'))
   .image(picture,{width:220,height:180,fit:i%2?'cover':'contain'})
 );
 const t0=performance.now();
 const serial=[];
 for(let i=0;i<3;i++)serial.push(await docs[i].render());
 const t1=performance.now();
 const concurrent=await Promise.all(docs.slice(3).map(d=>d.render()));
 const t2=performance.now();
 const dir=mkdtempSync(join(tmpdir(),'vufra-raster-'));
 let pages=0,images=0,totalBytes=0;
 const digest=createHash('sha256');
 try{
  for(const [i,pdf] of [...serial,...concurrent].entries()){
   digest.update(pdf);
   totalBytes+=pdf.length;
   const path=join(dir,'doc-'+i+'.pdf');
   writeFileSync(path,pdf);
   const info=execFileSync('pdfinfo',[path],{encoding:'utf8'});
   pages+=Number(info.match(/Pages:\s+(\d+)/)[1]);
   const text=execFileSync('pdftotext',['-raw',path,'-'],{encoding:'utf8'});
   if(!text.includes('LARGE_RASTER_'+String(i).padStart(2,'0')))
      throw Error('missing document token '+i);
   const list=execFileSync('pdfimages',['-list',path],{encoding:'utf8'});
   const entries=list.split('\n').filter(line=>line.includes(' image '));
   if(entries.length!==1||!entries[0].includes(String(w)))
      throw Error('incorrect pixel payload for document '+i);
   images+=entries.length;
  }
 }finally{rmSync(dir,{recursive:true,force:true})}
 return {docs:6,pages,images,imageBytes:picture.length,format,pdfBytes:totalBytes,
  pdfSha256:digest.digest('hex'),
  serialRenderMs:Number((t1-t0).toFixed(2)),
  parallelRenderMs:Number((t2-t1).toFixed(2)),
  maxRSSMiB:Number((process.resourceUsage().maxRSS/1024).toFixed(2))};
}
if(process.env.VUFRA_BIG_RASTER_CHILD==='1')console.log(JSON.stringify(await runOne()));
else{
 const count=Number(runArg);
 if(!Number.isInteger(count)||count<3||count>9)throw Error('runs 3..9');
 const samples=[];
 for(let i=0;i<count;i++){
  const out=execFileSync(process.execPath,[new URL(import.meta.url).pathname,
   fontFile,'3',widthArg,format],{
   env:{...process.env,VUFRA_BIG_RASTER_CHILD:'1'},
   encoding:'utf8',maxBuffer:1048576
  });
  samples.push(JSON.parse(out));
 }
 const med=key=>[...samples].sort((a,b)=>a[key]-b[key])[Math.floor(samples.length/2)][key];
 if(!samples.every(v=>v.pdfSha256===samples[0].pdfSha256))
  throw Error('nondeterministic PDF output');
 console.log(JSON.stringify({runs:count,width:Number(widthArg),format,
  maxRSSMiBMedian:med('maxRSSMiB'),
  serialRenderMsMedian:med('serialRenderMs'),
  parallelRenderMsMedian:med('parallelRenderMs'),samples},null,2));
}
