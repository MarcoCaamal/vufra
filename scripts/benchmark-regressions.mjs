// Repeatable cross-commit PDF throughput/memory comparison; no external packages.
// node --expose-gc scripts/benchmark-regressions.mjs --font /path/font.ttf --runs 7 --out artifacts/perf.json
// node --expose-gc scripts/benchmark-regressions.mjs --font /path/font.ttf --compare artifacts/perf-before.json
// For stable results: same host, Node, native build mode, font, no concurrent load.
import {createRequire} from 'node:module';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {cpus,platform,arch,release,totalmem} from 'node:os';
import {spawnSync,execFileSync} from 'node:child_process';
import {performance} from 'node:perf_hooks';
const require=createRequire(import.meta.url);
const {createVufra}=require('../packages/vufra/dist/index.js');
const args=process.argv.slice(2);
function arg(name,defaultValue){const i=args.indexOf(name);return i<0?defaultValue:args[i+1];}
const fontFile=arg('--font',null);
const runs=Number(arg('--runs','7'));
const scenario=arg('--child',null);
const pathOut=arg('--out',null);
const comparison=arg('--compare',null);
const enforce=args.includes('--enforce');
const maxPercent=Number(arg('--max-regression','20'));
if(!fontFile||!Number.isInteger(runs)||runs<3||runs>30||
  !Number.isFinite(maxPercent)||maxPercent<0||maxPercent>100)
  throw Error('usage: --font REGULAR.ttf [--runs 3..30] [--out JSON] [--compare JSON] [--enforce --max-regression 20]');
const columns=[{title:'REFERENCE',width:'45%'},{title:'DESCRIPTION',width:'35%'},{title:'AMOUNT',width:'20%'}];
const rows=(prefix,n)=>Array.from({length:n},(_,i)=>[
  `${prefix}_${String(i+1).padStart(4,'0')}`,'Synthetic description '+(i%9),'$'+(i*13+20)
]);
function build(api,name){
 switch(name){
  case 'table-250':return api.document({page:'Letter',title:'Throughput table'})
     .heading('Synthetic ledger').table(rows('LINE',250),{columns});
  case 'nested-50':{
   let doc=api.document({page:'Letter',title:'Nested layout'});
   for(let i=0;i<50;i++)doc=doc.box({padding:{top:8,bottom:10,left:10,right:7},minHeight:95,
     background:'#EFF3F7'},b=>b
       .paragraph('CARD_'+String(i+1).padStart(3,'0'))
       .row({gap:10},r=>r.column({width:180},c=>c.paragraph('Description'))
         .column({width:180},c=>c.paragraph('Amount'))));
   return doc;
  }
  case 'mixed-150':return api.document({page:'A4',title:'Mixed-page throughput'})
     .tableOfContents('Index')
     .pageSection({title:'Letter',page:'Letter'},b=>b.table(rows('LETTER',75),{columns}))
     .pageSection({title:'Landscape',page:{width:920,height:520,
       margins:{top:122,bottom:62,left:92,right:30}}},b=>b.table(rows('LAND',75),{columns}));
  case 'flex-100':{
   let doc=api.document({page:'Letter',title:'Native row flex sample'});
   for(let i=0;i<100;i++)doc=doc.row({gap:12},r=>r
    .column({width:130,flexGrow:1,flexShrink:1},c=>c.paragraph('FLEXREF_'+i))
    .column({width:145,flexGrow:2,flexShrink:1},c=>c.paragraph('Description '+i))
    .column({width:90},c=>c.paragraph('$'+i)));
   return doc;
  }
  default:throw Error('Unknown benchmark scenario: '+name);
 }
}
const cases=['table-250','nested-50','mixed-150','flex-100'];
const round=v=>Number(v.toFixed(3));
const percentile=(values,percent)=>[...values].sort((a,b)=>a-b)[Math.ceil((percent/100)*values.length)-1];
const identity={platform:platform(),arch:arch(),release:release(),cpu:cpus()[0]?.model,
  cores:cpus().length,node:process.version,ramBytes:totalmem(),
  fontBytes:readFileSync(fontFile).length};
if(scenario){
 if(!cases.includes(scenario))throw Error('Unknown case');
 const api=createVufra({font:readFileSync(fontFile)});
 const doc=build(api,scenario);
 let bytes;
 for(let i=0;i<2;i++){
  bytes=doc.renderSync();
  if(bytes.length<1000||Buffer.from(bytes.subarray(0,5)).toString()!=='%PDF-')throw Error('Invalid benchmark PDF');
 }
 const samples=[];
 for(let i=0;i<runs;i++){
  global.gc?.();
  const started=performance.now();
  const pdf=doc.renderSync();
  samples.push(performance.now()-started);
  if(pdf.length!==bytes.length)throw Error('Non-deterministic PDF length');
 }
 const ru=process.resourceUsage();
 const peakRssMiB=platform()==='darwin'?ru.maxRSS/1048576:ru.maxRSS/1024;
 process.stdout.write(JSON.stringify({scenario,runs,
  medianMs:round(percentile(samples,50)),p95Ms:round(percentile(samples,95)),
  minMs:round(Math.min(...samples)),maxMs:round(Math.max(...samples)),
  samplesMs:samples.map(round),peakRssMiB:round(peakRssMiB),
  finalRssMiB:round(process.memoryUsage().rss/1048576),pdfBytes:bytes.length})+'\n');
}else{
 const results={schemaVersion:1,generatedAt:new Date().toISOString(),
  revision:execFileSync('git',['rev-parse','--short','HEAD'],{encoding:'utf8'}).trim(),
  identity,runs,caseOrder:cases,scenarios:{},
  methodology:'Fresh child per case; 2 warmups + N sequential sync renders, GC before each sample, peak RSS is process max (including fonts and warmup). No CI threshold by default.'};
 for(const name of cases){
  const cmd=spawnSync(process.execPath,['--expose-gc',process.argv[1],
    '--font',fontFile,'--runs',String(runs),'--child',name],{encoding:'utf8',maxBuffer:1024*1024});
  if(cmd.status!==0)throw Error(`Benchmark ${name} failed: ${cmd.stderr||cmd.stdout}`);
  results.scenarios[name]=JSON.parse(cmd.stdout);
 }
 if(comparison){
  const previous=JSON.parse(readFileSync(comparison,'utf8'));
  const sameMachine=JSON.stringify(previous.identity)===JSON.stringify(identity);
  const deltas={};
  for(const name of cases){
   if(!previous.scenarios[name]){deltas[name]={status:'new-scenario'};continue;}
   const now=results.scenarios[name],before=previous.scenarios[name];
   deltas[name]={medianPercent:round((now.medianMs/before.medianMs-1)*100),
     p95Percent:round((now.p95Ms/before.p95Ms-1)*100),
     peakRssPercent:round((now.peakRssMiB/before.peakRssMiB-1)*100),
     pdfBytesPercent:round((now.pdfBytes/before.pdfBytes-1)*100)};
  }
  results.comparison={baselineRevision:previous.revision,sameMachine,deltas};
  if(enforce&&(!sameMachine || Object.values(deltas).some(d=>d.medianPercent!==undefined&&d.medianPercent>maxPercent)))
   process.exitCode=2;
 }
 if(pathOut){const file=resolve(pathOut);mkdirSync(dirname(file),{recursive:true});writeFileSync(file,JSON.stringify(results,null,2)+'\n');}
 process.stdout.write(JSON.stringify(results,null,2)+'\n');
}
