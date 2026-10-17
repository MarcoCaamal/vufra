// Unit24 repeatable native memory probe. No external npm dependencies.
// node scripts/benchmark-native-memory.mjs REGULAR.ttf BOLD.ttf [runs=3]
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
if(!regular||!bold)throw new Error('usage: benchmark-native-memory.mjs regular.ttf bold.ttf [runs=3]');
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
  const lines=Array.from({length:450},(_,i)=>[
    'MEASURE_'+String(i+1).padStart(4,'0'),
    {runs:[{text:'Native ',bold:true},{text:'invoice item '+(i+1)}]},
    '$'+((i+1)*7).toFixed(2)
  ]);
  let doc=app.document({title:'Native memory profiling',page:'Letter'})
    .heading('Cross-language memory sample');
  doc=doc.table(lines,{columns:[
    {title:'Folio',width:'26%'},{title:'Concept',width:'49%'},
    {title:'Amount',width:'25%'}
  ]});
  for(let i=0;i<24;i++){
    doc=doc.box({padding:6},b=>b.image(picture,{width:70,height:70}));
  }
  const t1=performance.now();
  const bytes=await doc.render();
  const t2=performance.now();
  const path=join(mkdtempSync(join(tmpdir(),'vufra-mem-')),'probe.pdf');
  writeFileSync(path,bytes);
  const pages=Number(execFileSync('pdfinfo',[path],{encoding:'utf8'}).match(/Pages:\s+(\d+)/)[1]);
  const text=execFileSync('pdftotext',['-raw',path,'-'],{encoding:'utf8'});
  const records=[...text.matchAll(/MEASURE_(\d{4})/g)].map(m=>Number(m[1]));
  if(records.length!==450 || !records.every((v,i)=>v===i+1))
    throw new Error('lost/duplicated styled table references');
  if(pages<5)throw new Error('expected multiple pages');
  const mem=process.memoryUsage();
  return {
    imageInputBytes:picture.length*24,rows:450,images:24,
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
    runs:count,workload:'450 styled rows + 24 distinct native image blocks',
    maxRSSMiBMedian:median(samples.map(s=>s.maxRSSMiB)),
    renderMsMedian:median(samples.map(s=>s.renderMs)),
    buildMsMedian:median(samples.map(s=>s.buildMs)),
    samples
  };
  console.log(JSON.stringify(summary,null,2));
}
