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
 const file=join(mkdtempSync(join(tmpdir(),'vufra40-min-')),'minheight.pdf');
 writeFileSync(file,doc.renderSync());
 const bbox=execFileSync('pdftotext',['-bbox',file,'-'],{encoding:'utf8'});
 const words=[...bbox.matchAll(/<word xMin="([\d.]+)" yMin="([\d.]+)" xMax="([\d.]+)" yMax="([\d.]+)">([^<]+)<\/word>/g)]
 .map(m=>({x:+m[1],y:+m[2],text:m[5]}));
 const first=t=>{const w=words.find(w=>w.text===t);assert.ok(w,`missing ${t}`);return w;};
 const pages=Number(execFileSync('pdfinfo',[file],{encoding:'utf8'}).match(/Pages:\s+(\d+)/)[1]);
 return {pages,first,words,file};
}
test('box minHeight is measured natively, extending the paint region before following text',()=>{
 const compact=app.document({page:'Letter'})
  .box({padding:12,background:'#ECF5FE'},b=>b.paragraph('MINCARD'))
  .paragraph('AFTER_CARD');
 const taller=app.document({page:'Letter'})
  .box({padding:12,minHeight:195,background:'#ECF5FE'},b=>b.paragraph('MINCARD'))
  .paragraph('AFTER_CARD');
 const small=inspect(compact),big=inspect(taller);
 assert.equal(big.pages,1);
 assert.equal(taller.toDocument().blocks[0].box.minHeight,195);
 assert.ok(big.first('AFTER_CARD').y-small.first('AFTER_CARD').y>115);
 assert.ok(Math.abs(big.first('MINCARD').y-small.first('MINCARD').y)<1.5);
});
test('minHeight affects nested boxes and preserves page-break ordering',()=>{
 const builder=app.document({page:'Letter'})
  .box({padding:12,background:'#F0F7FC'},outer=>outer
    .paragraph('OUTER_TITLE')
    .box({padding:8,minHeight:175,border:{width:1,color:'#225577'}},inner=>inner
      .paragraph('INNER_TITLE')))
  .paragraph('AFTER_NESTED');
 const result=inspect(builder);
 assert.equal(result.pages,1);
 assert.ok(result.first('AFTER_NESTED').y-result.first('INNER_TITLE').y>130);
});
test('minHeight rejects invalid or impossible requests in SDK and native',()=>{
 assert.throws(()=>app.document().box({minHeight:-3},b=>b.paragraph('X')),/minHeight/);
 assert.throws(()=>app.document().box({minHeight:Infinity},b=>b.paragraph('X')),/minHeight/);
 assert.throws(()=>app.document({page:'Letter'}).box({minHeight:900},b=>b.paragraph('X')).renderSync(),/box geometry/);
 const d=app.document({page:'Letter'}).box({minHeight:120},b=>b.paragraph('X')).toDocument();
 d.blocks[0].box.minHeight=999999;
 assert.throws(()=>renderPdf(d,font),/box geometry/);
});
