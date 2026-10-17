// Styled report without repeating box/text geometry across each KPI or section.
// Usage: node examples/fluent-style-presets.mjs REGULAR.ttf BOLD.ttf [output.pdf]
import {createRequire} from 'node:module';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {dirname,resolve} from 'node:path';

const require=createRequire(import.meta.url);
const {createVufra,box,paragraph,grid}=require('../packages/vufra/dist/index.js');
const [regularPath,boldPath,target='artifacts/fluent-style-presets.pdf']=process.argv.slice(2);
if(!regularPath||!boldPath)throw new Error('Expected regular and bold TTF/OTF fonts.');
const engine=createVufra({
  font:readFileSync(regularPath),
  fonts:{bold:readFileSync(boldPath)},
  theme:{
    colors:{
      navy:'#173D78',muted:'#52647C',paper:'#EDF4FC',
      border:'#BDCEE0',positive:'#176344',accent:'#F1F7F4'
    },
    text:{color:'navy'},
    presets:{
      text:{
        eyebrow:{fontSize:10,bold:true,color:'muted',spaceBefore:3,spaceAfter:3},
        metric:{fontSize:17,bold:true,color:'navy',spaceBefore:4,spaceAfter:5},
        title:{fontSize:15,bold:true,color:'navy',spaceBefore:6,spaceAfter:6},
        chrome:{fontSize:9,color:'muted',spaceBefore:0,spaceAfter:0},
        status:{fontSize:11,bold:true,color:'positive',spaceBefore:3,spaceAfter:4}
      },
      box:{
        card:{padding:12,background:'paper',border:{width:1,color:'border'}},
        panel:{padding:15,background:'#FFFFFF',border:{width:1,color:'border'}},
        success:{padding:12,background:'accent',border:{width:1,color:'positive'}}
      }
    }
  }
});
const logo=readFileSync(new URL('../packages/vufra/tests/fixtures/two-tone.png',import.meta.url));
const MetricCard=(label,value)=>box({preset:'card'},[
  paragraph(label,{preset:'eyebrow'}),
  paragraph(value,{preset:'metric'})
]);
const overview=grid({columns:['2fr','1fr'],gap:12},[
  MetricCard('REVENUE_SUMMARY','MXN 842,560'),
  MetricCard('ORDERS_SUMMARY','1,240'),
  MetricCard('CUSTOMER_SUMMARY','580'),
  MetricCard('RETENTION_SUMMARY','94%')
]);
const rows=Array.from({length:175},(_,i)=>[
  'IN'+String(i+1).padStart(4,'0'),
  'Professional services agreement '+(i+1),
  {text:'MXN '+(550+i*9),align:'right'}
]);
const doc=engine.document({title:'Styled Operations Report',page:'Letter'})
  .header(h=>h.grid({columns:[90,'1fr'],gap:14},g=>{
    g.cell(c=>c.image(logo,{width:75,height:36}));
    g.cell(c=>c.paragraph('NORTH_REPORT',{preset:'eyebrow'}));
  }))
  .footer(f=>f.grid({columns:['2fr','1fr']},g=>{
    g.cell(c=>c.paragraph('CONFIDENTIAL',{preset:'chrome'}));
    g.cell(c=>c.paragraph('FY2026',{preset:'chrome'}));
  }))
  .heading('Quarterly business overview',{preset:'title',fontSize:20})
  .paragraph('Consistent cards and reusable styles across a complete PDF.')
  .add(overview)
  .box({preset:'panel'},b=>b
    .heading('Executive observation',{preset:'title'})
    .paragraph('Validated finance operations and consistent transaction data.')
    .box({preset:'success',padding:10},n=>n
      .paragraph('AUDIT_COMPLETE',{preset:'status'})))
  .section('Transaction details',section=>section
    .paragraph('Service records with repeated table headings.')
    .table(rows,{columns:[
      {title:'REFERENCE',width:'25%'},{title:'DESCRIPTION',width:'50%'},
      {title:'AMOUNT',width:'25%',align:'right'}
    ]}));
const file=resolve(target);
const pdf=await doc.render();
mkdirSync(dirname(file),{recursive:true});
writeFileSync(file,pdf);
console.log(JSON.stringify({pdf:file,pages:'check with pdfinfo',rows:rows.length,bytes:pdf.length}));
