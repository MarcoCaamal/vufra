import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { readFileSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const require = createRequire(import.meta.url);
const { renderPdf } = require('../dist/index.js');
const font = readFileSync(process.env.VUFRA_FONT ||
  execFileSync('fc-match', ['Noto Sans', '-f', '%{file}\n'], {encoding:'utf8'}).trim());
const cols = [
  {header:'Clave',width:98},
  {header:'Descripción',width:278},
  {header:'Precio MXN',width:121},
];

function inspect(bytes) {
  const dir=mkdtempSync(join(tmpdir(),'vufra-flow-'));
  const file=join(dir,'flow.pdf');
  writeFileSync(file,bytes);
  const info=execFileSync('pdfinfo',[file],{encoding:'utf8'});
  const text=execFileSync('pdftotext',['-layout',file,'-'],{encoding:'utf8'});
  const pages=Number(info.match(/Pages:\s+(\d+)/)?.[1]);
  return {file, pages, text, sheets:text.split('\f').filter(x=>x.trim())};
}

test('ordered paragraphs and table share the SAME page, without blank pages',()=>{
  const {pages,text,sheets}=inspect(renderPdf({
    title:'Vufra: composición unificada',
    blocks:[
      {type:'paragraph',text:'PRIMER PÁRRAFO: ¡Hola, Cancún!'},
      {type:'table',table:{columns:cols,rows:[
        ['SKU-0001','Producto café','$ 12'],
        ['SKU-0002','Producto té','$ 24']
      ]}},
      {type:'paragraph',text:'PÁRRAFO FINAL: después de la tabla.'},
    ]
  },font));
  assert.equal(pages,1,'short paragraph + table + paragraph should fit one page');
  const seq=['PRIMER PÁRRAFO','Clave','SKU-0001','SKU-0002','PÁRRAFO FINAL'];
  const positions=seq.map(s=>text.indexOf(s));
  assert.ok(positions.every(x=>x>=0),positions);
  assert.deepEqual(positions,[...positions].sort((a,b)=>a-b));
  assert.ok(sheets[0].includes('¡Hola, Cancún!'));
});

test('a paragraph spanning pages conserves 1200 marked tokens then an adjacent table',()=>{
  const expected=Array.from({length:1200},(_,i)=>'FLOW'+String(i+1).padStart(4,'0'));
  const result=inspect(renderPdf({
    title:'Largo documento',
    blocks:[
      {type:'paragraph',text:expected.join(' ')},
      {type:'table',table:{columns:cols,rows:[['SKU-END','Tabla después de texto enorme','$ 1']]}},
      {type:'paragraph',text:'FIN DEL DOCUMENTO'},
    ],
  },font));
  assert.ok(result.pages>2);
  const observed=[...result.text.matchAll(/FLOW(\d{4})/g)].map(m=>Number(m[1]));
  assert.deepEqual(observed,Array.from({length:1200},(_,i)=>i+1));
  assert.ok(result.text.indexOf('SKU-END')>result.text.indexOf('FLOW1200'));
  assert.ok(result.text.indexOf('FIN DEL DOCUMENTO')>result.text.indexOf('SKU-END'));
});

test('table with very long row followed by paragraph reuses last page space',()=>{
  const values=Array.from({length:330},(_,i)=>'CONT'+String(i).padStart(4,'0'));
  const result=inspect(renderPdf({
    title:'Tablas y párrafos fluidos',
    blocks:[
      {type:'table',table:{columns:cols,rows:[
        ['SKU-START',values.join(' '),'$ 0'],
        ['SKU-END','Última fila','$ 1'],
      ]}},
      {type:'paragraph',text:'ÚLTIMO PÁRRAFO AL FINAL DE TABLA'},
      {type:'paragraph',text:'SEGUNDO PÁRRAFO QUE APROVECHA LA PÁGINA'},
    ],
  },font));
  assert.ok(result.pages>1);
  assert.deepEqual(
    [...result.text.matchAll(/CONT(\d{4})/g)].map(m=>Number(m[1])),
    Array.from({length:330},(_,i)=>i)
  );
  assert.ok(result.sheets.at(-1).includes('SKU-END'));
  assert.ok(result.sheets.at(-1).includes('ÚLTIMO PÁRRAFO'));
  assert.ok(result.sheets.at(-1).includes('SEGUNDO PÁRRAFO'));
  // Every page carrying the same table repeats the header.
  assert.equal((result.text.match(/Clave/g)||[]).length,result.pages);
});

test('multiple tables and paragraphs retain their authored order',()=>{
  const result=inspect(renderPdf({
    title:'A-B-C',
    blocks:[
      {type:'table',table:{columns:cols,rows:[['FIRST-TABLE','uno','1']]}},
      {type:'paragraph',text:'MID-PARAGRAPH'},
      {type:'table',table:{columns:cols,rows:[['SECOND-TABLE','dos','2']]}},
      {type:'paragraph',text:'TAIL-PARAGRAPH'},
    ]
  },font));
  assert.equal(result.pages,1);
  const indexes=['FIRST-TABLE','MID-PARAGRAPH','SECOND-TABLE','TAIL-PARAGRAPH']
    .map(x=>result.text.indexOf(x));
  assert.deepEqual(indexes,[...indexes].sort((a,b)=>a-b));
  assert.equal((result.text.match(/Clave/g)||[]).length,2);
});

test('rejects mixed modes and invalid ordered blocks; empty flow still valid',()=>{
  const make=blocks=>renderPdf({title:'Valid',blocks},font);
  assert.throws(()=>renderPdf({title:'Valid',paragraphs:['old'],blocks:[]},font),/blocks.*legacy/);
  assert.throws(()=>renderPdf({title:'Valid',table:{columns:cols,rows:[]},blocks:[]},font),/blocks.*legacy/);
  assert.throws(()=>make([{type:'video',url:'unknown'}]),/flow block/);
  assert.throws(()=>make([{type:'paragraph',text:54}]),/flow block/);
  assert.throws(()=>make([{type:'table',table:{columns:[],rows:[]}}]),/columns/);
  assert.throws(()=>make([{type:'paragraph',text:'W'.repeat(2000)}]),/unbreakable/);
  assert.equal(inspect(make([])).pages,1);
});
