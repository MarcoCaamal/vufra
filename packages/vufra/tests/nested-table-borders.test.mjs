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
const app=createVufra({font});
function pdfFor(rows){
 return app.document({page:'Letter'})
   .box({padding:18,background:'#EEF4FF',
     border:{width:3,color:'#BB1122'}},outer=>
     outer.box({padding:16,background:'#EDF9EC',
       border:{width:3,color:'#127A3E'}},inner=>
       inner.table(rows,{columns:[
         {title:'REFERENCE_HEADER',width:'40%'},
         {title:'DETAIL_HEADER',width:'60%'}
       ]})
     )
   ).renderSync();
}
function inspect(pdf){
 const directory=mkdtempSync(join(tmpdir(),'vufra-box-border-'));
 const file=join(directory,'report.pdf');writeFileSync(file,pdf);
 const info=execFileSync('pdfinfo',[file],{encoding:'utf8'});
 const pages=Number(info.match(/Pages:\s+(\d+)/)[1]);
 const text=execFileSync('pdftotext',['-raw',file,'-'],{encoding:'utf8'});
 const byPage=Array.from({length:pages},(_,i)=>
  execFileSync('pdftotext',['-raw','-f',String(i+1),'-l',String(i+1),file,'-'],{encoding:'utf8'}));
 const rasters=new Map();
 function pixel(page,x,y){
   if(!rasters.has(page)){
     const ppm=execFileSync('pdftoppm',['-f',String(page),'-l',String(page),
       '-r','72','-singlefile',file],{maxBuffer:4*1024*1024});
     const hdr=ppm.subarray(0,90).toString('latin1')
       .match(/^P6\s+(\d+)\s+(\d+)\s+255\s/);
     assert.ok(hdr,'valid ppm');
     rasters.set(page,{ppm,header:hdr});
   }
   const {ppm,header}=rasters.get(page);
   const offset=header[0].length+(y*Number(header[1])+x)*3;
   return [...ppm.subarray(offset,offset+3)];
 }
 return {pages,text,byPage,pixel,close(){rmSync(directory,{recursive:true,force:true})}};
}
test('continuation pages repeat nested table headers, backgrounds and side borders without restamping top borders',()=>{
 const rows=Array.from({length:110},(_,i)=>[
   'NEST_'+String(i+1).padStart(4,'0'), 'SERVICE_'+String(i+1).padStart(4,'0')
 ]);
 const out=inspect(pdfFor(rows));
 try{
   assert.ok(out.pages>=4);
   const ids=[...out.text.matchAll(/NEST_(\d{4})/g)].map(m=>+m[1]);
   assert.deepEqual(ids,Array.from({length:110},(_,i)=>i+1));
   for(let p=1;p<=out.pages;p++){
      assert.equal((out.byPage[p-1].match(/REFERENCE_HEADER/g)??[]).length,1,
        'table header must repeat once on page '+p);
      // Letter default content starts at y=120pt. Outer+inner frames both
      // extend over every page, but top border is only on the *first* one.
      assert.deepEqual(out.pixel(p,50,142),[187,17,34],
        'outer side border repainted on page '+p);
      assert.deepEqual(out.pixel(p,68,154),[18,122,62],
        'inner side border repainted on page '+p);
      assert.deepEqual(out.pixel(p,200,121),p===1?[187,17,34]:[238,244,255],
        'outer top border should not be repeated on continuation page '+p);
      assert.deepEqual(out.pixel(p,200,139),p===1?[18,122,62]:[237,249,236],
        'inner top border should not be repeated on continuation page '+p);
      assert.deepEqual(out.pixel(p,58,160),[238,244,255],
        'outer blue background retained throughout the continuation '+p);
      assert.deepEqual(out.pixel(p,85,143),[237,249,236],
        'inner green background retained throughout the continuation '+p);
      // Inspect the horizontal center of both frames. On intermediate pages,
      // no top or bottom cap should be painted. Last page closes both boxes.
      for(const [color,kind] of [
        [[187,17,34],'outer'],[[18,122,62],'nested']]){
        const count=Array.from({length:600},(_,i)=>i+120)
          .filter(y=>out.pixel(p,200,y).every((part,k)=>part===color[k])).length;
        assert.equal(count>0,p===1||p===out.pages,
          kind+' horizontal border must appear only at first/last page, p='+p);
      }
   }
 }finally{out.close();}
});

test('three nested decorated containers maintain independent edges and final trailing content',()=>{
 const rows=Array.from({length:85},(_,i)=>[
   'DEEPNODE_'+String(i+1).padStart(4,'0'),'DETAIL_'+String(i+1).padStart(4,'0')
 ]);
 const pdf=app.document({page:'Letter'})
 .box({padding:14,background:'#EEF4FF',border:{width:3,color:'#BB1122'}},outer=>{
   outer.box({padding:12,background:'#FFF2D9',border:{width:3,color:'#AD6600'}},middle=>{
     middle.box({padding:10,background:'#EDF9EC',border:{width:3,color:'#127A3E'}},inner=>
       inner.table(rows,{columns:[
         {title:'DEEP_REFERENCE',width:'45%'},{title:'DEEP_DETAIL',width:'55%'}
       ]})
     );
   });
   outer.paragraph('CLOSED_SECTION_TRAILER');
 }).renderSync();
 const out=inspect(pdf);
 try{
   assert.ok(out.pages>=3);
   const ids=[...out.text.matchAll(/DEEPNODE_(\d{4})/g)].map(m=>+m[1]);
   assert.deepEqual(ids,Array.from({length:85},(_,i)=>i+1));
   assert.equal((out.text.match(/CLOSED_SECTION_TRAILER/g)??[]).length,1);
   const tableLast=out.byPage.findLastIndex(page=>page.includes('DEEPNODE_'))+1;
   assert.ok(tableLast>=2 && tableLast<out.pages,
     'trailing section should close on a separate page');
   for(let p=1;p<=out.pages;p++){
     const tableActive=p<=tableLast;
     assert.equal((out.byPage[p-1].match(/DEEP_REFERENCE/g)??[]).length,
       tableActive?1:0,'table headers appear only on occupied pages');
     assert.deepEqual(out.pixel(p,400,121),p===1?[187,17,34]:[238,244,255]);
     assert.deepEqual(out.pixel(p,400,135),
       !tableActive?[238,244,255]:p===1?[173,102,0]:[255,242,217]);
     assert.deepEqual(out.pixel(p,400,147),
       !tableActive?[238,244,255]:p===1?[18,122,62]:[237,249,236]);
   }
   // Middle/inner boxes close on the final table page; the outer box
   // continues on its own page for the final sibling paragraph.
   for(const [color,lastPage] of [
     [[173,102,0],tableLast],[[18,122,62],tableLast],
     [[187,17,34],out.pages]
   ]){
     const occurrences=Array.from({length:600},(_,i)=>i+120)
       .filter(y=>out.pixel(lastPage,400,y).every((part,k)=>part===color[k]))
       .length;
     assert.ok(occurrences>0,'expected independent bottom border for '+color);
   }
 }finally{out.close();}
});
