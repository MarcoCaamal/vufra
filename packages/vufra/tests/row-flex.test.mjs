import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFileSync,writeFileSync,mkdtempSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
const require=createRequire(import.meta.url);
const {createVufra}=require('../dist/index.js');
const font=readFileSync(execFileSync('fc-match',['Noto Sans','-f','%{file}\n'],{encoding:'utf8'}).trim());
const app=createVufra({font});
function inspect(doc){
 const file=join(mkdtempSync(join(tmpdir(),'vufra-flex-')),'row.pdf');
 writeFileSync(file,doc.renderSync());
 const bbox=execFileSync('pdftotext',['-bbox',file,'-'],{encoding:'utf8'});
 const words=[...bbox.matchAll(/<word xMin="([\d.]+)" yMin="([\d.]+)" xMax="([\d.]+)" yMax="([\d.]+)">([^<]+)<\/word>/g)]
 .map(m=>({x:+m[1],y:+m[2],text:m[5]}));
 return t=>{const w=words.find(w=>w.text===t);assert.ok(w,'missing '+t);return w;};
}
const rowWidths=doc=>doc.toDocument().blocks.find(b=>b.type==='row').row.columns.map(c=>c.width);
test('flexGrow distributes unused width proportionally without altering the fixed column',()=>{
 const make=(enabled)=>app.document({page:'Letter'}).row({gap:10},r=>r
  .column({width:120,flexGrow:enabled?1:0},c=>c.paragraph('LEFT_FLEX'))
  .column({width:120,flexGrow:enabled?2:0},c=>c.paragraph('MIDDLE_FLEX'))
  .column({width:120},c=>c.paragraph('RIGHT_FIXED')));
 const grown=make(true),old=make(false);
 const widths=rowWidths(grown);
 const remainder=514-20-360;
 assert.ok(Math.abs(widths[0]-(120+remainder/3))<0.01);
 assert.ok(Math.abs(widths[1]-(120+remainder*2/3))<0.01);
 assert.equal(widths[2],120);
 const before=inspect(old),after=inspect(grown);
 assert.ok(Math.abs(before('LEFT_FLEX').x-after('LEFT_FLEX').x)<1);
 assert.ok(after('MIDDLE_FLEX').x-before('MIDDLE_FLEX').x>30);
 assert.ok(after('RIGHT_FIXED').x-before('RIGHT_FIXED').x>120);
});
test('flexShrink resolves oversized tracks without clipping or changing text content',()=>{
 const doc=app.document({page:'Letter'}).row({gap:10},r=>r
  .column({width:280,flexShrink:1},c=>c.paragraph('SHRINK_LEFT'))
  .column({width:260,flexShrink:1},c=>c.paragraph('SHRINK_RIGHT')));
 const widths=rowWidths(doc);
 assert.ok(Math.abs(widths[0]+widths[1]-(514-10))<0.02);
 assert.ok(widths[0]<280 && widths[1]<260);
 const w=inspect(doc);
 assert.ok(w('SHRINK_RIGHT').x>w('SHRINK_LEFT').x+230);
});
test('flexShrink uses weighted shrink with minimum-width freezing and per-side padding',()=>{
 const doc=app.document({page:'Letter'}).box({padding:{top:12,right:10,bottom:10,left:12}},b=>b
  .row({gap:12},r=>r
   .column({width:360,flexShrink:1,padding:{left:20,right:20}},c=>c.paragraph('BIG_FLEX'))
   .column({width:170,flexShrink:10,padding:{left:6,right:6}},c=>c.paragraph('SMALL_FLEX'))));
 const snapshot=doc.toDocument();
 const columns=snapshot.blocks[0].box.items[0].row.columns;
 const sum=columns.reduce((v,c)=>v+c.width,0);
 assert.ok(Math.abs(sum-(514-12-10-12))<0.02);
 assert.ok(columns[1].width>=60-0.001);
 assert.ok(columns[0].width<360);
 const w=inspect(doc);
 assert.ok(w('SMALL_FLEX').x>w('BIG_FLEX').x+200);
});
test('flexGrow and flexShrink reject impossible sizes, implicit bases and invalid weights',()=>{
 assert.throws(()=>app.document().row(r=>r
  .column({flexGrow:1},c=>c.paragraph('A'))
  .column({width:100},c=>c.paragraph('B'))),/explicit column widths/);
 assert.throws(()=>app.document().row({justify:'space-between'},r=>r
  .column({width:120,flexGrow:1},c=>c.paragraph('A'))
  .column({width:120},c=>c.paragraph('B'))),/justify start/);
 assert.throws(()=>app.document().row(r=>r
  .column({width:200,flexShrink:-1},c=>c.paragraph('A'))),/flexGrow\/flexShrink/);
 assert.throws(()=>app.document().row(r=>r
  .column({width:200,flexGrow:Infinity},c=>c.paragraph('A'))),/flexGrow\/flexShrink/);
 assert.throws(()=>app.document().row(r=>r
  .column({width:600},c=>c.paragraph('A'))
  .column({width:100,flexShrink:1},c=>c.paragraph('B'))),/cannot satisfy native column minimum widths/);
});
test('flex sizing works for page-band rows and mixed section widths',()=>{
 const doc=app.document({page:'Letter'})
 .pageSection({title:'Narrow',page:{width:420,height:792,margins:{left:40,right:40}},
   header:h=>h.row({gap:10},r=>r
     .column({width:90,flexGrow:1},c=>c.paragraph('HEADER_A'))
     .column({width:90,flexGrow:1},c=>c.paragraph('HEADER_B')))},b=>b
     .row({gap:10},r=>r
       .column({width:90,flexGrow:1},c=>c.paragraph('NARROW_A'))
       .column({width:90,flexGrow:1},c=>c.paragraph('NARROW_B'))))
 .pageSection({title:'Wide',page:{width:700,height:792,margins:{left:40,right:40}}},b=>b
     .row({gap:10},r=>r
       .column({width:90,flexGrow:1},c=>c.paragraph('WIDE_A'))
       .column({width:90,flexGrow:1},c=>c.paragraph('WIDE_B'))));
 const blocks=doc.toDocument().blocks;
 const rows=blocks.filter(b=>b.type==='row');
 assert.equal(rows.length,2);
 assert.ok(rows[1].row.columns[0].width>rows[0].row.columns[0].width+100);
 const word=inspect(doc);
 assert.ok(word('WIDE_B').x>word('NARROW_B').x+100);
});
