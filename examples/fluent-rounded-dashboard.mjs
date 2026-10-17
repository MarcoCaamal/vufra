// Enterprise dashboard with rounded fluent cards and a multi-page nested ledger.
// Usage: node examples/fluent-rounded-dashboard.mjs REGULAR.ttf BOLD.ttf [output.pdf]
import {createRequire} from 'node:module';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {dirname,resolve} from 'node:path';
const require=createRequire(import.meta.url);
const {createVufra,grid,box,paragraph}=require('../packages/vufra/dist/index.js');
const [regular,bold,target='artifacts/fluent-rounded-dashboard.pdf']=process.argv.slice(2);
if(!regular||!bold)throw Error('Expected regular and bold fonts');
const app=createVufra({
 font:readFileSync(regular),fonts:{bold:readFileSync(bold)},
 theme:{
  colors:{primary:'#173D78',edge:'#779ABF',soft:'#EEF4FF',inner:'#EDF9EC',
    good:'#127A3E'},
  presets:{
   text:{
    label:{color:'primary',bold:true,fontSize:11,spaceBefore:3,spaceAfter:5},
    chrome:{color:'primary',fontSize:9,spaceBefore:0,spaceAfter:0}
   },
   box:{
    card:{padding:14,radius:12,background:'soft',
      border:{width:2,color:'edge'}},
    panel:{padding:16,radius:15,background:'soft',
      border:{width:2,color:'primary'}},
    ledger:{padding:12,radius:10,background:'inner',
      border:{width:2,color:'good'}}
   }
  }
 }
});
const Card=(name,value,description)=>box({preset:'card'},[
 paragraph(name,{preset:'label'}),
 paragraph(value,{bold:true,fontSize:16}),
 paragraph(description,{fontSize:10})
]);
const metrics=Array.from({length:9},(_,i)=>Card(
 'KPI_'+String(i+1).padStart(3,'0'),
 'MXN '+String(18500+i*980),
 'Current period consolidated value'
));
const rows=Array.from({length:165},(_,i)=>[
  'ROUNDINV_'+String(i+1).padStart(4,'0'),
  i%17===0?{runs:[
    {text:'Priority ',bold:true,color:'#173D78'},
    {text:'corporate service '+(i+1)}
  ],background:'#E1F4DC'}:'Corporate service '+(i+1),
  'MXN '+(870+i*4)
]);
const doc=app.document({page:'Letter',title:'Rounded Dashboard & Ledger'})
 .header(h=>h.grid({columns:['2fr','1fr'],gap:12},g=>{
  g.cell(c=>c.paragraph('ROUNDED_COMPANY',{preset:'chrome'}));
  g.cell(c=>c.paragraph('QUARTERLY_2026',{preset:'chrome'}));
 }))
 .footer(f=>f.text('CONFIDENTIAL | OPERATIONS',{preset:'chrome'}))
 .heading('Quarterly financial dashboard',{bold:true})
 .paragraph('Reusable rounded cards, natural heights and automatic PDF pagination.')
 .add(grid({columns:{minWidth:150,maxColumns:3},gap:12,rowGap:12},metrics))
 .heading('Detailed operations',{bold:true})
 .box({preset:'panel'},outer=>{
   outer.paragraph('Rounded outer panel contains a paginated ledger.',
      {preset:'label'});
   outer.box({preset:'ledger'},inner=>inner
     .table(rows,{columns:[
       {title:'REFERENCE',width:'30%'},
       {title:'SERVICE',width:'45%'},
       {title:'AMOUNT',width:'25%',align:'right'}
     ]}));
   outer.paragraph('END_AUDIT_REPORT',{bold:true});
 })
 .paragraph('OUTSIDE_CONTAINER');
const file=resolve(target);
const pdf=await doc.render();
mkdirSync(dirname(file),{recursive:true});writeFileSync(file,pdf);
console.log(JSON.stringify({file,pdfBytes:pdf.length,cards:metrics.length,records:rows.length}));
