// Unit 18: enterprise invoices with truly styled cells and repeated table headings.
// node examples/fluent-styled-tables.mjs REGULAR.ttf BOLD.ttf artifacts/styled-invoice.pdf
import {createRequire} from 'node:module';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {dirname,resolve} from 'node:path';

const require=createRequire(import.meta.url);
const {createVufra}=require('../packages/vufra/dist/index.js');
const [regularPath,boldPath,dest='artifacts/fluent-styled-tables.pdf']=process.argv.slice(2);
if(!regularPath||!boldPath)throw new Error('Expected regular and bold font file paths');

const font=readFileSync(regularPath);
const bold=readFileSync(boldPath);
const logo=readFileSync(new URL('../packages/vufra/tests/fixtures/two-tone.png',import.meta.url));
const engine=createVufra({
  font,fonts:{bold},
  theme:{colors:{primary:'#173D78',success:'#E1F4DC',cover:'#EEF4FD'}}
});
const rows=Array.from({length:350},(_,i)=>[
  {text:'INV'+String(i+1).padStart(4,'0'),bold:i%25===0,
    color:i%25===0?'primary':undefined},
  i===0?{runs:[{text:'PRIORITY ',bold:true,color:'#B02343'},
                {text:'corporate service'}]}:
    'Service agreement item '+(i+1),
  {text:'$'+(i*13+199).toFixed(2),align:'right',
    background:i%25===0?'success':undefined}
]);
const cols=[
  {title:'REFERENCE',width:'26%'},
  {title:'DESCRIPTION',width:'49%'},
  {title:'AMOUNT',width:'25%',align:'right',background:'cover'}
];
const pdf=await engine.document({title:'ACME enterprise invoice',page:'Letter'})
  .header(h=>h.row({gap:12},r=>{
    r.column({width:'30%'},c=>c.image(logo,{width:64,height:32}));
    r.column({width:'70%',align:'right'},c=>c.paragraph('ACME / Billing',{bold:true}));
  }))
  .footer(f=>f.text(({page,total})=>'ACME Invoice - Page '+page+' of '+total))
  .heading('Invoice detail',{bold:true,color:'primary'})
  .box({padding:14,border:{width:1,color:'primary'},background:'#FFFFFF'},box=>{
    box.paragraph('Statement of items, including highlighted amounts.');
    box.table(rows,{columns:cols});
    box.paragraph('TOTAL ITEMS: 350',{bold:true});
  })
  .render();
const file=resolve(dest);
mkdirSync(dirname(file),{recursive:true});
writeFileSync(file,pdf);
console.log('PDF '+file+' ('+pdf.byteLength+' bytes, 350 invoice references)');
