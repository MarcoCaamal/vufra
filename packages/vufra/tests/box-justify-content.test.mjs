import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {execFileSync} from 'node:child_process';
import {readFileSync,writeFileSync,mkdtempSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
const req=createRequire(import.meta.url);
const {createVufra}=req('../dist/index.js');
const {renderPdf}=req('../dist/renderer.js');
const font=readFileSync(execFileSync('fc-match',['Noto Sans','-f','%{file}\n'],{encoding:'utf8'}).trim());
const app=createVufra({font});
function measure(doc){
 const file=join(mkdtempSync(join(tmpdir(),'vufra-box-justify-')),'layout.pdf');
 writeFileSync(file,doc.renderSync());
 const bbox=execFileSync('pdftotext',['-bbox',file,'-'],{encoding:'utf8'});
 const words=[...bbox.matchAll(/<word xMin="([\d.]+)" yMin="([\d.]+)" xMax="([\d.]+)" yMax="([\d.]+)">([^<]+)<\/word>/g)]
 .map(m=>({x:+m[1],y:+m[2],text:m[5]}));
 const word=t=>{const w=words.find(x=>x.text===t);assert.ok(w,t);return w;};
 const pages=Number(execFileSync('pdfinfo',[file],{encoding:'utf8'}).match(/Pages:\s+(\d+)/)[1]);
 return {word,pages,file};
}
test('box space-between allocates spare minHeight only between direct child blocks',()=>{
 const make=justifyContent=>app.document({page:'Letter'})
  .box({padding:{top:10,bottom:15,left:20,right:15},minHeight:260,justifyContent,
    border:{width:1,color:'#123456'}},b=>b
     .paragraph('TOP_ITEM')
     .paragraph('BOTTOM_ITEM'))
  .paragraph('AFTER_THE_BOX');
 const aligned=measure(make('space-between'));
 const base=measure(make('start'));
 assert.equal(aligned.pages,1);
 assert.ok(Math.abs(aligned.word('TOP_ITEM').y-base.word('TOP_ITEM').y)<1.5);
 assert.ok(aligned.word('BOTTOM_ITEM').y-base.word('BOTTOM_ITEM').y>120);
 assert.ok(Math.abs(aligned.word('AFTER_THE_BOX').y-base.word('AFTER_THE_BOX').y)<1.5);
});
test('box space-between never fragments a wrapped text line; nested layouts keep all content',()=>{
 const phrase='MULTILINE_START '+'word '.repeat(56)+'MULTILINE_END';
 const doc=app.document({page:'Letter'}).box({width:260,padding:12,minHeight:380,
     justifyContent:'space-between'},b=>b
       .paragraph(phrase)
       .box({padding:10,background:'#F1F5FF'},inner=>inner.paragraph('NESTED_END')))
   .paragraph('AFTER_ALL');
 const out=measure(doc);
 assert.equal(out.pages,1);
 assert.ok(out.word('NESTED_END').y>out.word('MULTILINE_START').y+140);
 assert.ok(out.word('AFTER_ALL').y>out.word('NESTED_END').y);
});
test('space-between rejects unsupported constraints and native corrupted snapshots',()=>{
 assert.throws(()=>app.document().box({justifyContent:'space-between'},b=>b
   .paragraph('ONE').paragraph('TWO')),/minHeight/);
 assert.throws(()=>app.document().box({minHeight:250,justifyContent:'space-between'},b=>b
   .paragraph('ONE')).renderSync(),/box geometry|item count/);
 assert.throws(()=>app.document().box({minHeight:250,justifyContent:'evenly'},b=>b
   .paragraph('ONE').paragraph('TWO')),/justifyContent/);
 const snapshot=app.document().box({minHeight:180},b=>b.paragraph('ONE')).toDocument();
 snapshot.blocks[0].box.justifyContent='space-between';
 assert.throws(()=>renderPdf(snapshot,font),/box geometry/);
});

test('space-between degrades to normal pagination for content taller than minHeight',()=>{
 const rows=Array.from({length:115},(_,i)=>[
  'JUSTROW_'+String(i+1).padStart(3,'0'),'SERVICE','$10'
 ]);
 const doc=app.document({page:'Letter'}).box({padding:12,minHeight:220,
  justifyContent:'space-between'},b=>b
  .paragraph('LARGE_REPORT_TITLE')
  .table(rows,{columns:[{title:'REFERENCE',width:'44%'},
    {title:'ACTIVITY',width:'34%'},{title:'AMOUNT',width:'22%'}]}));
 const out=measure(doc);
 assert.ok(out.pages>=3);
 const raw=execFileSync('pdftotext',['-raw',out.file,'-'],{encoding:'utf8'});
 assert.deepEqual([...raw.matchAll(/JUSTROW_(\d{3})/g)].map(m=>+m[1]),
   Array.from({length:115},(_,i)=>i+1));
});
