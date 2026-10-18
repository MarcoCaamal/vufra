import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFileSync,writeFileSync,mkdtempSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
const require=createRequire(import.meta.url);
const {createVufra}=require('../dist/index.js');
const {renderPdf}=require('../dist/renderer.js');
const font=readFileSync(execFileSync('fc-match',['Noto Sans','-f','%{file}\n'],{encoding:'utf8'}).trim());
const app=createVufra({font});
function inspect(doc){
 const file=join(mkdtempSync(join(tmpdir(),'vufra40-pad-')),'layout.pdf');
 writeFileSync(file,doc.renderSync());
 const bbox=execFileSync('pdftotext',['-bbox',file,'-'],{encoding:'utf8'});
 const words=[...bbox.matchAll(/<word xMin="([\d.]+)" yMin="([\d.]+)" xMax="([\d.]+)" yMax="([\d.]+)">([^<]+)<\/word>/g)]
 .map(m=>({x:+m[1],y:+m[2],text:m[5]}));
 const word=t=>{const w=words.find(w=>w.text===t);assert.ok(w,'missing '+t);return w;};
 const pages=Number(execFileSync('pdfinfo',[file],{encoding:'utf8'}).match(/Pages:\s+(\d+)/)[1]);
 return {file,words,word,pages};
}
test('box separate top/bottom/left/right change native X/Y and reserved height independently',()=>{
 const base=inspect(app.document({page:'Letter'})
  .box({padding:0},b=>b.paragraph('INSIDE_REGION'))
  .paragraph('AFTER_REGION'));
 const custom=app.document({page:'Letter'})
  .box({padding:{top:23,bottom:17,left:31,right:5}},b=>b.paragraph('INSIDE_REGION'))
  .paragraph('AFTER_REGION');
 const out=inspect(custom);
 assert.equal(out.pages,1);
 assert.ok(Math.abs((out.word('INSIDE_REGION').x-base.word('INSIDE_REGION').x)-31)<2);
 assert.ok(Math.abs((out.word('INSIDE_REGION').y-base.word('INSIDE_REGION').y)-23)<2);
 assert.ok(Math.abs((out.word('AFTER_REGION').y-base.word('AFTER_REGION').y)-40)<2);
 assert.deepEqual(custom.toDocument().blocks[0].box.padding,
  {top:23,bottom:17,left:31,right:5});
});
test('nested boxes and minHeight share one page-aware measurement with asymmetric padding',()=>{
 const doc=app.document({page:'Letter'})
  .box({padding:{top:18,bottom:13,left:24,right:9},background:'#EEF5FE'},b=>b
    .paragraph('OUTER_CONTENT')
    .box({padding:{top:16,bottom:8,left:22,right:6},minHeight:125,
      border:{width:1,color:'#255588'}},n=>n.paragraph('INNER_CONTENT')))
  .paragraph('AFTER_NESTED');
 const out=inspect(doc);
 assert.equal(out.pages,1);
 assert.ok(out.word('INNER_CONTENT').x-out.word('OUTER_CONTENT').x>18);
 assert.ok(out.word('INNER_CONTENT').y-out.word('OUTER_CONTENT').y>22);
 assert.ok(out.word('AFTER_NESTED').y-out.word('INNER_CONTENT').y>90);
});
test('box side padding rejects oversized, invalid and low-level corrupted geometry',()=>{
 assert.throws(()=>app.document().box({padding:{top:-1}},b=>b.paragraph('X')),/padding/);
 assert.throws(()=>app.document().box({padding:{left:61}},b=>b.paragraph('X')),/padding/);
 assert.throws(()=>app.document().box({padding:{bad:5}},b=>b.paragraph('X')),/padding/);
 assert.throws(()=>app.document().box({width:100,padding:{left:39,right:39}},b=>b.paragraph('X')),/content width/);
 assert.throws(()=>app.document().box({padding:{top:0,bottom:0,left:0,right:0},radius:8},b=>b.paragraph('X')).renderSync(),/box geometry/);
 const altered=app.document({page:'Letter'}).box({padding:8},b=>b.paragraph('X')).toDocument();
 altered.blocks[0].box.padding={top:99,right:60,bottom:60,left:60};
 assert.throws(()=>renderPdf(altered,font),/box geometry/);
});

test('asymmetric box padding preserves repeated table headers and all IDs through page fragments',()=>{
 const many=Array.from({length:140},(_,i)=>['PADROW_'+String(i+1).padStart(3,'0'),'SERVICE','$10']);
 const doc=app.document({page:'Letter'})
  .box({padding:{top:20,bottom:11,left:24,right:7},background:'#F4F9FE',
    border:{width:1,color:'#225577'}},b=>b
    .paragraph('PADDED_REPORT')
    .table(many,{columns:[{title:'REFERENCE',width:'40%'},
      {title:'DESCRIPTION',width:'40%'},{title:'AMOUNT',width:'20%'}]}));
 const out=inspect(doc);
 assert.ok(out.pages>=4);
 const text=execFileSync('pdftotext',['-raw',out.file,'-'],{encoding:'utf8'});
 assert.deepEqual([...text.matchAll(/PADROW_(\d{3})/g)].map(m=>+m[1]),
  Array.from({length:140},(_,i)=>i+1));
 for(let pg=1;pg<=out.pages;pg++){
  const portion=execFileSync('pdftotext',['-raw','-f',String(pg),'-l',String(pg),out.file,'-'],{encoding:'utf8'});
  assert.equal((portion.match(/REFERENCE/g)??[]).length,1,'repeated table header '+pg);
 }
});
