import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {execFileSync} from 'node:child_process';
import {readFileSync,writeFileSync,mkdtempSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';

const require=createRequire(import.meta.url);
const {createVufra}=require('../dist/index.js');
const fontsDir=execFileSync('fc-match',['Noto Sans','-f','%{file}\n'],
  {encoding:'utf8'}).trim();
const boldDir=execFileSync('fc-match',['Noto Sans:style=Bold','-f','%{file}\n'],
  {encoding:'utf8'}).trim();
const app=createVufra({font:readFileSync(fontsDir),fonts:{bold:readFileSync(boldDir)}});
const png=readFileSync(new URL('./fixtures/two-tone.png',import.meta.url));
const jpg=readFileSync(new URL('./fixtures/two-tone.jpg',import.meta.url));
const long=(id,count=390)=>Array.from({length:count},(_,i)=>
  id+String(i+1).padStart(4,'0')).join(' ');

function inspect(pdf){
  const path=join(mkdtempSync(join(tmpdir(),'vufra-cached-img-')),'result.pdf');
  writeFileSync(path,pdf);
  const info=execFileSync('pdfinfo',[path],{encoding:'utf8'});
  const raw=execFileSync('pdftotext',['-raw',path,'-'],{encoding:'utf8'});
  const list=execFileSync('pdfimages',['-list',path],{encoding:'utf8'});
  return {path,raw,list,pages:Number(info.match(/Pages:\s+(\d+)/)[1])};
}
function validate(out,prefix,count){
  assert.ok(out.pages>=2,'long source row should fragment');
  assert.deepEqual([...out.raw.matchAll(new RegExp(prefix+'(\\d{4})','g'))]
    .map(m=>Number(m[1])),Array.from({length:count},(_,i)=>i+1));
  assert.equal(out.list.split('\n').filter(l=>l.includes(' image ')).length,1,
    'one original image must appear once across fragments');
  assert.match(out.list,/\b160\s+80\b/);
}
test('PNG Cover in root over-height row paints once and preserves 390 ordered tokens',()=>{
  const out=inspect(app.document({title:'Root cover',page:'Letter'})
    .row(r=>r
      .column({width:'34%'},c=>c.image(png,{width:100,height:65,fit:'cover'}))
      .column({width:'66%'},c=>c.paragraph(long('ROOTPNG_',390)))
    ).renderSync());
  validate(out,'ROOTPNG_',390);
});
test('JPEG Contain in nested box over-height row paints once',()=>{
  const out=inspect(app.document({title:'Nested JPEG',page:'Letter'})
    .box({padding:10,border:{width:1,color:'#123456'}},b=>b.row(r=>r
      .column({width:'35%'},c=>c.image(jpg,{width:85,height:65,fit:'contain'}))
      .column({width:'65%'},c=>c.paragraph(long('BOXJPEG_',390)))
    )).renderSync());
  validate(out,'BOXJPEG_',390);
});
test('styled-table body oversized row keeps its PNG, colored cell and repeated header',()=>{
  const out=inspect(app.document({title:'Styled long cell',page:'Letter'})
    .box({padding:12},b=>b.table([[
      {image:png,width:75,height:35,background:'#DDEEFF'},
      long('TABLEPNG_',390)
    ]],{columns:[
      {title:'PHOTO',width:'30%'},{title:'REFERENCE',width:'70%'}
    ]})).renderSync());
  validate(out,'TABLEPNG_',390);
  const page=number=>execFileSync('pdftotext',['-f',String(number),'-l',String(number),
    '-raw',out.path,'-'],{encoding:'utf8'});
  for(let i=1;i<=out.pages;i++){
    const txt=page(i);
    if(txt.includes('TABLEPNG_')){
      assert.equal((txt.match(/\bPHOTO\b/g)??[]).length,1,
        'styled-table header repeated once on data page '+i);
    }
  }
});
