import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const require=createRequire(import.meta.url);
const {renderPdf,renderPdfAsync,PdfRenderQueue}=require('../dist/index.js');
const locate=family=>execFileSync('fc-match',[family,'-f','%{file}\n'],{encoding:'utf8'}).trim();
const regular=readFileSync(process.env.VUFRA_FONT || locate('Noto Sans'));
const bold=readFileSync(locate('Noto Sans:style=Bold'));
const italic=readFileSync(locate('Noto Sans:style=Italic'));
const serif=readFileSync(locate('Noto Serif'));
const faces=()=>({bold,italic,serif});
function inspect(bytes) {
  assert.equal(Buffer.from(bytes).subarray(0,5).toString(),'%PDF-');
  const dir=mkdtempSync(join(tmpdir(),'vufra-rich-'));
  const pdf=join(dir,'report.pdf');writeFileSync(pdf,bytes);
  return {pdf,
    pages:Number(execFileSync('pdfinfo',[pdf],{encoding:'utf8'}).match(/Pages:\s+(\d+)/)[1]),
    text:execFileSync('pdftotext',['-layout',pdf,'-'],{encoding:'utf8'}),
    fonts:execFileSync('pdffonts',[pdf],{encoding:'utf8'}),
    bbox:execFileSync('pdftotext',['-bbox',pdf,'-'],{encoding:'utf8'})
  };
}
const p=runs=>({type:'rich-paragraph',runs});
test('real regular, bold, italic and serif face files embed in PDF and keep text order',()=>{
  const doc={title:'Multiple fonts',fontFaces:faces(),blocks:[
    {type:'heading',level:2,text:'Prueba tipográfica'},
    p([{text:'NORMAL '},{text:'BOLD ',font:'bold'},
      {text:'ITALIC ',font:'italic'},{text:'SERIF ',font:'serif'},
      {text:'ESPAÑOL CANCÚN' }])
  ]};
  const out=inspect(renderPdf(doc,regular));
  assert.equal(out.pages,1);
  for(const expected of ['NotoSans-Regular','NotoSans-Bold','NotoSans-Italic','NotoSerif-Regular']){
    assert.ok(out.fonts.includes(expected),expected+' was not embedded: '+out.fonts);
  }
  assert.match(out.text,/NORMAL BOLD ITALIC SERIF ESPAÑOL CANCÚN/);
  assert.equal(out.fonts.split('\n').filter(x=>x.includes('Noto')&&/\byes\s+yes\s+yes\b/.test(x)).length,4);
});

test('hundreds of alternating runs wrap and continue through many pages without lost tokens',()=>{
  const runs=Array.from({length:700},(_,i)=>({
    text:'RICH'+String(i+1).padStart(4,'0')+' ',
    font:['bold','italic','serif','regular'][i%4]
  }));
  runs[310].text+='\n';
  const out=inspect(renderPdf({title:'Long rich report',fontFaces:faces(),
    blocks:[{type:'rich-paragraph',runs,style:{fontSize:13,lineHeight:20,
      spaceBefore:8,spaceAfter:8}},{type:'paragraph',text:'FINALRICHMARKER'}]
  },regular));
  assert.ok(out.pages>=3,out.pages);
  assert.deepEqual([...out.text.matchAll(/RICH(\d{4})/g)].map(m=>+m[1]),
    Array.from({length:700},(_,i)=>i+1));
  assert.match(out.text,/FINALRICHMARKER/);
});

test('mixed faces keep words inside printable bounds and avoid overlaps',()=>{
  const runs=Array.from({length:100},(_,i)=>({
    text:['Contra','Informe','México','valor','evidencia','revisión'][i%6]+' ',
    font:['regular','bold','italic','serif'][i%4]
  }));
  const out=inspect(renderPdf({title:'Bounds check',fontFaces:faces(),
    page:{format:'letter',margins:{top:140,bottom:70,left:80,right:70}},
    blocks:[{type:'rich-paragraph',runs,style:{fontSize:12,lineHeight:20,spaceBefore:5,spaceAfter:5}}]
  },regular));
  const matches=[...out.bbox.matchAll(/<word xMin="([\d.]+)" yMin="([\d.]+)" xMax="([\d.]+)" yMax="([\d.]+)">([^<]+)<\/word>/g)]
    .filter(m=>/Contra|Informe|M[eé]xico|valor|evidencia|revisi[oó]n/.test(m[5]));
  assert.equal(matches.length,100);
  assert.ok(matches.every(m=>Number(m[1])>=79.7 && Number(m[3])<=542.3),
    'rich tokens overflow printable area');
  const grouped=new Map();
  for(const m of matches){
    const key=Math.round(Number(m[2])/4)*4;
    if(!grouped.has(key)) grouped.set(key,[]);
    grouped.get(key).push([Number(m[1]),Number(m[3])]);
  }
  for(const line of grouped.values()){
    line.sort((a,b)=>a[0]-b[0]);
    for(let i=1;i<line.length;i++) assert.ok(line[i][0]>=line[i-1][1]-1.0,
      'two rich fragments overlap horizontally');
  }
});

test('errors are explicit for unknown faces, invalid bytes, duplicate identifiers and too many fonts',()=>{
  const doc=opts=>({title:'Invalid rich',blocks:[p([{text:'Hello',font:'bold'}])],...opts});
  assert.throws(()=>renderPdf(doc({}),regular),/unknown font face/);
  assert.throws(()=>renderPdf(doc({fontFaces:{bold:Uint8Array.of(0,1,2)}}),regular),/Font/);
  assert.throws(()=>renderPdf(doc({fontFaces:{regular:bold}}),regular),/fontFaces names/);
  assert.throws(()=>renderPdf(doc({fontFaces:{'bad name':bold}}),regular),/fontFaces names/);
  assert.throws(()=>renderPdf(doc({fontFaces:{bold:Buffer.alloc(12*1024*1024+1)}}),regular),/fontFaces/);
  assert.throws(()=>renderPdf(doc({fontFaces:Object.fromEntries(
    Array.from({length:7},(_,i)=>['face'+i,serif]))}),regular),/maximum of six/);
  assert.throws(()=>renderPdf({title:'No text',blocks:[p([])]},regular),/rich-paragraph/);
  assert.throws(()=>renderPdf({title:'Unbreakable',fontFaces:faces(),
    blocks:[p([{text:'W'.repeat(400),font:'bold'}])]},regular),/unbreakable token/);
});

test('async and queue render rich text safely even when caller mutates font buffers',async()=>{
  const extraBold=Buffer.from(bold);
  const q=new PdfRenderQueue({maxConcurrent:1,maxQueued:1});
  const first=q.render({title:'Long job',rows:Array.from({length:6500},(_,i)=>'LOAD'+i)},regular);
  const doc={title:'Snapshot face',fontFaces:{bold:extraBold},
    blocks:[p([{text:'FONTSNAPSHOT ',font:'bold'},{text:'REMAINS ORIGINAL'}])]};
  const waiting=q.render(doc,regular);
  assert.equal(q.stats.queued,1);
  assert.ok(q.stats.queuedBytes > extraBold.byteLength);
  assert.ok(q.stats.queuedBytes < 2*regular.byteLength+extraBold.byteLength+30000,
    'font face bytes should not be JSON-expanded');
  extraBold.fill(0);
  doc.blocks[0].runs[0].text='CHANGED';
  await first;
  const queued=inspect(await waiting);
  assert.match(queued.text,/FONTSNAPSHOT REMAINS ORIGINAL/);
  assert.match(queued.fonts,/NotoSans-Bold/);
  q.close();
  const direct=inspect(await renderPdfAsync({title:'Async rich',fontFaces:faces(),
    blocks:[p([{text:'ASYNCTEXT ',font:'italic'},{text:'works'}])]},regular));
  assert.match(direct.text,/ASYNCTEXT works/);
});
