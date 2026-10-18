// Unit 38 — horizontally/vertically aligned table cells and inherited padding.
// node examples/fluent-table-cells.mjs REGULAR.ttf BOLD.ttf artifacts/fluent-table-cells.pdf
import {createRequire} from 'node:module';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {dirname,resolve} from 'node:path';
const require=createRequire(import.meta.url);
const {createVufra}=require('../packages/vufra/dist/index.js');
const [regular,bold,destination='artifacts/fluent-table-cells.pdf']=process.argv.slice(2);
if(!regular||!bold)throw new Error('Expected regular and bold font paths');
const app=createVufra({font:readFileSync(regular),fonts:{bold:readFileSync(bold)},
  theme:{colors:{ink:'#173D78',pale:'#EAF1FA',success:'#E3F5E7'}}});
const records=Array.from({length:135},(_,i)=>[
  {text:'ITEM_'+String(i+1).padStart(3,'0'),bold:i%11===0},
  {text:i%3===0?'Long enterprise service with additional description':'Enterprise service',
    padding:{left:14,right:8}},
  {text:String(i%7+1),verticalAlign:'center'},
  {text:'$'+(520+i*9).toLocaleString('en-US'),align:'right',
    background:i%11===0?'success':undefined,padding:{right:17}}
]);
const pdf=app.document({title:'Vufra — Styled table cell layout',page:'Letter'})
  .heading('Enterprise statement',{color:'ink',bold:true})
  .paragraph('Quantity centered, amounts right-aligned, and individual cell padding.')
  .box({padding:12,radius:10,background:'#FFFFFF',border:{color:'ink',width:1}},b=>{
    b.table(records,{padding:{top:8,bottom:8,left:8,right:8},verticalAlign:'center',columns:[
      {title:'Reference',width:'20%',background:'pale'},
      {title:'Description',width:'39%',background:'pale'},
      {title:'Qty',width:'13%',align:'center',background:'pale'},
      {title:'Amount',width:'28%',align:'right',padding:{right:14},background:'pale'}
    ]});
  }).renderSync();
const file=resolve(destination);mkdirSync(dirname(file),{recursive:true});
writeFileSync(file,pdf);
console.log(`Wrote ${file}: ${pdf.length} bytes, ${records.length} records`);
