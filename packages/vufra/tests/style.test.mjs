import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const require = createRequire(import.meta.url);
const { renderPdf } = require('../dist/index.js');
const font = readFileSync(process.env.VUFRA_FONT ||
  execFileSync('fc-match', ['Noto Sans', '-f', '%{file}\n'], {encoding:'utf8'}).trim());

function inspect(document) {
  const dir = mkdtempSync(join(tmpdir(), 'vufra-style-'));
  const path = join(dir, 'generated.pdf');
  const bytes = renderPdf(document, font);
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

test('Letter preset renders 612x792, with semantic heading and custom styled text', () => {
  const result = inspect({
    title:'Vufra Letter',
    page:{format:'letter'},
    blocks:[
      {type:'heading',level:1,text:'CABECERAUNO'},
      {type:'heading',level:2,text:'CABECERADOS'},
      {type:'styled-paragraph',text:'CUERPOBASICO',style:{fontSize:10,lineHeight:15,spaceBefore:10,spaceAfter:6}},
      {type:'table',table:{
        columns:[{header:'Clave',width:110},{header:'Descripción',width:280}],
        rows:[['L-001','Conserva tablas en Letter']],
      }},
    ],
  });
  assert.match(result.info, /Page size:\s+612 x 792 pts/);
  assert.equal(result.pages,1);
  assert.ok(result.text.includes('L-001'));
  assert.ok(word(result.bbox, 'CABECERAUNO').height > word(result.bbox,'CABECERADOS').height);
  assert.ok(word(result.bbox, 'CABECERADOS').height > word(result.bbox,'CUERPOBASICO').height);
});

test('custom page dimensions and margins position content correctly', () => {
  const custom = inspect({
    title:'Vufra geometría',
    page:{width:470,height:660,margins:{top:150,bottom:70,left:75,right:55}},
    blocks:[
      {type:'heading',level:3,text:'MARCADORUNO'},
      {type:'spacer',height:45},
      {type:'paragraph',text:'MARCADORDOS'},
      {type:'table',table:{
        columns:[{header:'ID',width:90},{header:'Concepto',width:200}],
        rows:[['X-001','Texto en márgenes personalizados']],
      }},
    ],
  });
  assert.match(custom.info,/Page size:\s+470 x 660 pts/);
  assert.equal(custom.pages,1);
  const h = word(custom.bbox,'MARCADORUNO');
  const p = word(custom.bbox,'MARCADORDOS');
  assert.ok(h.left >= 74,JSON.stringify(h));
  assert.ok(p.top > h.bottom + 40,JSON.stringify({h,p}));
  assert.ok(custom.text.includes('X-001'));
});

test('a smaller printable area changes pagination but preserves table rows', () => {
  const rows = Array.from({length:130},(_,i)=>['ID'+String(i+1).padStart(4,'0'),'Cancún, producto de prueba '+(i+1)]);
  const blocks=[
    {type:'heading',level:2,text:'CATALOGO'},
    {type:'table',table:{columns:[{header:'ID',width:100},{header:'Concepto',width:230}],rows}}
  ];
  const a4 = inspect({title:'Vufra',page:{format:'a4'},blocks});
  const small = inspect({title:'Vufra',page:{width:390,height:490,margins:{top:120,bottom:70,left:30,right:30}},blocks});
  assert.ok(small.pages > a4.pages,JSON.stringify({small:small.pages,a4:a4.pages}));
  for (const result of [a4,small]) {
    const ids=[...result.text.matchAll(/ID(\d{4})/g)].map(m=>+m[1]);
    assert.deepEqual(ids,Array.from({length:130},(_,i)=>i+1));
  }
});

test('wide custom pages allow wider tables than fixed A4 page width', () => {
  const result = inspect({
    title:'Ancho configurable',
    page:{width:770,height:850,margins:{left:60,right:60,top:130,bottom:70}},
    blocks:[{type:'table',table:{
      columns:[{header:'Identificador',width:180},{header:'Descripción extendida',width:410}],
      rows:[['XYZ-01','Contenido sobre papel ancho']]
    }}],
  });
  assert.match(result.info,/Page size:\s+770 x 850 pts/);
  assert.equal(result.pages,1);
  assert.ok(result.text.includes('XYZ-01'));
});

test('invalid geometry, spacers, heading levels and style values are rejected', () => {
  const build=(page,blocks=[{type:'paragraph',text:'valid'}]) =>
    renderPdf({title:'Valid',page,blocks},font);
  assert.throws(()=>build({width:300}),/both width and height/);
  assert.throws(()=>build({format:'tabloid'}),/format/);
  assert.throws(()=>build({format:'a4',margins:{top:800}}),/geometry/);
  assert.throws(()=>build({format:'a4',margins:{left:NaN}}),/geometry/);
  assert.throws(()=>build({format:'a4'},[{type:'heading',level:4,text:'bad'}]),/flow block/);
  assert.throws(()=>build({format:'a4'},[{type:'spacer',height:0}]),/flow block/);
  assert.throws(()=>build({format:'a4'},[{type:'spacer',height:900}]),/pagination failed/i);
  assert.throws(()=>build({format:'a4'},[{type:'styled-paragraph',text:'bad',style:{fontSize:75}}]),/style/);
  assert.throws(()=>renderPdf({title:'Old mode',paragraphs:['x'],page:{format:'letter'}},font),/requires blocks mode/);
});

test('preserves defaults for block paragraphs when no new options are passed', () => {
  const result=inspect({title:'Vufra',blocks:[
    {type:'paragraph',text:'DEFAULTONE'},
    {type:'spacer',height:24},
    {type:'paragraph',text:'DEFAULTTWO'},
  ]});
  assert.match(result.info,/Page size:\s+595 x 842 pts/);
  assert.equal(result.pages,1);
  assert.ok(word(result.bbox,'DEFAULTTWO').top > word(result.bbox,'DEFAULTONE').bottom + 20);
});
