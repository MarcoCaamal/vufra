// Vufra Unit 14 — executive dashboard with grid and section callbacks.
// node examples/fluent-report.mjs /path/to/regular.ttf [output.pdf]
import {createRequire} from 'node:module';
import {readFileSync,writeFileSync} from 'node:fs';
const require=createRequire(import.meta.url);
const {createVufra}=require('../packages/vufra/dist/index.js');
const fontPath=process.argv[2],out=process.argv[3]||'artifacts/fluent-report.pdf';
if(!fontPath)throw new Error('Supply a regular TTF/OTF font file path.');
const pdf=await createVufra({font:readFileSync(fontPath)})
  .document({title:'Quarterly Executive Report',page:'A4'})
  .heading('Executive dashboard')
  .paragraph('Financial summary — illustrative figures.')
  .grid({columns:3,gap:10},grid=>{
    grid.cell(c=>c.heading('REVENUE',{level:2}).paragraph('2.4M MXN'));
    grid.cell(c=>c.heading('CLIENTS',{level:2}).paragraph('1,284'));
    grid.cell(c=>c.heading('EXPENSES',{level:2}).paragraph('840K MXN'));
  })
  .section('Performance',section=>{
    section.paragraph('Operational highlights from the last quarter:');
    section.list(['Higher recurring revenue','Better customer retention',
      'Lower response times'],{ordered:true});
  })
  .pageBreak()
  .heading('Appendix')
  .paragraph('An explicit page break puts the appendix on the next sheet.')
  .render();
writeFileSync(out,pdf);
console.log('Executive Fluent API report:',out,pdf.byteLength,'bytes');
