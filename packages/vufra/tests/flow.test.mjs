import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {execFileSync} from 'node:child_process';
import {readFileSync,writeFileSync,mkdtempSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
const require=createRequire(import.meta.url);
const {createVufra}=require('../dist/index.js');
const font=readFileSync(execFileSync('fc-match',['Noto Sans','-f','%{file}\n'],
  {encoding:'utf8'}).trim());
const app=createVufra({font});
const columns=[{title:'Clave',width:'30%'},{title:'Detalle',width:'70%'}];
function inspect(pdf){
 const path=join(mkdtempSync(join(tmpdir(),'vufra-flow-')),'report.pdf');
 writeFileSync(path,pdf);
 return {pages:+execFileSync('pdfinfo',[path],{encoding:'utf8'}).match(/Pages:\s+(\d+)/)[1],
 text:execFileSync('pdftotext',['-raw',path,'-'],{encoding:'utf8'}),path};
}
test('canonical fluent paragraph and table paginate without data loss',()=>{
 const rows=Array.from({length:115},(_,i)=>['SKU_'+String(i+1).padStart(4,'0'),'Producto']);
 const out=inspect(app.document({title:'Flow ordering'})
   .paragraph('INTRO_MIXED_PARAGRAPH').table(rows,{columns}).paragraph('OUTRO_MARKER')
   .renderSync());
 assert.ok(out.pages>=2);
 assert.deepEqual([...out.text.matchAll(/SKU_(\d{4})/g)].map(m=>+m[1]),
   Array.from({length:115},(_,i)=>i+1));
 assert.ok(out.text.indexOf('INTRO_MIXED_PARAGRAPH')<out.text.indexOf('SKU_0001'));
 assert.ok(out.text.indexOf('SKU_0115')<out.text.indexOf('OUTRO_MARKER'));
});
test('long paragraph and adjacent rich table both continue across pages',()=>{
 const tokens=Array.from({length:1200},(_,i)=>'WORD_'+String(i+1).padStart(4,'0'));
 const out=inspect(app.document({title:'Long text'})
   .paragraph(tokens.join(' ')).table([['END_REF','Remainder']],{columns})
   .renderSync());
 assert.ok(out.pages>=5);
 assert.deepEqual([...out.text.matchAll(/WORD_(\d{4})/g)].map(m=>+m[1]),
  Array.from({length:1200},(_,i)=>i+1));
 assert.equal((out.text.match(/END_REF/g)||[]).length,1);
});
test('two tables and paragraphs appear in authored order',()=>{
 const out=inspect(app.document({title:'Two rich tables'})
  .table([['FIRST_TABLE','one']],{columns})
  .paragraph('MID_PARAGRAPH')
  .table([['SECOND_TABLE','two']],{columns})
  .paragraph('TAIL_PARAGRAPH').renderSync());
 const labels=['FIRST_TABLE','MID_PARAGRAPH','SECOND_TABLE','TAIL_PARAGRAPH'];
 assert.deepEqual(labels.map(s=>out.text.indexOf(s)),
   [...labels.map(s=>out.text.indexOf(s))].sort((a,b)=>a-b));
});
test('heading and table preserve keepWithNext when first page is nearly filled',()=>{
 const out=inspect(app.document({title:'Keep with table'})
  .paragraph('PREFACE '.repeat(1600))
  .heading('FOLLOWING_HEADING',{keepWithNext:true})
  .table([['FOLLOWING_REF','value']],{columns})
  .renderSync());
 assert.ok(out.pages>=2);
 const pg=execFileSync('pdftotext',['-raw','-f',String(out.pages),'-l',String(out.pages),out.path,'-'],{encoding:'utf8'});
 assert.match(pg,/FOLLOWING_REF/);
});
test('invalid rich table and unbreakable paragraph reject clearly',()=>{
 const doc=app.document({title:'Flow errors'});
 assert.throws(()=>doc.table([['a','b','c']],{columns}),/row does not cover all columns|too many cells/);
 assert.throws(()=>doc.paragraph('W'.repeat(2000)).renderSync(),/unbreakable/);
});
test('empty flow renders one valid page',()=>{
 const out=inspect(app.document({title:'Empty modern flow'}).renderSync());
 assert.equal(out.pages,1);
});
