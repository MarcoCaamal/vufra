import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const require = createRequire(import.meta.url);
const {renderPdf, renderPdfAsync, PdfRenderQueue} = require('../dist/index.js');
const png=readFileSync(new URL('./fixtures/two-tone.png',import.meta.url));
const jpeg=readFileSync(new URL('./fixtures/two-tone.jpg',import.meta.url));
const alpha=readFileSync(new URL('./fixtures/transparent.png',import.meta.url));
const oversized=readFileSync(new URL('./fixtures/oversized-pixels.png',import.meta.url));
const large=readFileSync(new URL('./fixtures/large-pixels.png',import.meta.url));
const font=readFileSync(process.env.VUFRA_FONT ||
  execFileSync('fc-match',['Noto Sans','-f','%{file}\n'],{encoding:'utf8'}).trim());

function inspect(pdf, options={}) {
  const dir=mkdtempSync(join(tmpdir(),'vufra-images-'));
  const path=join(dir,'image.pdf');
  writeFileSync(path,pdf);
  const info=execFileSync('pdfinfo',[path],{encoding:'utf8'});
  const text=execFileSync('pdftotext',['-layout',path,'-'],{encoding:'utf8'});
  const images=execFileSync('pdfimages',['-list',path],{encoding:'utf8'});
  const pages=Number(info.match(/Pages:\s+(\d+)/)[1]);
  const result={path,info,text,images,pages};
  if(options.raster) {
    execFileSync('pdftoppm',['-r','72','-f','1','-l','1',path,join(dir,'raster')]);
    result.rasterPath=join(dir,'raster-1.ppm');
  }
  return result;
}
const img=(data,fit='contain',width=80,height=80)=>({type:'image',data,fit,width,height});
const imageLines=details=>details.images.split('\n').filter(line=>/^\s*\d+\s+\d+\s+image\b/.test(line));

function ppmPixel(path,x,y) {
  const b=readFileSync(path);
  let p=0;
  const token=()=>{
    while (p<b.length && [9,10,13,32].includes(b[p]))p++;
    if(b[p]===35) {while(p<b.length && b[p]!==10)p++;return token();}
    const start=p;
    while(p<b.length && ![9,10,13,32].includes(b[p]))p++;
    return b.toString('ascii',start,p);
  };
  assert.equal(token(),'P6');
  const w=Number(token()),h=Number(token()),depth=Number(token());
  assert.equal(depth,255);
  assert.ok(x>=0&&y>=0&&x<w&&y<h);
  p++; // binary content begins immediately after maxval newline
  return Array.from(b.subarray(p+(y*w+x)*3,p+(y*w+x)*3+3));
}
test('PNG and JPEG are embedded, and mixed-flow text remains selectable and in order',()=>{
  const result=inspect(renderPdf({
    title:'PNG and JPEG',
    blocks:[{type:'paragraph',text:'BEFOREIMAGE'},{type:'image',image:{data:png,width:80,height:80,fit:'contain'}},
      {type:'paragraph',text:'BETWEENIMAGES'},img(jpeg),
      {type:'paragraph',text:'AFTERIMAGE'}]
  },font));
  assert.equal(result.pages,1);
  assert.equal(imageLines(result).length,2,result.images);
  assert.match(result.images,/\b160\s+80\b/);
  assert.match(result.images,/\bjpeg\b/i);
  const indices=['BEFOREIMAGE','BETWEENIMAGES','AFTERIMAGE'].map(s=>result.text.indexOf(s));
  assert.ok(indices.every(i=>i>=0));
  assert.deepEqual(indices,[...indices].sort((a,b)=>a-b));
});

test('contain letterboxes non-square source; cover crops to fill declared box',()=>{
  const contain=inspect(renderPdf({title:'Contain',blocks:[img(png)]},font),{raster:true});
  const cover=inspect(renderPdf({title:'Cover',blocks:[img(png,'cover')]},font),{raster:true});
  // A4 content starts at x=49 y=120. Pixel x=60,y=128 lies
  // above contained 80x40 image (centered inside 80x80),
  // but inside the 80x80 image in cover mode.
  const whitespace=ppmPixel(contain.rasterPath,60,128);
  const colored=ppmPixel(cover.rasterPath,60,128);
  assert.ok(whitespace.every(c=>c>235),JSON.stringify(whitespace));
  assert.ok(colored[0]>150 && colored[1]<150,JSON.stringify(colored));
  // Source left/right halves must remain visible without stretching.
  const left=ppmPixel(cover.rasterPath,56,150);
  const right=ppmPixel(cover.rasterPath,112,150);
  assert.ok(left[0]>left[2],JSON.stringify(left));
  assert.ok(right[2]>right[0],JSON.stringify(right));
});

test('transparent PNG embeds with a mask and keeps next text visible',()=>{
  const result=inspect(renderPdf({title:'PNG alpha',blocks:[img(alpha,'contain',90,90),
    {type:'paragraph',text:'AFTERTRANSPARENCY'}]},font));
  assert.equal(result.pages,1);
  assert.ok(imageLines(result).length>=1,result.images);
  assert.match(result.text,/AFTERTRANSPARENCY/);
});

test('atomic image moves to next page and uses configured margins',()=>{
  const doc={title:'Page break image',page:{format:'letter',margins:{top:140,left:70,right:60,bottom:60}},
    blocks:[{type:'spacer',height:490},img(jpeg,'cover',130,130),
      {type:'paragraph',text:'TEXTAFTERPAGINATEDIMAGE'}]};
  const result=inspect(renderPdf(doc,font));
  assert.equal(result.pages,2,result.info);
  assert.equal(imageLines(result).length,1,result.images);
  assert.equal(Number(imageLines(result)[0].trim().split(/\s+/)[0]),2);
  assert.match(result.text,/TEXTAFTERPAGINATEDIMAGE/);
});

test('invalid image format, geometry and excessive encoded data are rejected',()=>{
  const render=(block)=>renderPdf({title:'Invalid image',blocks:[block]},font);
  assert.throws(()=>render(img(Buffer.from([1,2,3]))),/image format must be PNG or JPEG/);
  assert.throws(()=>render(img(Buffer.from([0x89,0x50,0x4e,0x47,13,10,26,10,1,2,3]))),/invalid or unsupported PNG/);
  assert.throws(()=>render(img(Buffer.alloc(0))),/image.data/);
  assert.throws(()=>render(img(png,'stretch')),/image.fit/);
  assert.throws(()=>render(img(png,'contain',999,80)),/image dimensions/);
  assert.throws(()=>render(img(png,'contain',NaN,80)),/image dimensions/);
  assert.throws(()=>render(img(png,'contain',80,1000)),/image dimensions/);
  assert.throws(()=>render(img(Buffer.alloc(8*1024*1024+1))),/image.data/);
  assert.throws(()=>render(img(oversized)),/12 megapixel limit/);
  assert.throws(()=>renderPdf({title:'Total pixel cap',blocks:Array.from({length:4},()=>img(large,'contain',50,50))},font),/total image pixel budget exceeded/);
  const document={title:'Many images',blocks:Array.from({length:65},()=>img(png))};
  assert.throws(()=>renderPdf(document,font),/too many images/);
});

test('async and bounded queue preserve image data after caller mutation',async()=>{
  const src=Buffer.from(jpeg);
  const doc={title:'Snapshot of embedded image',blocks:[img(src),{type:'paragraph',text:'MUTATIONSAFE'}]};
  const queue=new PdfRenderQueue({maxConcurrent:1,maxQueued:1});
  const first=queue.render({title:'Background',rows:Array.from({length:2000},(_,i)=>'ROW'+i)},font);
  const second=queue.render(doc,font);
  const stats=queue.stats;
  assert.equal(stats.queued,1);
  assert.ok(stats.queuedBytes>font.length+src.length);
  assert.ok(stats.queuedBytes < font.length + 100000, 'image bytes should not expand as JSON decimal arrays');
  src.fill(0);
  await first;
  const result=inspect(await second);
  assert.equal(imageLines(result).length,1);
  assert.match(result.text,/MUTATIONSAFE/);
  const result2=inspect(await renderPdfAsync({title:'Async photo',blocks:[img(png)]},font));
  assert.equal(imageLines(result2).length,1);
  queue.close();
});
