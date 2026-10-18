// Precise native PDF anchors and chapter bookmarks.
// node examples/fluent-anchors.mjs FONT.ttf artifacts/fluent-anchors.pdf
import {createRequire} from 'node:module';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
const require=createRequire(import.meta.url);
const {createVufra}=require('../packages/vufra/dist/index.js');
const [fontPath,destination='artifacts/fluent-anchors.pdf']=process.argv.slice(2);
if(!fontPath)throw new Error('Expected TTF/OTF path');
const app=createVufra({font:readFileSync(fontPath)});
const columns=[{title:'REFERENCE',width:'58%'},{title:'AMOUNT',width:'42%',align:'right'}];
const records=Array.from({length:115},(_,i)=>[
 'ANCHOR_ITEM_'+String(i+1).padStart(3,'0'),'MXN '+(i*30+100)
]);
const document=app.document({title:'Anchored enterprise report',page:'Letter'})
  .tableOfContents('CHAPTER_INDEX')
  .linkTo('totals','Go directly to the summary')
  .pageSection({title:'Operations',header:h=>h.text('Operations')},section=>section
    .heading('Operations')
    .table(records,{columns}))
  .anchor('totals',content=>content
    .heading('OPERATIONS_SUMMARY')
    .paragraph('Annual records: 115'))
  .pageSection({title:'Finance',header:h=>h.text('Finance')},section=>section
    .heading('Finance')
    .paragraph('This is a separate chapter with a native PDF outline entry.'));
const pdf=document.renderSync();
const path=resolve(destination);mkdirSync(dirname(path),{recursive:true});writeFileSync(path,pdf);
console.log('Wrote '+path+' ('+pdf.length+' bytes)');
