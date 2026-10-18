import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {execFileSync} from 'node:child_process';
import {readFileSync,writeFileSync,mkdtempSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
const req=createRequire(import.meta.url);
const {createVufra}=req('../dist/index.js');
const font=readFileSync(execFileSync('fc-match',['Noto Sans','-f','%{file}\n'],{encoding:'utf8'}).trim());
const app=createVufra({font});
function pdfDetails(bytes){
  const file=join(mkdtempSync(join(tmpdir(),'vufra-anchor-')),'report.pdf');
  writeFileSync(file,bytes);
  const pageCount=Number(execFileSync('pdfinfo',[file],{encoding:'utf8'}).match(/Pages:\s+(\d+)/)[1]);
  const text=execFileSync('pdftotext',['-layout',file,'-'],{encoding:'utf8'});
  const bbox=execFileSync('pdftotext',['-bbox',file,'-'],{encoding:'utf8'});
  const xmlPrefix=file.slice(0,-4);
  execFileSync('pdftohtml',['-xml','-hidden','-i',file,xmlPrefix],{encoding:'utf8'});
  const xml=readFileSync(xmlPrefix+'.xml','utf8');
  // Krilla writes uncompressed PDF objects; extract actual XYZ /Dest from the
  // annotation rather than assuming that a printed page number is a link.
  const raw=Buffer.from(bytes).toString('latin1');
  function destination(label){
    const annotation=raw.match(new RegExp('/Dest (\\d+) 0 R/F 4/Contents\\(Go to '+label+'\\)'));
    assert.ok(annotation,'missing PDF annotation for '+label);
    const object=raw.match(new RegExp('(?:^|\\n)'+annotation[1]+' 0 obj\\s*\\[(\\d+) 0 R/XYZ ([\\d.]+) ([\\d.]+) 0\\]','m'));
    assert.ok(object,'missing native XYZ coordinates for '+label);
    return {pageObject:+object[1],x:+object[2],yBottom:+object[3]};
  }
  function word(name){
    const match=bbox.match(new RegExp('<word xMin="([\\d.]+)" yMin="([\\d.]+)" xMax="([\\d.]+)" yMax="([\\d.]+)">'+name+'</word>'));
    assert.ok(match,'missing bbox word '+name);
    return {x:+match[1],y:+match[2]};
  }
  return {file,pageCount,text,xml,destination,word};
}

test('an anchor links to the precise native Y of a heading halfway down a page, not the page top',async()=>{
  const document=app.document({page:'Letter',title:'Precise anchors'})
    .linkTo('totals','JUMP_EXACT')
    .paragraph('BEFORE_ANCHOR')
    .spacer(168)
    .anchor('totals',s=>s.heading('ANCHORED_TOTALS').paragraph('AFTER_ANCHOR'))
    .paragraph('END_OF_REPORT');
  const blocks=document.toDocument().blocks;
  assert.equal(blocks[0].type,'page-reference');
  assert.equal(blocks[0].targetBlock,3);
  const result=pdfDetails(document.renderSync());
  assert.equal(result.pageCount,1);
  assert.match(result.xml,/<a href="[^"]*#1">JUMP_EXACT<\/a>/);
  const link=result.destination('JUMP_EXACT');
  const target=result.word('ANCHORED_TOTALS');
  const pageHeight=792;
  const anchorY=pageHeight-link.yBottom;
  assert.ok(anchorY>300,'target is in the middle of the page, not the margin');
  assert.ok(Math.abs(anchorY-target.y)<16,'destination matches native glyph position');
  assert.doesNotMatch(result.xml,/<outline>/,'ordinary anchors do not invent chapter bookmarks');
  const asyncResult=pdfDetails(await document.render());
  assert.deepEqual(asyncResult.destination('JUMP_EXACT'),link);
});

test('chapter, TOC and named anchors retain targets after TOC expansion and multi-page reflow',()=>{
  const columns=[{title:'REF',width:'50%'},{title:'AMOUNT',width:'50%'}];
  const rows=Array.from({length:80},(_,i)=>['ROW_'+String(i+1).padStart(3,'0'),'$10']);
  const build=(extra)=>app.document({page:'Letter'})
    .tableOfContents('CHAPTER_LIST')
    .linkTo('itemSummary','JUMP_SUMMARY')
    .pageSection({title:'First chapter'},b=>b
      .heading('FIRST_CHAPTER').table(rows.slice(0,extra),{columns}))
    .anchor('itemSummary',b=>b.heading('SUMMARY_TARGET').paragraph('SUMMARY_DATA'))
    .pageSection({title:'Last chapter'},b=>b.heading('LAST_CHAPTER'));
  const small=pdfDetails(build(15).renderSync()),large=pdfDetails(build(80).renderSync());
  for(const result of [small,large]){
    const summaryPage=result.text.split('\f').findIndex(x=>x.includes('SUMMARY_TARGET'))+1;
    assert.ok(summaryPage>0);
    assert.match(result.xml,new RegExp('<a href="[^"]*#'+summaryPage+'">JUMP_SUMMARY<\\/a>'));
    const index=result.text.indexOf('First chapter');
    assert.ok(index>=0);
    assert.equal((result.text.match(/SUMMARY_TARGET/g)??[]).length,1);
  }
  assert.ok(large.pageCount>small.pageCount);
  assert.notEqual(small.destination('JUMP_SUMMARY').pageObject,large.destination('JUMP_SUMMARY').pageObject);
});

test('anchor syntax rejects duplicates, missing targets, empty callbacks and malformed names',()=>{
  assert.throws(()=>app.document().anchor('bad id',b=>b.heading('TEXT')),/anchor id/);
  assert.throws(()=>app.document().anchor('id',b=>{}),/visible content/);
  assert.throws(()=>app.document().anchor('id',b=>b.pageBreak()),/visible content/);
  assert.throws(()=>app.document().anchor('same',b=>b.heading('ONE'))
    .anchor('same',b=>b.heading('TWO')),/duplicate anchor/);
  assert.throws(()=>app.document().linkTo('missing','GO').toDocument(),/requires exactly one anchor/);
  assert.throws(()=>app.document().linkTo('bad id'),/valid anchor id/);
  assert.throws(()=>app.document().linkTo('valid','X'.repeat(65)),/64-character/);
  const original=app.document().linkTo('target','CLICK').anchor('target',b=>b.heading('VALID'));
  const altered=original.toDocument();
  altered.blocks[0].targetBlock=9999;
  const {renderPdf}=req('../dist/renderer.js');
  assert.throws(()=>renderPdf(altered,font),/target block/);
});
