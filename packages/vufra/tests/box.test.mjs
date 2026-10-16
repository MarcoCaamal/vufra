import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {execFileSync} from 'node:child_process';
import {readFileSync,writeFileSync,mkdtempSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';

const require=createRequire(import.meta.url);
const {createVufra,renderPdf,PdfRenderQueue}=require('../dist/index.js');
const font=readFileSync(execFileSync('fc-match',['Noto Sans','-f','%{file}\\n'],{encoding:'utf8'}).trim());
const img=readFileSync(new URL('./fixtures/two-tone.png',import.meta.url));
const vufra=createVufra({font,theme:{colors:{blue:'#1F4BA8',light:'#E8F1FF',red:'#D42030'}}});
function inspect(bytes){
 const dir=mkdtempSync(join(tmpdir(),'vufra-box-'));
 const pdf=join(dir,'document.pdf');writeFileSync(pdf,bytes);
 const out=(cmd,args)=>execFileSync(cmd,args,{encoding:'utf8'});
 const info=out('pdfinfo',[pdf]),raw=out('pdftotext',['-raw',pdf,'-']),
  layout=out('pdftotext',['-layout',pdf,'-']);
 const boxes=out('pdftotext',['-bbox',pdf,'-']);
 const words=[...boxes.matchAll(/<word xMin="([\d.]+)" yMin="([\d.]+)" xMax="([\d.]+)" yMax="([\d.]+)">([^<]+)<\/word>/g)]
 .map(m=>({x:+m[1],y:+m[2],right:+m[3],bottom:+m[4],text:m[5]}));
 return {pdf,dir,pages:+info.match(/Pages:\s+(\d+)/)[1],raw,layout,words};
}
// Read Poppler P6 RGB pixels directly; no ImageMagick or other CI dependencies.
const rasterCache=new Map();
function ppm(pdf,page=1){
 const key=pdf.pdf+':'+page;
 if(rasterCache.has(key))return rasterCache.get(key);
 const target=join(pdf.dir,'sample-'+page);
 execFileSync('pdftoppm',['-r','72','-f',String(page),'-l',String(page),
   '-singlefile',pdf.pdf,target]);
 const data=readFileSync(target+'.ppm');
 let pos=0;
 function next(){
   while(pos<data.length){
     if(data[pos]===35){while(pos<data.length && data[pos]!==10)pos++;continue;}
     if([9,10,13,32].includes(data[pos])){pos++;continue;}
     break;
   }
   const from=pos;
   while(pos<data.length && ![9,10,13,32].includes(data[pos]))pos++;
   return data.toString('ascii',from,pos);
 }
 assert.equal(next(),'P6');
 const width=Number(next()),height=Number(next()),max=Number(next());
 assert.equal(max,255);
 // Poppler's PPM has one whitespace byte after its header.
 assert.ok([9,10,13,32].includes(data[pos]));
 pos++;
 const raster={data,width,height,offset:pos};
 rasterCache.set(key,raster);
 return raster;
}
function pixel(pdf,x,y,page){
 const {data,width,height,offset}=ppm(pdf,page);
 const px=Math.round(x),py=Math.round(y);
 assert.ok(px>=0 && px<width && py>=0 && py<height);
 const start=offset+3*(py*width+px);
 return [...data.subarray(start,start+3)];
}
test('decorated box fills pixels, preserves padding and keeps following text outside',()=>{
 const doc=vufra.document({title:'Box QA'})
  .box({background:'light',padding:20,border:{width:2,color:'blue'}},box=>{
    box.heading('CARD_TITLE',{level:2,color:'blue'});
    box.paragraph('BOX_DESCRIPTION ' + 'text '.repeat(20));
    box.divider({height:2,color:'red'});
    box.paragraph('END_CARD');
  }).paragraph('BELOW_BOX');
 const out=inspect(doc.renderSync());
 assert.equal(out.pages,1);
 const title=out.words.find(x=>x.text==='CARD_TITLE');
 const below=out.words.find(x=>x.text==='BELOW_BOX');
 assert.ok(title&&below);
 assert.ok(title.x>=68.5,title.x);
 assert.ok(below.y>title.bottom+60);
 assert.equal(out.raw.match(/CARD_TITLE/g)?.length,1);
 const inside=pixel(out,60,160,1);
 assert.ok(inside[2]>inside[0]*0.9,inside);
 const border=pixel(out,49,150,1);
 assert.ok(border[2]>border[0]*1.5,border);
});

test('width and alignment center and right have real calculated x offsets',()=>{
 const left=vufra.document({title:'Align QA'})
 .box({width:240,padding:12,align:'left',background:'#FAFAFA'},b=>b.paragraph('LEFTBOX'))
 .box({width:240,padding:12,align:'center',background:'#FAFAFA'},b=>b.paragraph('CENTERBOX'))
 .box({width:240,padding:12,align:'right',background:'#FAFAFA'},b=>b.paragraph('RIGHTBOX'));
 const out=inspect(left.renderSync());
 const w=t=>out.words.find(x=>x.text===t);
 assert.ok(w('LEFTBOX') && w('CENTERBOX') && w('RIGHTBOX'));
 assert.ok(w('LEFTBOX').x<100);
 assert.ok(w('CENTERBOX').x>170 && w('CENTERBOX').x<220);
 assert.ok(w('RIGHTBOX').x>290);
});

test('long decorated box spans pages: 1000 text tokens extracted once in logical order',()=>{
 const content=Array.from({length:1000},(_,i)=>'BXT'+String(i+1).padStart(4,'0')).join(' ');
 const doc=vufra.document({title:'Box multipage',page:'Letter',
   margins:{left:52,right:52,top:125,bottom:72}})
 .heading('LONG BOX')
 .box({padding:18,border:{width:2,color:'blue'},background:'light'},b=>{
   b.paragraph(content,{fontSize:13,lineHeight:20,spaceBefore:6,spaceAfter:8});
 })
 .paragraph('AFTER_MULTIPAGE_BOX');
 const out=inspect(doc.renderSync());
 assert.ok(out.pages>=3);
 const ids=[...out.raw.matchAll(/BXT(\d{4})/g)].map(m=>+m[1]);
 assert.deepEqual(ids,Array.from({length:1000},(_,i)=>i+1));
 assert.equal((out.raw.match(/AFTER_MULTIPAGE_BOX/g)||[]).length,1);
 for(const item of out.words.filter(x=>/^BXT\d{4}$/.test(x.text))){
   assert.ok(item.x>=65 && item.right<565,item.text+' '+item.x+','+item.right);
   assert.ok(item.bottom<765,item.text+' '+item.bottom);
 }
 // The middle-page box is still decorated; fragment frame may start at content top.
 const second=out.raw.includes('BXT');
 assert.ok(second);
 const middle=pixel(out,52,125,2);
 assert.ok(middle[2]>middle[0]*1.2,middle);
});

test('short box moves together to following page, no split around page edge',()=>{
 const out=inspect(vufra.document({title:'Keep box',page:'Letter'})
  .spacer(530)
  .box({padding:14,border:{width:1,color:'blue'},background:'light'},b=>{
   b.heading('WHOLEBOX');
   b.paragraph('CHILDINBOX');
  }).renderSync());
 assert.equal(out.pages,2);
 const first=execFileSync('pdftotext',['-f','1','-l','1',out.pdf,'-'],{encoding:'utf8'});
 const second=execFileSync('pdftotext',['-f','2','-l','2',out.pdf,'-'],{encoding:'utf8'});
 assert.ok(!first.includes('WHOLEBOX'));
 assert.match(second,/WHOLEBOX/);
 assert.match(second,/CHILDINBOX/);
});

test('box with PNG image and vector divider continues to following text',()=>{
 const out=inspect(vufra.document({title:'Box image'})
  .box({padding:14,border:{width:1,color:'blue'},background:'light'},b=>{
   b.image(img,{width:170,height:85});
   b.divider({height:3,width:250,color:'red'});
   b.paragraph('IMAGE_CAPTION');
  }).paragraph('OUTSIDE_BOX').renderSync());
 assert.match(out.raw,/IMAGE_CAPTION/);
 assert.match(out.raw,/OUTSIDE_BOX/);
 const images=execFileSync('pdfimages',['-list',out.pdf],{encoding:'utf8'});
 assert.match(images,/160\s+80/);
});

test('invalid decorated box input explicitly errors instead of being ignored',()=>{
 const base=vufra.document({title:'Wrong box'});
 assert.throws(()=>base.box({padding:0,border:{width:2,color:'blue'}},b=>b.paragraph('BAD')).renderSync(),/invalid box/);
 assert.throws(()=>base.box({width:90},b=>b.paragraph('BAD')).renderSync(),/invalid box/);
 assert.throws(()=>base.box({border:{width:2,color:'unknown'}},b=>b.paragraph('BAD')),/color/);
 assert.throws(()=>base.box(b=>b.paragraph('BOLD',{bold:true})),/regular font/);
 assert.throws(()=>base.box(b=>b.paragraph('BAD').spacer(900)).renderSync(),/invalid box/);
 assert.throws(()=>base.box(b=>b.paragraph('A'.repeat(2000))).renderSync(),/unbreakable text/);
});

test('native binding enforces recursive image count before copying boxed buffers',()=>{
 const native=require('../native/vufra.node');
 const overLimit={kind:'box',boxData:{
   align:'left',padding:12,borderWidth:0,items:Array.from({length:65},()=>({
     kind:'image',image:{data:img,width:80,height:40,fit:'contain'}
   }))
 }};
 assert.throws(()=>native.renderPdfNative('Preflight',[],[],font,
   undefined,[overLimit]),/too many images or too much image data/);
});
test('async and bounded queue render boxed content with binary image snapshots',async()=>{
 const q=new PdfRenderQueue({maxConcurrent:1,maxQueued:1,
  maxJobBytes:6*1024*1024,maxQueuedBytes:8*1024*1024});
 const data=vufra.document({title:'Async box'})
 .box({padding:18,background:'light',border:{width:2,color:'blue'}},b=>{
  b.image(img,{width:130,height:65});
  b.paragraph('QUEUED_BOX');
 });
 const out=inspect(await data.enqueue(q));
 assert.equal(out.pages,1);
 assert.match(out.raw,/QUEUED_BOX/);
 q.close();
 const native=inspect(await data.render());
 assert.match(native.raw,/QUEUED_BOX/);
});
