// Vufra Unit21: rich text fragmentation in rows and styled table cells.
// Usage: node examples/fluent-rich-pagination.mjs REGULAR.ttf BOLD.ttf [out.pdf]
import {createRequire} from 'node:module';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {dirname,resolve} from 'node:path';
const require=createRequire(import.meta.url);
const {createVufra}=require('../packages/vufra/dist/index.js');
const [regularPath,boldPath,out='artifacts/fluent-rich-pagination.pdf']=process.argv.slice(2);
if(!regularPath||!boldPath)throw new Error('Provide regular and bold font paths');
const engine=createVufra({font:readFileSync(regularPath),fonts:{bold:readFileSync(boldPath)}});
const seq=(prefix,n)=>Array.from({length:n},(_,i)=>
  prefix+String(i+1).padStart(4,'0')).join(' ')+' ';
const count=170;
const pdf=await engine.document({title:'Rich financial report',page:'Letter'})
  .header(h=>h.text('ACME / Rich report 2026',{bold:true}))
  .footer(f=>f.text(({page,total})=>'Page '+page+' of '+total))
  .heading('Styled ledger / multipage cells')
  .box({padding:14,background:'#FAFCFF'},b=>b.tableStyled([
    ['LEDGER_1',{runs:[
      {text:seq('ITEMRED_',count),bold:true,color:'#BB3344'},
      {text:seq('ITEMREG_',count)}
    ],background:'#E1F4DC'}],
    ['LEDGER_2','Last row of the report']
  ],{columns:[{title:'ID',width:'30%'},{title:'Notes',width:'70%'}]}))
  .heading('Long rich two-column appendix')
  .row(r=>r
    .column({width:'55%'},c=>c.richText(t=>{
      t.add(seq('COLBOLD_',145),{bold:true,color:'#BB3344'});
      t.add(seq('COLREG_',145));
    },{fontSize:11,lineHeight:18}))
    .column({width:'45%'},c=>c.paragraph(seq('COLRIGHT_',90))))
  .paragraph('END_OF_RICH_REPORT')
  .render();
const dest=resolve(out);
mkdirSync(dirname(dest),{recursive:true});
writeFileSync(dest,pdf);
console.log('Saved '+dest+' ('+pdf.length+' bytes)');
