// Page-aware sections use the same Fluent syntax, now with fewer orphan headings.
// Usage: node examples/fluent-page-aware-sections.mjs REGULAR.ttf BOLD.ttf [output.pdf]
import {createRequire} from 'node:module';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
const require=createRequire(import.meta.url);
const {createVufra}=require('../packages/vufra/dist/index.js');
const [regular,bold,destination='artifacts/fluent-page-aware-sections.pdf']=process.argv.slice(2);
if(!regular||!bold)throw Error('Provide regular and bold font files');
const logo=readFileSync(new URL('../packages/vufra/tests/fixtures/two-tone.png',import.meta.url));
const engine=createVufra({
 font:readFileSync(regular),fonts:{bold:readFileSync(bold)},
 theme:{
  colors:{navy:'#163E74',muted:'#596A80',panel:'#F1F5FC',edge:'#C6D3E3'},
  presets:{
   text:{title:{bold:true,fontSize:16,color:'navy'},muted:{fontSize:10,color:'muted'}},
   box:{card:{padding:12,background:'panel',border:{width:1,color:'edge'}}}
  }
 }
});
const movements=Array.from({length:185},(_,i)=>[
 'INV_'+String(i+1).padStart(4,'0'),
 'Monthly service and operations '+(i+1),
 {text:'MXN '+(620+i*7),align:'right'}
]);
const report=engine.document({page:'Letter',title:'Statement: Page-Aware Flow'})
 .header(h=>h.grid({columns:[200,'1fr'],gap:12},g=>{
   g.cell(c=>c.paragraph('VUFRA_OPERATIONS',{preset:'muted'}));
   g.cell(c=>c.paragraph('QUARTERLY_STATEMENT',{preset:'muted'}));
 }))
 .footer(f=>f.text('CONTROLLED_REPORT',{preset:'muted'}))
 .heading('Monthly operations report',{preset:'title'})
 .paragraph('A fully flowing statement with coherent section headings and tables.')
 // Deliberately approach the end of the page. The next header, its gap
 // and the first visible box must move together rather than orphaning.
 .spacer(440)
 .heading('EXECUTIVE_SUMMARY',{preset:'title'})
 .spacer(14)
 .box({preset:'card',keepTogether:true},b=>b
   .paragraph('BUSINESS_RESULT',{bold:true,fontSize:11})
   .paragraph('All opening balances and payments have been reviewed.')
   .paragraph('No manual page coordinates are used.'))
 .section('STATEMENT_DETAILS',section=>section
   .spacer(12)
   .table(movements,{columns:[
      {title:'REFERENCE',width:'27%'},{title:'DETAIL',width:'46%'},
      {title:'VALUE',width:'27%',align:'right'}
   ]})
 )
 .section('Closing observations',section=>section
   .spacer(9)
   .paragraph('END_OF_STATEMENT'));
const path=resolve(destination);
const pdf=await report.render();
mkdirSync(dirname(path),{recursive:true});
writeFileSync(path,pdf);
console.log(JSON.stringify({pdf:path,bytes:pdf.length,records:movements.length}));
