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
function readPages(bytes){
 const file=join(mkdtempSync(join(tmpdir(),'vufra-masters-')),'masters.pdf');
 writeFileSync(file,bytes);
 const pages=Number(execFileSync('pdfinfo',[file],{encoding:'utf8'}).match(/Pages:\s+(\d+)/)[1]);
 return Array.from({length:pages},(_,i)=>execFileSync('pdftotext',['-raw',
  '-f',String(i+1),'-l',String(i+1),file,'-'],{encoding:'utf8'}));
}
const cols=[{title:'REFERENCE',width:'54%'},{title:'AMOUNT',width:'46%'}];
function rows(label,n){return Array.from({length:n},(_,i)=>[label+'_'+String(i+1).padStart(3,'0'),'$'+i]);}
test('independent section masters persist through multi-page tables and change only at section boundaries',()=>{
 const doc=app.document({page:'Letter',title:'Section report'})
  .header(h=>h.text('BASE_HEADER'))
  .footer(f=>f.text('BASE_FOOTER'))
  .pageSection({header:h=>h.text('SALES_MASTER'),footer:f=>f.text('SALES_FOOTER_{{page}}')},b=>b
    .heading('SALES_TITLE').table(rows('SALE',115),{columns:cols}))
  .pageSection({header:h=>h.text('OPERATIONS_MASTER'),footer:f=>f.text('OPERATIONS_FOOTER_{{page}}')},b=>b
    .heading('OPERATIONS_TITLE').table(rows('OPER',130),{columns:cols}))
  .pageSection({header:h=>h.text('FINANCE_MASTER'),footer:f=>f.text('FINANCE_FOOTER_{{page}}')},b=>b
    .heading('FINANCE_TITLE').table(rows('FIN',87),{columns:cols}));
 const snap=doc.toDocument();
 assert.deepEqual(snap.pageMasters.map(m=>m.startBlock),[0,3,6]);
 assert.equal(snap.blocks[2].type,'page-break');
 assert.equal(snap.blocks[5].type,'page-break');
 const pages=readPages(doc.renderSync());
 assert.ok(pages.length>=8);
 const pageIndex=word=>pages.findIndex(text=>text.includes(word));
 const p1=pageIndex('SALES_TITLE'),p2=pageIndex('OPERATIONS_TITLE'),p3=pageIndex('FINANCE_TITLE');
 assert.equal(p1,0);
 assert.ok(p2>p1+1 && p3>p2+1);
 for(let i=0;i<pages.length;i++){
  const group=i<p2?'SALES':i<p3?'OPERATIONS':'FINANCE';
  const text=pages[i];
  assert.match(text,new RegExp(group+'_MASTER'));
  assert.match(text,new RegExp((group==='SALES'?'SALES':group==='OPERATIONS'?'OPERATIONS':'FINANCE')+'_FOOTER_'+(i+1)));
  assert.doesNotMatch(text,/BASE_HEADER|BASE_FOOTER/);
  for(const other of ['SALES','OPERATIONS','FINANCE'].filter(x=>x!==group))
   assert.ok(!text.includes(other+'_MASTER'));
 }
 const raw=pages.join('');
 for(const [label,count] of [['SALE',115],['OPER',130],['FIN',87]])
  assert.deepEqual([...raw.matchAll(new RegExp(label+'_(\\d{3})','g'))].map(m=>+m[1]),
   Array.from({length:count},(_,i)=>i+1));
});
test('sections inherit previously selected bands and support explicit suppression',()=>{
 const doc=app.document({page:'Letter',title:'Inheritance'})
  .pageSection({header:h=>h.text('ONE_HEADER'),footer:f=>f.text('BASE_FOOTER')},b=>b.paragraph('ONE_BODY'))
  .pageSection({footer:f=>f.text('SECOND_FOOTER')},b=>b.paragraph('SECOND_BODY'))
  .pageSection({header:null},b=>b.paragraph('THIRD_BODY'));
 const pages=readPages(doc.renderSync());
 assert.equal(pages.length,3);
 assert.match(pages[0],/ONE_HEADER/);
 assert.match(pages[1],/ONE_HEADER/);
 assert.match(pages[1],/SECOND_FOOTER/);
 assert.doesNotMatch(pages[2],/ONE_HEADER/);
 assert.match(pages[2],/SECOND_FOOTER/);
});
test('section masters reject invalid boundaries and invalid band declarations',()=>{
 assert.throws(()=>app.document().pageSection({header:123},b=>b.paragraph('A')),/callback or null/);
 assert.throws(()=>app.document().pageSection({firstHeader:h=>h.text('A')},b=>b.paragraph('A')),/only supports/);
 assert.throws(()=>app.document().pageSection({},b=>{}),/must have content/);
 const original=app.document({page:'Letter'})
  .pageSection({header:h=>h.text('A')},b=>b.paragraph('A'))
  .pageSection({header:h=>h.text('B')},b=>b.paragraph('B'));
 const snapshot=original.toDocument();
 snapshot.pageMasters[1].startBlock=0;
 assert.throws(()=>renderPdf(snapshot,font),/increasing page boundaries/);
 const snapshot2=original.toDocument();
 snapshot2.blocks[1]={type:'paragraph',text:'NO_BREAK'};
 assert.throws(()=>renderPdf(snapshot2,font),/increasing page boundaries/);
});

test('cover, page section and async render preserve first-page isolation and identical section pages',async()=>{
 const doc=app.document({page:'Letter',title:'Executive'})
  .header(h=>h.text('DEFAULT_BAND'))
  .coverPage({padding:{top:25,left:30,bottom:12,right:15},minHeight:220},b=>b
    .heading('COVER_ONLY'))
  .pageSection({header:h=>h.text('FIRST_CHAPTER'),footer:f=>f.text('CHAPTER_FOOT_{{page}}')},b=>b
    .heading('FIRST_CHAPTER_BODY').table(rows('CH1',83),{columns:cols}))
  .pageSection({header:h=>h.text('SECOND_CHAPTER')},b=>b
    .heading('SECOND_CHAPTER_BODY').table(rows('CH2',74),{columns:cols}));
 const sync=doc.renderSync();
 const asyncBytes=await doc.render();
 const direct=readPages(sync),queued=readPages(asyncBytes);
 assert.deepEqual(direct,queued);
 assert.match(direct[0],/COVER_ONLY/);
 assert.doesNotMatch(direct[0],/DEFAULT_BAND|FIRST_CHAPTER|SECOND_CHAPTER/);
 const second=direct.findIndex(text=>text.includes('SECOND_CHAPTER_BODY'));
 assert.ok(second>=3);
 for(let i=1;i<second;i++)assert.match(direct[i],/FIRST_CHAPTER/);
 for(let i=second;i<direct.length;i++)assert.match(direct[i],/SECOND_CHAPTER/);
 const labels=direct.join('');
 assert.equal((labels.match(/CH1_\d{3}/g)??[]).length,83);
 assert.equal((labels.match(/CH2_\d{3}/g)??[]).length,74);
});

test('section first pages remain physical odd/even parity and document-first overrides stay document-wide',()=>{
 const doc=app.document({page:'Letter',title:'Master parity'})
  .pageSection({header:h=>h.text('MASTER_ONE'),oddFooter:f=>f.text('ODD_PAGE_{{page}}'),
    evenFooter:f=>f.text('EVEN_PAGE_{{page}}')},b=>b
    .heading('ALPHA_CHAPTER').table(rows('ALPHA',75),{columns:cols}))
  .pageSection({header:h=>h.text('MASTER_TWO')},b=>b
    .heading('BETA_CHAPTER').table(rows('BETA',66),{columns:cols}));
 const pages=readPages(doc.renderSync());
 assert.ok(pages.length>=4);
 for(let i=0;i<pages.length;i++){
  const p=i+1;
  assert.match(pages[i],new RegExp((p%2?'ODD':'EVEN')+'_PAGE_'+p));
 }
});
