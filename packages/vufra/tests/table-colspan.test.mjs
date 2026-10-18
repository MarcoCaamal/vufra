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
const columns=[{title:'REF',width:'28%'},{title:'CATEGORY',width:'42%'},{title:'TOTAL',width:'30%'}];
function pdfCheck(bytes){
  const file=join(mkdtempSync(join(tmpdir(),'vufra-colspan-')),'check.pdf');
  writeFileSync(file,bytes);
  const raw=execFileSync('pdftotext',['-raw',file,'-'],{encoding:'utf8'});
  const pages=Number(execFileSync('pdfinfo',[file],{encoding:'utf8'}).match(/Pages:\s+(\d+)/)[1]);
  return {file,raw,pages};
}
test('colSpan rows use native merged column width and repeat header through long pages',()=>{
  const rows=[
    [{text:'MERGED_GROUP_HEADER',colSpan:3,background:'#DBF3FD',align:'center'}],
    ...Array.from({length:180},(_,i)=>[
      'ITEM_'+String(i+1).padStart(3,'0'),
      i===0?{text:'FIRST_PAIR',colSpan:2,background:'#EEF6FC'}:'CATEGORY_'+String(i+1).padStart(3,'0'),
      ...(i===0?[]:['$'+i])
    ])
  ];
  const builder=app.document({title:'Merged invoice',page:'Letter'}).table(rows,{columns});
  const snapshot=builder.toDocument();
  const table=snapshot.blocks[0].box.items[0].table;
  assert.equal(table.rows[0].columns.length,1);
  assert.equal(table.rows[0].columns[0].width,table.header.columns.reduce((a,c)=>a+c.width,0));
  assert.equal(table.rows[1].columns.length,2);
  assert.equal(table.rows[1].columns[1].width,table.header.columns[1].width+table.header.columns[2].width);
  const out=pdfCheck(builder.renderSync());
  assert.ok(out.pages>=3);
  assert.equal((out.raw.match(/MERGED_GROUP_HEADER/g)??[]).length,1);
  assert.equal((out.raw.match(/FIRST_PAIR/g)??[]).length,1);
  assert.deepEqual([...out.raw.matchAll(/ITEM_(\d{3})/g)].map(m=>+m[1]),Array.from({length:180},(_,i)=>i+1));
  for(let pg=1;pg<=out.pages;pg++){
    const page=execFileSync('pdftotext',['-raw','-f',String(pg),'-l',String(pg),out.file,'-'],{encoding:'utf8'});
    assert.equal((page.match(/\bREF\b/g)??[]).length,1,'header repeats on page '+pg);
  }
});
test('colSpan rejects invalid counts and invalid vertical merging',()=>{
  const good={columns};
  assert.throws(()=>app.document().table([[{text:'A',colSpan:0},'B','C']],good),/colSpan|rowSpan occupies these columns/);
  assert.throws(()=>app.document().table([[{text:'A',colSpan:4}]],good),/colSpan|rowSpan occupies these columns/);
  assert.throws(()=>app.document().table([[{text:'A',colSpan:1.5},'B','C']],good),/colSpan|rowSpan occupies these columns/);
  assert.throws(()=>app.document().table([[{text:'A',rowSpan:2},'B','C']],good),/rowSpan/);
  assert.throws(()=>app.document().table([[{text:'A',colSpan:2},'B','C']],good),/colSpan|rowSpan occupies these columns/);
});
