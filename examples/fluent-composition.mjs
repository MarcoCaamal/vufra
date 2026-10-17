// Unit 19 — Fluent chaining + reusable functional nodes, no headless browser.
// Usage: node examples/fluent-composition.mjs REGULAR.ttf BOLD.ttf [output.pdf]
import {createRequire} from 'node:module';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
const require=createRequire(import.meta.url);
const {createVufra,box,paragraph,heading,image,grid,table}=require('../packages/vufra/dist/index.js');
const [regularPath,boldPath,dest='artifacts/fluent-composition.pdf']=process.argv.slice(2);
if(!regularPath||!boldPath)throw new Error('Use regular and bold TTF/OTF file paths');
const font=readFileSync(regularPath),bold=readFileSync(boldPath);
const logo=readFileSync(new URL('../packages/vufra/tests/fixtures/two-tone.png',import.meta.url));
const app=createVufra({font,fonts:{bold},theme:{colors:{card:'#EEF4FF',accent:'#173D78'}}});

function MetricCard(name,value){
  return box({padding:14,background:'card',border:{width:1,color:'accent'}},[
    paragraph(name,{fontSize:11}),
    paragraph(value,{fontSize:16,bold:true,color:'accent'})
  ]);
}
const invoices=Array.from({length:15},(_,i)=>[
  'DOC'+String(i+1).padStart(3,'0'),
  'Annual corporate service '+(i+1),
  '$'+(i+1)*15
]);
const pdf=await app.document({title:'ACME composition demo',page:'Letter'})
  .header(h=>h.text('ACME / FY2026',{bold:true,fontSize:12}))
  .footer(f=>f.text(({page,total})=>'Page '+page+' of '+total))
  .heading('Executive Overview')
  .paragraph('This report uses both Fluent chaining and reusable node functions.')
  .add(box({padding:16,background:'#FFFFFF',border:{width:1,color:'accent'}},[
    heading('Performance highlights',{level:2}),
    image(logo,{width:80,height:40}),
    grid({columns:2,gap:10},[
      paragraph('REGIONAL_REVENUE'),
      paragraph('REGIONAL_COSTS')
    ]),
    MetricCard('NET_REVENUE','$125,000'),
    MetricCard('COST_OF_SALES','$42,000'),
    table(invoices,{columns:[
      {title:'Reference',width:'22%'},
      {title:'Service',width:'53%'},
      {title:'Amount',width:'25%',align:'right'}
    ]}),
    paragraph('SUMMARY_COMPLETE',{bold:true})
  ]))
  .paragraph('Report issued for internal use.')
  .render();
const path=resolve(dest);
mkdirSync(dirname(path),{recursive:true});
writeFileSync(path,pdf);
console.log('Generated '+path+' ('+pdf.byteLength+' bytes; '+invoices.length+' invoice rows)');
