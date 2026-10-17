import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFileSync,writeFileSync,mkdtempSync,rmSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {join} from 'node:path';
import {tmpdir} from 'node:os';

const require=createRequire(import.meta.url);
const {createVufra,grid,box,paragraph}=require('../dist/index.js');
const font=readFileSync(execFileSync('fc-match',
  ['Noto Sans','-f','%{file}\n'],{encoding:'utf8'}).trim());
const bold=readFileSync(execFileSync('fc-match',
  ['Noto Sans:style=Bold','-f','%{file}\n'],{encoding:'utf8'}).trim());
const app=createVufra({font,fonts:{bold},theme:{
  colors:{panel:'#EDF4FB',primary:'#173D78'},
  presets:{
    box:{card:{padding:10,background:'panel'}},
    text:{label:{fontSize:10,bold:true,color:'primary',
      spaceBefore:2,spaceAfter:2}}
  }
}});
function inspect(bytes){
  const dir=mkdtempSync(join(tmpdir(),'vufra-auto-grid-'));
  try{
    const file=join(dir,'a.pdf');
    writeFileSync(file,bytes);
    const xml=execFileSync('pdftotext',['-bbox',file,'-'],{encoding:'utf8'});
    const raw=execFileSync('pdftotext',['-raw',file,'-'],{encoding:'utf8'});
    const info=execFileSync('pdfinfo',[file],{encoding:'utf8'});
    return {
      raw,pages:Number(info.match(/Pages:\s+(\d+)/)[1]),
      words:[...xml.matchAll(/<word xMin="([\d.]+)" yMin="([\d.]+)" xMax="([\d.]+)" yMax="([\d.]+)">([^<]+)<\/word>/g)]
        .map(m=>({x:+m[1],y:+m[2],right:+m[3],bottom:+m[4],text:m[5]}))
    };
  }finally{rmSync(dir,{recursive:true,force:true})}
}
function find(out,token){
 const value=out.words.find(w=>w.text===token);
 assert.ok(value,'word missing '+token);
 return value;
}
function approx(actual,expected,tolerance=2){
 assert.ok(Math.abs(actual-expected)<tolerance,
  'expected '+expected+', received '+actual);
}
function simpleCells(count,prefix){
 return g=>{
  for(let i=0;i<count;i++)
   g.cell(c=>c.paragraph(prefix+'_'+String(i).padStart(2,'0')));
 };
}
test('auto grid chooses 3 columns on Letter page and wraps five cards into two rows',()=>{
 const doc=app.document({page:'Letter'})
  .grid({columns:{minWidth:150,maxColumns:5},gap:12,rowGap:16},
    simpleCells(5,'BODY'));
 const blocks=doc.toDocument().blocks;
 assert.deepEqual(blocks.map(b=>b.type),['row','spacer','row']);
 assert.deepEqual(blocks.filter(b=>b.type==='row')
   .map(b=>b.row.columns.length),[3,3]);
 assert.equal(blocks[1].height,16);
 const expectedWidth=(514-24)/3;
 for(const col of blocks[0].row.columns)approx(col.width,expectedWidth,0.01);
 const out=inspect(doc.renderSync());
 approx(find(out,'BODY_00').x,49);
 approx(find(out,'BODY_01').x,49+expectedWidth+12);
 approx(find(out,'BODY_02').x,49+2*(expectedWidth+12));
 approx(find(out,'BODY_03').x,49);
 assert.ok(find(out,'BODY_03').y>find(out,'BODY_00').bottom+12);
 for(let i=0;i<5;i++)assert.equal((out.raw.match(
   new RegExp('BODY_'+String(i).padStart(2,'0'),'g'))??[]).length,1);
});
test('the SAME auto grid picks fewer columns in a narrower nested box',()=>{
 const make=(key)=>grid({columns:{minWidth:145,maxColumns:5},gap:10,rowGap:8},
  [paragraph(key+'_00'),paragraph(key+'_01'),paragraph(key+'_02')]);
 const root=app.document({page:'Letter'}).add(make('ROOT'));
 const nested=app.document({page:'Letter'})
   .box({width:340,padding:12,align:'center'},b=>b.add(make('INNER')));
 assert.equal(root.toDocument().blocks.length,1);
 const n=nested.toDocument().blocks[0].box.items;
 assert.deepEqual(n.map(x=>x.type),['row','spacer','row']);
 assert.equal(n[0].row.columns.length,2);
 const a=inspect(root.renderSync()),b=inspect(nested.renderSync());
 assert.ok(find(a,'ROOT_02').x>find(a,'ROOT_01').x);
 assert.ok(find(b,'INNER_02').y>find(b,'INNER_00').y);
});
test('auto width threshold is exact and single column remains safe',()=>{
 const fn=(width)=>app.document({page:'Letter'}).box({width,padding:12},b=>
   b.grid({columns:{minWidth:150},gap:12},
     simpleCells(3,'THRESHOLD'))).toDocument().blocks[0].box.items;
 // inner 311pt cannot fit two 150pt columns with a 12pt gap.
 assert.deepEqual(fn(335).map(x=>x.row?.columns.length??0),[1,1,1]);
 // inner 312pt fits exactly two; third cell moves to second row.
 assert.deepEqual(fn(336).map(x=>x.row?.columns.length??0),[2,2]);
});
test('rowGap creates whitespace proportional to configured value, not manual item heights',()=>{
 const make=(rowGap)=>app.document({page:'Letter'})
  .grid({columns:{minWidth:230,maxColumns:2},gap:12,rowGap},g=>{
    g.cell(c=>c.box({preset:'card'},b=>b
      .paragraph('TALL_TOP',{preset:'label'})
      .paragraph('This card has intentionally longer natural content which needs to wrap across several lines because the available track is narrow enough to constrain the text comfortably.')
      .paragraph('TALL_BOTTOM')));
    g.cell(c=>c.box({preset:'card'},b=>b.paragraph('SHORT_CARD')));
    g.cell(c=>c.box({preset:'card'},b=>b.paragraph('NEXT_ROW')));
  });
 const small=inspect(make(0).renderSync());
 const spaced=inspect(make(24).renderSync());
 approx(find(spaced,'NEXT_ROW').y-find(small,'NEXT_ROW').y,24,1.5);
 assert.ok(find(spaced,'NEXT_ROW').y>find(spaced,'TALL_BOTTOM').bottom+18);
 assert.equal(spaced.pages,1);
});
test('auto tracks work in a page band and reject vertical row spacing',()=>{
 const doc=app.document({page:'Letter'})
   .header(h=>h.grid({columns:{minWidth:200,maxColumns:2},gap:10},g=>{
     g.cell(c=>c.paragraph('AUTOBAND_LEFT'));
     g.cell(c=>c.paragraph('AUTOBAND_RIGHT'));
   }))
   .paragraph('DOCUMENT_MAIN');
 const out=inspect(doc.renderSync());
 assert.equal(out.pages,1);
 assert.ok(find(out,'AUTOBAND_RIGHT').x>find(out,'AUTOBAND_LEFT').x+150);
 assert.throws(()=>app.document().header(h=>h.grid({
     columns:{minWidth:200},rowGap:10
   },simpleCells(2,'BAD_BAND'))),/rowGap is not supported/);
});
test('invalid minWidth, maxColumns, gaps and unknown auto keys reject early',()=>{
 const base=app.document({page:'Letter'});
 const bad=[
  {columns:{minWidth:0}},{columns:{minWidth:59}},
  {columns:{minWidth:600}},{columns:{minWidth:Infinity}},
  {columns:{minWidth:150,maxColumns:0}},
  {columns:{minWidth:150,maxColumns:7}},
  {columns:{minWidth:150,maxColumns:1.5}},
  {columns:{minWidth:150,maxColumns:NaN}},
  {columns:{minWidth:150,unknown:42}},
  {columns:{maxColumns:2}},
  {columns:{minWidth:150},gap:-1},
  {columns:{minWidth:150},rowGap:81},
  {columns:{minWidth:150},rowGap:NaN},
  {columns:{minWidth:150},rowGap:-1},
 ];
 for(const options of bad)assert.throws(()=>base.grid(options,simpleCells(2,'BAD')),
   /Vufra: grid/,JSON.stringify(options));
 assert.throws(()=>base.grid({columns:{minWidth:150}},()=>{}),
   /grid needs at least one cell/);
});
test('variable-height cards paginate in row-major order with no missing IDs',()=>{
 const cards=Array.from({length:62},(_,i)=>box({preset:'card'},[
   paragraph('CARD_'+String(i+1).padStart(3,'0'),{preset:'label'}),
   paragraph('Record information '.repeat(i%4+1)+String(i+1))
 ]));
 const doc=app.document({page:'Letter'})
   .header(h=>h.text('AUTO_REPORT_HEADER'))
   .add(grid({columns:{minWidth:150,maxColumns:4},gap:10,rowGap:9},cards))
   .paragraph('END_OF_CARDS');
 const out=inspect(doc.renderSync());
 assert.ok(out.pages>=2);
 const ids=[...out.raw.matchAll(/CARD_(\d{3})/g)].map(m=>Number(m[1]));
 assert.deepEqual(ids,Array.from({length:62},(_,i)=>i+1));
 assert.equal(out.raw.split('END_OF_CARDS').length-1,1);
 assert.equal(out.raw.split('AUTO_REPORT_HEADER').length-1,out.pages);
});
