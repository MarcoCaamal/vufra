// Experimental benchmark; no unverified baseline/speedup claims.
// node --expose-gc scripts/benchmark-fluent.mjs REGULAR.ttf BOLD.ttf [rows]
import {createRequire} from 'node:module';
import {readFileSync} from 'node:fs';
import {hrtime} from 'node:process';
const require=createRequire(import.meta.url);
const {createVufra}=require('../packages/vufra/dist/index.js');
const {renderPdf}=require('../packages/vufra/dist/renderer.js');
const [regular,bold,requested='350']=process.argv.slice(2);
if(!regular||!bold) throw new Error('usage: benchmark-fluent.mjs REGULAR.ttf BOLD.ttf [rows]');
const n=Number(requested);
if(!Number.isInteger(n)||n<20||n>1000)throw new Error('rows must be 20..1000');
const font=readFileSync(regular),fontBold=readFileSync(bold);
const api=createVufra({font,fonts:{bold:fontBold}});
const rows=Array.from({length:n},(_,i)=>[
  'LOAD_'+String(i+1).padStart(4,'0'),
  {runs:[{text:'Vufra bold ',bold:true},{text:'report item '+(i+1)}]},
  '$'+((i+1)*35).toFixed(2)
]);
const before=process.memoryUsage().heapUsed;
const t0=hrtime.bigint();
const doc=api.document({title:'Benchmark',page:'Letter'})
  .paragraph('Enterprise invoice with styled rows and real native font faces')
  .table(rows,{columns:[
    {title:'Folio',width:'23%'},{title:'Concept',width:'52%'},
    {title:'Amount',width:'25%'}
  ]});
const t1=hrtime.bigint();
const after=process.memoryUsage().heapUsed;
const ms=(a,b)=>Number(b-a)/1e6;
const samples=[],copies=[];
let bytes=0;
// Warm up both paths to reduce JIT/cold font impact. Comparing only the
// previously required full inspection snapshot vs direct immutable input.
doc.renderSync();
renderPdf(doc.toDocument(),font);
for(let i=0;i<5;i++){
  const start=hrtime.bigint();
  const result=doc.renderSync();
  samples.push(ms(start,hrtime.bigint()));
  bytes=result.byteLength;
  const snapshotStart=hrtime.bigint();
  const cloned=doc.toDocument();
  copies.push(ms(snapshotStart,hrtime.bigint()));
  if(cloned.blocks.length===0)throw new Error('invalid snapshot');
}
const median=values=>[...values].sort((a,b)=>a-b)[Math.floor(values.length/2)];
const results={
  rows:n,pdfBytes:bytes,
  builderMs:Number(ms(t0,t1).toFixed(2)),
  builderHeapDeltaBytes:after-before,
  renderSyncMsMedian:Number(median(samples).toFixed(2)),
  explicitSnapshotMsMedian:Number(median(copies).toFixed(2)),
  notes:'Five warm repetitions; explicit snapshot previously ran before every render. Memory delta is JS heap, NOT peak native RSS. No cross-commit baseline.'
};
console.log(JSON.stringify(results,null,2));
