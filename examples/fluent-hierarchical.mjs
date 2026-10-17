// Vufra Unit20: writer-independent hierarchical layout, page-spanning boxes,
// repeated nested table headers and fragmentable rich Row columns.
// Usage: node examples/fluent-hierarchical.mjs REGULAR.ttf BOLD.ttf [OUTPUT.pdf]
import {createRequire} from 'node:module';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {dirname,resolve} from 'node:path';
const require=createRequire(import.meta.url);
const {createVufra,box,paragraph,heading,table}=require('../packages/vufra/dist/index.js');

const [regularPath,boldPath,dest='artifacts/fluent-hierarchical.pdf']=process.argv.slice(2);
if(!regularPath||!boldPath)throw new Error('Pass regular & bold font file paths');
const engine=createVufra({
  font:readFileSync(regularPath),
  fonts:{bold:readFileSync(boldPath)}
});

const statements=Array.from({length:210},(_,i)=>
  paragraph('STATEMENT_'+String(i+1).padStart(4,'0')+' / quarterly audit line'));
const invoiceRows=Array.from({length:160},(_,i)=>[
  'INVOICE_'+String(i+1).padStart(4,'0'),
  'Service '+(i+1),
  '$'+(i+1)*11
]);

const pdf=await engine.document({title:'Vufra / Hierarchical Layout',page:'Letter'})
  .header(b=>b.text('ACME / FY2026',{bold:true}))
  .footer(b=>b.text(({page,total})=>'Page '+page+' of '+total))
  .heading('Hierarchical page layout')
  .add(box({padding:18,background:'#EDF2FF',border:{color:'#4466BB',width:1}},[
    heading('Many paragraphs inside nested panels'),
    box({padding:14,background:'#F1F9F2',border:{color:'#338855',width:1}},[
      box({padding:11,background:'#FFF5E9'},statements),
      paragraph('AFTER_STATEMENT_PANEL')
    ]),
    paragraph('AFTER_NESTED_PANEL'),
    box({padding:10,background:'#FFFFFF'},[
      table(invoiceRows,{columns:[
        {title:'Invoice',width:'26%'},
        {title:'Details',width:'49%'},
        {title:'Amount',width:'25%',align:'right'}
      ]})
    ]),
    paragraph('AFTER_TABLE_PANEL')
  ]))
  .heading('Parallel columns continue across pages')
  .row(r=>r
    .column({width:'50%'},c=>{
      for(let i=1;i<=45;i++)c.paragraph('LEFT_COL_'+String(i).padStart(3,'0'));
    })
    .column({width:'50%'},c=>{
      for(let i=1;i<=39;i++)c.paragraph('RIGHT_COL_'+String(i).padStart(3,'0'));
    })
  )
  .paragraph('END_OF_REPORT')
  .render();
const destPath=resolve(dest);
mkdirSync(dirname(destPath),{recursive:true});
writeFileSync(destPath,pdf);
console.log('Saved '+destPath+' ('+pdf.byteLength+' bytes, '+statements.length+
  ' statements, '+invoiceRows.length+' invoices, 45/39 column items)');
