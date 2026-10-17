import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFileSync,writeFileSync,mkdtempSync,rmSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
const require=createRequire(import.meta.url);
const {createVufra}=require('../dist/index.js');
const font=readFileSync(execFileSync('fc-match',
 ['Noto Sans','-f','%{file}\n'],{encoding:'utf8'}).trim());
const bold=readFileSync(execFileSync('fc-match',
 ['Noto Sans:style=Bold','-f','%{file}\n'],{encoding:'utf8'}).trim());
const png=readFileSync(new URL('./fixtures/two-tone.png',import.meta.url));
const app=createVufra({font,fonts:{bold}});
function inspect(bytes){
 const dir=mkdtempSync(join(tmpdir(),'vufra-pagination-separators-'));
 try{
  const path=join(dir,'out.pdf');writeFileSync(path,bytes);
  const info=execFileSync('pdfinfo',[path],{encoding:'utf8'});
  const count=Number(info.match(/Pages:\s+(\d+)/)[1]);
  const pages=Array.from({length:count},(_,i)=>{
    const page=String(i+1);
    return execFileSync('pdftotext',['-raw','-f',page,'-l',page,path,'-'],
      {encoding:'utf8'});
  });
  const bbox=execFileSync('pdftotext',['-bbox',path,'-'],{encoding:'utf8'});
  const pageBlocks=[...bbox.matchAll(/<page\b[^>]*>([\s\S]*?)<\/page>/g)];
  const words=pageBlocks.map((block)=>[...block[1].matchAll(
    /<word xMin="([\d.]+)" yMin="([\d.]+)" xMax="([\d.]+)" yMax="([\d.]+)">([^<]+)<\/word>/g
  )].map(m=>({x:+m[1],y:+m[2],end:+m[4],text:m[5]})));
  return {pages,words,count,raw:pages.join('\n')};
 }finally{rmSync(dir,{recursive:true,force:true})}
}
function find(out,token){
 for(let p=0;p<out.words.length;p++){
  const entry=out.words[p].find(x=>x.text===token);
  if(entry)return {page:p+1,...entry};
 }
 assert.fail('PDF does not contain '+token);
}
test('heading + spacer keeps its image on same page, including styled headings',()=>{
 const make=(keepWithNext)=>app.document({page:'Letter'})
  .spacer(485)
  .heading('PHOTO_SECTION',{level:2,bold:true,color:'#17497C',keepWithNext})
  .spacer(13).image(png,{width:160,height:80}).paragraph('CAPTION_MARKER');
 const kept=inspect(make(true).renderSync());
 const separated=inspect(make(false).renderSync());
 assert.equal(kept.count,2);
 assert.equal(find(kept,'PHOTO_SECTION').page,2);
 assert.equal(find(kept,'CAPTION_MARKER').page,2);
 assert.equal(find(separated,'PHOTO_SECTION').page,1,
  'turning off keepWithNext explicitly should permit orphaned heading');
 assert.equal(find(separated,'CAPTION_MARKER').page,2);
});
test('titled sections with spacer preserve table heading and first data row together',()=>{
 const doc=app.document({page:'Letter'}).spacer(485)
  .section('ACCOUNT_SECTION',s=>s.spacer(13).table(
   Array.from({length:8},(_,i)=>[
     'ACCOUNT_'+String(i+1).padStart(3,'0'),
     'MXN '+(100+i)
   ]),
   {columns:[{title:'ACCOUNT',width:180},{title:'AMOUNT',width:220}]}
  ));
 const out=inspect(doc.renderSync());
 assert.equal(out.count,2);
 assert.equal(find(out,'ACCOUNT_SECTION').page,2);
 assert.equal(find(out,'ACCOUNT_001').page,2);
 const ids=[...out.raw.matchAll(/ACCOUNT_(\d{3})/g)].map(m=>+m[1]);
 assert.deepEqual(ids,Array.from({length:8},(_,i)=>i+1));
});
test('soft separator disappears at an implicit page break rather than consuming top whitespace',()=>{
 const separated=inspect(app.document({page:'Letter'})
  .spacer(530).paragraph('BODY_START')
  .spacer(70).paragraph('BODY_END').renderSync());
 const explicit=inspect(app.document({page:'Letter'})
  .spacer(530).paragraph('BODY_START')
  .pageBreak().paragraph('BODY_END').renderSync());
 assert.equal(separated.count,2);
 assert.equal(find(separated,'BODY_START').page,1);
 assert.equal(find(separated,'BODY_END').page,2);
 assert.ok(Math.abs(find(separated,'BODY_END').y-find(explicit,'BODY_END').y)<1.5,
   'implicit page break should not carry the 70pt separator to page 2');
});
test('explicit leading and post-pageBreak spacers still reserve intentional whitespace',()=>{
 const raw=inspect(app.document({page:'Letter'}).paragraph('PAGE_ONE')
  .pageBreak().paragraph('TOP_REFERENCE').renderSync());
 const padded=inspect(app.document({page:'Letter'}).paragraph('PAGE_ONE')
  .pageBreak().spacer(24).paragraph('TOP_REFERENCE').renderSync());
 assert.equal(raw.count,2);
 assert.equal(padded.count,2);
 assert.ok(Math.abs(
  find(padded,'TOP_REFERENCE').y-find(raw,'TOP_REFERENCE').y-24
 )<1.5);
 const initial=inspect(app.document({page:'Letter'})
  .spacer(25).paragraph('FIRST_CONTENT').renderSync());
 const defaultDoc=inspect(app.document({page:'Letter'})
  .paragraph('FIRST_CONTENT').renderSync());
 assert.ok(Math.abs(
  find(initial,'FIRST_CONTENT').y-find(defaultDoc,'FIRST_CONTENT').y-25
 )<1.5);
});
test('long paginated sections keep ordered rows and repeated page headers',()=>{
 const rows=Array.from({length:175},(_,i)=>[
  'PAY_'+String(i+1).padStart(4,'0'),
  'Professional services '+(i+1),
  'MXN '+(480+i)
 ]);
 const doc=app.document({page:'Letter'})
  .header(h=>h.text('PAGINATION_COMPANY'))
  .spacer(485)
  .section('CONTRACT_LEDGER',s=>s
   .spacer(12)
   .table(rows,{columns:[
     {title:'CODE',width:'25%'},
     {title:'DESCRIPTION',width:'50%'},
     {title:'TOTAL',width:'25%'}
   ]})
  );
 const out=inspect(doc.renderSync());
 assert.ok(out.count>4);
 assert.equal(find(out,'CONTRACT_LEDGER').page,2);
 assert.equal(find(out,'PAY_0001').page,2);
 assert.deepEqual([...out.raw.matchAll(/PAY_(\d{4})/g)].map(m=>+m[1]),
   Array.from({length:175},(_,i)=>i+1));
 for(const page of out.pages)assert.match(page,/PAGINATION_COMPANY/);
});
