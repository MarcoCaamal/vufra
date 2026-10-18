// Native page masters: 3 chapters with independent running headers and footers.
// node examples/fluent-page-masters.mjs FONT.ttf artifacts/fluent-page-masters.pdf
import {createRequire} from 'node:module';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
const require=createRequire(import.meta.url);
const {createVufra}=require('../packages/vufra/dist/index.js');
const [fontPath,destination='artifacts/fluent-page-masters.pdf']=process.argv.slice(2);
if(!fontPath)throw new Error('Expected TTF/OTF path');
const app=createVufra({font:readFileSync(fontPath)});
const columns=[{title:'REFERENCE',width:'50%'},{title:'TOTAL',width:'50%',align:'right'}];
const records=(prefix,total)=>Array.from({length:total},(_,i)=>[
 prefix+'_'+String(i+1).padStart(3,'0'),'MXN '+(i*35+100)
]);
const doc=app.document({title:'Annual enterprise review',page:'Letter'})
 .coverPage({minHeight:240,padding:{top:36,right:20,bottom:24,left:28},
   background:'#E9F1FA',radius:12},b=>b
    .heading('Annual Enterprise Review')
    .paragraph('Operations • Finance • Quality'))
 .tableOfContents('INDEX_OF_CHAPTERS')
 .pageReference('Quality','See the Quality chapter')
 .pageSection({title:'Operations',firstHeader:h=>h.text('OPERATIONS_OPENING'),
   header:h=>h.text('OPERATIONS_MASTER'),
   footer:f=>f.text('OPERATIONS_PAGE_{{page}}_OF_{{total}}')},b=>b
     .heading('Operations')
     .box({padding:{top:12,left:14,right:10,bottom:12},minHeight:128,
       maxHeight:170,justifyContent:'space-between',background:'#EFF6FD'},card=>card
         .paragraph('PERIOD: OCTOBER')
         .paragraph('STATUS: APPROVED'))
     .row({justify:'space-between',gap:12},r=>r
       .column({width:225},c=>c.paragraph('PERIOD_OCTOBER'))
       .column({width:225},c=>c.paragraph('STATUS_APPROVED')))
     .table(records('OPS',115),{columns}))
 .pageSection({title:'Finance',firstHeader:h=>h.text('FINANCE_OPENING'),
   header:h=>h.text('FINANCE_MASTER'),
   footer:f=>f.text('FINANCE_PAGE_{{page}}_OF_{{total}}')},b=>b
     .heading('Finance')
     .table(records('FIN',110),{columns}))
 .pageSection({title:'Quality',firstHeader:h=>h.text('QUALITY_OPENING'),
   header:h=>h.text('QUALITY_MASTER'),
   footer:f=>f.text('QUALITY_PAGE_{{page}}_OF_{{total}}')},b=>b
     .heading('Quality')
     .table(records('QAS',100),{columns}));
const pdf=doc.renderSync();
const path=resolve(destination);mkdirSync(dirname(path),{recursive:true});writeFileSync(path,pdf);
console.log('Wrote '+path+' with 325 ordered records in three independent page masters');
