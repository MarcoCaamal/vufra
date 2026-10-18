import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {execFileSync} from 'node:child_process';
import {readFileSync,writeFileSync,mkdtempSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
const require=createRequire(import.meta.url);
const {createVufra}=require('../dist/index.js');
const {renderPdf}=require('../dist/renderer.js');
const font=readFileSync(execFileSync('fc-match',['Noto Sans','-f','%{file}\n'],{encoding:'utf8'}).trim());
const app=createVufra({font});
function pages(bytes){
 const file=join(mkdtempSync(join(tmpdir(),'vufra-max-height-')),'report.pdf');
 writeFileSync(file,bytes);
 return {
  pageCount:Number(execFileSync('pdfinfo',[file],{encoding:'utf8'}).match(/Pages:\s+(\d+)/)[1]),
  text:execFileSync('pdftotext',['-raw',file,'-'],{encoding:'utf8'})
 };
}
test('native maxHeight accepts content within intrinsic cap without changing printable text',()=>{
 const doc=app.document({page:'Letter'})
  .box({padding:{top:12,bottom:10,left:15,right:8},minHeight:125,maxHeight:180,
     background:'#F0F5FA'},b=>b.paragraph('MAXHEIGHT_PASS'))
  .paragraph('AFTER_MAXHEIGHT');
 const result=pages(doc.renderSync());
 assert.equal(result.pageCount,1);
 assert.equal((result.text.match(/MAXHEIGHT_PASS/g)??[]).length,1);
 assert.equal((result.text.match(/AFTER_MAXHEIGHT/g)??[]).length,1);
});
test('native maxHeight rejects measured overflow before producing a clipped PDF',()=>{
 const invalid=app.document({page:'Letter'})
  .box({padding:12,maxHeight:100},b=>{
    b.heading('LARGE_BOX_CONTENT');
    for(let i=0;i<17;i++)b.paragraph('LINE_'+String(i).padStart(2,'0'));
  });
 assert.throws(()=>invalid.renderSync(),/maxHeight.*clipping is unsupported/);
 const nested=app.document({page:'Letter'})
  .box({padding:10,maxHeight:90},outer=>outer
    .box({padding:8,minHeight:140},inner=>inner.paragraph('INNER_BIG')));
 assert.throws(()=>nested.renderSync(),/maxHeight.*clipping is unsupported/);
});
test('maxHeight validates finite range and minHeight ordering at SDK and native layers',()=>{
 assert.throws(()=>app.document().box({maxHeight:-1},b=>b.paragraph('A')),/maxHeight/);
 assert.throws(()=>app.document().box({maxHeight:Infinity},b=>b.paragraph('A')),/maxHeight/);
 assert.throws(()=>app.document().box({minHeight:200,maxHeight:150},b=>b.paragraph('A')),/maxHeight/);
 const snapshot=app.document().box({maxHeight:200},b=>b.paragraph('A')).toDocument();
 snapshot.blocks[0].box.maxHeight=NaN;
 assert.throws(()=>renderPdf(snapshot,font),/box geometry/);
});
