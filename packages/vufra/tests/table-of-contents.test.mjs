import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFileSync,writeFileSync,mkdtempSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
const req=createRequire(import.meta.url);
const {createVufra}=req('../dist/index.js');
const {renderPdf}=req('../dist/renderer.js');
const font=readFileSync(execFileSync('fc-match',['Noto Sans','-f','%{file}\n'],{encoding:'utf8'}).trim());
const app=createVufra({font});
const cols=[{title:'IDENTIFIER',width:'52%'},{title:'AMOUNT',width:'48%'}];
const rows=(prefix,n)=>Array.from({length:n},(_,i)=>[prefix+'_'+String(i+1).padStart(3,'0'),'$'+i]);
function inspect(bytes){
 const file=join(mkdtempSync(join(tmpdir(),'vufra-toc-')),'report.pdf');writeFileSync(file,bytes);
 const n=Number(execFileSync('pdfinfo',[file],{encoding:'utf8'}).match(/Pages:\s+(\d+)/)[1]);
 const pages=Array.from({length:n},(_,i)=>execFileSync('pdftotext',['-layout','-f',String(i+1),'-l',String(i+1),file,'-'],{encoding:'utf8'}));
 return {pages,file,pageOf(label){const found=pages.findIndex(x=>x.includes(label));assert.ok(found>=0,label);return found+1;}};
}
function navigationXml(pdfFile,from=1,to=1){
 const prefix=join(mkdtempSync(join(tmpdir(),'vufra-nav-')),'navigation');
 execFileSync('pdftohtml',['-xml','-hidden','-i',
  '-f',String(from),'-l',String(to),pdfFile,prefix],{encoding:'utf8'});
 return readFileSync(prefix+'.xml','utf8');
}
test('native TOC and cross-reference pages equal actual pagination of chapters, including content after a TOC',async()=>{
 const doc=app.document({page:'Letter',title:'Indexed report'})
 .coverPage({padding:25,minHeight:180},b=>b.heading('COVER_UNIQUE'))
 .tableOfContents('REPORT_INDEX')
 .pageReference('Finanzas','Go to finance')
 .pageSection({title:'Ventas',header:h=>h.text('SALES_MASTER')},b=>b
   .heading('SALES_TARGET').table(rows('SALE',95),{columns:cols}))
 .pageSection({title:'Finanzas',header:h=>h.text('FINANCE_MASTER')},b=>b
   .heading('FIN_TARGET').table(rows('FIN',135),{columns:cols}))
 .pageSection({title:'Operaciones',header:h=>h.text('OPS_MASTER')},b=>b
   .heading('OPS_TARGET').table(rows('OPS',84),{columns:cols}));
 const tree=doc.toDocument();
 assert.equal(tree.pageMasters.length,3);
 assert.ok(tree.blocks.filter(b=>b.type==='page-reference').length===4);
 const out=inspect(doc.renderSync());
 assert.ok(out.pages.length>=9);
 const toc=out.pages[1];
 const mapping=[['Ventas','SALES_TARGET'],['Finanzas','FIN_TARGET'],['Operaciones','OPS_TARGET']];
 for(const [name,target] of mapping){
   const actual=out.pageOf(target);
   assert.match(toc,new RegExp(name+'\\s+'+actual+'(?:\\s|$)'));
 }
 assert.match(toc,new RegExp('Go to finance\\s+'+out.pageOf('FIN_TARGET')+'(?:\\s|$)'));
 assert.equal(out.pageOf('COVER_UNIQUE'),1);
 // Poppler inspects actual /Annot /Link destinations and /Outlines —
 // merely seeing a page number printed in the PDF is not sufficient.
 const navigation=navigationXml(out.file,2,2);
 const href=(label,page)=>new RegExp(`<a href="[^"]*#${page}">${label}<\\/a>`);
 for(const [name,target] of mapping){
   const actual=out.pageOf(target);
   assert.match(navigation,href(name,actual));
   assert.match(navigation,new RegExp(`<item page="${actual}">${name}<\\/item>`));
 }
 assert.match(navigation,href('Go to finance',out.pageOf('FIN_TARGET')));
 assert.equal((navigation.match(/<item page=/g)??[]).length,3);
 const text=out.pages.join('');
 for(const [prefix,n] of [['SALE',95],['FIN',135],['OPS',84]])
  assert.deepEqual([...text.matchAll(new RegExp(prefix+'_(\\d{3})','g'))].map(m=>+m[1]),
    Array.from({length:n},(_,i)=>i+1));
 const asyncOut=inspect(await doc.render());
 assert.deepEqual(asyncOut.pages,out.pages);
});
test('TOC page numbers change when earlier sections grow, with no stale second pass',()=>{
 const make=n=>app.document({page:'Letter'})
  .tableOfContents('INDEX')
  .pageSection({title:'First'},b=>b.heading('FIRST_BODY').table(rows('FIRST',n),{columns:cols}))
  .pageSection({title:'Second'},b=>b.heading('SECOND_BODY').table(rows('SECOND',75),{columns:cols}));
 const small=inspect(make(20).renderSync()),large=inspect(make(150).renderSync());
 assert.ok(large.pageOf('SECOND_BODY')>small.pageOf('SECOND_BODY'));
 for(const result of [small,large])
  assert.match(result.pages[0],new RegExp('Second\\s+'+result.pageOf('SECOND_BODY')+'(?:\\s|$)'));
 for(const result of [small,large]){
  const xml=navigationXml(result.file);
  const page=result.pageOf('SECOND_BODY');
  assert.match(xml,new RegExp(`<a href="[^"]*#${page}">Second<\\/a>`));
  assert.match(xml,new RegExp(`<item page="${page}">Second<\\/item>`));
 }
});
test('TOC rejects missing/ambiguous named sections, oversized labels and corrupted target indices',()=>{
 assert.throws(()=>app.document().tableOfContents('Contents').heading('ONLY').toDocument(),/requires named/);
 assert.throws(()=>app.document().pageReference('Nonexistent').pageSection({title:'Another'},b=>b.paragraph('A')).renderSync(),/exactly one/);
 assert.throws(()=>app.document().tableOfContents().tableOfContents(),/only one/);
 assert.throws(()=>app.document().pageSection({title:' '.repeat(5)},b=>b.paragraph('A')),/title/);
 assert.throws(()=>app.document().pageReference('Bad','X'.repeat(65)),/64/);
 assert.throws(()=>app.document().tableOfContents().pageSection({title:'Same'},b=>b.paragraph('A'))
  .pageSection({title:'Same'},b=>b.paragraph('B')).pageReference('Same').toDocument(),/exactly one/);
 const snapshot=app.document({page:'Letter'}).tableOfContents().pageSection({title:'Safe'},b=>b.paragraph('GOOD')).toDocument();
 snapshot.blocks[1].targetBlock=999;
 assert.throws(()=>renderPdf(snapshot,font),/target block/);
});


test('PDF chapter title validations also cover manipulated snapshots and unnavigable unnamed chapters',()=>{
 const named=app.document({page:'Letter'}).pageSection({title:'Legal'},b=>b.paragraph('DOCUMENT'));
 const invalid=named.toDocument();
 invalid.pageMasters[0].title='Invalid\nOutline';
 assert.throws(()=>renderPdf(invalid,font),/page master title/);
 const untitled=app.document({page:'Letter'}).pageSection({header:h=>h.text('NO_TITLES')},b=>b.paragraph('ONLY'));
 const pdf=inspect(untitled.renderSync());
 const xml=navigationXml(pdf.file);
 assert.doesNotMatch(xml,/<outline>/);
 assert.doesNotMatch(xml,/<a href=/);
});
