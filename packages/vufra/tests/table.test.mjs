import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {execFileSync} from 'node:child_process';
import {readFileSync,writeFileSync,mkdtempSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
const require=createRequire(import.meta.url);
const {createVufra}=require('../dist/index.js');
const font=readFileSync(process.env.VUFRA_FONT ||
  execFileSync('fc-match',['Noto Sans','-f','%{file}\n'],{encoding:'utf8'}).trim());
const engine=createVufra({font});
const columns=[
  {title:'Código SKU',width:110},
  {title:'Descripción de producto',width:270},
  {title:'Importe MXN',width:117}
];
function inspect(builder){
  const bytes=builder.renderSync();
  const path=join(mkdtempSync(join(tmpdir(),'vufra-table-')),'table.pdf');
  writeFileSync(path,bytes);
  return {
    path,pages:+execFileSync('pdfinfo',[path],{encoding:'utf8'}).match(/Pages:\s+(\d+)/)[1],
    text:execFileSync('pdftotext',['-raw',path,'-'],{encoding:'utf8'})
  };
}
test('Fluent tables: 600 rows, wrapping, repeated headers and no lost IDs',()=>{
  const rows=Array.from({length:600},(_,i)=>[
    'SKU-'+String(i+1).padStart(4,'0'),
    i%5===0?'Cancún, niño, acción. '+'Descripción extensa. '.repeat(3):'Producto '+(i+1),
    '$ '+((i+1)*12).toFixed(2)
  ]);
  const out=inspect(engine.document({title:'Tabla 600'}).table(rows,{columns}));
  assert.ok(out.pages>12);
  assert.deepEqual([...out.text.matchAll(/SKU-(\d{4})/g)].map(x=>+x[1]),
    Array.from({length:600},(_,i)=>i+1));
  for(let i=1;i<=out.pages;i++){
    const page=execFileSync('pdftotext',['-raw','-f',String(i),'-l',String(i),out.path,'-'],
      {encoding:'utf8'});
    assert.equal((page.match(/Código SKU/g)??[]).length,1);
  }
  assert.match(out.text,/Cancún/);
});
test('table following an introduction remains ordered and paginated',()=>{
  const rows=Array.from({length:120},(_,i)=>[
    'SKU-'+String(i).padStart(4,'0'),'Producto','10.50'
  ]);
  const out=inspect(engine.document({title:'Reporte mixto'})
    .paragraph('INTRODUCCION_PERMANECE').table(rows,{columns}));
  assert.ok(out.text.indexOf('INTRODUCCION_PERMANECE')<out.text.indexOf('SKU-0000'));
  assert.ok(out.pages>=2);
  assert.equal([...out.text.matchAll(/SKU-(\d{4})/g)].length,120);
});
test('empty styled table is invalid rather than producing an orphaned header',()=>{
  assert.throws(()=>engine.document({title:'Vacía'}).table([],{columns}),/1\.\.1000 rows/);
});
test('invalid table structures and widths reject',()=>{
  const doc=engine.document({title:'Bad'});
  assert.throws(()=>doc.table([['a']],{columns:[]}),/1\.\.6 columns/);
  assert.throws(()=>doc.table([['a']],{columns:[{title:'H',width:500}]}),/width|columns/);
  assert.throws(()=>doc.table([['a']],{columns:[{title:'H',width:NaN}]}),/width|columns/);
  assert.throws(()=>doc.table([['a','b']],{columns:[{title:'H',width:100}]}),/row does not cover all columns|too many cells/);
  assert.throws(()=>doc.table([['W'.repeat(1000)]],{columns:[{title:'H',width:100}]})
    .renderSync(),/unbreakable|printable width/);
});
test('long cell continues across pages once with heading repetition',()=>{
  const tokens=Array.from({length:500},(_,i)=>'FRAG'+String(i+1).padStart(4,'0'));
  const out=inspect(engine.document({title:'Large cell'}).table([
    ['SKU-BEGIN','Producto inicial','$12'],
    ['SKU-LARGE',tokens.join(' '),'$100'],
    ['SKU-END','Producto final','$13']
  ],{columns}));
  assert.ok(out.pages>=4);
  assert.deepEqual([...out.text.matchAll(/FRAG(\d{4})/g)].map(x=>+x[1]),
    Array.from({length:500},(_,i)=>i+1));
  assert.equal((out.text.match(/SKU-END/g)??[]).length,1);
});
test('different sized styled cells retain all content during continuation',()=>{
  const short=Array.from({length:150},(_,i)=>'SHORT'+String(i).padStart(4,'0'));
  const long=Array.from({length:450},(_,i)=>'LONG'+String(i).padStart(4,'0'));
  const out=inspect(engine.document({title:'Multi cell'}).table([
    ['LONG-CELL',long.join(' '),short.join(' ')]
  ],{columns}));
  assert.ok(out.pages>=2);
  assert.deepEqual([...out.text.matchAll(/LONG(\d{4})/g)].map(x=>+x[1]),
    Array.from({length:450},(_,i)=>i));
  assert.deepEqual([...out.text.matchAll(/SHORT(\d{4})/g)].map(x=>+x[1]),
    Array.from({length:150},(_,i)=>i));
});
