import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFileSync,writeFileSync,mkdtempSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
const {createVufra,barChart}=createRequire(import.meta.url)('../dist/index.js');
const font=readFileSync(execFileSync('fc-match',['Noto Sans','-f','%{file}\n'],{encoding:'utf8'}).trim());
const app=createVufra({font,theme:{colors:{bar:'#14789F'}}});
function inspect(bytes){
  const file=join(mkdtempSync(join(tmpdir(),'vufra-chart-')),'bars.pdf');writeFileSync(file,bytes);
  const pages=Number(execFileSync('pdfinfo',[file],{encoding:'utf8'}).match(/Pages:\s+(\d+)/)[1]);
  const raw=execFileSync('pdftotext',['-raw',file,'-'],{encoding:'utf8'});
  return {file,pages,raw};
}
test('vector bar chart composes in fluent boxes and paginates long readable series',()=>{
  const items=Array.from({length:145},(_,i)=>({label:'BARITEM_'+String(i+1).padStart(3,'0'),value:i}));
  const builder=app.document({title:'Bar chart',page:'Letter'})
    .heading('FINANCIAL_SERIES')
    .box({padding:12},b=>b.add(barChart(items,{color:'bar',barHeight:12,gap:3})));
  const out=inspect(builder.renderSync());
  assert.ok(out.pages>=4);
  assert.deepEqual([...out.raw.matchAll(/BARITEM_(\d{3})/g)].map(m=>+m[1]),
    Array.from({length:145},(_,i)=>i+1));
  assert.match(out.raw,/FINANCIAL_SERIES/);
  const snap=builder.toDocument();
  const boxed=snap.blocks.find(b=>b.type==='box');
  assert.ok(boxed);
  assert.equal(boxed.box.items.filter(i=>i.type==='row').length,145);
  const ppm=execFileSync('pdftoppm',['-r','72','-f','1','-l','1','-singlefile',out.file],{maxBuffer:4*1024*1024});
  let hits=0;
  for(let k=0;k<ppm.length-3;k+=3)if(ppm[k]===20&&ppm[k+1]===120&&ppm[k+2]===159)hits++;
  assert.ok(hits>200,'native colored vector rectangles present');
});
test('barChart validates geometry, zero values, ranges and narrow layouts',()=>{
  assert.throws(()=>app.document().barChart([{label:'X',value:-1}]),/nonnegative/);
  assert.throws(()=>app.document().barChart([{label:'X',value:Infinity}]),/finite/);
  assert.throws(()=>app.document().barChart([{label:'X',value:2}],{maxValue:1}),/positive maximum/);
  assert.throws(()=>app.document().barChart([{label:'X',value:2}],{barHeight:50}),/height/);
  assert.throws(()=>app.document().barChart([{label:'X',value:0}],{maxValue:0}),/positive maximum/);
  assert.throws(()=>app.document({page:{width:300,height:500,margins:{left:36,right:36}}})
    .barChart([{label:'X',value:2}]),/available width/);
  assert.ok(inspect(app.document().barChart([{label:'ZERO',value:0},{label:'OTHER',value:8}]).renderSync()).raw.includes('ZERO'));
});
