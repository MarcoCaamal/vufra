import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFileSync,writeFileSync,mkdtempSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
const {createVufra}=createRequire(import.meta.url)('../dist/index.js');
const font=readFileSync(execFileSync('fc-match',['Noto Sans','-f','%{file}\n'],{encoding:'utf8'}).trim());
const app=createVufra({font});
function inspect(bytes){
 const file=join(mkdtempSync(join(tmpdir(),'vufra-odd-even-')),'report.pdf');
 writeFileSync(file,bytes);
 const pages=Number(execFileSync('pdfinfo',[file],{encoding:'utf8'}).match(/Pages:\s+(\d+)/)[1]);
 const texts=Array.from({length:pages},(_,i)=>execFileSync('pdftotext',[
  '-raw','-f',String(i+1),'-l',String(i+1),file,'-'],{encoding:'utf8'}));
 return {pages,texts};
}
const rows=Array.from({length:180},(_,i)=>['PAGEID_'+String(i+1).padStart(3,'0'),'AMOUNT_'+i]);
const columns=[{title:'ORDER_REF',width:'50%'},{title:'AMOUNT',width:'50%'}];
test('odd/even running headers and footers alternate correctly with page token substitution',()=>{
 const result=app.document({title:'Two-sided report',page:'Letter'})
  .header(h=>h.text('BASE_HEADER'))
  .footer(f=>f.text('BASE_FOOTER'))
  .oddHeader(h=>h.text('ODD_HEADER_{{page}}'))
  .evenHeader(h=>h.text('EVEN_HEADER_{{page}}'))
  .oddFooter(f=>f.text('ODD_FOOTER_{{page}}'))
  .evenFooter(f=>f.text('EVEN_FOOTER_{{page}}'))
  .table(rows,{columns});
 const out=inspect(result.renderSync());
 assert.ok(out.pages>=4);
 for(let page=1;page<=out.pages;page++){
   const text=out.texts[page-1];
   const parity=page%2?'ODD':'EVEN';
   assert.ok(text.includes(parity+'_HEADER_'+page),'header page '+page);
   assert.ok(text.includes(parity+'_FOOTER_'+page),'footer page '+page);
   assert.doesNotMatch(text,/BASE_HEADER|BASE_FOOTER/);
   assert.doesNotMatch(text,new RegExp((page%2?'EVEN':'ODD')+'_HEADER_'));
 }
 assert.deepEqual([...out.texts.join('').matchAll(/PAGEID_(\d{3})/g)].map(m=>+m[1]),
  Array.from({length:180},(_,i)=>i+1));
});
test('cover first-page suppression wins over odd headers, while later parity bands remain',()=>{
 const result=app.document({title:'Cover plus odd-even',page:'Letter'})
  .oddHeader(h=>h.text('ODD_ACTIVE'))
  .evenHeader(h=>h.text('EVEN_ACTIVE'))
  .oddFooter(f=>f.text('ODD_FOOT'))
  .evenFooter(f=>f.text('EVEN_FOOT'))
  .coverPage({padding:18},c=>c.heading('COVERPAGE_PARITY'))
  .table(rows,{columns});
 const out=inspect(result.renderSync());
 assert.ok(out.pages>=4);
 assert.match(out.texts[0],/COVERPAGE_PARITY/);
 assert.doesNotMatch(out.texts[0],/ODD_ACTIVE|EVEN_ACTIVE|ODD_FOOT|EVEN_FOOT/);
 assert.match(out.texts[1],/EVEN_ACTIVE/);
 assert.match(out.texts[1],/EVEN_FOOT/);
 assert.match(out.texts[2],/ODD_ACTIVE/);
 assert.match(out.texts[2],/ODD_FOOT/);
});
test('first page override and parity null suppressions take precedence over fallback',()=>{
 const out=inspect(app.document({page:'Letter'})
  .header(h=>h.text('BASE'))
  .firstHeader(h=>h.text('FIRST_SPECIAL'))
  .oddHeader(h=>h.text('ODD_SPECIAL'))
  .evenHeader(null)
  .table(rows,{columns}).renderSync());
 assert.match(out.texts[0],/FIRST_SPECIAL/);
 assert.doesNotMatch(out.texts[0],/ODD_SPECIAL|BASE/);
 assert.doesNotMatch(out.texts[1],/FIRST_SPECIAL|ODD_SPECIAL|BASE/);
 assert.match(out.texts[2],/ODD_SPECIAL/);
});
