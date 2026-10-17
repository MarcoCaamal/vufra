import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {execFileSync} from 'node:child_process';
import {readFileSync,writeFileSync,mkdtempSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
const require=createRequire(import.meta.url);
const {createVufra,renderPdf}=require('../dist/index.js');
const regular=readFileSync(execFileSync('fc-match',['Noto Sans','-f','%{file}\n'],{encoding:'utf8'}).trim());
const bold=readFileSync(execFileSync('fc-match',['Noto Sans:style=Bold','-f','%{file}\n'],{encoding:'utf8'}).trim());
const logo=readFileSync(new URL('./fixtures/two-tone.png',import.meta.url));
const app=createVufra({font:regular,fonts:{bold},theme:{colors:{soft:'#E8F2FC',ink:'#173D78'}}});
function inspect(pdfBytes){
 const dir=mkdtempSync(join(tmpdir(),'vufra-nested-')),pdf=join(dir,'test.pdf');
 writeFileSync(pdf,pdfBytes);
 const run=(cmd,args)=>execFileSync(cmd,args,{encoding:'utf8'});
 const raw=run('pdftotext',['-raw',pdf,'-']);
 const fonts=run('pdffonts',[pdf]);
 const pages=Number(run('pdfinfo',[pdf]).match(/Pages:\s+(\d+)/)[1]);
 const bbox=run('pdftotext',['-bbox',pdf,'-']);
 const words=[...bbox.matchAll(/<word xMin="([\d.]+)" yMin="([\d.]+)" xMax="([\d.]+)" yMax="([\d.]+)">([^<]+)<\/word>/g)]
   .map(m=>({x:+m[1],y:+m[2],right:+m[3],bottom:+m[4],text:m[5]}));
 return {pdf,raw,fonts,pages,words,byPage:n=>run('pdftotext',['-f',String(n),'-l',String(n),pdf,'-'])};
}
test('genuine embedded bold and mixed rich runs inside a padded decorated box',()=>{
 const out=inspect(app.document({title:'Nested typography'})
 .box({width:430,align:'center',padding:18,background:'soft',
   border:{width:1,color:'ink'}},b=>{
   b.heading('BOLD_IN_BOX',{bold:true,level:2,color:'ink'});
   b.richText(t=>{
     t.add('NORMAL_IN_BOX ');
     t.add('BOLD_IN_RUN ',{bold:true,color:'ink',fontSize:15});
     t.add('TRAILING_TEXT');
   },{fontSize:11,lineHeight:21,spaceBefore:3,spaceAfter:4});
 }).renderSync());
 assert.equal(out.pages,1);
 assert.match(out.fonts,/NotoSans-Bold/);
 for(const token of ['BOLD_IN_BOX','BOLD_IN_RUN','NORMAL_IN_BOX','TRAILING_TEXT']){
   assert.equal((out.raw.match(new RegExp(token,'g'))??[]).length,1);
   const w=out.words.find(w=>w.text===token);
   assert.ok(w && w.x>100 && w.right<540,JSON.stringify(w));
 }
});
test('box contains a native side-by-side row with real bold text and aligned columns',()=>{
 const out=inspect(app.document({title:'Box row',page:'Letter'})
 .box({padding:20,background:'soft'},b=>{
   b.row({gap:20},r=>{
     r.column({width:'45%'},c=>{
       c.image(logo,{width:80,height:40});
       c.heading('COMPANY_LEFT',{bold:true,level:3});
       c.paragraph('LEFT_VALUE');
     });
     r.column({width:'55%',align:'right'},c=>{
       c.paragraph('NUMBER_RIGHT',{bold:true});
       c.richText(t=>{t.add('RICH_');t.add('RIGHT',{bold:true});});
     });
   });
 }).renderSync());
 assert.match(out.fonts,/NotoSans-Bold/);
 const find=s=>out.words.find(w=>w.text===s);
 assert.ok(find('COMPANY_LEFT') && find('NUMBER_RIGHT'));
 assert.ok(find('COMPANY_LEFT').x<find('NUMBER_RIGHT').x);
 assert.ok(find('NUMBER_RIGHT').right<570);
 assert.match(out.raw,/LEFT_VALUE/);
 assert.match(execFileSync('pdfimages',['-list',out.pdf],{encoding:'utf8'}),/160\s+80/);
 assert.ok(find('COMPANY_LEFT').y>170,'boxed column text must follow image');
});
test('two-column grid inside narrow box measures inner width rather than whole page',()=>{
 const out=inspect(app.document({title:'Grid inside',page:'Letter'})
 .box({width:340,align:'center',padding:20},b=>{
   b.grid({columns:2,gap:8},g=>{
     g.cell(c=>c.heading('CELL_A',{bold:true}).paragraph('VALUE_A'));
     g.cell(c=>c.heading('CELL_B',{bold:true}).paragraph('VALUE_B'));
     g.cell(c=>c.paragraph('CELL_C'));
     g.cell(c=>c.paragraph('CELL_D'));
   });
 }).renderSync());
 for(const word of ['CELL_A','CELL_B','CELL_C','CELL_D']){
   const w=out.words.find(w=>w.text===word);
   assert.ok(w && w.x>150 && w.right<460,JSON.stringify(w));
 }
 assert.equal(out.pages,1);
});
test('box breakBefore and keepWithNext move content predictably',()=>{
 const before=inspect(app.document({title:'Break explicit',page:'Letter'})
  .paragraph('PREVIOUS_PAGE')
  .box({breakBefore:true,padding:14},b=>b.paragraph('NEXT_PAGE_BOX'))
  .renderSync());
 assert.equal(before.pages,2);
 assert.doesNotMatch(before.byPage(1),/NEXT_PAGE_BOX/);
 assert.match(before.byPage(2),/NEXT_PAGE_BOX/);
 const kept=inspect(app.document({title:'Keep with next',page:'Letter'})
  .spacer(525)
  .box({keepWithNext:true,padding:12},b=>b.paragraph('KEEPED_BOX'))
  .paragraph('SIBLING_AFTER')
  .renderSync());
 assert.equal(kept.pages,2);
 assert.doesNotMatch(kept.byPage(1),/KEEPED_BOX/);
 assert.match(kept.byPage(2),/KEEPED_BOX/);
 assert.match(kept.byPage(2),/SIBLING_AFTER/);
});
test('keepTogether rejects an impossible box while ordinary box fragments all words once',()=>{
 const terms=Array.from({length:750},(_,i)=>'LONG'+String(i+1).padStart(4,'0')).join(' ');
 const split=inspect(app.document({title:'Long box',page:'Letter'})
 .box({padding:15,background:'soft'},b=>{
   b.heading('LONGHEADING',{bold:true});
   b.paragraph(terms,{fontSize:12,lineHeight:18});
 }).paragraph('AFTER_BOX').renderSync());
 assert.ok(split.pages>=3);
 const ids=[...split.raw.matchAll(/LONG(\d{4})/g)].map(m=>Number(m[1]));
 assert.deepEqual(ids,Array.from({length:750},(_,i)=>i+1));
 assert.equal((split.raw.match(/AFTER_BOX/g)??[]).length,1);
 assert.throws(()=>app.document({title:'Impossible keep',page:'Letter'})
 .box({keepTogether:true},b=>b.paragraph(terms)).renderSync(),/pagination failed|InvalidHeight|height/i);
});
test('oversized nested row errors and unknown font is rejected before rendering',()=>{
 const d=app.document({title:'Bad nested'});
 assert.throws(()=>d.box({width:240,padding:20},b=>b.row(r=>{
   r.column({width:150},c=>c.paragraph('ONE'));
   r.column({width:150},c=>c.paragraph('TWO'));
 })),/do not fit/);
 assert.throws(()=>d.box(b=>b.row(r=>r.column(c=>
   c.paragraph('X '.repeat(2500))))).renderSync(),/row height exceeds/);
 assert.throws(()=>d.box(b=>b.paragraph('Unknown',{font:'unconfigured'})),/must be configured/);
 assert.throws(()=>renderPdf({title:'Native guard',blocks:[{type:'box',
   box:{items:[{type:'rich',runs:[{text:'X',font:'missing'}]}]}}]},regular),
   /invalid font|unknown font|font face/i);
});
