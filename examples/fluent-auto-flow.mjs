// Responsive PDF cards using the same Fluent API for the page and nested boxes.
// Usage: node examples/fluent-auto-flow.mjs REGULAR.ttf BOLD.ttf [output.pdf]
import {createRequire} from 'node:module';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {dirname,resolve} from 'node:path';
const require=createRequire(import.meta.url);
const {createVufra,grid,box,paragraph}=require('../packages/vufra/dist/index.js');
const [regularPath,boldPath,destination='artifacts/fluent-auto-flow.pdf']=process.argv.slice(2);
if(!regularPath||!boldPath)throw Error('Provide regular and bold fonts');
const pdfFactory=createVufra({
  font:readFileSync(regularPath),fonts:{bold:readFileSync(boldPath)},
  theme:{colors:{
    navy:'#173D78',muted:'#5C6D83',panel:'#EDF4FB',border:'#C6D4E3'
  },presets:{
    text:{label:{fontSize:10,bold:true,color:'navy',spaceBefore:2,spaceAfter:4},
      quiet:{fontSize:10,color:'muted',spaceBefore:2,spaceAfter:3}},
    box:{card:{padding:10,background:'panel',border:{color:'border',width:1}},
      section:{padding:14,background:'#FFFFFF',border:{color:'border',width:1}}}
  }}
});
const metrics=Array.from({length:37},(_,i)=>({
  code:'KPI_'+String(i+1).padStart(3,'0'),
  value:'MXN '+String(21000+i*119),
  note:'This metric tracks revenue and customer activity '+(i%5===0
    ?'with an extended explanatory note for management':'')
}));
const metricCard=m=>box({preset:'card'},[
  paragraph(m.code,{preset:'label'}),
  paragraph(m.value,{bold:true,fontSize:12,spaceBefore:4,spaceAfter:4}),
  paragraph(m.note,{preset:'quiet'})
]);
const entries=Array.from({length:175},(_,i)=>[
  'TX'+String(i+1).padStart(4,'0'),
  'Professional services '+(i+1),
  'MXN '+String(540+i*7)
]);
const report=pdfFactory.document({page:'Letter',title:'Automatic Layout Report'})
  .header(h=>h.grid({columns:{minWidth:190,maxColumns:2},gap:12},g=>{
    g.cell(c=>c.paragraph('AUTO_LAYOUT_REPORT',{preset:'label'}));
    g.cell(c=>c.paragraph('FY2026 | NORTH REGION',{preset:'quiet'}));
  }))
  .footer(f=>f.text('INTERNAL DOCUMENT',{preset:'quiet'}))
  .heading('Operations dashboard',{level:1})
  .paragraph('Automatic card widths, natural heights and page-safe flowing content.')
  .add(grid({columns:{minWidth:150,maxColumns:3},gap:12,rowGap:12},
    metrics.map(metricCard)))
  .section('Flexible subsidiary panel',s=>s.box({
    preset:'section',width:370,align:'center'
  },panel=>panel
    .paragraph('The same auto layout fits two cards in this narrower area.',
      {preset:'quiet'})
    .grid({columns:{minWidth:150,maxColumns:3},gap:10,rowGap:10},g=>{
      g.cell(c=>c.add(metricCard({
        code:'PANEL_A',value:'24%',note:'Current regional goal'
      })));
      g.cell(c=>c.add(metricCard({
        code:'PANEL_B',value:'13%',note:'Pipeline review'
      })));
    })
  ))
  .section('Itemized transactions',s=>s
    .paragraph('The following records paginate without manual heights or positions.')
    .table(entries,{columns:[
      {title:'REFERENCE',width:'26%'},{title:'DESCRIPTION',width:'46%'},
      {title:'AMOUNT',width:'28%'}
    ]}));
const file=resolve(destination);
const result=await report.render();
mkdirSync(dirname(file),{recursive:true});
writeFileSync(file,result);
console.log(JSON.stringify({file,bytes:result.length,cards:metrics.length,rows:entries.length}));
