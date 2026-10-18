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
function inspect(bytes){
 const file=join(mkdtempSync(join(tmpdir(),'vufra-mixed-')),'report.pdf');
 writeFileSync(file,bytes);
 const metadata=execFileSync('pdfinfo',['-f','1','-l','100','-box',file],{encoding:'utf8'});
 const pages=Number(metadata.match(/Pages:\s+(\d+)/)[1]);
 const texts=Array.from({length:pages},(_,i)=>execFileSync('pdftotext',
  ['-layout','-f',String(i+1),'-l',String(i+1),file,'-'],{encoding:'utf8'}));
 const bbox=execFileSync('pdftotext',['-bbox',file,'-'],{encoding:'utf8'});
 const dimensions=[...metadata.matchAll(/Page\s+(\d+) size:\s+([\d.]+) x ([\d.]+) pts/g)]
  .map(m=>({page:+m[1],width:+m[2],height:+m[3]}));
 function word(name){const m=bbox.match(new RegExp('<word xMin="([\\d.]+)" yMin="([\\d.]+)" xMax="([\\d.]+)" yMax="([\\d.]+)">'+name+'</word>'));assert.ok(m,name);return {x:+m[1],y:+m[2]};}
 function pageOf(label){const p=texts.findIndex(t=>t.includes(label));assert.ok(p>=0,label);return p+1;}
 return {file,pages,texts,dimensions,word,pageOf};
}
const cols=[{title:'MOVEMENT',width:'54%'},{title:'AMOUNT',width:'46%',align:'right'}];
const rows=(name,n)=>Array.from({length:n},(_,i)=>[name+'_'+String(i+1).padStart(3,'0'),'$'+i]);

test('A4 cover, Letter tables and custom landscape chapter each use their own real MediaBox and margins',async()=>{
 const doc=app.document({page:'A4',title:'Mixed geometry'})
  .coverPage({padding:16,minHeight:240},b=>b.heading('COVER_A4'))
  .tableOfContents('INDEX_ALL')
  .linkTo('midway','MIDWAY_LINK')
  .pageSection({title:'Letter department',page:'Letter',
    header:h=>h.text('LETTER_BAND_{{page}}')},b=>b
     .heading('LETTER_CHAPTER').table(rows('LETTERROW',112),{columns:cols}))
  .anchor('midway',b=>b.heading('MIDWAY_TARGET').paragraph('A real named destination'))
  .pageSection({title:'Landscape report',page:{width:920,height:520,
      margins:{left:92,right:30,top:122,bottom:62}},
    header:h=>h.text('LANDSCAPE_BAND_{{page}}')},b=>b
     .heading('LANDSCAPE_CHAPTER').table(rows('WIDEROW',85),{columns:cols}));
 const tree=doc.toDocument();
 assert.equal(tree.pageMasters.length,2);
 assert.equal(tree.pageMasters[0].page.format,'letter');
 assert.equal(tree.pageMasters[1].page.width,920);
 const bytes=doc.renderSync();
 const output=inspect(bytes);
 assert.ok(output.pages>=6);
 const letterPage=output.pageOf('LETTER_CHAPTER'),landscapePage=output.pageOf('LANDSCAPE_CHAPTER');
 assert.equal(output.pageOf('COVER_A4'),1);
 assert.ok(letterPage>=3 && landscapePage>letterPage+1);
 assert.equal(output.dimensions.length,output.pages);
 for(const {page,width,height} of output.dimensions){
   const expectSize=page<letterPage?[595,842]:page<landscapePage?[612,792]:[920,520];
   assert.deepEqual([width,height],expectSize,'MediaBox page '+page);
 }
 assert.ok(Math.abs(output.word('LANDSCAPE_CHAPTER').x-92)<1);
 assert.ok(Math.abs(output.word('LETTER_CHAPTER').x-49)<1);
 assert.equal((output.texts.join('').match(/MIDWAY_TARGET/g)??[]).length,1);
 for(const [prefix,count] of [['LETTERROW',112],['WIDEROW',85]]){
  assert.deepEqual([...output.texts.join('').matchAll(new RegExp(prefix+'_(\\d{3})','g'))].map(m=>+m[1]),
    Array.from({length:count},(_,i)=>i+1));
 }
 assert.match(output.texts[1],new RegExp('Letter department\\s+'+letterPage));
 assert.match(output.texts[1],new RegExp('Landscape report\\s+'+landscapePage));
 const xmlRoot=join(mkdtempSync(join(tmpdir(),'vufra-mixed-nav-')),'nav');
 execFileSync('pdftohtml',['-xml','-hidden','-i','-f','2','-l','2',output.file,xmlRoot]);
 const xml=readFileSync(xmlRoot+'.xml','utf8');
 assert.match(xml,new RegExp('href="[^"]*#'+output.pageOf('MIDWAY_TARGET')+'">MIDWAY_LINK</a>'));
 assert.match(xml,new RegExp(`<item page="${landscapePage}">Landscape report</item>`));
 // Page-specific destination /XYZ must use the *target* page's physical
 // height, not the A4 cover's height or the landscape section's margins.
 const pdfSource=Buffer.from(bytes).toString('latin1');
 const annotation=pdfSource.match(/\/Dest (\d+) 0 R\/F 4\/Contents\(Go to MIDWAY_LINK\)/);
 assert.ok(annotation,'PDF link annotation must exist');
 const dest=pdfSource.match(new RegExp('(?:^|\\n)'+annotation[1]+' 0 obj\\s*\\[(\\d+) 0 R/XYZ ([\\d.]+) ([\\d.]+) 0\\]','m'));
 assert.ok(dest,'real PDF XYZ destination must exist');
 const targetPage=output.pageOf('MIDWAY_TARGET');
 const targetBoxes=execFileSync('pdftotext',['-bbox','-f',String(targetPage),'-l',String(targetPage),output.file,'-'],{encoding:'utf8'});
 const title=targetBoxes.match(/<word xMin="([\d.]+)" yMin="([\d.]+)"[^>]*>MIDWAY_TARGET<\/word>/);
 assert.ok(title);
 const targetSize=output.dimensions[targetPage-1];
 assert.equal(targetSize.height,792);
 assert.ok(Math.abs((targetSize.height-Number(dest[3]))-Number(title[2]))<16);
 assert.ok(Math.abs(Number(dest[2])-49)<1);
 assert.deepEqual(inspect(await doc.render()).texts,output.texts);
});

test('per-chapter width participates in TS compiled table tracks and Rust line wrapping',()=>{
 const narrow=app.document({page:'Letter'})
  .pageSection({title:'Narrow',page:{width:420,height:780,
    margins:{left:35,right:35,top:120,bottom:55}}},b=>b
    .heading('NARROW_CHAPTER').table(rows('NARROW',35),{columns:cols}))
  .pageSection({title:'Wide',page:{width:850,height:780,
    margins:{left:35,right:35,top:120,bottom:55}}},b=>b
    .heading('WIDE_CHAPTER').table(rows('WIDE',35),{columns:cols}));
 const result=inspect(narrow.renderSync());
 const n=result.pageOf('NARROW_CHAPTER'),w=result.pageOf('WIDE_CHAPTER');
 assert.deepEqual([result.dimensions[n-1].width,result.dimensions[w-1].width],[420,850]);
 const snap=narrow.toDocument();
 const first=snap.blocks.find(b=>b.type==='box');
 const later=snap.blocks.filter(b=>b.type==='box').at(-1);
 assert.ok(first.box.items[0].table.header.columns[0].width<later.box.items[0].table.header.columns[0].width);
 assert.deepEqual([...result.texts.join('').matchAll(/WIDE_(\d{3})/g)].map(m=>+m[1]),Array.from({length:35},(_,i)=>i+1));
});

test('invalid section pages, even if forged in a raw document, must fail rather than corrupt mixed pages',()=>{
 assert.throws(()=>app.document().pageSection({page:{width:200,height:780}},b=>b.heading('BAD')),/page geometry/);
 const {renderPdf}=require('../dist/renderer.js');
 const snapshot=app.document().pageSection({title:'OK',page:'Letter'},b=>b.heading('HELLO')).toDocument();
 snapshot.pageMasters[0].page={width:410,height:410,margins:{top:300,bottom:200}};
 assert.throws(()=>renderPdf(snapshot,font),/page geometry|margins/);
});

test('content appended after a landscape pageSection inherits its live geometry',()=>{
 const wide=app.document({page:'A4'})
  .pageSection({title:'Landscape',page:{width:900,height:550,
    margins:{top:125,bottom:55,left:100,right:40}}},b=>b.heading('LANDSCAPE_OPENING'))
  .table(rows('AFTER_SECTION',45),{columns:cols});
 const snapshot=wide.toDocument();
 const table=snapshot.blocks.find(b=>b.type==='box').box.items[0].table;
 const expected=(900-100-40)*0.54;
 assert.ok(Math.abs(table.header.columns[0].width-expected)<1);
 const out=inspect(wide.renderSync());
 assert.deepEqual(out.dimensions.map(({width,height})=>[width,height]),
   out.dimensions.map(()=>[900,550]));
 assert.deepEqual([...out.texts.join('').matchAll(/AFTER_SECTION_(\d{3})/g)].map(m=>+m[1]),
   Array.from({length:45},(_,i)=>i+1));
});


test('section pages retain an immutable snapshot when a caller later mutates margin options',()=>{
 const options={width:900,height:520,margins:{left:95,right:33,top:125,bottom:55}};
 const created=app.document({page:'A4'}).pageSection({title:'Snapshot',page:options},b=>b.heading('SNAPSHOT')).paragraph('AFTER_SNAPSHOT');
 options.width=410;options.margins.left=35;
 const snapshot=created.toDocument();
 assert.equal(snapshot.pageMasters[0].page.width,900);
 assert.equal(snapshot.pageMasters[0].page.margins.left,95);
 const output=inspect(created.renderSync());
 assert.equal(output.dimensions[0].width,900);
 assert.ok(Math.abs(output.word('SNAPSHOT').x-95)<1);
});

test('default title is rejected on a narrow section instead of drawing outside its margins',()=>{
 const title='WIDE_TITLE_'.repeat(4);
 const pdf=app.document({page:'Letter',title})
   .pageSection({page:{width:350,height:780,
      margins:{left:50,right:50,top:120,bottom:55}}},b=>b.paragraph('NARROW_REPORT'));
 assert.throws(()=>pdf.renderSync(),/document title exceeds section printable width/);
});
