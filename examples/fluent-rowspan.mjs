// Unit 39 — true rowSpan + colSpan with native paints crossing PDF pages.
// node examples/fluent-rowspan.mjs FONT.ttf artifacts/fluent-rowspan.pdf
import {createRequire} from 'node:module';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
const require=createRequire(import.meta.url);
const {createVufra}=require('../packages/vufra/dist/index.js');
const [fontPath,destination='artifacts/fluent-rowspan.pdf']=process.argv.slice(2);
if(!fontPath)throw new Error('Expected TTF/OTF path');
const app=createVufra({font:readFileSync(fontPath)});
const regular=Array.from({length:38},(_,i)=>[
 'INVOICE_'+String(i+1).padStart(3,'0'), 'Service '+(i+1), 'MXN '+(i*50+100)
]);
const merged=[
 [{text:'MULTIPAGE_GROUP',rowSpan:4,background:'#DDEEFF',border:{width:1.5,color:'#14789F'}},'Annual tax','MXN 1,200'],
 ['Monthly payroll','MXN 2,300'],['Renewal','MXN 3,400'],['Infrastructure','MXN 4,500']
];
const later=Array.from({length:110},(_,i)=>[
 'AFTER_'+String(i+1).padStart(3,'0'),'Adjustment','MXN '+(i*30+100)
]);
const pdf=app.document({title:'Enterprise rowspan',page:'Letter'})
 .table([...regular,...merged,...later],{
  headerBackground:'#C9DDF5',evenRowBackground:'#F6F9FD',padding:6,
  columns:[{title:'DEPARTMENT',width:'36%'},{title:'OPERATION',width:'38%'},
   {title:'AMOUNT',width:'26%',align:'right'}]
 }).renderSync();
const path=resolve(destination);mkdirSync(dirname(path),{recursive:true});writeFileSync(path,pdf);
console.log('Wrote '+path+', bytes='+pdf.length+', entries='+regular.length+'+4+'+later.length);
