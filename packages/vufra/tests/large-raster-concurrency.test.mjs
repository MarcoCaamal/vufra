import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFileSync,writeFileSync,mkdtempSync,rmSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {deterministicPng} from '../../../scripts/lib/deterministic-png.mjs';

const require=createRequire(import.meta.url);
const {createVufra}=require('../dist/index.js');
const font=readFileSync(execFileSync('fc-match',
  ['Noto Sans','-f','%{file}\n'],{encoding:'utf8'}).trim());

function verifyImage(bytes,token,expectedWidth){
  const dir=mkdtempSync(join(tmpdir(),'vufra-raster-'));
  try{
    const path=join(dir,'render.pdf');
    writeFileSync(path,bytes);
    const text=execFileSync('pdftotext',['-raw',path,'-'],{encoding:'utf8'});
    assert.ok(text.includes(token),'text token lost or duplicated');
    const info=execFileSync('pdfinfo',[path],{encoding:'utf8'});
    assert.match(info,/Pages:\s+1/);
    const imageList=execFileSync('pdfimages',['-list',path],{encoding:'utf8'});
    const images=imageList.split('\n').filter(line=>line.includes(' image '));
    assert.equal(images.length,1,'original image must appear once');
    assert.ok(images[0].includes(' '+expectedWidth+' '),
      'raster dimensions must be preserved');
  }finally{
    rmSync(dir,{recursive:true,force:true});
  }
}

test('a real 800px PNG in two concurrent PDFs matches each independent serial render',async()=>{
  const original=deterministicPng(800);
  assert.ok(original.length>1024*1024,'fixture must be large enough to exercise native PNG');
  const engine=createVufra({font});
  const first=engine.document({title:'Concurrent PNG 1'})
    .paragraph('PNG_REPEAT_FIRST').image(original,{width:170,height:140,fit:'contain'});
  const second=engine.document({title:'Concurrent PNG 2'})
    .paragraph('PNG_REPEAT_SECOND').image(original,{width:170,height:140,fit:'cover'});
  const serial1=first.renderSync();
  const serial2=second.renderSync();
  original.fill(0);
  const [async1,async2]=await Promise.all([first.render(),second.render()]);
  assert.deepEqual(Buffer.from(async1),Buffer.from(serial1));
  assert.deepEqual(Buffer.from(async2),Buffer.from(serial2));
  verifyImage(async1,'PNG_REPEAT_FIRST',800);
  verifyImage(async2,'PNG_REPEAT_SECOND',800);
});

test('shared JPEG source also renders independently under concurrent workers',async()=>{
  const jpg=Buffer.from(readFileSync(new URL('./fixtures/two-tone.jpg',import.meta.url)));
  const engine=createVufra({font});
  const doc=engine.document({title:'JPEG parallel'})
    .paragraph('JPEG_REPEAT_OK').image(jpg,{width:80,height:45});
  const expected=doc.renderSync();
  jpg.fill(0);
  const outputs=await Promise.all([doc.render(),doc.render()]);
  for(const pdf of outputs){
    assert.deepEqual(Buffer.from(pdf),Buffer.from(expected));
    verifyImage(pdf,'JPEG_REPEAT_OK',160);
  }
});
