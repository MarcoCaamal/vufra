// Unit27 repeatable benchmark: images in overflowing rich row fragments. No external npm dependencies.
// node scripts/benchmark-fragmented-images.mjs REGULAR.ttf BOLD.ttf [runs=3]
// Each child runs exactly once in a fresh process. Linux maxRSS is KiB,
// process memory can change due to allocator, shaping and page count.
import {createRequire} from 'node:module';
import {readFileSync,writeFileSync,mkdtempSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {execFileSync} from 'node:child_process';
import {deflateSync} from 'node:zlib';
import {performance} from 'node:perf_hooks';
const require=createRequire(import.meta.url);
const {createVufra}=require('../packages/vufra/dist/index.js');
const [regular,bold,arg='3']=process.argv.slice(2);
if(!regular||!bold)throw new Error('usage: benchmark-fragmented-images.mjs regular.ttf bold.ttf [runs=3]');
function crc32(data){
  let crc=0xffffffff;
  for(const byte of data){
    crc^=byte;
    for(let i=0;i<8;i++)crc=(crc>>>1)^(0xedb88320&-(crc&1));
  }
  return (crc^0xffffffff)>>>0;
}
function chunk(name,payload){
  const type=Buffer.from(name,'ascii');
  const size=Buffer.alloc(4),check=Buffer.alloc(4);
  size.writeUInt32BE(payload.length);
  check.writeUInt32BE(crc32(Buffer.concat([type,payload])));
  return Buffer.concat([size,type,payload,check]);
}
function imageBytes(){
  const w=384,h=384;
  const scan=Buffer.alloc((1+w*3)*h);
  let x=0x728abcde;
  for(let y=0;y<h;y++)for(let j=1;j<=w*3;j++){
    x^=x<<13;x^=x>>>17;x^=x<<5;
    scan[y*(w*3+1)+j]=x&255;
  }
  const head=Buffer.alloc(13);
  head.writeUInt32BE(w,0);head.writeUInt32BE(h,4);
  head[8]=8;head[9]=2; // RGB 8bpp
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),
    chunk('IHDR',head),chunk('IDAT',deflateSync(scan)),chunk('IEND',Buffer.alloc(0))]);
}
async function renderOne(){
  const t0=performance.now();
  const regularBytes=readFileSync(regular),boldBytes=readFileSync(bold);
  const app=createVufra({font:regularBytes,fonts:{bold:boldBytes}});
  const picture=imageBytes();
  let doc=app.document({title:'Oversized rows with prepared PNG',page:'Letter'})
    .heading('Image-heavy fragmented rows benchmark');
  for(let i=0;i<10;i++){
    const prefix='PICROW_'+String(i+1).padStart(2,'0')+'_T';
    const text=Array.from({length:420},(_,j)=>
      prefix+String(j+1).padStart(3,'0')).join(' ');
    doc=doc.row(r=>r
      .column({width:'34%'},c=>c.image(picture,{width:125,height:95}))
      .column({width:'66%'},c=>c.paragraph(text))
    );
  }
  const t1=performance.now();
  const bytes=await doc.render();
  const t2=performance.now();
  const path=join(mkdtempSync(join(tmpdir(),'vufra-image-rows-')),'probe.pdf');
  writeFileSync(path,bytes);
  const pages=Number(execFileSync('pdfinfo',[path],{encoding:'utf8'}).match(/Pages:\s+(\d+)/)[1]);
  const text=execFileSync('pdftotext',['-raw',path,'-'],{encoding:'utf8'});
  for(let row=1;row<=10;row++){
    const prefix='PICROW_'+String(row).padStart(2,'0')+'_T';
    const ids=[...text.matchAll(new RegExp(prefix+'(\\d{3})','g'))]
      .map(m=>Number(m[1]));
    if(ids.length!==420||ids.some((v,i)=>v!==i+1))
      throw new Error('lost or duplicated picture row '+row);
  }
  if(pages<12)throw new Error('rows did not fragment across enough pages');
  const images=execFileSync('pdfimages',['-list',path],{encoding:'utf8'})
    .split(String.fromCharCode(10)).filter(line=>line.includes(' image ')).length;
  if(images!==10)throw new Error('expected 10 physical PNG images, got '+images);
  const mem=process.memoryUsage();
  return {
    imageInputBytes:picture.length*10,rows:10,images:10,
    pdfBytes:bytes.byteLength,pages,
    buildMs:Number((t1-t0).toFixed(2)),renderMs:Number((t2-t1).toFixed(2)),
    heapUsedMiB:Number((mem.heapUsed/1048576).toFixed(2)),
    rssMiB:Number((mem.rss/1048576).toFixed(2)),
    maxRSSMiB:Number((process.resourceUsage().maxRSS/1024).toFixed(2))
  };
}
if(process.env.VUFRA_BENCH_CHILD==='1'){
  console.log(JSON.stringify(await renderOne()));
}else{
  const count=Number(arg);
  if(!Number.isInteger(count)||count<3||count>12)throw new Error('runs 3..12');
  const samples=[];
  for(let i=0;i<count;i++){
    const out=execFileSync(process.execPath,[new URL(import.meta.url).pathname,
      regular,bold,'3'],{env:{...process.env,VUFRA_BENCH_CHILD:'1'},
      encoding:'utf8',maxBuffer:1048576});
    samples.push(JSON.parse(out));
  }
  const median=values=>[...values].sort((a,b)=>a-b)[Math.floor(values.length/2)];
  const summary={
    runs:count,workload:'10 oversized rows each with PNG and 420 identifiable tokens',
    maxRSSMiBMedian:median(samples.map(s=>s.maxRSSMiB)),
    renderMsMedian:median(samples.map(s=>s.renderMs)),
    buildMsMedian:median(samples.map(s=>s.buildMs)),
    samples
  };
  console.log(JSON.stringify(summary,null,2));
}
