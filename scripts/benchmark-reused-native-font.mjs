// Unit29. Repeat Fluent rendering from ONE factory to measure repeated font
// snapshot overhead. The 10MiB font padding stresses copies, not glyph shaping.
// node scripts/benchmark-reused-native-font.mjs regular.ttf bold.ttf [runs=3] [padMiB=10]
import {readFileSync,writeFileSync,mkdtempSync,rmSync} from 'node:fs';
import {createRequire} from 'node:module';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {execFileSync} from 'node:child_process';
import {performance} from 'node:perf_hooks';
const require=createRequire(import.meta.url);
const {createVufra}=require('../packages/vufra/dist/index.js');
const [regular,bold,rawCount='3',rawPad='10']=process.argv.slice(2);
if(!regular||!bold)throw Error('usage: benchmark-reused-native-font.mjs regular.ttf bold.ttf [runs]');
async function measure(){
 const source=readFileSync(regular);
 if(source.length>10*1024*1024)throw Error('regular font must be <=10MiB');
 const pad=Number(rawPad);
 if(!Number.isInteger(pad)||pad<0||pad>12)throw Error('padMiB must be 0..12');
 const payloadSize=pad===0?source.length:pad*1024*1024;
 if(source.length>payloadSize)throw Error('source font exceeds requested padding');
 const f=Buffer.alloc(payloadSize);
 source.copy(f);
 const face=readFileSync(bold);
 const t0=performance.now();
 const vufra=createVufra({font:f,fonts:{bold:face}});
 const preparedMs=performance.now()-t0;
 const t1=performance.now();
 const dir=mkdtempSync(join(tmpdir(),'vufra-repeat-'));
 let bytes=0,pages=0;
 try{
  for(let round=0;round<9;round++){
   const doc=vufra.document({title:'Font reuse '+round,page:'Letter'})
    .heading('STATEMENT '+round)
    .paragraph('OWNED_FONT_'+round);
   const pdf=await doc.render();
   const path=join(dir,'pdf-'+round+'.pdf');
   writeFileSync(path,pdf);
   const txt=execFileSync('pdftotext',['-raw',path,'-'],{encoding:'utf8'});
   if(!txt.includes('OWNED_FONT_'+round))throw Error('token missing in round '+round);
   const info=execFileSync('pdfinfo',[path],{encoding:'utf8'});
   pages+=Number(info.match(/Pages:\s+(\d+)/)[1]);
   bytes+=pdf.length;
  }
 }finally{rmSync(dir,{recursive:true,force:true})}
 const wallMs=performance.now()-t1;
 return {rounds:9,sourceFontBytes:source.length,syntheticFontBytes:f.length,
  totalPdfBytes:bytes,totalPages:pages,
  prepareMs:Number(preparedMs.toFixed(2)),
  renderAndVerifyMs:Number(wallMs.toFixed(2)),
  maxRSSMiB:Number((process.resourceUsage().maxRSS/1024).toFixed(2))
 }
}
if(process.env.VUFRA_REUSE_CHILD==='1')console.log(JSON.stringify(await measure()));
else{
 const count=Number(rawCount);
 if(!Number.isInteger(count)||count<3||count>12)throw Error('runs 3..12');
 const samples=[];
 for(let i=0;i<count;i++){
  const out=execFileSync(process.execPath,[new URL(import.meta.url).pathname,regular,bold,'3',rawPad],
   {env:{...process.env,VUFRA_REUSE_CHILD:'1'},encoding:'utf8'});
  samples.push(JSON.parse(out));
 }
 const med=v=>[...v].sort((a,b)=>a-b)[Math.floor(v.length/2)];
 console.log(JSON.stringify({runs:count,maxRSSMiBMedian:med(samples.map(s=>s.maxRSSMiB)),
  renderAndVerifyMsMedian:med(samples.map(s=>s.renderAndVerifyMs)),samples},null,2));
}
