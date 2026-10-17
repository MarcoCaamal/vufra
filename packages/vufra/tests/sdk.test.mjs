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
function inspect(pdf){
  const path=join(mkdtempSync(join(tmpdir(),'vufra-sdk-')),'pdf.pdf');
  writeFileSync(path,pdf);
  return {
    pages:+execFileSync('pdfinfo',[path],{encoding:'utf8'}).match(/Pages:\s+(\d+)/)[1],
    text:execFileSync('pdftotext',['-raw',path,'-'],{encoding:'utf8'})
  };
}
test('Fluent renders unicode, multiple paragraphs and pages from Rust',()=>{
  const pdf=engine.document({title:'Desde Fluent'})
    .paragraph('¡Hola, Cancún! Niño, acción, México y ¿Qué?')
    .paragraph('Un párrafo extenso que debe partirse en muchas líneas. '.repeat(32))
    .section(s=>{
      for(let i=0;i<130;i++)s.paragraph('REGISTRO_'+String(i).padStart(4,'0'));
    }).renderSync();
  assert.equal(Buffer.from(pdf).subarray(0,5).toString(),'%PDF-');
  const out=inspect(pdf);
  assert.ok(out.pages>=2);
  for(const word of ['Cancún','Niño','acción','México','REGISTRO_0129'])
    assert.ok(out.text.includes(word),word);
});
test('1000 Fluent entries preserve exact order and paginate',()=>{
  const pdf=engine.document({title:'Mil entradas'}).section(s=>{
    for(let i=1;i<=1000;i++)s.paragraph('ENTRY_'+String(i).padStart(4,'0'));
  }).renderSync();
  const out=inspect(pdf);
  assert.ok(out.pages>5);
  assert.deepEqual([...out.text.matchAll(/ENTRY_(\d{4})/g)].map(x=>+x[1]),
    Array.from({length:1000},(_,i)=>i+1));
});
test('invalid Fluent title, fonts, or paragraph values reject',()=>{
  assert.throws(()=>engine.document({title:''}).paragraph('text').renderSync(),/title/);
  assert.throws(()=>createVufra({font:new Uint8Array()})
    .document({title:'ok'}).paragraph('text').renderSync(),/font/);
  assert.throws(()=>engine.document({title:'ok'}).paragraph(123),/text/);
  assert.throws(()=>createVufra({font:Uint8Array.of(0,1,2)})
    .document({title:'ok'}).paragraph('valid').renderSync(),/Font/);
});
test('unbreakable titles and words reject instead of drawing outside page',()=>{
  assert.throws(()=>engine.document({title:'W'.repeat(500)})
    .paragraph('ok').renderSync(),/title exceeds printable width/);
  assert.throws(()=>engine.document({title:'normal'})
    .paragraph('W'.repeat(1200)).renderSync(),/unbreakable text exceeds printable width/);
});
test('indivisible huge image in Fluent row fails rather than clipping',()=>{
  const bytes=readFileSync(new URL('./fixtures/two-tone.png',import.meta.url));
  assert.throws(()=>engine.document({title:'Big image'})
    .row(r=>r.column(c=>c.image(bytes,{width:80,height:900})))
    .renderSync(),/invalid row image|image.*exceeds|row.*height/i);
});
