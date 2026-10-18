import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFileSync,writeFileSync,mkdtempSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
const {createVufra}=createRequire(import.meta.url)('../dist/index.js');
const font=readFileSync(execFileSync('fc-match',['Noto Sans','-f','%{file}\n'],{encoding:'utf8'}).trim());
const app=createVufra({font});
function inspect(pdf){
 const path=join(mkdtempSync(join(tmpdir(),'vufra41-')),'cover.pdf');writeFileSync(path,pdf);
 const pages=Number(execFileSync('pdfinfo',[path],{encoding:'utf8'}).match(/Pages:\s+(\d+)/)[1]);
 const text=n=>execFileSync('pdftotext',['-raw','-f',String(n),'-l',String(n),path,'-'],{encoding:'utf8'});
 return {pages,text};
}
test('coverPage is one unique first page with running bands disabled and lazy page break',()=>{
 const result=app.document({title:'Cover test',page:'Letter'})
 .header(h=>h.text('RUNNING_HEAD'))
 .footer(f=>f.text('RUNNING_FOOT'))
 .coverPage({padding:25,radius:8,background:'#EAF3FE'},c=>c
   .heading('COVERPAGE_ONLY')
   .paragraph('SUBTITLE_SECTION'))
 .heading('MAIN_SECTION')
 .table(Array.from({length:135},(_,i)=>['REF_'+String(i+1).padStart(3,'0'),'$123']),{
   columns:[{title:'ITEM_REFERENCE',width:'55%'},{title:'AMOUNT',width:'45%'}]
 });
 const out=inspect(result.renderSync());
 assert.ok(out.pages>=4);
 assert.match(out.text(1),/COVERPAGE_ONLY/);
 assert.doesNotMatch(out.text(1),/MAIN_SECTION|RUNNING_HEAD|RUNNING_FOOT|REF_001/);
 assert.match(out.text(2),/MAIN_SECTION/);
 assert.match(out.text(2),/RUNNING_HEAD/);
 assert.match(out.text(2),/RUNNING_FOOT/);
 assert.match(out.text(2),/REF_001/);
 const all=Array.from({length:out.pages},(_,i)=>out.text(i+1)).join('');
 assert.deepEqual([...all.matchAll(/REF_(\d{3})/g)].map(m=>+m[1]),Array.from({length:135},(_,i)=>i+1));
});
test('cover alone does not append blank page, cover order is explicit',()=>{
 const only=inspect(app.document({title:'Only cover'})
  .coverPage({padding:18},c=>c.heading('SINGLE_COVER')).renderSync());
 assert.equal(only.pages,1);
 assert.match(only.text(1),/SINGLE_COVER/);
 assert.throws(()=>app.document().heading('BEFORE_COVER')
   .coverPage({padding:15},c=>c.paragraph('LATE')),/first document content/);
});
