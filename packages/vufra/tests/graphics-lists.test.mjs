import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const require=createRequire(import.meta.url);
const {renderPdf,renderPdfAsync,PdfRenderQueue}=({...require('../dist/index.js'),...require('../dist/renderer.js')});
const font=readFileSync(process.env.VUFRA_FONT ||
  execFileSync('fc-match',['Noto Sans','-f','%{file}\n'],{encoding:'utf8'}).trim());
const png=readFileSync(new URL('./fixtures/two-tone.png',import.meta.url));
const image={type:'image',data:png,width:180,height:80,fit:'contain'};
function inspect(bytes,raster=false) {
  assert.equal(Buffer.from(bytes).subarray(0,5).toString(),'%PDF-');
  const dir=mkdtempSync(join(tmpdir(),'vufra-unit11-'));
  const file=join(dir,'report.pdf');writeFileSync(file,bytes);
  const info=execFileSync('pdfinfo',[file],{encoding:'utf8'});
  const text=execFileSync('pdftotext',['-layout',file,'-'],{encoding:'utf8'});
  const pages=Number(info.match(/Pages:\s+(\d+)/)?.[1]);
  const imageList=execFileSync('pdfimages',['-list',file],{encoding:'utf8'});
  if(raster)execFileSync('pdftoppm',['-r','72','-f','1','-l','1',file,join(dir,'preview')]);
  return {file,dir,info,text,pages,imageList,firstPage:
    execFileSync('pdftotext',['-f','1','-l','1','-layout',file,'-'],{encoding:'utf8'})};
}
function ppmPixel(filename,x,y) {
  const b=readFileSync(filename);
  let off=0;
  const token=()=>{
    while([9,10,13,32].includes(b[off]))off++;
    let start=off;
    while(![9,10,13,32].includes(b[off]))off++;
    return b.toString('ascii',start,off);
  };
  assert.equal(token(),'P6');
  const w=+token(),h=+token();assert.equal(+token(),255);off++;
  assert.ok(x<w&&y<h);
  return [...b.subarray(off+3*(w*y+x),off+3*(w*y+x)+3)];
}

test('ordered and unordered lists paginate without losing items or repeating tokens',()=>{
  const entries=Array.from({length:120},(_,i)=>'LISTROW'+String(i+1).padStart(4,'0'));
  const doc={title:'Lists',blocks:[
    {type:'heading',level:1,text:'Bullet list'},
    {type:'list',items:entries.slice(0,60)},
    {type:'heading',level:2,text:'Numbered list'},
    {type:'list',ordered:true,items:entries.slice(60)}
  ]};
  const pdf=inspect(renderPdf(doc,font));
  assert.ok(pdf.pages>=3,pdf.pages);
  const found=[...pdf.text.matchAll(/LISTROW(\d{4})/g)].map(m=>+m[1]);
  assert.deepEqual(found,Array.from({length:120},(_,i)=>i+1));
  assert.match(pdf.text,/\b1\.\s+LISTROW0061/);
  assert.match(pdf.text,/\b60\.\s+LISTROW0120/);
});

test('long list item wraps with hanging indentation and resumes across pages',()=>{
  const tokens=Array.from({length:680},(_,i)=>'LONGITEM'+String(i+1).padStart(4,'0'));
  const pdf=inspect(renderPdf({title:'Large list',blocks:[
    {type:'list',ordered:true,items:[tokens.join(' '),'FINALLISTITEM']}
  ]},font));
  assert.ok(pdf.pages>=2,pdf.pages);
  assert.deepEqual([...pdf.text.matchAll(/LONGITEM(\d{4})/g)].map(m=>+m[1]),
    Array.from({length:680},(_,i)=>i+1));
  assert.match(pdf.text,/FINALLISTITEM/);
});

test('colored vector rule and rectangle draw in normal page flow',()=>{
  const out=inspect(renderPdf({title:'Graphics',blocks:[
    {type:'rule',width:150,height:5,color:'#ef2f20'},
    {type:'rectangle',width:95,height:55,color:'#1785da'},
    {type:'paragraph',text:'Graphic flow preserved'}
  ]},font),true);
  assert.equal(out.pages,1);
  assert.match(out.text,/Graphic flow preserved/);
  const img=join(out.dir,'preview-1.ppm');
  const red=ppmPixel(img,60,122);
  const blue=ppmPixel(img,60,150);
  assert.ok(red[0]>180 && red[1]<100 && red[2]<100,JSON.stringify(red));
  assert.ok(blue[2]>blue[0] && blue[2]>blue[1],JSON.stringify(blue));
});

test('keepWithNext default keeps heading and image together, false restores separate pages',()=>{
  const make=(value)=>inspect(renderPdf({
    title:'Keep image',page:{format:'letter'},
    blocks:[{type:'spacer',height:490},{type:'heading',level:2,
      text:'STICKYIMAGETITLE',...(value===undefined?{}:{keepWithNext:value})},
      image,{type:'paragraph',text:'AFTERIMAGE'}]
  },font));
  const kept=make(undefined);
  const separate=make(false);
  assert.equal(kept.pages,2);
  assert.equal(separate.pages,2);
  assert.ok(!kept.firstPage.includes('STICKYIMAGETITLE'));
  assert.ok(separate.firstPage.includes('STICKYIMAGETITLE'));
  assert.match(kept.text,/STICKYIMAGETITLE/);
  assert.match(kept.imageList,/\b160\s+80\b/);
});

test('keepWithNext keeps heading alongside the styled table on next page',()=>{
  const {createVufra}=require('../dist/index.js');
  const out=inspect(createVufra({font}).document({title:'Keep table',page:'Letter'})
    .spacer(555).heading('STICKYTABLETITLE',{level:2,keepWithNext:true})
    .table(Array.from({length:28},(_,i)=>[
      'ID'+String(i+1).padStart(3,'0'),'Item '+i
    ]),{columns:[{title:'SKU',width:110},{title:'Item',width:340}]})
    .renderSync());
  assert.ok(out.pages>=2);
  assert.ok(!out.firstPage.includes('STICKYTABLETITLE'));
  const page2=execFileSync('pdftotext',['-f','2','-l','2','-layout',out.file,'-'],{encoding:'utf8'});
  assert.match(page2,/STICKYTABLETITLE/);
  assert.match(page2,/ID001/);
  assert.deepEqual([...out.text.matchAll(/ID(\d{3})/g)].map(m=>+m[1]),
    Array.from({length:28},(_,i)=>i+1));
});

test('invalid list/graphic values reject clearly and async queue still renders',async()=>{
  const render=block=>renderPdf({title:'Bad input',blocks:[block]},font);
  assert.throws(()=>render({type:'list',items:[]}),/list/);
  assert.throws(()=>render({type:'list',items:['  ']}),/list/);
  assert.throws(()=>render({type:'rule',width:100,height:9}),/graphic/);
  assert.throws(()=>render({type:'rectangle',width:900,height:10}),/graphic/);
  assert.throws(()=>render({type:'rectangle',width:100,height:10,color:'blue'}),/color/);
  assert.throws(()=>render({type:'heading',level:1,text:'Hi',keepWithNext:'yes'}),/keepWithNext/);
  const q=new PdfRenderQueue({maxConcurrent:1,maxQueued:1});
  const pdf=inspect(await q.render({title:'Async graphics',blocks:[
    {type:'list',items:['ASYNC_LIST_ITEM']},
    {type:'rectangle',width:30,height:20,color:'#236fa9'}
  ]},font));
  assert.match(pdf.text,/ASYNC_LIST_ITEM/);
  q.close();
  const direct=inspect(await renderPdfAsync({title:'Async headings',blocks:[
    {type:'heading',level:1,text:'ASYNC HEADING'},
    {type:'rule',width:100,height:2},
  ]},font));
  assert.match(direct.text,/ASYNC HEADING/);
});
