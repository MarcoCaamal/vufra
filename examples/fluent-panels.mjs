// Unit 15: polished invoice with real decorative boxes and a long split panel.
// Usage: node examples/fluent-panels.mjs regular.ttf bold.ttf [output.pdf]
import {createRequire} from 'node:module';
import {readFileSync,writeFileSync} from 'node:fs';
const require=createRequire(import.meta.url);
const {createVufra}=require('../packages/vufra/dist/index.js');
const [regular,bold,destination='artifacts/fluent-panels.pdf']=process.argv.slice(2);
if(!regular||!bold)throw new Error('Supply regular and bold TTF/OTF file paths');
const app=createVufra({
 font:readFileSync(regular),fonts:{bold:readFileSync(bold)},
 theme:{colors:{primary:'#244A89',accent:'#008F88',soft:'#EFF5FC',warm:'#FFF7E8'},
   h1:{bold:true,fontSize:25,color:'primary'}
 }
});
const services=Array.from({length:110},(_,i)=>({
 service:'SERV-'+String(i+1).padStart(4,'0'),
 units:String(i%4+1),
 amount:(125+i*1.75).toFixed(2)
}));
const terms=Array.from({length:500},(_,i)=>
 'TERM'+String(i+1).padStart(4,'0')).join(' ');
const doc=app.document({title:'Vufra - Enterprise Invoice',page:'Letter',
 margins:{left:52,right:52}})
 .heading('Enterprise invoice')
 .paragraph('Document layout example rendered entirely with Vufra in Rust.')
 .row({gap:20},r=>{
   r.column({width:'50%'},c=>{
     c.heading('SERVICE PROVIDER',{level:3});
     c.paragraph('Vufra Engineering LLC');
     c.paragraph('Mexico - QR');
   });
   r.column({width:'50%',align:'right'},c=>{
     c.heading('INVOICE 2026-014',{level:3});
     c.paragraph('Issued: 16 October 2026');
     c.paragraph('Reference: VF-014');
   });
 })
 .spacer(12)
 .box({padding:15,background:'soft',border:{width:1.5,color:'primary'}},box=>{
   box.heading('Account summary',{level:2,color:'primary'});
   box.paragraph('Customer: Example Organization');
   box.paragraph('Payment terms: Net 30 days');
   box.divider({height:2,color:'accent'});
   box.paragraph('Items are measured and paginated natively; no browser renderer required.');
 })
 .spacer(10)
 .box({width:310,align:'right',padding:14,background:'warm',
   border:{width:1,color:'#E0AD53'}},b=>{
     b.paragraph('ESTIMATED TOTAL',{fontSize:12,color:'#795522'});
     b.heading('MXN 44,980.00',{level:2,color:'#795522'});
 })
 .heading('Detailed services')
 .table(services.map(p=>[p.service,p.units,p.amount]),{columns:[
   {title:'Service',width:'*'},
   {title:'Units',width:75},
   {title:'Amount',width:120}
 ]})
 .box({padding:15,background:'soft',border:{width:1,color:'primary'}},b=>{
   b.heading('Additional service conditions',{level:2,color:'primary'});
   b.paragraph(terms,{fontSize:11,lineHeight:17});
   b.paragraph('END_OF_TERMS',{fontSize:11,color:'accent'});
 })
 .paragraph('END_OF_REPORT');
const pdf=await doc.render();
writeFileSync(destination,pdf);
console.log(destination,pdf.byteLength,'bytes');
