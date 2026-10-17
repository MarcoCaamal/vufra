// Cross-process benchmark for font loading and rich row fragmentation.
// node scripts/benchmark-font-rows.mjs REGULAR.ttf BOLD.ttf [runs=3]
import {createRequire} from 'node:module';
import {readFileSync,writeFileSync,mkdtempSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {performance} from 'node:perf_hooks';
const require=createRequire(import.meta.url);
const {createVufra}=require('../packages/vufra/dist/index.js');
const [regular,bold,countRaw='3']=process.argv.slice(2);
if(!regular||!bold)throw Error('usage benchmark-font-rows.mjs REGULAR.ttf BOLD.ttf [runs]');
const seq=(prefix,n)=>Array.from({length:n},(_,i)=>
  prefix+String(i+1).padStart(4,'0')).join(' ')+' ';
async function run(){
  const t0=performance.now();
  const app=createVufra({font:readFileSync(regular),fonts:{bold:readFileSync(bold)}});
  let doc=app.document({title:'Rich row font benchmark',page:'Letter'})
    .heading('Benchmark de tipografía enriquecida');
  for(let j=0;j<8;j++){
    const prefix=String(j+1).padStart(2,'0');
    doc=doc.row(r=>r
      .column({width:'55%'},c=>c.richText(t=>{
        t.add(seq('RB'+prefix+'_',125),{bold:true,color:'#B02244'});
        t.add(seq('RR'+prefix+'_',125));
      },{fontSize:10,lineHeight:17}))
      .column({width:'45%'},c=>c.paragraph(seq('RC'+prefix+'_',80)))
    );
  }
  const t1=performance.now();
  const pdf=await doc.render();
  const t2=performance.now();
  const filepath=join(mkdtempSync(join(tmpdir(),'vufra-font-row-')),'report.pdf');
  writeFileSync(filepath,pdf);
  const txt=execFileSync('pdftotext',['-raw',filepath,'-'],{encoding:'utf8'});
  const pages=Number(execFileSync('pdfinfo',[filepath],{encoding:'utf8'}).match(/Pages:\s+(\d+)/)[1]);
  for(let j=1;j<=8;j++){
    const id=String(j).padStart(2,'0');
    for(const [name,n] of [['RB'+id+'_',125],['RR'+id+'_',125],['RC'+id+'_',80]]){
      const actual=[...txt.matchAll(new RegExp(name+'(\\d{4})','g'))].map(m=>Number(m[1]));
      if(actual.length!==n||actual.some((v,i)=>v!==i+1))throw Error(name+' tokens missing/duplicated');
    }
  }
  const m=process.memoryUsage();
  return {rows:8,ids:2640,pages,pdfBytes:pdf.length,
    buildMs:Number((t1-t0).toFixed(2)),renderMs:Number((t2-t1).toFixed(2)),
    rssMiB:Number((m.rss/1048576).toFixed(2)),
    maxRSSMiB:Number((process.resourceUsage().maxRSS/1024).toFixed(2))};
}
if(process.env.VUFRA_BENCH_CHILD==='1'){
 console.log(JSON.stringify(await run()));
}else{
 const count=Number(countRaw);
 if(!Number.isInteger(count)||count<3||count>12)throw Error('runs 3..12');
 const samples=[];
 for(let i=0;i<count;i++){
  samples.push(JSON.parse(execFileSync(process.execPath,
    [new URL(import.meta.url).pathname,regular,bold,'3'],
    {env:{...process.env,VUFRA_BENCH_CHILD:'1'},encoding:'utf8'})));
 }
 const median=values=>[...values].sort((a,b)=>a-b)[Math.floor(values.length/2)];
 console.log(JSON.stringify({runs:count,
  workload:'8 long rich rows × (125 bold +125 regular +80 other-column tokens)',
  maxRSSMiBMedian:median(samples.map(s=>s.maxRSSMiB)),
  renderMsMedian:median(samples.map(s=>s.renderMs)),samples},null,2));
}
