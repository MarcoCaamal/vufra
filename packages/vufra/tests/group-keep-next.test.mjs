import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {execFileSync} from 'node:child_process';
import {readFileSync,writeFileSync,mkdtempSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
const {createVufra,groupTableRows}=createRequire(import.meta.url)('../dist/index.js');
const font=readFileSync(execFileSync('fc-match',['Noto Sans','-f','%{file}\n'],{encoding:'utf8'}).trim());
const app=createVufra({font});
const columns=[{title:'REFERENCE',width:'45%'},{title:'AMOUNT',width:'55%'}];
function inspect(builder){
 const file=join(mkdtempSync(join(tmpdir(),'vufra39-group-')),'groups.pdf');
 writeFileSync(file,builder.renderSync());
 const pages=Number(execFileSync('pdfinfo',[file],{encoding:'utf8'}).match(/Pages:\s+(\d+)/)[1]);
 const texts=Array.from({length:pages},(_,i)=>execFileSync('pdftotext',[
  '-raw','-f',String(i+1),'-l',String(i+1),file,'-'],{encoding:'utf8'}));
 const which=t=>texts.findIndex(x=>x.includes(t));
 return {file,pages,texts,which};
}
test('group header and first following table row stay together at a page boundary',()=>{
 const base=Array.from({length:39},(_,i)=>['ITEM_'+String(i+1).padStart(3,'0'),'$1']);
 const heading=[{text:'NEXT_DEPARTMENT',colSpan:2}];
 const rows=[...base,heading,['NEXT_FIRST','$2'],['NEXT_SECOND','$3']];
 const original=inspect(app.document({page:'Letter'}).table(rows,{columns}));
 assert.ok(original.which('NEXT_DEPARTMENT')<original.which('NEXT_FIRST'),
  'unprotected reference layout must orphan the group heading on this fixture');
 const protectedRows=[...base,[{...heading[0],keepWithNext:true}],
  ['NEXT_FIRST','$2'],['NEXT_SECOND','$3']];
 const fixed=inspect(app.document({page:'Letter'}).table(protectedRows,{columns}));
 assert.equal(fixed.which('NEXT_DEPARTMENT'),fixed.which('NEXT_FIRST'));
 assert.ok(fixed.which('NEXT_DEPARTMENT')>0);
 assert.deepEqual([...fixed.texts.join('').matchAll(/ITEM_(\d{3})/g)].map(m=>+m[1]),
  Array.from({length:39},(_,i)=>i+1));
 for(const page of fixed.texts)assert.equal((page.match(/REFERENCE/g)??[]).length,1);
});
test('groupTableRows automatically keeps the label beside its first data row, even when nested',()=>{
 const groups=[
  {title:'DEPARTMENT_ALPHA',rows:Array.from({length:39},(_,i)=>['GROUP_'+String(i+1).padStart(3,'0'),'$1'])},
  {title:'DEPARTMENT_BETA',rows:[['BETA_FIRST','$5'],['BETA_SECOND','$8']]}
 ];
 const rows=groupTableRows(groups,2);
 assert.equal(rows[0][0].keepWithNext,true);
 assert.equal(rows[40][0].keepWithNext,true);
 const result=inspect(app.document({page:'Letter'})
  .box({padding:12,background:'#F2F6FE'},b=>b.table(rows,{columns})));
 assert.equal(result.which('DEPARTMENT_BETA'),result.which('BETA_FIRST'));
 assert.equal((result.texts.join('').match(/DEPARTMENT_BETA/g)??[]).length,1);
 assert.equal((result.texts.join('').match(/BETA_SECOND/g)??[]).length,1);
});
test('keepWithNext rejects invalid positions, invalid types and trailing headings',()=>{
 const doc=app.document({page:'Letter'});
 assert.throws(()=>doc.table([[{text:'A',keepWithNext:true},'B']],{columns}),/keepWithNext/);
 assert.throws(()=>doc.table([[{text:'A',colSpan:2,keepWithNext:true}]],{columns}),/following body row/);
 assert.throws(()=>doc.table([[{text:'A',colSpan:2,keepWithNext:4}],['B','C']],{columns}),/keepWithNext/);

});
