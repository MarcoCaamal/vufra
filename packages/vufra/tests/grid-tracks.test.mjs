import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFileSync,writeFileSync,mkdtempSync,rmSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {join} from 'node:path';
import {tmpdir} from 'node:os';

const require=createRequire(import.meta.url);
const {createVufra,grid,paragraph,box}=require('../dist/index.js');
const font=readFileSync(execFileSync('fc-match',
  ['Noto Sans','-f','%{file}\n'],{encoding:'utf8'}).trim());
const bold=readFileSync(execFileSync('fc-match',
  ['Noto Sans:style=Bold','-f','%{file}\n'],{encoding:'utf8'}).trim());
const app=createVufra({font,fonts:{bold}});

function inspect(data){
  const dir=mkdtempSync(join(tmpdir(),'vufra-grid-tracks-'));
  try {
    const pdf=join(dir,'grid.pdf');
    writeFileSync(pdf,data);
    const bbox=execFileSync('pdftotext',['-bbox',pdf,'-'],{encoding:'utf8'});
    const raw=execFileSync('pdftotext',['-raw',pdf,'-'],{encoding:'utf8'});
    const info=execFileSync('pdfinfo',[pdf],{encoding:'utf8'});
    const words=[...bbox.matchAll(/<word xMin="([\d.]+)" yMin="([\d.]+)" xMax="([\d.]+)" yMax="([\d.]+)">([^<]+)<\/word>/g)]
      .map(m=>({x:+m[1],y:+m[2],right:+m[3],bottom:+m[4],text:m[5]}));
    return {pages:Number(info.match(/Pages:\s+(\d+)/)[1]),words,raw};
  }finally{rmSync(dir,{recursive:true,force:true})}
}
function word(out,text){
  const found=out.words.find(w=>w.text===text);
  assert.ok(found,'word missing from PDF: '+text);
  return found;
}
function approx(actual,expected,error=3){
  assert.ok(Math.abs(actual-expected)<=error,
    'expected '+expected+' ±'+error+'pt, received '+actual);
}
test('2fr/1fr grid uses actual PDF column positions, not equal widths',()=>{
 const out=inspect(app.document({page:'Letter',title:'Fractional dashboard'})
   .grid({columns:['2fr','1fr'],gap:12},g=>{
     g.cell(c=>c.paragraph('WIDE_LEFT'));
     g.cell(c=>c.paragraph('NARROW_RIGHT'));
   }).renderSync());
 assert.equal(out.pages,1);
 const a=word(out,'WIDE_LEFT'),b=word(out,'NARROW_RIGHT');
 // Letter default margins=49pt -> 514pt content, 502pt usable.
 // second column starts at 49 + (514-12)*2/3 + 12.
 approx(a.x,49);
 approx(b.x,49+(514-12)*2/3+12);
 assert.ok(b.x>a.right+100,'fractional layout must not overlap');
});
test('fixed + percentage + fractional tracks use remaining width inside padded box',()=>{
 const out=inspect(app.document({page:'Letter',title:'Nested mixed tracks'})
   .box({width:440,align:'center',padding:20},b=>b
     .grid({columns:[100,'30%','2fr'],gap:8},g=>{
       g.cell(c=>c.paragraph('NEST_FIXED'));
       g.cell(c=>c.paragraph('NEST_PERCENT'));
       g.cell(c=>c.paragraph('NEST_FLEX'));
     })
   ).renderSync());
 const fixed=word(out,'NEST_FIXED'),pct=word(out,'NEST_PERCENT'),
       flex=word(out,'NEST_FLEX');
 const x=49+(514-440)/2+20;
 const usable=440-40-16;
 approx(fixed.x,x);
 approx(pct.x,x+100+8);
 approx(flex.x,x+100+8+usable*0.3+8);
 assert.ok(flex.right<49+514,'third column cannot overrun the page');
});
test('page band uses the same fractional grid solver as document body',()=>{
 const out=inspect(app.document({page:'Letter',title:'Template columns'})
  .header(h=>h.grid({columns:['1fr','2fr'],gap:12},g=>{
    g.cell(c=>c.paragraph('HEADER_LEFT'));
    g.cell(c=>c.paragraph('HEADER_RIGHT'));
  }))
  .footer(f=>f.grid({columns:[120,'1fr'],gap:12},g=>{
    g.cell(c=>c.paragraph('FOOTER_FIXED'));
    g.cell(c=>c.paragraph('FOOTER_FLUID'));
  }))
  .paragraph('BODY_MAIN')
  .renderSync());
 assert.equal(out.pages,1);
 approx(word(out,'HEADER_RIGHT').x,49+(514-12)/3+12);
 approx(word(out,'FOOTER_FLUID').x,49+120+12);
 assert.ok(word(out,'HEADER_LEFT').y<word(out,'BODY_MAIN').y);
 assert.ok(word(out,'FOOTER_FIXED').y>word(out,'BODY_MAIN').y);
});
test('reusable composed fractional grid cards support partial final row and typography',()=>{
 const metric=(key,value)=>box({padding:10,background:'#EEF4FA'},
   [paragraph(key,{bold:true,fontSize:12}),paragraph(value)]);
 const cards=grid({columns:['2fr','1fr'],gap:14},[
   metric('REVENUE_CARD','MXN_120000'),
   metric('ORDERS_CARD','ORDERS_1250'),
   metric('RETENTION_CARD','RETENTION_95')
 ]);
 const a=app.document({title:'Reusable fractional'}).add(cards);
 const first=inspect(a.renderSync());
 for(const token of ['REVENUE_CARD','ORDERS_CARD','RETENTION_CARD']){
   assert.equal((first.raw.match(new RegExp(token,'g'))??[]).length,1);
 }
 assert.ok(word(first,'RETENTION_CARD').y>word(first,'REVENUE_CARD').y,
   'third card should flow to next grid row');
 const second=inspect(a.paragraph('AFTER_CARDS').renderSync());
 assert.match(second.raw,/AFTER_CARDS/);
 assert.doesNotMatch(first.raw,/AFTER_CARDS/);
});
test('invalid or impossible fractional/fixed tracks fail early with clear errors',()=>{
 const doc=app.document({page:'Letter'});
 const bad=[
   {columns:[]},{columns:['0fr','1fr']},{columns:['-1fr','2fr']},
   {columns:['Infinityfr','1fr']},{columns:['120%','1fr']},
   {columns:[600,'1fr']},{columns:[240,'2fr','1fr'],gap:80},
   {columns:[Number.POSITIVE_INFINITY,'1fr']},
   {columns:[-80,'1fr']},{columns:['5pt','1fr']},
   {columns:['*','*','*','*','*','*','*']},
   {columns:['1fr','1fr'],gap:100},
   {columns:0},{columns:7},{columns:1.5},
   {columns:['0%','*']},
 ];
 for(const options of bad){
   assert.throws(()=>doc.grid(options,g=>g
      .cell(c=>c.paragraph('INVALID_GRID'))
      .cell(c=>c.paragraph('ALSO_INVALID'))),
     /Vufra: grid/,JSON.stringify(options));
 }
 assert.throws(()=>doc.grid({columns:['2fr','1fr']},()=>{}),
   /grid needs at least one cell/);
 assert.throws(()=>doc.box({width:230,padding:20},b=>
   b.grid({columns:['2fr','1fr']},g=>g.cell(c=>c.paragraph('TOO_NARROW')))),
   /grid tracks do not fit/);
 assert.throws(()=>doc.header(h=>h.grid({columns:['2fr','1fr']},g=>
   g.cell(c=>c.paragraph('MISSING_RIGHT')))),
   /exactly one row/);
});
test('mixed fractional cards and multi-page styled table keep all identifiers once',()=>{
 const rows=Array.from({length:180},(_,i)=>[
   'ITEM_'+String(i+1).padStart(3,'0'),
   'Monthly payment record '+(i+1),
   'MXN '+(100+i)
 ]);
 const out=inspect(app.document({page:'Letter',title:'Business report'})
   .header(h=>h.grid({columns:[125,'1fr']},g=>{
     g.cell(c=>c.paragraph('COMPANY_GRID'));
     g.cell(c=>c.paragraph('EXECUTIVE_REPORT',{bold:true}));
   }))
   .grid({columns:['2fr','1fr'],gap:12},g=>{
     g.cell(c=>c.box({padding:12},b=>b
       .heading('REVENUE_CARD',{bold:true,level:3})
       .paragraph('Current business performance')));
     g.cell(c=>c.box({padding:12},b=>b
       .heading('ORDERS_CARD',{bold:true,level:3})
       .paragraph('180 records')));
   })
   .table(rows,{columns:[
     {title:'CODE',width:'25%'},{title:'DETAIL',width:'50%'},{title:'AMOUNT',width:'25%'}
   ]})
   .renderSync());
 assert.ok(out.pages>2,'table should paginate');
 const ids=[...out.raw.matchAll(/ITEM_(\d{3})/g)].map(m=>Number(m[1]));
 assert.deepEqual(ids,Array.from({length:180},(_,i)=>i+1));
 assert.equal((out.raw.match(/REVENUE_CARD/g)||[]).length,1);
 assert.equal((out.raw.match(/ORDERS_CARD/g)||[]).length,1);
 assert.equal((out.raw.match(/COMPANY_GRID/g)||[]).length,out.pages);
});
