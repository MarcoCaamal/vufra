import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFileSync,writeFileSync,mkdtempSync,rmSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {join} from 'node:path';
import {tmpdir} from 'node:os';

const require=createRequire(import.meta.url);
const {createVufra,box,paragraph,grid}=require('../dist/index.js');
const font=readFileSync(execFileSync('fc-match',
  ['Noto Sans','-f','%{file}\n'],{encoding:'utf8'}).trim());
const bold=readFileSync(execFileSync('fc-match',
  ['Noto Sans:style=Bold','-f','%{file}\n'],{encoding:'utf8'}).trim());
const theme={colors:{paper:'#EDF4FB',ink:'#16325C',edge:'#99B1C9',accent:'#277349'},
  text:{color:'ink'},
  presets:{
    text:{
      label:{bold:true,color:'accent',fontSize:11,spaceBefore:3,spaceAfter:3},
      muted:{color:'edge',fontSize:10,spaceBefore:4,spaceAfter:4},
      chrome:{color:'ink',fontSize:9,spaceBefore:0,spaceAfter:0},
      title:{bold:true,color:'ink',fontSize:15,spaceBefore:6,spaceAfter:5}
    },
    box:{
      card:{padding:14,background:'paper',border:{width:1,color:'edge'}},
      panel:{padding:18,background:'#FFFFFF',border:{width:1,color:'edge'}}
    }
  }
};
const app=createVufra({font,fonts:{bold},theme});
function inspect(bytes){
 const dir=mkdtempSync(join(tmpdir(),'vufra-presets-'));
 try{
  const path=join(dir,'a.pdf');
  writeFileSync(path,bytes);
  const raw=execFileSync('pdftotext',['-raw',path,'-'],{encoding:'utf8'});
  const pages=Number(execFileSync('pdfinfo',[path],{encoding:'utf8'}).match(/Pages:\s+(\d+)/)[1]);
  const fonts=execFileSync('pdffonts',[path],{encoding:'utf8'});
  const bbox=execFileSync('pdftotext',['-bbox',path,'-'],{encoding:'utf8'});
  const words=[...bbox.matchAll(/<word xMin="([\d.]+)" yMin="([\d.]+)" xMax="([\d.]+)" yMax="([\d.]+)">([^<]+)<\/word>/g)]
    .map(m=>({x:+m[1],y:+m[2],right:+m[3],bottom:+m[4],text:m[5]}));
  return {raw,pages,fonts,words};
 }finally{rmSync(dir,{recursive:true,force:true})}
}
test('named box + text presets serialize exactly like hand-written visual options',()=>{
 const named=app.document({page:'Letter',title:'Matching appearance'})
   .box({preset:'card'},c=>c
     .paragraph('AMOUNT_LABEL',{preset:'label'})
     .paragraph('MXN_842560',{preset:'title'})
   ).renderSync();
 const manual=app.document({page:'Letter',title:'Matching appearance'})
   .box({padding:14,background:'paper',border:{width:1,color:'edge'}},c=>c
     .paragraph('AMOUNT_LABEL',
       {bold:true,color:'accent',fontSize:11,spaceBefore:3,spaceAfter:3})
     .paragraph('MXN_842560',
       {bold:true,color:'ink',fontSize:15,spaceBefore:6,spaceAfter:5})
   ).renderSync();
 assert.deepEqual(Buffer.from(named),Buffer.from(manual),
   'named presets must compile to identical native PDF paint structures');
 const pdf=inspect(named);
 assert.match(pdf.fonts,/NotoSans-Bold/);
 assert.equal(pdf.pages,1);
 assert.match(pdf.raw,/AMOUNT_LABEL/);
});
test('local background, padding and partial border override a reusable box preset',()=>{
 const effective=app.document().box({preset:'card',padding:20,
   border:{width:2}},b=>b.paragraph('BOX_OVERRIDE'));
 const b=effective.toDocument().blocks[0].box;
 assert.equal(b.padding,20);
 assert.equal(b.background,'#EDF4FB');
 assert.deepEqual(b.border,{width:2,color:'#99B1C9'});
 assert.equal('preset' in b,false,'resolved AST must not leak theme preset ids into native wire');
 assert.match(inspect(effective.renderSync()).raw,/BOX_OVERRIDE/);
});
test('text presets apply in headings, column cells, rich spans and repeated page bands',()=>{
 const pdf=app.document({page:'Letter'})
   .header(h=>h.text('BRANDED_HEADER',{preset:'chrome',color:'accent'}))
   .heading('REPORT_HEADING',{preset:'title',fontSize:16,level:2})
   .grid({columns:['2fr','1fr'],gap:10},g=>{
     g.cell(c=>c.heading('METRIC_ONE',{preset:'label'})
       .paragraph('AMOUNT_ONE',{preset:'muted'}));
     g.cell(c=>c.richText(t=>{
       t.add('SEGMENT_BOLD',{preset:'label'});
       t.add('SEGMENT_MUTED',{preset:'muted'});
     }));
   }).pageBreak().paragraph('NEXT_PAGE')
   .renderSync();
 const out=inspect(pdf);
 assert.equal(out.pages,2);
 assert.equal((out.raw.match(/BRANDED_HEADER/g)??[]).length,2);
 for(const key of ['REPORT_HEADING','METRIC_ONE','SEGMENT_BOLD','SEGMENT_MUTED','NEXT_PAGE'])
   assert.match(out.raw,new RegExp(key));
 assert.match(out.fonts,/NotoSans-Bold/);
});
test('reusable functional cards keep preset appearance when inserted into grids and boxes',()=>{
 const card=(title,value)=>box({preset:'card'},[
   paragraph(title,{preset:'label'}),paragraph(value,{preset:'title'})
 ]);
 const reusable=grid({columns:['2fr','1fr'],gap:10},[
   card('KPI_REVENUE','MXN_14000'),card('KPI_ORDERS','ORDERS_130')
 ]);
 const doc=app.document({page:'Letter'}).add(reusable)
   .box({preset:'panel'},b=>b.add(card('INNER_CARD','VALUE_300')));
 const pdf=inspect(doc.renderSync());
 for(const key of ['KPI_REVENUE','KPI_ORDERS','INNER_CARD','MXN_14000','VALUE_300'])
   assert.equal((pdf.raw.match(new RegExp(key,'g'))??[]).length,1);
 const l=pdf.words.find(w=>w.text==='KPI_REVENUE');
 const r=pdf.words.find(w=>w.text==='KPI_ORDERS');
 assert.ok(l&&r&&r.x>l.x+140,'visual cards must keep 2fr/1fr geometry');
});
test('theme snapshots isolate source mutation, new documents, and sibling builders',()=>{
 const supplied=structuredClone(theme);
 const engine=createVufra({font,fonts:{bold},theme:supplied});
 const base=engine.document({page:'Letter'});
 const first=base.box({preset:'card'},c=>c.paragraph('FIRST_THEME',{preset:'label'}));
 const before=first.renderSync();
 supplied.colors.paper='#000000';
 supplied.presets.box.card.padding=44;
 supplied.presets.text.label.fontSize=30;
 assert.deepEqual(Buffer.from(first.renderSync()),Buffer.from(before));
 const second=base.box({preset:'card'},c=>c.paragraph('FIRST_THEME',{preset:'label'}));
 assert.deepEqual(Buffer.from(second.renderSync()),Buffer.from(before));
 const other=base.paragraph('SIBLING_COMPONENT');
 assert.doesNotMatch(inspect(other.renderSync()).raw,/FIRST_THEME/);
 assert.equal(first.toDocument().blocks[0].box.padding,14);
});
test('unknown or malformed named presets fail before native rendering',()=>{
 const base=app.document({page:'Letter'});
 assert.throws(()=>base.paragraph('X',{preset:'missing'}),/unknown text preset "missing"/);
 assert.throws(()=>base.heading('X',{preset:'__proto__'}),/unknown text preset/);
 assert.throws(()=>base.box({preset:'missing'},b=>b.paragraph('X')),/unknown box preset/);
 assert.throws(()=>base.box({preset:'toString'},b=>b.paragraph('X')),/unknown box preset/);
 assert.throws(()=>base.box({preset:''},b=>b.paragraph('X')),/unknown box preset/);
 assert.throws(()=>base.box({preset:'card',background:'not_a_color'},b=>b.paragraph('X')),/color/);
 assert.throws(()=>base.box({preset:'card',padding:250},b=>b.paragraph('X'))
   .renderSync(),/invalid box|width|padding/);
 const malformed=createVufra({font,theme:{presets:{
   text:{bad:{preset:'bad'}},box:{bad:{preset:'bad'}}
 }}});
 assert.throws(()=>malformed.document().paragraph('X',{preset:'bad'}),/flat style objects/);
 assert.throws(()=>malformed.document().box({preset:'bad'},b=>b.paragraph('X')),/flat style objects/);
});
test('styled cards and multi-page table retain ordered line IDs and page headers',()=>{
 const rows=Array.from({length:155},(_,i)=>[
  'L'+String(i+1).padStart(4,'0'),
  'Professional service for quarter '+(i+1),
  'MXN '+(250+i)
 ]);
 const doc=app.document({page:'Letter'})
   .header(h=>h.text('PRESET_COMPANY',{preset:'chrome'}))
   .grid({columns:['2fr','1fr'],gap:12},g=>{
     g.cell(c=>c.box({preset:'card'},b=>b
       .paragraph('REVENUE_Q3',{preset:'label'})
       .paragraph('MXN_45000',{preset:'title'})));
     g.cell(c=>c.box({preset:'card'},b=>b
       .paragraph('ORDERS_Q3',{preset:'label'})
       .paragraph('155',{preset:'title'})));
   })
   .table(rows,{columns:[
     {title:'CODE',width:'25%'},{title:'DETAIL',width:'50%'},
     {title:'AMOUNT',width:'25%'}
   ]});
 const out=inspect(doc.renderSync());
 assert.ok(out.pages>2);
 const ids=[...out.raw.matchAll(/L(\d{4})/g)].map(m=>Number(m[1]));
 assert.deepEqual(ids,Array.from({length:155},(_,i)=>i+1));
 assert.equal((out.raw.match(/PRESET_COMPANY/g)??[]).length,out.pages);
});

test('heading preset precedence: default theme < level theme < preset < caller',()=>{
 const instance=createVufra({font,fonts:{bold},theme:{
   colors:theme.colors,
   text:{color:'edge',fontSize:10},
   h2:{color:'ink',fontSize:12},
   presets:{text:{title:{color:'accent',fontSize:17,bold:true}}}
 }});
 const doc=instance.document().heading('HEADING_PRECEDENCE',{
   level:2,preset:'title',fontSize:19
 });
 const root=doc.toDocument().blocks[0];
 assert.equal(root.type,'rich-paragraph');
 assert.equal(root.runs[0].fontSize,19);
 assert.equal(root.runs[0].color,'#277349');
 assert.equal(root.runs[0].font,'bold');
 assert.match(inspect(doc.renderSync()).raw,/HEADING_PRECEDENCE/);
});
test('presets without configured themes do not create hidden global defaults',()=>{
 const plain=createVufra({font}).document();
 assert.throws(()=>plain.paragraph('X',{preset:'title'}),/unknown text preset/);
 assert.throws(()=>plain.box({preset:'card'},b=>b.paragraph('X')),/unknown box preset/);
 assert.match(inspect(plain.paragraph('PLAIN_DOCUMENT').renderSync()).raw,/PLAIN_DOCUMENT/);
});
