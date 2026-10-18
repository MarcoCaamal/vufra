// Unit 43 foundation: declarative JSON-only template with conditionals/repeat/table bindings.
// node examples/fluent-json-template.mjs REGULAR.ttf artifacts/fluent-json-template.pdf
import {createRequire} from 'node:module';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
const require=createRequire(import.meta.url);
const {createVufra,defineTemplate}=require('../packages/vufra/dist/index.js');
const [fontPath,destination='artifacts/fluent-json-template.pdf']=process.argv.slice(2);
if(!fontPath)throw new Error('Expected TTF/OTF path');
const app=createVufra({font:readFileSync(fontPath)});
const definition=JSON.parse(JSON.stringify({
  schemaVersion:1,title:{bind:'report.title'},page:'Letter',content:[
    {type:'heading',text:{bind:'report.title'}},
    {type:'if',test:'report.reviewed',then:[{type:'paragraph',text:'REVIEWED_FINAL'}],
      else:[{type:'paragraph',text:'DRAFT_ONLY'}]},
    {type:'box',options:{padding:16,background:'#EEF4FF'},children:[
      {type:'paragraph',text:{bind:'report.description'}}
    ]},
    {type:'each',from:'sections',as:'section',children:[
      {type:'heading',text:{bind:'section.name'},options:{level:2}}
    ]},
    {type:'table',from:'movements',as:'item',options:{
      padding:8,headerBackground:'#E4EDFA',oddRowBackground:'#FFFFFF',evenRowBackground:'#F5F8FB'
    },columns:[
      {title:'REFERENCE',width:'45%',value:{bind:'item.ref'}},
      {title:'AMOUNT',width:'55%',align:'right',value:{bind:'item.amount'}}
    ]}
  ]
}));
const report=defineTemplate(definition);
const data={report:{title:'Operations | October',description:'Monthly account review',reviewed:true},
  sections:[{name:'Finance'}, {name:'Settlements'}],
  movements:Array.from({length:150},(_,i)=>({
    ref:'JSONITEM_'+String(i+1).padStart(3,'0'),amount:'MXN '+(i*15+100)
  }))};
const bytes=report.document(app,data).renderSync();
const path=resolve(destination);mkdirSync(dirname(path),{recursive:true});writeFileSync(path,bytes);
console.log('Wrote '+path+' with '+data.movements.length+' movements');
