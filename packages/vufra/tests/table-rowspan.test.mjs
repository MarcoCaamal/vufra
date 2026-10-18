import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFileSync,writeFileSync,mkdtempSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
const require=createRequire(import.meta.url);
const {createVufra}=require('../dist/index.js');
const {renderPdf}=require('../dist/renderer.js');
const font=readFileSync(execFileSync('fc-match',['Noto Sans','-f','%{file}\n'],{encoding:'utf8'}).trim());
const app=createVufra({font});
const columns=[{title:'DEPARTMENT',width:'34%'},{title:'ACTIVITY',width:'40%'},{title:'AMOUNT',width:'26%'}];
function pixelAt(file,page,x,y){
 const img=execFileSync('pdftoppm',['-f',String(page),'-l',String(page),
  '-r','72','-singlefile',file],{maxBuffer:4*1024*1024});
 const head=img.subarray(0,100).toString('latin1').match(/^P6\s+(\d+)\s+(\d+)\s+255\s/);
 assert.ok(head,'Poppler emitted PPM');
 const index=head[0].length+(Math.round(y)*Number(head[1])+Math.round(x))*3;
 return [...img.subarray(index,index+3)];
}
function inspect(bytes){
 const file=join(mkdtempSync(join(tmpdir(),'vufra-rowspan-')),'span.pdf');writeFileSync(file,bytes);
 const pages=Number(execFileSync('pdfinfo',[file],{encoding:'utf8'}).match(/Pages:\s+(\d+)/)[1]);
 const texts=Array.from({length:pages},(_,i)=>execFileSync('pdftotext',[
  '-raw','-f',String(i+1),'-l',String(i+1),file,'-'],{encoding:'utf8'}));
 const words=[...execFileSync('pdftotext',['-bbox',file,'-'],{encoding:'utf8'})
  .matchAll(/<word xMin="([\d.]+)" yMin="([\d.]+)" xMax="([\d.]+)" yMax="([\d.]+)">([^<]+)<\/word>/g)]
  .map(m=>({x:+m[1],y:+m[2],end:+m[3],text:m[5]}));
 return {file,pages,texts,words,which(t){return texts.findIndex(page=>page.includes(t));}};
}
test('rowSpan creates native painted regions, alongside horizontal spans, without repeated label',()=>{
 const rows=[
  [{text:'NORTH_DIVISION',rowSpan:3,colSpan:2,background:'#FFEECC',border:{width:2,color:'#1379AC'}},'$11'],
  ['$12'],['$13'],
  ['SOUTH_DIVISION',{text:'OPERATIONS',colSpan:2}],
  ['OTHER','WORK','$44']
 ];
 const doc=app.document({title:'RowSpan Native',page:'Letter'}).table(rows,{columns});
 const t=doc.toDocument().blocks[0].box.items[0].table;
 assert.deepEqual(t.rowSpans,[{row:0,column:0,colSpan:2,rowSpan:3}]);
 assert.equal(t.rows[1].columns.length,2);
 assert.equal(t.rows[1].columns[0].items[0].type,'spacer');
 assert.equal(t.rows[1].columns[0].width,t.header.columns[0].width+t.header.columns[1].width);
 const result=inspect(doc.renderSync());
 assert.equal(result.pages,1);
 for(const token of ['NORTH_DIVISION','SOUTH_DIVISION','OPERATIONS','$11','$12','$13','$44'])
  assert.equal(result.texts.join('').split(token).length-1,1,'token '+token);
});
test('rowSpan carries background, side edges and one owner text across page boundaries',()=>{
 const filler=Array.from({length:39},(_,i)=>['START_'+String(i+1).padStart(3,'0'),'ACT_'+i,'$1']);
 const rows=[...filler,
  [{text:'CROSS_PAGE_ROWSPAN',rowSpan:4,background:'#F6D5A7',border:{width:2,color:'#14789F'}},'CROSS_ACTIVITY_1','$2'],
  ['CROSS_ACTIVITY_2','$3'],['CROSS_ACTIVITY_3','$4'],['CROSS_ACTIVITY_4','$5'],
  ...Array.from({length:100},(_,i)=>['AFTER_'+String(i+1).padStart(3,'0'),'OTHER','$9'])
 ];
 const result=inspect(app.document({title:'Long vertical spans',page:'Letter'}).table(rows,{columns}).renderSync());
 assert.ok(result.pages>=3);
 assert.equal((result.texts.join('').match(/CROSS_PAGE_ROWSPAN/g)??[]).length,1);
 for(let n=1;n<=4;n++)assert.equal(result.texts.join('').split('CROSS_ACTIVITY_'+n).length-1,1);
 const allIds=[...result.texts.join('').matchAll(/(?:START|AFTER)_(\d{3})/g)];
 assert.equal(allIds.length,139);
 const first=result.which('CROSS_ACTIVITY_1'),last=result.which('CROSS_ACTIVITY_4');
 assert.ok(first<last,'rowSpan must really cross a page boundary, not just a single page');
 const owned=result.words.filter(w=>w.text.startsWith('CROSS_ACTIVITY_'));
 const pagesByWord=owned.map(w=>result.which(w.text)+1);
 const at2=owned.find(w=>w.text==='CROSS_ACTIVITY_2');
 const at4=owned.find(w=>w.text==='CROSS_ACTIVITY_4');
 for(const [word,page] of [[at2,pagesByWord[1]],[at4,pagesByWord[3]]]){
   assert.ok(word);
   // The leftmost spanning cell carries the same source fill, independent of
   // the page-local zebra background of the activity cells.
   assert.deepEqual(pixelAt(result.file,page,70,word.y+1),[246,213,167]);
 }

 for(const page of result.texts)assert.equal((page.match(/DEPARTMENT/g)??[]).length,1);
});
test('rowSpan rejects overlapping ranges, oversized spans, extra cells and unsupported vertical centering',()=>{
 const opts={columns};
 assert.throws(()=>app.document().table([[{text:'A',rowSpan:0},'B','C']],opts),/rowSpan/);
 assert.throws(()=>app.document().table([[{text:'A',rowSpan:2},'B','C']],opts),/rowSpan/);
 assert.throws(()=>app.document().table([[{text:'A',rowSpan:2,verticalAlign:'bottom'},'B','C'],['D','E']],opts),/verticalAlign/);
 assert.throws(()=>app.document().table([[{text:'A',rowSpan:2},'B','C'],['X','Y','Z']],opts),/rowSpan occupies these columns/);
 assert.throws(()=>app.document().table([[{text:'A',rowSpan:2,colSpan:2},'C'],['D','E']],opts),/too many cells/);
 const bad=app.document({page:'Letter'}).table([[{text:'A',rowSpan:2},'B','C'],['D','E']],opts).toDocument();
 bad.blocks[0].box.items[0].table.rowSpans[0].rowSpan=999;
 assert.throws(()=>renderPdf(bad,font),/invalid table rowSpan/);
});
