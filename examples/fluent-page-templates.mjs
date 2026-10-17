// Unit 17 — Corporate page templates without a browser.
// node examples/fluent-page-templates.mjs REGULAR.ttf BOLD.ttf artifacts/page-templates.pdf
import {createRequire} from 'node:module';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {dirname,resolve} from 'node:path';

const require=createRequire(import.meta.url);
const {createVufra}=require('../packages/vufra/dist/index.js');
const [regularPath,boldPath,outputPath='artifacts/fluent-page-templates.pdf']=process.argv.slice(2);
if(!regularPath||!boldPath)throw new Error('Pass regular and bold TTF/OTF paths');

const regular=readFileSync(regularPath);
const bold=readFileSync(boldPath);
const logo=readFileSync(new URL('../packages/vufra/tests/fixtures/two-tone.png',import.meta.url));
const app=createVufra({font:regular,fonts:{bold},
  theme:{colors:{primary:'#173D78',muted:'#51617B'},h1:{bold:true,color:'primary'}}});

const clauses=Array.from({length:520},(_,i)=>'CLAUSE'+String(i+1).padStart(4,'0'));
const builder=app.document({title:'ACME annual report',page:'Letter'})
  .header(h=>h.row({gap:14},row=>{
    row.column({width:'30%'},col=>col.image(logo,{width:72,height:36}));
    row.column({width:'70%',align:'right'},col=>
      col.paragraph('ACME - Annual Report',{bold:true,fontSize:14,color:'primary',
        lineHeight:20,spaceBefore:0,spaceAfter:0}));
  }))
  .firstHeader(h=>h.text('ACME | Executive cover',{bold:true,color:'primary',fontSize:16}))
  .footer(f=>f.row({gap:12},row=>{
    row.column({width:'60%'},col=>col.paragraph('CONFIDENTIAL - FY2026'));
    row.column({width:'40%',align:'right'},col=>col.paragraph('Company records'));
  }))
  .firstFooter(null)
  .heading('ACME - Executive report')
  .paragraph('Corporate PDF built with Vufra. First page has its own cover header and no footer.')
  .box({padding:20,background:'#E8F2FC',keepTogether:true},box=>{
    box.heading('At a glance',{bold:true});
    box.grid({columns:2,gap:14},grid=>{
      grid.cell(col=>col.paragraph('Revenue',{bold:true}).paragraph('$1,250,000'));
      grid.cell(col=>col.paragraph('Clients',{bold:true}).paragraph('5,200'));
    });
  })
  .pageBreak()
  .heading('Detailed obligations')
  .paragraph('All 520 numbered clauses are preserved and flow between pages.')
  .footer(f=>f.text(({page,total})=>'ACME CONFIDENTIAL - Page '+page+' of '+total,
    {fontSize:10,color:'muted'}))
  .paragraph(clauses.join(' '));

const bytes=await builder.render();
const destination=resolve(outputPath);
mkdirSync(dirname(destination),{recursive:true});
writeFileSync(destination,bytes);
console.log('Created '+destination+' ('+bytes.byteLength+' bytes, '+clauses.length+' clauses)');
