// Vufra Unit 14 — enterprise invoice with Fluent API, real columns and paginated table.
// node examples/fluent-invoice.mjs /path/to/regular.ttf /path/to/bold.ttf [output.pdf]
import {createRequire} from 'node:module';
import {readFileSync,writeFileSync} from 'node:fs';
const require=createRequire(import.meta.url);
const {createVufra}=require('../packages/vufra/dist/index.js');
const [regular,bold,output='artifacts/fluent-invoice.pdf']=process.argv.slice(2);
if(!regular||!bold)throw new Error('Pass regular and bold font file paths.');
const logo=readFileSync(new URL('../packages/vufra/tests/fixtures/two-tone.png',import.meta.url));
const products=Array.from({length:260},(_,i)=>({
  description:'SERVICE-'+String(i+1).padStart(4,'0'),
  quantity:(i%5)+1,
  unitPrice:(500+i*7.25).toFixed(2)
}));
const vufra=createVufra({
  font:readFileSync(regular),
  fonts:{bold:readFileSync(bold)},
  theme:{colors:{primary:'#255aa9',success:'#187f53'},
    h1:{fontSize:26,bold:true,color:'primary'}}
});
const invoice=vufra
 .document({page:'Letter',title:'Invoice INV-2026-001',
   margins:{left:52,right:52}})
 .row({gap:24},row=>{
   row.column({width:'45%'},col=>{
     col.image(logo,{width:130,height:65,fit:'contain'});
     col.heading('VUFRA SOFTWARE',{level:2});
     col.paragraph('Company tax ID: XYZ010101');
   });
   row.column({width:'55%',align:'right'},col=>{
     col.heading('INVOICE 2026',{level:2});
     col.paragraph('Reference: INV-2026-001');
     col.paragraph('16 October 2026');
   });
 })
 .divider({height:2,color:'#255aa9'})
 .row({gap:24},row=>{
   row.column({width:'50%'},col=>{
     col.heading('BILL TO',{level:3});
     col.paragraph('Example Customer LLC');
     col.paragraph('Playa del Carmen, Quintana Roo');
   });
   row.column({width:'50%',align:'right'},col=>{
     col.heading('STATUS',{level:3});
     col.paragraph('Paid by bank transfer');
   });
 })
 .heading('Invoice line items')
 .paragraph('Every row is paginated automatically; headers repeat on subsequent pages.')
 .table(products.map(p=>[p.description,p.quantity,p.unitPrice]),{columns:[
   {title:'Description',width:'*'},
   {title:'Qty',width:70},
   {title:'Price (MXN)',width:120}
 ]})
 .divider({height:2,color:'#255aa9'})
 .row(row=>{
   row.column({width:'*'},col=>col.paragraph('THANK YOU FOR YOUR BUSINESS'));
   row.column({width:205,align:'right'},col=>{
     col.heading('TOTAL 825,000 MXN',{level:2});
     col.paragraph('Illustrative amounts');
   });
 })
 .richText(text=>{
   text.add('Status: ');
   text.add('PROCESSED ',{bold:true,color:'success',fontSize:15});
   text.add('— demo data only.');
 });
const pdf=await invoice.render();
writeFileSync(output,pdf);
console.log('Enterprise Fluent API invoice:',output,pdf.byteLength,'bytes');
