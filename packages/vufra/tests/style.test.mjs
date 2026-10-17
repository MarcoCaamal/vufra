import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const require = createRequire(import.meta.url);
const {createVufra} = require('../dist/index.js');
const font = readFileSync(process.env.VUFRA_FONT ||
  execFileSync('fc-match', ['Noto Sans', '-f', '%{file}\n'], {encoding:'utf8'}).trim());

function inspect(document) {
  const dir = mkdtempSync(join(tmpdir(), 'vufra-style-'));
  const path = join(dir, 'generated.pdf');
  const bytes = document.renderSync();
  writeFileSync(path, bytes);
  return {
    pages: Number(execFileSync('pdfinfo', [path], {encoding:'utf8'}).match(/Pages:\s+(\d+)/)[1]),
    info: execFileSync('pdfinfo', [path], {encoding:'utf8'}),
    text: execFileSync('pdftotext', ['-layout', path, '-'], {encoding:'utf8'}),
    bbox: execFileSync('pdftotext', ['-bbox', path, '-'], {encoding:'utf8'}),
  };
}
function word(html, word) {
  const escaped = word.replace(/[.*+?^$\x7B\x7D()|[\]\\]/g, '\\$&');
  const match = html.match(new RegExp('<word xMin="([^"]+)" yMin="([^"]+)" xMax="([^"]+)" yMax="([^"]+)">' + escaped + '</word>'));
  assert.ok(match, 'word not found: ' + word);
  return {left:+match[1], top:+match[2], right:+match[3], bottom:+match[4],
    height:+match[4] - +match[2]};
}

const app=createVufra({font});
const cols=[{title:'Clave',width:'30%'},{title:'Descripción',width:'70%'}];
test('Letter renders correct page and proportional semantic typography',()=>{
 const out=inspect(app.document({title:'Letter',page:'Letter'})
  .heading('CABECERAUNO',{level:1})
  .heading('CABECERADOS',{level:2})
  .paragraph('CUERPOBASICO',{fontSize:10,lineHeight:15})
  .table([['L-001','Tabla enriquecida en Letter']],{columns:cols}));
 assert.match(out.info,/Page size:\s+612 x 792 pts/);
 assert.equal(out.pages,1);
 assert.match(out.text,/L-001/);
 assert.ok(word(out.bbox,'CABECERAUNO').height>word(out.bbox,'CABECERADOS').height);
});
test('custom dimensions and margins position content',()=>{
 const out=inspect(app.document({title:'Custom',page:{width:470,height:660},
  margins:{top:150,bottom:70,left:75,right:55}})
  .heading('MARCADORUNO',{level:3}).spacer(45).paragraph('MARCADORDOS')
  .table([['X-001','Interior']],{columns:cols}));
 assert.match(out.info,/Page size:\s+470 x 660 pts/);
 const h=word(out.bbox,'MARCADORUNO'),p=word(out.bbox,'MARCADORDOS');
 assert.ok(h.left>=74);
 assert.ok(p.top>h.bottom+40);
 assert.match(out.text,/X-001/);
});
test('small page increases table pagination without losing IDs',()=>{
 const rows=Array.from({length:130},(_,i)=>[
  'ID'+String(i+1).padStart(4,'0'),'Cancún producto '+(i+1)]);
 const a4=inspect(app.document({title:'Catalog',page:'A4'}).table(rows,{columns:cols}));
 const small=inspect(app.document({title:'Catalog',page:{width:390,height:490},
  margins:{top:120,bottom:70,left:30,right:30}}).table(rows,{columns:cols}));
 assert.ok(small.pages>a4.pages);
 for(const out of [a4,small])
  assert.deepEqual([...out.text.matchAll(/ID(\d{4})/g)].map(m=>+m[1]),
   Array.from({length:130},(_,i)=>i+1));
});
test('wide custom page supports wide styled tables',()=>{
 const out=inspect(app.document({title:'Wide',page:{width:770,height:850},
  margins:{left:60,right:60,top:130,bottom:70}})
 .table([['XYZ-01','Content']],{columns:[
  {title:'Identificador',width:180},{title:'Descripción',width:410}]}));
 assert.match(out.info,/Page size:\s+770 x 850 pts/);
 assert.match(out.text,/XYZ-01/);
});
test('invalid geometry and style reject before painting',()=>{
 assert.throws(()=>app.document({title:'Valid',page:{width:300}})
  .paragraph('ok').renderSync(),/width|dimensions/);
 assert.throws(()=>app.document({title:'Valid',page:{width:400,height:500},
  margins:{top:800}}).paragraph('ok').renderSync(),/geometry/);
 assert.throws(()=>app.document({title:'Valid'}).heading('bad',{level:4}),/heading level/);
 assert.throws(()=>app.document({title:'Valid'}).paragraph('bad',{fontSize:75})
  .renderSync(),/fontSize|style|font/i);
});
test('default paragraph and spacer preserve spacing',()=>{
 const out=inspect(app.document({title:'Vufra'})
  .paragraph('DEFAULTONE').spacer(24).paragraph('DEFAULTTWO'));
 assert.match(out.info,/Page size:\s+595 x 842 pts/);
 assert.equal(out.pages,1);
 assert.ok(word(out.bbox,'DEFAULTTWO').top>word(out.bbox,'DEFAULTONE').bottom+20);
});
