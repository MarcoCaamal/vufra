import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFileSync,writeFileSync,mkdtempSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
const require=createRequire(import.meta.url);
const native=require('../native/vufra.node');
const regular=readFileSync(execFileSync('fc-match',['Noto Sans','-f','%{file}\n'],{encoding:'utf8'}).trim());
const bold=readFileSync(execFileSync('fc-match',['Noto Sans:style=Bold','-f','%{file}\n'],{encoding:'utf8'}).trim());
const png=readFileSync(new URL('./fixtures/two-tone.png',import.meta.url));
function textFrom(pdf){
 const dir=mkdtempSync(join(tmpdir(),'vufra-assets-'));
 const path=join(dir,'result.pdf');
 writeFileSync(path,pdf);
 return execFileSync('pdftotext',['-raw',path,'-'],{encoding:'utf8'});
}
test('native font and image assets snapshot sources once, reuse exact content and render',async()=>{
 const callerBold=Buffer.from(bold),callerImage=Buffer.from(png);
 const assets=new native.NativeAssets([{name:'bold',data:callerBold}]);
 const imageId=assets.registerImage(callerImage);
 assert.equal(imageId,assets.registerImage(Buffer.from(callerImage)),
   'exact image content reuses identical native slot');
 const regularResource=new native.NativeFont(regular);
 const blocks=[
  {kind:'rich-paragraph',runs:[{text:'NATIVE_ASSET_BOLD',font:'bold'}],
    style:{fontSize:11,lineHeight:16,spaceBefore:5,spaceAfter:5}},
  {kind:'image',image:{assetId:imageId,width:80,height:40,fit:'contain'}}
 ];
 const first=native.renderPdfNative('Asset check',blocks,regularResource,undefined,assets);
 callerBold.fill(0);callerImage.fill(0);
 const second=native.renderPdfNative('Asset check',blocks,regularResource,undefined,assets);
 assert.deepEqual(Buffer.from(second),Buffer.from(first));
 assert.match(textFrom(first),/NATIVE_ASSET_BOLD/);
 const jobs=await Promise.all([
   native.renderPdfAsyncNative('Asset check',blocks,regularResource,undefined,undefined,assets),
   native.renderPdfAsyncNative('Asset check',blocks,regularResource,undefined,undefined,assets)
 ]);
 assert.deepEqual(Buffer.from(jobs[0].pdf),Buffer.from(first));
 assert.deepEqual(Buffer.from(jobs[1].pdf),Buffer.from(first));
});
test('cached image counts still apply per-document (65 instances rejected)',()=>{
 const assets=new native.NativeAssets([]);
 const id=assets.registerImage(png);
 const over={kind:'box',boxData:{align:'left',padding:12,borderWidth:0,
  items:Array.from({length:65},()=>({kind:'image',
   image:{assetId:id,width:80,height:40,fit:'contain'}}))}};
 assert.throws(()=>native.renderPdfNative('Image limit',[over],
  new native.NativeFont(regular),undefined,assets),
  /too many images or too much image data/);
 assert.throws(()=>native.renderPdfNative('Invalid asset',
  [{kind:'image',image:{assetId:999999,width:60,height:40,fit:'cover'}}],
  new native.NativeFont(regular),undefined,assets),/invalid image asset id/);
});
test('image cache is bounded and refuses registration without breaking earlier ids',()=>{
 const assets=new native.NativeAssets([]);
 for(let i=0;i<256;i++){
  const bytes=Buffer.alloc(16);
  bytes.writeUInt32LE(i);
  assert.equal(assets.registerImage(bytes),i);
 }
 const extra=Buffer.alloc(16);
 extra.writeUInt32LE(257);
 assert.equal(assets.registerImage(extra),-1);
 const first=Buffer.alloc(16);
 first.writeUInt32LE(0);
 assert.equal(assets.registerImage(first),0,'stable id remains valid after saturation');
});

test('saturated factory cache falls back to inline PNG and still produces a valid PDF',()=>{
 const {renderPdf}=require('../dist/renderer.js');
 const assets=new native.NativeAssets([]);
 for(let i=0;i<256;i++){
  const bytes=Buffer.alloc(16);
  bytes.writeUInt32LE(i);
  assert.equal(assets.registerImage(bytes),i);
 }
 const pdf=renderPdf({
   title:'Fallback image',
   blocks:[
     {type:'paragraph',text:'FALLBACK_IMAGE_OK'},
     {type:'image',data:png,width:80,height:40,fit:'contain'}
   ]
 },regular,assets);
 assert.match(textFrom(pdf),/FALLBACK_IMAGE_OK/);
 const dir=mkdtempSync(join(tmpdir(),'vufra-assets-list-'));
 const file=join(dir,'fallback.pdf');
 writeFileSync(file,pdf);
 const images=execFileSync('pdfimages',['-list',file],{encoding:'utf8'});
 assert.match(images,/160\s+80/);
});

test('Fluent repeats a bold logo document using private face and image snapshots',async()=>{
 const {createVufra}=require('../dist/index.js');
 const callerFont=Buffer.from(bold);
 const callerLogo=Buffer.from(png);
 const engine=createVufra({font:regular,fonts:{bold:callerFont}});
 const build=()=>engine.document({title:'Repeated logo'})
   .paragraph('SAME_LOGO_PDF',{bold:true})
   .image(callerLogo,{width:80,height:40});
 const first=build().renderSync();
 const secondDoc=build(); // images are snapshotted at composition time
 callerLogo.fill(0);
 callerFont.fill(0);
 const second=await secondDoc.render();
 assert.deepEqual(Buffer.from(first),Buffer.from(second));
 assert.match(textFrom(second),/SAME_LOGO_PDF/);
});
