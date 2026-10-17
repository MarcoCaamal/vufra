import {massiveFlow} from './fixtures/flow.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const require = createRequire(import.meta.url);
const { renderPdf, renderPdfAsync,createVufra } = ({...require('../dist/index.js'),...require('../dist/renderer.js')});
const font = readFileSync(process.env.VUFRA_FONT ||
  execFileSync('fc-match', ['Noto Sans', '-f', '%{file}\n'], {encoding:'utf8'}).trim());

function inspect(bytes) {
  assert.ok(Buffer.isBuffer(bytes), 'native worker must resolve to Buffer bytes');
  assert.equal(bytes.subarray(0, 5).toString(), '%PDF-');
  const file=join(mkdtempSync(join(tmpdir(),'vufra-async-')),'result.pdf');
  writeFileSync(file, bytes);
  const info = execFileSync('pdfinfo', [file], {encoding:'utf8'});
  const text = execFileSync('pdftotext', ['-layout', file, '-'], {encoding:'utf8'});
  return {pages: Number(info.match(/Pages:\s+(\d+)/)?.[1]), text};
}

test('async and sync produce equivalent selectable text and pagination', async () => {
  const doc={
    title:'Asíncrono: reporte México',
    page:{format:'letter'},
    blocks:[
      {type:'heading',level:1,text:'Resultados de octubre'},
      {type:'paragraph',text:'¡Hola, Cancún! Nativo, sin bloqueo de Node.js'},
      ...createVufra({font}).document({title:'Internal'}).table(
        Array.from({length:150},(_,i)=>['REG'+String(i+1).padStart(4,'0'),'Producto de ejemplo '+(i+1)]),
        {columns:[{title:'Clave',width:110},{title:'Descripción',width:300}]}
      ).toDocument().blocks
    ]
  };
  const slow = inspect(renderPdf(doc,font));
  const fast = inspect(await renderPdfAsync(doc,font));
  assert.equal(fast.pages,slow.pages);
  assert.equal(fast.text,slow.text);
  const ids=[...fast.text.matchAll(/REG(\d{4})/g)].map(m=>+m[1]);
  assert.deepEqual(ids,Array.from({length:150},(_,i)=>i+1));
});

test('long running native rendering does not block immediate event-loop iteration', async () => {
  const doc=massiveFlow('Heavy native job','RUN',9500,' descripción con texto de ejemplo');
  let completed=false;
  const task=renderPdfAsync(doc,font).finally(()=>{completed=true;});
  // A synchronous "async-looking" shim would finish CPU rendering before this
  // setImmediate, then set the completed flag at its Promise microtask.
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(completed,false,'PDF work unexpectedly finished before Node event loop yielded');
  const result=inspect(await task);
  const ids=[...result.text.matchAll(/RUN(\d{4})/g)].map(m=>+m[1]);
  assert.equal(ids.length,9500);
  assert.deepEqual(ids,Array.from({length:9500},(_,i)=>i+1));
  assert.ok(result.pages > 100);
});

test('parallel native jobs remain isolated and return their own PDFs', async () => {
  const docs=Array.from({length:4},(_,i)=>({
    title:'Concurrent job '+i,
    blocks:[
      {type:'heading',level:2,text:'LOTE'+i},
      {type:'paragraph',text:'Año 2026, documento '+i},
      ...createVufra({font}).document({title:'Internal'}).table(
        Array.from({length:350},(_,row)=>[
          'J'+i+'ROW'+String(row+1).padStart(4,'0'),'Producto '+row
        ]),{columns:[{title:'Folio',width:110},{title:'Detalle',width:320}]}
      ).toDocument().blocks
    ]
  }));
  const results=await Promise.all(docs.map(doc=>renderPdfAsync(doc,font)));
  results.forEach((bytes,i)=>{
    const output=inspect(bytes);
    assert.ok(output.pages>1);
    const ids=[...output.text.matchAll(/J(\d)ROW(\d{4})/g)];
    assert.equal(ids.length,350);
    assert.ok(ids.every(match=>Number(match[1])===i));
    assert.equal(output.text.includes('LOTE'+i),true);
  });
});

test('async errors reject Promise with same validation and rendering diagnostics', async () => {
  await assert.rejects(renderPdfAsync({title:'',blocks:[]},font),/title/);
  await assert.rejects(renderPdfAsync({title:'Valid',blocks:[
    {type:'paragraph',text:'Z'.repeat(1000)}
  ]},font),/unbreakable text exceeds printable width/);
  await assert.rejects(renderPdfAsync({title:'Valid',blocks:[]},Buffer.from([0,1,2])),/Font/);
  await assert.rejects(renderPdfAsync({title:'Valid',blocks:[], page:{format:'a4', margins:{left:595}}},font),/geometry/);
});

test('async task owns original inputs after enqueue', async () => {
  const inputFont=Buffer.from(font);
  const inputDoc={title:'Owned input',blocks:[{type:'paragraph',text:'THIS STAYS ORIGINAL'}]};
  const task=renderPdfAsync(inputDoc,inputFont);
  inputFont.fill(0);
  inputDoc.blocks[0].text='THIS WAS CHANGED';
  const output=inspect(await task);
  assert.ok(output.text.includes('THIS STAYS ORIGINAL'));
  assert.ok(!output.text.includes('THIS WAS CHANGED'));
});
