import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFileSync,writeFileSync,mkdtempSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
const {createVufra,defineTemplate}=createRequire(import.meta.url)('../dist/index.js');
const font=readFileSync(execFileSync('fc-match',['Noto Sans','-f','%{file}\n'],{encoding:'utf8'}).trim());
const app=createVufra({font});
const templateDefinition={schemaVersion:1,title:{bind:'statement.title'},page:'Letter',content:[
  {type:'heading',text:{bind:'statement.title'}},
  {type:'if',test:'showIntro',then:[{type:'paragraph',text:'INCLUDED_INTRO'}],else:[{type:'paragraph',text:'OMITTED_INTRO'}]},
  {type:'box',options:{padding:12,background:'#F0F5FB'},children:[
    {type:'paragraph',text:{bind:'statement.description'}}
  ]},
  {type:'each',from:'departments',as:'department',children:[
    {type:'heading',text:{bind:'department.name'},options:{level:2}}
  ]},
  {type:'table',from:'items',as:'line',columns:[
    {title:'REFERENCE',width:'45%',value:{bind:'line.sku'}},
    {title:'AMOUNT',width:'55%',align:'right',value:{bind:'line.amount'}}
  ],options:{padding:7,oddRowBackground:'#FFFFFF',evenRowBackground:'#F0F5FC'}}
]};
function inspect(pdf){
  const file=join(mkdtempSync(join(tmpdir(),'vufra-json-template-')),'report.pdf');
  writeFileSync(file,pdf);
  return {file,raw:execFileSync('pdftotext',['-raw',file,'-'],{encoding:'utf8'}),
    pages:Number(execFileSync('pdfinfo',[file],{encoding:'utf8'}).match(/Pages:\s+(\d+)/)[1])};
}
test('JSON template binds, branches, repeats and renders native styled tables without eval',()=>{
  const compiled=defineTemplate(JSON.parse(JSON.stringify(templateDefinition)));
  const data={statement:{title:'MONTHLY_REPORT',description:'ACCOUNT_VALID'},showIntro:true,
    departments:[{name:'DEPARTMENT_A'},{name:'DEPARTMENT_B'}],
    items:Array.from({length:160},(_,i)=>({sku:'DOC_'+String(i+1).padStart(3,'0'),amount:'$'+(i+5)}))};
  const builder=compiled.document(app,data);
  const out=inspect(builder.renderSync());
  assert.ok(out.pages>=3);
  assert.match(out.raw,/INCLUDED_INTRO/);
  assert.doesNotMatch(out.raw,/OMITTED_INTRO/);
  assert.match(out.raw,/DEPARTMENT_A/);
  assert.match(out.raw,/DEPARTMENT_B/);
  assert.match(out.raw,/ACCOUNT_VALID/);
  assert.deepEqual([...out.raw.matchAll(/DOC_(\d{3})/g)].map(x=>+x[1]),Array.from({length:160},(_,i)=>i+1));
  for(let pg=1;pg<=out.pages;pg++){
    const raw=execFileSync('pdftotext',['-raw','-f',String(pg),'-l',String(pg),out.file,'-'],{encoding:'utf8'});
    assert.equal((raw.match(/REFERENCE/g)??[]).length,1);
  }
  const inverse=inspect(compiled.document(app,{...data,showIntro:false,items:data.items.slice(0,1)}).renderSync());
  assert.match(inverse.raw,/OMITTED_INTRO/);
  assert.doesNotMatch(inverse.raw,/INCLUDED_INTRO/);
});
test('JSON template snapshot isolates source mutation and rejects unsafe executable inputs',()=>{
  const source=structuredClone(templateDefinition);
  const template=defineTemplate(source);
  source.title='MUTATED';
  const doc=template.document(app,{statement:{title:'ORIGINAL_TITLE',description:'SAFE_DESCRIPTION'},showIntro:false,
    departments:[{name:'SAFE_DEPARTMENT'}],items:[{sku:'SKU1',amount:'$3'}]});
  assert.equal(doc.toDocument().title,'ORIGINAL_TITLE');
  assert.match(inspect(doc.renderSync()).raw,/ORIGINAL_TITLE/);
  assert.throws(()=>defineTemplate({...templateDefinition,schemaVersion:2}),/schemaVersion/);
  assert.throws(()=>defineTemplate({...templateDefinition,content:[{type:'paragraph',text:'A',evil:'B'}]}),/unknown field/);
  assert.throws(()=>defineTemplate({...templateDefinition,callback:()=>{}}),/JSON values/);
  assert.throws(()=>defineTemplate({...templateDefinition,content:[{type:'paragraph',text:{bind:'__proto__.x'}}]})
    .document(app,{}),/unsafe binding path/);
  assert.throws(()=>template.document(app,{statement:{title:'A',description:'B'},showIntro:'yes',departments:[],items:[]}),/boolean/);
  assert.throws(()=>template.document(app,{statement:{title:'A',description:'B'},showIntro:true,departments:[],items:[]}),/table source is empty/);
  assert.throws(()=>template.document(app,{statement:{title:'A',description:'B'},showIntro:false,departments:[],items:[{sku:'A'}]}),/binding.*missing/);
  assert.throws(()=>template.document(app,{statement:{title:'A',description:'B'},showIntro:false,departments:[],items:Array.from({length:1001},(_,i)=>i)}),/1000/);
});
