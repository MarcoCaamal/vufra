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
const bold=readFileSync(execFileSync('fc-match',['Noto Sans:style=Bold','-f','%{file}\n'],{encoding:'utf8'}).trim());
const doc=(runs,extra={})=>({title:'Inline colored text',fontFaces:{bold},blocks:[{
 type:'rich-paragraph',runs,style:{fontSize:11,lineHeight:16,spaceBefore:17,spaceAfter:9}
}],...extra});
function inspect(pdf,raster=false){
 const dir=mkdtempSync(join(tmpdir(),'vufra-inline-'));
 const path=join(dir,'report.pdf');writeFileSync(path,pdf);
 const info=execFileSync('pdfinfo',[path],{encoding:'utf8'});
 const bbox=execFileSync('pdftotext',['-bbox',path,'-'],{encoding:'utf8'});
 const text=execFileSync('pdftotext',['-layout',path,'-'],{encoding:'utf8'});
 if(raster)execFileSync('pdftoppm',['-r','72','-f','1','-l','1',path,join(dir,'raster')]);
 const words=[...bbox.matchAll(/<word xMin="([\d.]+)" yMin="([\d.]+)" xMax="([\d.]+)" yMax="([\d.]+)">([^<]+)<\/word>/g)]
   .map(m=>({x:+m[1],y:+m[2],endX:+m[3],endY:+m[4],text:m[5]}));
 return {dir,path,pages:+info.match(/Pages:\s+(\d+)/)[1],bbox,text,words,
  raster:raster?join(dir,'raster-1.ppm'):undefined};
}
function ppmPixels(path){
 const b=readFileSync(path);let p=0;
 const next=()=>{while([9,10,13,32].includes(b[p]))p++;const a=p;
 while(![9,10,13,32].includes(b[p]))p++;return b.toString('ascii',a,p);};
 assert.equal(next(),'P6');
 const width=+next(),height=+next(),depth=+next();assert.equal(depth,255);p++;
 return {width,height,pixel:(x,y)=>Array.from(b.subarray(p+(width*y+x)*3,p+(width*y+x)*3+3))};
}
function hasColor(raster,word,dominant){
 const img=ppmPixels(raster);
 for(let y=Math.floor(word.y);y<Math.min(img.height,Math.ceil(word.endY));y++){
   for(let x=Math.floor(word.x);x<Math.min(img.width,Math.ceil(word.endX));x++){
     const [r,g,b]=img.pixel(x,y);
     if(dominant==='red' && r>150 && g<110 && b<110)return true;
     if(dominant==='blue' && b>145 && r<110 && g<130)return true;
     if(dominant==='black' && Math.max(r,g,b)<110)return true;
   }
 }
 return false;
}

test('red and blue inline fill are real pixels, and defaults restore black text',()=>{
 const out=inspect(renderPdf(doc([
  {text:'REDTOKEN ',color:'#EE2417'},
  {text:'BLUETOKEN ',font:'bold',color:'#1049E0'},
  {text:'BLACKTOKEN'}
 ]),font),true);
 assert.equal(out.pages,1);
 for(const [token,color] of [['REDTOKEN','red'],['BLUETOKEN','blue'],['BLACKTOKEN','black']]){
   const word=out.words.find(w=>w.text===token);
   assert.ok(word,token);
   assert.ok(hasColor(out.raster,word,color),token+' has no expected '+color+' pixels');
 }
 assert.match(out.text,/REDTOKEN BLUETOKEN BLACKTOKEN/);
});

test('inline sizes use actual glyph geometry and grow line reservation',()=>{
 const out=inspect(renderPdf(doc([
  {text:'SMALLTOKEN ',fontSize:8},
  {text:'LARGETOKEN ',fontSize:30,color:'#A02040'},
  {text:'MIDTOKEN ',fontSize:15}
 ]),font),true);
 const get=t=>out.words.find(w=>w.text===t);
 assert.ok(get('SMALLTOKEN') && get('LARGETOKEN') && get('MIDTOKEN'));
 const height=w=>w.endY-w.y;
 assert.ok(height(get('LARGETOKEN'))>height(get('SMALLTOKEN'))*2.5,
   JSON.stringify([get('SMALLTOKEN'),get('LARGETOKEN')]));
 assert.ok(height(get('MIDTOKEN'))>height(get('SMALLTOKEN'))*1.4);
 assert.ok(get('LARGETOKEN').endX<546);
});

test('mixed sizes/colors/fonts across pages do not lose tokens or escape margins',()=>{
 const runs=Array.from({length:210},(_,i)=>({
  text:'INK'+String(i+1).padStart(4,'0')+' ',
  font:i%3===0?'bold':'regular',
  fontSize:[9,18,28,11][i%4],
  color:i%2===0?'#B22A2A':'#274EBB'
 }));
 const out=inspect(renderPdf(doc(runs,{page:{format:'letter',
   margins:{top:145,bottom:75,left:66,right:66}}}),font));
 assert.ok(out.pages>=2,out.pages);
 const ids=[...out.text.matchAll(/INK(\d{4})/g)].map(m=>+m[1]);
 assert.deepEqual(ids,Array.from({length:210},(_,i)=>i+1));
 const words=out.words.filter(w=>/^INK\d{4}$/.test(w.text));
 assert.equal(words.length,210);
 for(const w of words){
   assert.ok(w.x>=65.7 && w.endX<=546.3,JSON.stringify(w));
   assert.ok(w.y>=0 && w.endY<792,JSON.stringify(w));
 }
});

test('bad run colors/sizes reject early; optional fields keep old interface',()=>{
 assert.throws(()=>renderPdf(doc([{text:'INVALID',color:'red'}]),font),/color/);
 assert.throws(()=>renderPdf(doc([{text:'INVALID',color:'#12345G'}]),font),/color/);
 assert.throws(()=>renderPdf(doc([{text:'INVALID',fontSize:37}]),font),/fontSize/);
 assert.throws(()=>renderPdf(doc([{text:'INVALID',fontSize:0}]),font),/fontSize/);
 assert.throws(()=>renderPdf(doc([{text:'INVALID',fontSize:NaN}]),font),/fontSize/);
 assert.throws(()=>renderPdf(doc([{text:'INVALID',fontSize:Infinity}]),font),/fontSize/);
 const out=inspect(renderPdf(doc([{text:'UNSTYLED_INLINE'}]),font));
 assert.match(out.text,/UNSTYLED_INLINE/);
});

test('async and FIFO queue preserve inline styling and result metadata',async()=>{
 const events=[];
 const q=new PdfRenderQueue({maxConcurrent:1,maxQueued:1,onJobEvent:e=>events.push(e)});
 const data=doc([{text:'INLINE_ASYNC ',fontSize:24,color:'#1144CC'},
  {text:'QUEUEOK',fontSize:14,font:'bold'}]);
 const pdf=await q.render(data,font);
 const out=inspect(pdf);
 assert.match(out.text,/INLINE_ASYNC QUEUEOK/);
 assert.equal(q.stats.completed,1);assert.equal(events[0].outcome,'completed');
 q.close();
 const p=inspect(await renderPdfAsync(data,font));
 assert.match(p.text,/INLINE_ASYNC QUEUEOK/);
});

test('explicit fallback chooses a real embedded Symbols 2 font',()=>{
 const symbols=readFileSync(execFileSync('fc-match',['Noto Sans Symbols 2','-f','%{file}\\n'],{encoding:'utf8'}).trim());
 const result=inspect(renderPdf({
  title:'Fallback font',
  fontFaces:{symbols},
  blocks:[{type:'rich-paragraph',runs:[
    {text:'START '},
    {text:'★ ',fallbackFonts:['symbols'],color:'#2244DD',fontSize:17},
    {text:'END'}
  ]}]
 },font));
 const fonts=execFileSync('pdffonts',[result.path],{encoding:'utf8'});
 assert.match(fonts,/NotoSansSymbols2-Regular/);
 assert.match(result.text,/START ★ END/);
 assert.ok(result.words.some(w=>w.text==='★'));
});

test('explicit fallback fails instead of silently using missing glyphs',()=>{
 const symbols=readFileSync(execFileSync('fc-match',['Noto Sans Symbols 2','-f','%{file}\\n'],{encoding:'utf8'}).trim());
 assert.throws(()=>renderPdf({
  title:'Missing fallback glyph',
  fontFaces:{symbols},
  blocks:[{type:'rich-paragraph',runs:[
    {text:'☯ ',fallbackFonts:['symbols']}
  ]}]
 },font),/no font face covers/);
 assert.throws(()=>renderPdf(doc([
  {text:'HELLO',fallbackFonts:['missing']}
 ]),font),/fallbackFonts/);
 assert.throws(()=>renderPdf(doc([
  {text:'HELLO',fallbackFonts:'bold'}
 ]),font),/fallbackFonts/);
});

test('identical adjacent spans preserve a single word shape and positions',()=>{
 const a=inspect(renderPdf(doc([{text:'office organization',font:'bold',fontSize:18}]),font));
 const b=inspect(renderPdf(doc([
  {text:'of',font:'bold',fontSize:18},
  {text:'fice ',font:'bold',fontSize:18},
  {text:'organization',font:'bold',fontSize:18}
 ]),font));
 const aa=a.words.filter(w=>/office|organization/.test(w.text));
 const bb=b.words.filter(w=>/office|organization/.test(w.text));
 assert.equal(aa.length,2);assert.equal(bb.length,2);
 for(let i=0;i<2;i++){
  assert.equal(aa[i].text,bb[i].text);
  assert.ok(Math.abs(aa[i].x-bb[i].x)<0.05);
  assert.ok(Math.abs(aa[i].endX-bb[i].endX)<0.05);
 }
});
