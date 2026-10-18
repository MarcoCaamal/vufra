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
function inspect(pdf){
 const file=join(mkdtempSync(join(tmpdir(),'vufra39-')),'report.pdf');writeFileSync(file,pdf);
 const bbox=execFileSync('pdftotext',['-bbox',file,'-'],{encoding:'utf8'});
 const text=execFileSync('pdftotext',['-raw',file,'-'],{encoding:'utf8'});
 const pages=Number(execFileSync('pdfinfo',[file],{encoding:'utf8'}).match(/Pages:\s+(\d+)/)[1]);
 const all=[...bbox.matchAll(/<word xMin="([\d.]+)" yMin="([\d.]+)" xMax="([\d.]+)" yMax="([\d.]+)">([^<]+)<\/word>/g)]
 .map(m=>({text:m[5],x:+m[1],y:+m[2],ex:+m[3]}));
 const word=t=>{const w=all.find(v=>v.text===t);assert.ok(w,'missing '+t);return w;};
 const rast=new Map();
 const pixel=(pg,x,y)=>{
  if(!rast.has(pg)){
   const ppm=execFileSync('pdftoppm',['-f',String(pg),'-l',String(pg),'-r','72','-singlefile',file],{maxBuffer:4*1024*1024});
   const hdr=ppm.subarray(0,100).toString('latin1').match(/^P6\s+(\d+)\s+(\d+)\s+255\s/);
   assert.ok(hdr);rast.set(pg,{ppm,head:hdr});
  }
  const {ppm,head}=rast.get(pg);return [...ppm.subarray(head[0].length+(y*+head[1]+x)*3,head[0].length+(y*+head[1]+x)*3+3)];
 };
 const countColor=(pg,color)=>{
   // sample every third pixel to avoid edge antialiasing while testing real raster output
   const hits=[];
   for(let y=130;y<730;y+=2)for(let x=40;x<560;x+=2){
     if(pixel(pg,x,y).every((channel,i)=>channel===color[i]))hits.push(1);
   }
   return hits.length;
 };
 return {file,bbox,text,pages,word,pixel,countColor};
}
const cols=[{title:'REFERENCE',width:'45%',border:{width:2,color:'#AA0022'}},
 {title:'AMOUNT',width:'55%',border:{width:0}}];
test('native cell border and table row palettes survive repeated headers and page breaks',()=>{
 const rows=Array.from({length:130},(_,i)=>[
  {text:'INV_'+String(i+1).padStart(3,'0'),border:i===0?{width:3,color:'#2244EE'}:undefined},
  {text:'$'+i,border:i===1?{width:1,color:'#FF00FF'}:undefined}
 ]);
 const out=inspect(app.document({title:'Styled borders',page:'Letter'}).table(rows,{
  columns:cols,border:{width:1,color:'#550000'},
  headerBackground:'#F2C400',oddRowBackground:'#C2F9D0',evenRowBackground:'#C7D5F4'
 }).renderSync());
 assert.ok(out.pages>=3);
 const ids=[...out.text.matchAll(/INV_(\d{3})/g)].map(m=>+m[1]);
 assert.deepEqual(ids,Array.from({length:130},(_,i)=>i+1));
 assert.ok(out.countColor(1,[242,196,0])>200,'header fill is visible');
 assert.ok(out.countColor(1,[194,249,208])>300,'odd fill is visible');
 assert.ok(out.countColor(1,[199,213,244])>300,'even fill is visible');
 assert.ok(out.countColor(1,[170,0,34])>30,'column border is visible');
 assert.ok(out.countColor(1,[34,68,238])>20,'overridden cell border is visible');
 for(let pg=1;pg<=out.pages;pg++){
   const text=execFileSync('pdftotext',['-raw','-f',String(pg),'-l',String(pg),out.file,'-'],{encoding:'utf8'});
   assert.equal((text.match(/REFERENCE/g)??[]).length,1);
 }
});
test('border and palette values are validated and overrides do not poison other documents',()=>{
 const plain=[{title:'REFERENCE',width:'45%'},{title:'AMOUNT',width:'55%'}];
 const opts={columns:plain,border:{width:2,color:'#883311'}};
 const a=app.document().table([['ONE','TWO']],opts).renderSync();
 const b=app.document().table([['ONE','TWO']],{columns:plain}).renderSync();
 assert.notDeepEqual(a,b);
 assert.throws(()=>app.document().table([['A','B']],{columns:cols,border:{width:-1}}),/border/);
 assert.throws(()=>app.document().table([[{text:'A',border:{width:5}},'B']],{columns:cols}),/border/);
 assert.throws(()=>app.document().table([['A','B']],{columns:cols,oddRowBackground:'invalid'}),/color/);
});

test('groupTableRows preserves ordered groups, blanks and subtotals across pages',()=>{
  const {groupTableRows}=require('../dist/index.js');
  const groups=[
    {title:'DEPARTMENT_NORTH',rows:Array.from({length:62},(_,i)=>['NORTH_'+String(i+1).padStart(3,'0'),'$20']),subtotal:['SUBTOTAL_NORTH','$1240']},
    {title:'DEPARTMENT_SOUTH',rows:Array.from({length:61},(_,i)=>['SOUTH_'+String(i+1).padStart(3,'0'),'$10']),subtotal:['SUBTOTAL_SOUTH','$610']}
  ];
  const rows=groupTableRows(groups,2,{groupBackground:'#E5EBF8',subtotalBackground:'#D6EDE2'});
  assert.equal(rows.length,127);
  const out=inspect(app.document({title:'Groups',page:'Letter'}).table(rows,{
    columns:[{title:'DEPARTMENT',width:'55%'},{title:'TOTAL',width:'45%',align:'right'}]
  }).renderSync());
  assert.ok(out.pages>=3);
  assert.equal((out.text.match(/DEPARTMENT_NORTH/g)??[]).length,1);
  assert.equal((out.text.match(/SUBTOTAL_NORTH/g)??[]).length,1);
  assert.equal((out.text.match(/DEPARTMENT_SOUTH/g)??[]).length,1);
  assert.equal((out.text.match(/SUBTOTAL_SOUTH/g)??[]).length,1);
  const ids=[...out.text.matchAll(/(NORTH|SOUTH)_(\d{3})/g)].map(m=>m[1]+'_'+m[2]);
  assert.deepEqual(ids,[...Array.from({length:62},(_,i)=>'NORTH_'+String(i+1).padStart(3,'0')),
    ...Array.from({length:61},(_,i)=>'SOUTH_'+String(i+1).padStart(3,'0'))]);
  assert.throws(()=>groupTableRows(groups,7),/1..6/);
  assert.throws(()=>groupTableRows([{title:'Bad',rows:[['X']]}],2),/column count/);
});
