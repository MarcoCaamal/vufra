// Unit 16: genuine embedded bold, nested rows/grids and explicit page policies.
// Usage: node examples/fluent-nested.mjs regular.ttf bold.ttf [output.pdf]
import {createRequire} from 'node:module';
import {readFileSync,writeFileSync} from 'node:fs';
const require=createRequire(import.meta.url);
const {createVufra}=require('../packages/vufra/dist/index.js');

const [regular,bold,out='artifacts/fluent-nested.pdf']=process.argv.slice(2);
if(!regular||!bold)throw new Error('Usage: node examples/fluent-nested.mjs regular.ttf bold.ttf [output.pdf]');
const app=createVufra({
  font:readFileSync(regular),
  fonts:{bold:readFileSync(bold)},
  theme:{colors:{navy:'#244A89',soft:'#EFF5FC',accent:'#007D74'},
    h2:{bold:true,color:'navy'}}
});
const clauses=Array.from({length:700},(_,i)=>
  'CLAUSE'+String(i+1).padStart(4,'0')).join(' ');
const document=app.document({title:'Vufra — Composite Enterprise Report',page:'Letter'})
  .heading('Regional business report',{bold:true})
  .paragraph('Composed in TypeScript and measured, paginated and painted in Rust.')
  .box({padding:18,background:'soft',border:{width:1,color:'navy'},
    keepWithNext:true},b=>{
    b.heading('Executive summary',{level:2});
    b.grid({columns:2,gap:14},g=>{
      g.cell(c=>c.heading('REVENUE',{level:3,bold:true})
        .paragraph('MXN 1,240,000',{bold:true,color:'navy'}));
      g.cell(c=>c.heading('CUSTOMERS',{level:3,bold:true})
        .paragraph('2,184 active accounts',{fontSize:12}));
      g.cell(c=>c.paragraph('GROWTH: +14%'));
      g.cell(c=>c.paragraph('STATUS: on track'));
    });
    b.divider({color:'accent',height:2});
    b.richText(t=>{
      t.add('Status: ');
      t.add('VERIFIED',{bold:true,color:'accent'});
      t.add(' — accounting and operational KPIs validated.');
    });
  })
  .paragraph('Executive metrics are followed immediately by the management commentary.')
  .box({padding:18,breakBefore:true,keepTogether:true,
    background:'#FFF5E7',border:{width:1,color:'#BD863D'}},b=>{
    b.heading('Action items',{level:2,bold:true});
    b.row({gap:14},r=>{
      r.column({width:'50%'},c=>{
        c.heading('Owner',{level:3,bold:true});
        c.paragraph('Operations team');
      });
      r.column({width:'50%'},c=>{
        c.heading('Due date',{level:3,bold:true});
        c.paragraph('31 October 2026');
      });
    });
  })
  .box({padding:17,border:{width:1,color:'navy'},background:'soft'},b=>{
    b.heading('Annex: service-level terms',{level:2,bold:true});
    b.paragraph(clauses,{fontSize:11,lineHeight:18});
    b.paragraph('ANNEX_END',{bold:true,color:'navy'});
  })
  .paragraph('END_OF_REPORT');

const pdf=await document.render();
writeFileSync(out,pdf);
console.log('Wrote',out,pdf.byteLength,'bytes');
