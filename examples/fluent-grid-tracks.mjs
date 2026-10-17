// An enterprise PDF using the same grid primitives as a modern web layout.
// Usage: node examples/fluent-grid-tracks.mjs REGULAR.ttf BOLD.ttf [output.pdf]
import {createRequire} from 'node:module';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {resolve,dirname} from 'node:path';

const require=createRequire(import.meta.url);
const {createVufra,box,paragraph,grid}=require('../packages/vufra/dist/index.js');
const [regularPath,boldPath,output='artifacts/fluent-grid-tracks.pdf']=process.argv.slice(2);
if(!regularPath||!boldPath)throw new Error('Expected regular and bold font paths');

const engine=createVufra({
  font:readFileSync(regularPath),
  fonts:{bold:readFileSync(boldPath)},
  theme:{colors:{
    primary:'#173D78',muted:'#57718D',panel:'#F0F5FB',highlight:'#E5F4EA'
  }}
});
const logo=readFileSync(new URL('../packages/vufra/tests/fixtures/two-tone.png',import.meta.url));
const metric=(label,value)=>box({padding:11,background:'panel',
  border:{width:1,color:'#CCD9E8'}},[
  paragraph(label,{bold:true,fontSize:10,color:'muted'}),
  paragraph(value,{bold:true,fontSize:16,color:'primary'})
]);
const facts=grid({columns:['2fr','1fr'],gap:12},[
  metric('NET REVENUE','MXN 842,560'),
  metric('PAID ORDERS','1,240'),
  metric('AVERAGE ORDER','MXN 679'),
  metric('CUSTOMERS','580')
]);
const rows=Array.from({length:190},(_,i)=>[
  'SO'+String(i+1).padStart(4,'0'),
  i%12===0?{runs:[{text:'Priority ',bold:true,color:'primary'},
    {text:'professional services'}]}:'Professional services '+(i+1),
  {text:'MXN '+String(900+i*3),align:'right',
    background:i%12===0?'highlight':undefined}
]);
const report=engine.document({page:'Letter',title:'Quarterly Operations Report'})
  .header(h=>h.grid({columns:[110,'1fr'],gap:14},g=>{
    g.cell(c=>c.image(logo,{width:76,height:36}));
    g.cell(c=>c.paragraph('NORTH REGION | FINANCE',{bold:true,
      color:'primary',fontSize:12,spaceBefore:0,spaceAfter:0}));
  }))
  .footer(f=>f.grid({columns:['2fr','1fr'],gap:12},g=>{
    g.cell(c=>c.paragraph('INTERNAL | 2026',{fontSize:9,spaceBefore:0,spaceAfter:0}));
    g.cell(c=>c.paragraph('OPERATIONS REPORT',{fontSize:9,
      spaceBefore:0,spaceAfter:0}));
  }))
  .heading('Quarterly Overview',{bold:true,color:'primary'})
  .paragraph('A dashboard, nested layout and paginated statement in one document.')
  .add(facts)
  .section('Business notes',s=>{
    s.box({padding:12,border:{width:1,color:'#CCD9E8'}},b=>
      b.grid({columns:[125,'30%','1fr'],gap:8},g=>{
        g.cell(c=>c.paragraph('REPORT PERIOD',{bold:true,fontSize:10}));
        g.cell(c=>c.paragraph('Q3 2026'));
        g.cell(c=>c.paragraph('Audited operations'));
      }));
  })
  .section('Transaction detail',s=>{
    s.paragraph('Illustrative enterprise data; column headers repeat across pages.');
    s.table(rows,{columns:[
      {title:'ORDER',width:'24%'},
      {title:'SERVICE',width:'46%'},
      {title:'AMOUNT',width:'30%',align:'right'}
    ]});
  });
const pdf=await report.render();
const file=resolve(output);
mkdirSync(dirname(file),{recursive:true});
writeFileSync(file,pdf);
console.log(JSON.stringify({pdf:file,bytes:pdf.length,records:rows.length}));
