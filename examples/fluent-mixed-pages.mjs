// Mixed A4, Letter and landscape chapters in one native PDF.
// node examples/fluent-mixed-pages.mjs FONT.ttf artifacts/fluent-mixed-pages.pdf
import {createRequire} from 'node:module';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
const require=createRequire(import.meta.url);
const {createVufra}=require('../packages/vufra/dist/index.js');
const [fontPath,destination='artifacts/fluent-mixed-pages.pdf']=process.argv.slice(2);
if(!fontPath)throw new Error('Expected a TTF/OTF font path');
const app=createVufra({font:readFileSync(fontPath)});
const columns=[{title:'REFERENCE',width:'58%'},{title:'TOTAL',width:'42%',align:'right'}];
const records=(prefix,n)=>Array.from({length:n},(_,i)=>[
 prefix+'_'+String(i+1).padStart(3,'0'),'MXN '+(i*20+50)
]);
const doc=app.document({title:'Enterprise mixed geometry',page:'A4'})
 .coverPage({minHeight:200,padding:25,background:'#F0F6FB'},b=>b
   .heading('MIXED_PAPER_REPORT').paragraph('A4 cover • Letter operations • landscape finance'))
 .tableOfContents('INDEX_OF_SECTIONS')
 .linkTo('financial-summary','Go to the financial summary')
 .pageSection({title:'Operations',page:'Letter',
   header:h=>h.text('OPERATIONS_{{page}}')},b=>b
     .heading('OPERATIONS_CHAPTER')
     .table(records('OPER',112),{columns}))
 .pageSection({title:'Finance',page:{width:920,height:520,
   margins:{top:122,bottom:62,left:92,right:30}},
   header:h=>h.text('FINANCE_{{page}}')},b=>b
     .heading('FINANCE_CHAPTER')
     .table(records('FIN',85),{columns}))
 .anchor('financial-summary',b=>b.heading('FINANCIAL_SUMMARY').paragraph('197 ordered records'));
const pdf=doc.renderSync();
const path=resolve(destination);mkdirSync(dirname(path),{recursive:true});
writeFileSync(path,pdf);
console.log('Wrote '+path+' ('+pdf.length+' bytes, 197 ordered entries)');
