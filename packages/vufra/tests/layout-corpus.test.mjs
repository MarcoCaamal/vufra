import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {execFileSync} from 'node:child_process';
import {readFileSync,writeFileSync,mkdtempSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
const {createVufra}=createRequire(import.meta.url)('../dist/index.js');
const font=readFileSync(execFileSync('fc-match',['Noto Sans','-f','%{file}\n'],{encoding:'utf8'}).trim());
const app=createVufra({font});
const cols=[{title:'COL_A',width:'33%'},{title:'COL_B',width:'33%'},{title:'COL_C',width:'34%'}];
let seed=0x8acafe73;
function random(){seed^=seed<<13;seed^=seed>>>17;seed^=seed<<5;return (seed>>>0)/0x100000000;}
const rand=n=>Math.floor(random()*n);
function caseRows(id,n=20){
 const remaining=[0,0,0];
 const rows=[],labels=[];
 for(let row=0;row<n;row++){
  const cells=[];
  for(let col=0;col<3;col++){
   if(remaining[col]>0){remaining[col]--;continue;}
   const span=(random()<0.38)?Math.min(2+rand(3),n-row):1;
   const label='CORP_'+id+'_'+String(row).padStart(2,'0')+'_'+col;
   labels.push(label);
   cells.push({text:label,rowSpan:span,
     background:random()<0.5?'#F3F8FC':'#E5F3E6',
     border:{width:random()<0.5?0.5:1,color:'#6688AA'},
     padding:{top:1+rand(7),bottom:1+rand(7),left:1+rand(7),right:1+rand(7)}});
   remaining[col]=span-1;
  }
  rows.push(cells);
 }
 return {rows,labels};
}
test('deterministic corpus of 40 native spanning tables preserves all source labels and validates PDFs',()=>{
 const dir=mkdtempSync(join(tmpdir(),'vufra-corpus-'));
 for(let sample=0;sample<40;sample++){
  const {rows,labels}=caseRows(sample,19+rand(8));
  const pdf=app.document({page:'Letter',title:'Corpus '+sample})
   .box({padding:{left:8+rand(13),right:6+rand(9),top:4+rand(12),bottom:4+rand(10)},
     minHeight:sample%2?110:undefined},scope=>scope.table(rows,{columns:cols}))
   .renderSync();
  const file=join(dir,'sample-'+sample+'.pdf');writeFileSync(file,pdf);
  const actual=execFileSync('pdftotext',['-raw',file,'-'],{encoding:'utf8'});
  for(const label of labels){
   const hits=actual.split(label).length-1;
   assert.equal(hits,1,'sample '+sample+' '+label+' count='+hits);
  }
  assert.ok(pdf.length>1000);
 }
});
