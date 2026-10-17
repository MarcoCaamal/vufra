// Unit30 baseline: reuse a secondary large bold face and the same PNG image
// across 8 Fluent documents created by the same Vufra factory.
// node scripts/benchmark-reused-assets.mjs REGULAR.ttf BOLD.ttf [runs=3]
import {createRequire} from 'node:module';
import {readFileSync,writeFileSync,mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {execFileSync} from 'node:child_process';
import {performance} from 'node:perf_hooks';
import {createHash} from 'node:crypto';
const require=createRequire(import.meta.url);
const {createVufra}=require('../packages/vufra/dist/index.js');
const [regular,bold,countRaw='3',padRaw='10']=process.argv.slice(2);
if(!regular||!bold)throw Error('usage benchmark-reused-assets.mjs REGULAR.ttf BOLD.ttf [runs]');
async function run(){
 const source=readFileSync(bold);
 if(source.length>10*1048576)throw Error('bold font too large');
 const pad=Number(padRaw);
 if(!Number.isInteger(pad)||pad<0||pad>10)throw Error('padMiB 0..10');
 const fontSize=pad===0?source.length:pad*1048576;
 if(fontSize<source.length)throw Error('font exceeds requested padded bytes');
 const boldBytes=Buffer.alloc(fontSize);
 source.copy(boldBytes);
 const font=readFileSync(regular);
 const png=readFileSync(new URL('../packages/vufra/tests/fixtures/two-tone.png',import.meta.url));
 const started=performance.now();
 const app=createVufra({font,fonts:{bold:boldBytes}});
 const dir=mkdtempSync(join(tmpdir(),'vufra-shared-assets-'));
 let size=0,pages=0,images=0;
 const pdfDigest=createHash('sha256');
 try{
  for(let n=0;n<8;n++){
   const doc=app.document({title:'Reusable assets '+n,page:'Letter'})
    .heading('ASSET_DOC_'+n,{bold:true})
    .box({padding:10},b=>b
       .paragraph('ASSET_TEXT_'+n,{bold:true})
       .image(png,{width:120,height:60}));
   const out=await doc.render();
   const file=join(dir,'sample-'+n+'.pdf');
   writeFileSync(file,out);
   pdfDigest.update(out);
   const txt=execFileSync('pdftotext',['-raw',file,'-'],{encoding:'utf8'});
   if(!txt.includes('ASSET_DOC_'+n)||!txt.includes('ASSET_TEXT_'+n))
     throw Error('missing text or invalid bold face '+n);
   const info=execFileSync('pdfinfo',[file],{encoding:'utf8'});
   const imageRows=execFileSync('pdfimages',['-list',file],{encoding:'utf8'});
   images+=imageRows.split('\n').filter(s=>s.includes(' image ')).length;
   pages+=Number(info.match(/Pages:\s+(\d+)/)[1]);
   size+=out.length;
  }
 }finally{rmSync(dir,{recursive:true,force:true})}
 if(images!==8||pages!==8)throw Error('unexpected asset counts '+images+' images and '+pages+' pages');
 return {docs:8,pages,images,pdfBytes:size,pdfSha256:pdfDigest.digest('hex'),
  actualBoldBytes:source.length,paddedBoldBytes:boldBytes.length,
  elapsedMs:Number((performance.now()-started).toFixed(2)),
  maxRSSMiB:Number((process.resourceUsage().maxRSS/1024).toFixed(2))};
}
if(process.env.VUFRA_ASSET_CHILD==='1')console.log(JSON.stringify(await run()));
else{
 const n=Number(countRaw);if(!Number.isInteger(n)||n<3||n>12)throw Error('runs 3..12');
 const samples=[];
 for(let i=0;i<n;i++){
  const out=execFileSync(process.execPath,[new URL(import.meta.url).pathname,regular,bold,'3',padRaw],
   {env:{...process.env,VUFRA_ASSET_CHILD:'1'},encoding:'utf8'});
  samples.push(JSON.parse(out));
 }
 const med=a=>[...a].sort((a,b)=>a-b)[Math.floor(a.length/2)];
 console.log(JSON.stringify({runs:n,maxRSSMiBMedian:med(samples.map(s=>s.maxRSSMiB)),
  elapsedMsMedian:med(samples.map(s=>s.elapsedMs)),samples},null,2));
}
