import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFileSync,writeFileSync,mkdtempSync,rmSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {join} from 'node:path';
import {tmpdir} from 'node:os';

const require=createRequire(import.meta.url);
const {createVufra,box,paragraph}=require('../dist/index.js');
const font=readFileSync(execFileSync('fc-match',
 ['Noto Sans','-f','%{file}\n'],{encoding:'utf8'}).trim());
const app=createVufra({font,theme:{
  colors:{panel:'#EEF4FF',accent:'#BB1122'},
  presets:{box:{card:{padding:16,radius:12,background:'panel',
    border:{width:2,color:'accent'}}}}
}});
function inspect(pdf){
 const dir=mkdtempSync(join(tmpdir(),'vufra-rounded-'));
 const file=join(dir,'document.pdf');writeFileSync(file,pdf);
 const info=execFileSync('pdfinfo',[file],{encoding:'utf8'});
 const pages=Number(info.match(/Pages:\s+(\d+)/)[1]);
 const text=execFileSync('pdftotext',['-raw',file,'-'],{encoding:'utf8'});
 const byPage=Array.from({length:pages},(_,i)=>execFileSync(
   'pdftotext',['-raw','-f',String(i+1),'-l',String(i+1),file,'-'],
   {encoding:'utf8'}));
 const cache=new Map();
 function color(page,x,y){
  if(!cache.has(page)){
   const ppm=execFileSync('pdftoppm',['-f',String(page),'-l',String(page),
     '-r','72','-singlefile',file],{maxBuffer:4*1024*1024});
   const head=ppm.subarray(0,90).toString('latin1').match(/^P6\s+(\d+)\s+(\d+)\s+255\s/);
   assert.ok(head);
   cache.set(page,{ppm,head});
  }
  const {ppm,head}=cache.get(page);
  const at=head[0].length+((y*Number(head[1]))+x)*3;
  return [...ppm.subarray(at,at+3)];
 }
 return {pages,text,byPage,color,close:()=>rmSync(dir,{recursive:true,force:true})};
}
test('rounded box and named preset create real corner pixels without modifying text positions',()=>{
 const styled=app.document({page:'Letter'}).box({preset:'card'},
  c=>c.paragraph('ROUND_CARD_CONTENT')).renderSync();
 const manual=app.document({page:'Letter'}).box({
  padding:16,radius:12,background:'panel',border:{width:2,color:'accent'}
 },c=>c.paragraph('ROUND_CARD_CONTENT')).renderSync();
 assert.deepEqual(Buffer.from(styled),Buffer.from(manual));
 const out=inspect(styled);
 try{
  assert.equal(out.pages,1);
  assert.equal((out.text.match(/ROUND_CARD_CONTENT/g)||[]).length,1);
  assert.deepEqual(out.color(1,50,121),[255,255,255],
   'top-left corner must remain white instead of square fill');
  assert.deepEqual(out.color(1,100,121),[187,17,34],
   'actual top border curve must have a horizontal middle');
  assert.deepEqual(out.color(1,50,144),[187,17,34],
   'side border must remain fully visible');
  assert.deepEqual(out.color(1,70,144),[238,244,255],
   'filled interior must be tinted');
 }finally{out.close();}
});
test('radius=0 preserves the previous square PDF byte for byte',()=>{
 const a=app.document({page:'Letter'}).box({padding:16,background:'panel',
   border:{width:2,color:'accent'}},b=>b.paragraph('SQUARE_EQUIVALENT')).renderSync();
 const b=app.document({page:'Letter'}).box({padding:16,radius:0,background:'panel',
   border:{width:2,color:'accent'}},b=>b.paragraph('SQUARE_EQUIVALENT')).renderSync();
 assert.deepEqual(Buffer.from(a),Buffer.from(b));
});
test('rounded multi-page boxes open and close only once, preserving nested table headers',()=>{
 const rows=Array.from({length:115},(_,i)=>[
  'ROUND_'+String(i+1).padStart(4,'0'),'DETAIL_'+String(i+1).padStart(4,'0')
 ]);
 const pdf=app.document({page:'Letter'})
  .box({preset:'card'},outer=>outer
    .box({padding:12,radius:10,background:'#EDF9EC',
       border:{width:2,color:'#127A3E'}},inner=>inner
      .table(rows,{columns:[
       {title:'TABLE_KEY',width:'40%'},{title:'TABLE_VALUE',width:'60%'}
      ]})
    )).renderSync();
 const out=inspect(pdf);
 try{
  assert.ok(out.pages>=4);
  const ids=[...out.text.matchAll(/ROUND_(\d{4})/g)].map(m=>+m[1]);
  assert.deepEqual(ids,Array.from({length:115},(_,i)=>i+1));
  for(let p=1;p<=out.pages;p++){
   assert.equal((out.byPage[p-1].match(/TABLE_KEY/g)||[]).length,1);
   assert.deepEqual(out.color(p,50,121),
     p===1?[255,255,255]:[187,17,34],
     'rounded outer left top corner only on original first page');
   assert.deepEqual(out.color(p,100,121),
     p===1?[187,17,34]:[238,244,255],
     'outer top border never repeats with table header');
   assert.deepEqual(out.color(p,50,160),[187,17,34],
     'straight side borders continue through pages');
  }
  const last=out.pages;
  const red=[187,17,34];
  const atBottom=Array.from({length:590},(_,i)=>i+120)
   .filter(y=>out.color(last,100,y).every((v,k)=>v===red[k]));
  assert.ok(atBottom.length>0,'last page must close rounded bottom border');
 }finally{out.close();}
});
test('radius cannot exceed padding or supported geometry limits',()=>{
 const make=radius=>app.document({page:'Letter'})
   .box({padding:16,radius,background:'panel'},b=>b.paragraph('INVALID_RADIUS'));
 for(const value of [-1,17,25,Number.NaN,Number.POSITIVE_INFINITY]){
  assert.throws(()=>make(value).renderSync(),/invalid box geometry|radius/i,
    'invalid radius '+String(value));
 }
 const preset=createVufra({font,theme:{
   presets:{box:{bad:{padding:5,radius:10}}}
 }});
 assert.throws(()=>preset.document().box({preset:'bad'},b=>b.paragraph('X'))
   .renderSync(),/invalid box geometry|radius/i);
});
