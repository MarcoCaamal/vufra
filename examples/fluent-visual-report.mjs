// Partial Units 40–42: first-page cover, center/vertical-align rows and native bars.
// node examples/fluent-visual-report.mjs REGULAR.ttf artifacts/fluent-visual-report.pdf
import {createRequire} from 'node:module';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
const require=createRequire(import.meta.url);
const {createVufra,barChart}=require('../packages/vufra/dist/index.js');
const [fontPath,destination='artifacts/fluent-visual-report.pdf']=process.argv.slice(2);
if(!fontPath)throw new Error('Expected TTF/OTF path');
const app=createVufra({font:readFileSync(fontPath),
  theme:{colors:{bars:'#14789F',panel:'#EFF6FD'}}});
const items=Array.from({length:145},(_,i)=>({
  label:'METRIC_'+String(i+1).padStart(3,'0'),value:(i*17)%112+1
}));
const doc=app.document({title:'Annual operations',page:'Letter'})
 .header(h=>h.text('ANNUAL_OPERATION_REPORT'))
 .footer(f=>f.text(({page,total})=>'Page '+page+' of '+total))
 .coverPage({padding:{top:30,right:20,bottom:18,left:32},minHeight:240,
   radius:12,background:'panel',border:{width:1,color:'#2A5A88'}},b=>b
   .heading('Annual Operations')
   .paragraph('Performance report and vector-based chart'))
 .heading('Key metrics')
 .row({gap:12},r=>r
   .column({width:'50%'},c=>c.paragraph('PERIOD_OCTOBER'))
   .column({width:'50%',align:'center',verticalAlign:'center',padding:{left:12,right:12}},
     c=>c.paragraph('STATUS_REVIEWED')))
 .add(barChart(items,{color:'bars',barHeight:12,gap:3}));
const bytes=doc.renderSync();
const path=resolve(destination);mkdirSync(dirname(path),{recursive:true});writeFileSync(path,bytes);
console.log('Wrote '+path+' with '+items.length+' metric bars');
