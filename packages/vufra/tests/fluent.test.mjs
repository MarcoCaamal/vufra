import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {execFileSync} from 'node:child_process';
import {readFileSync,writeFileSync,mkdtempSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';

const require=createRequire(import.meta.url);
const {vufra,createVufra,PdfRenderQueue,renderPdf}=require('../dist/index.js');
const regular=readFileSync(execFileSync('fc-match',['Noto Sans','-f','%{file}\n'],{encoding:'utf8'}).trim());
const bold=readFileSync(execFileSync('fc-match',['Noto Sans:style=Bold','-f','%{file}\n'],{encoding:'utf8'}).trim());
const image=readFileSync(new URL('./fixtures/two-tone.png',import.meta.url));
const configured=createVufra({font:regular,fonts:{bold},
  theme:{colors:{primary:'#245FA8'},h1:{color:'primary',fontSize:24,bold:true}}});

function inspect(bytes){
 const dir=mkdtempSync(join(tmpdir(),'vufra-fluent-'));
 const pdf=join(dir,'document.pdf');writeFileSync(pdf,bytes);
 const info=execFileSync('pdfinfo',[pdf],{encoding:'utf8'});
 const text=execFileSync('pdftotext',['-layout',pdf,'-'],{encoding:'utf8'});
 const raw=execFileSync('pdftotext',['-raw',pdf,'-'],{encoding:'utf8'});
 const fonts=execFileSync('pdffonts',[pdf],{encoding:'utf8'});
 const bbox=execFileSync('pdftotext',['-bbox',pdf,'-'],{encoding:'utf8'});
 const words=[...bbox.matchAll(/<word xMin="([\d.]+)" yMin="([\d.]+)" xMax="([\d.]+)" yMax="([\d.]+)">([^<]+)<\/word>/g)]
   .map(m=>({x:+m[1],y:+m[2],right:+m[3],bottom:+m[4],text:m[5]}));
 return {pdf,info,text,raw,fonts,words,pages:+info.match(/Pages:\s+(\d+)/)[1]};
}
const word=(out,name)=>out.words.find(w=>w.text===name);

test('fluent first PDF uses a simple chain, and async and sync preserve content',async()=>{
 const doc=vufra.document({font:regular,title:'Hello Vufra'})
   .heading('START_HEADING')
   .paragraph('My first fluent PDF')
   .divider()
   .list(['FIRST_ITEM','SECOND_ITEM'],{ordered:true});
 const low=doc.toDocument();
 assert.equal(low.blocks.length,4);
 assert.equal(low.page.format,'a4');
 const sync=inspect(doc.renderSync());
 const async=inspect(await doc.render());
 assert.equal(sync.pages,1);
 assert.match(sync.text,/START_HEADING/);
 assert.match(sync.text,/FIRST_ITEM/);
 assert.match(async.text,/SECOND_ITEM/);
 assert.match(sync.info,/Page size:\s+595 x 842/);
});

test('builder is structurally immutable, and copies caller image/font bytes',()=>{
 const mutableFont=Buffer.from(regular), mutableImage=Buffer.from(image);
 const base=vufra.document({font:mutableFont,title:'Immutable'});
 const a=base.heading('DOCUMENT_A').image(mutableImage,{width:100,height:60});
 const b=base.heading('DOCUMENT_B');
 assert.equal(base.toDocument().blocks.length,0);
 assert.equal(a.toDocument().blocks.length,2);
 assert.equal(b.toDocument().blocks.length,1);
 mutableImage.fill(0);mutableFont.fill(0);
 const rendered=inspect(a.renderSync());
 assert.match(rendered.text,/DOCUMENT_A/);
 assert.ok(!rendered.text.includes('DOCUMENT_B'));
});

test('real native row renders side by side, including image and right-aligned text',()=>{
 const pdf=inspect(configured.document({title:'Invoice header',page:'Letter'})
  .row({gap:14}, row=>{
    row.column({width:'42%'},col=>{
      col.image(image,{width:80,height:40})
         .heading('LEFTCOMPANY',{level:2})
         .paragraph('Company details');
    });
    row.column({width:'58%',align:'right'},col=>{
      col.heading('RIGHTINVOICE',{level:2})
         .paragraph('FOLIO999');
    });
  })
  .paragraph('FOLLOWING CONTENT')
  .renderSync());
 assert.equal(pdf.pages,1);
 const left=word(pdf,'LEFTCOMPANY'),right=word(pdf,'RIGHTINVOICE');
 assert.ok(left&&right);
 assert.ok(left.x<100 && right.x>310,JSON.stringify({left,right}));
 assert.ok(left.y>=160,'column text must begin below the 40pt image: '+left.y);
 assert.ok(pdf.words.some(w=>w.text==='FOLIO999'&&w.x>400));
 assert.match(pdf.text,/FOLLOWING CONTENT/);
 assert.match(execFileSync('pdfimages',['-list',pdf.pdf],{encoding:'utf8'}),/160\s+80/);
});

test('theme and real bold font embed, heading custom style keeps next image',()=>{
 const a=configured.document({title:'Themed',page:'Letter'})
  .spacer(460)
  .heading('STICKYBOLD',{color:'primary',fontSize:26,bold:true})
  .image(image,{width:190,height:100});
 const out=inspect(a.renderSync());
 assert.equal(out.pages,2);
 assert.ok(!execFileSync('pdftotext',['-f','1','-l','1','-layout',out.pdf,'-'],
   {encoding:'utf8'}).includes('STICKYBOLD'));
 const second=execFileSync('pdftotext',['-f','2','-l','2',out.pdf,'-'],{encoding:'utf8'});
 assert.match(second,/STICKYBOLD/);
 assert.match(out.fonts,/NotoSans-Bold/);
 const images=execFileSync('pdfimages',['-list',out.pdf],{encoding:'utf8'});
 assert.ok(/^\s*2\s+\d+\s+image\b/m.test(images),images);
});

test('grid and section callbacks compose native columns and flow',()=>{
 const out=inspect(configured.document({title:'Dashboard'})
 .heading('Quarterly dashboard')
 .grid({columns:3,gap:8},g=>{
   g.cell(c=>c.heading('REVENUE').paragraph('2.4M'));
   g.cell(c=>c.heading('CLIENTS').paragraph('1284'));
   g.cell(c=>c.heading('COSTS').paragraph('840K'));
 })
 .section('Conclusions',section=>{
   section.paragraph('POSITIVE_MARGIN');
   section.list(['FIRST_FACTOR','SECOND_FACTOR']);
 })
 .renderSync());
 assert.equal(out.pages,1);
 const names=['REVENUE','CLIENTS','COSTS'].map(t=>word(out,t));
 assert.ok(names.every(Boolean),JSON.stringify(names));
 assert.ok(names[0].x<names[1].x && names[1].x<names[2].x);
 assert.ok(Math.max(...names.map(w=>w.y))-Math.min(...names.map(w=>w.y))<2);
 assert.match(out.text,/POSITIVE_MARGIN/);
 assert.match(out.text,/SECOND_FACTOR/);
});

test('long invoice tables keep every row and repeat headers across pages',async()=>{
 const products=Array.from({length:480},(_,i)=>({
  concept:'PRODUCT'+String(i+1).padStart(4,'0'),
  units:(i%5)+1,
  amount:((i+1)*19.8).toFixed(2)
 }));
 const builder=configured.document({title:'Invoice',page:'Letter'})
   .row({gap:20},r=>{
     r.column({width:'40%'},c=>c.heading('BUSINESS_NAME').paragraph('Tax ID: X0101'));
     r.column({width:'60%',align:'right'},c=>c.heading('INVOICE_2026').paragraph('PAID'));
   })
   .section('Bill to',s=>s.paragraph('CLIENT NAME'))
   .table(products,{columns:[
     {key:'concept',title:'Concept',width:'*'},
     {key:'units',title:'Qty',width:75},
     {key:'amount',title:'Amount',width:125}
   ]})
   .row(r=>{
     r.column({width:'*'},c=>c.paragraph('THANK YOU'));
     r.column({width:220,align:'right'},c=>c.heading('TOTAL_12450'));
   });
 const q=new PdfRenderQueue({maxConcurrent:1,maxQueued:1});
 const out=inspect(await builder.enqueue(q));q.close();
 assert.ok(out.pages>=10);
 const found=[...out.raw.matchAll(/PRODUCT(\d{4})/g)].map(m=>+m[1]);
 assert.deepEqual(found,Array.from({length:480},(_,i)=>i+1));
 assert.match(out.raw,/THANK YOU/);
 assert.match(out.raw,/TOTAL_12450/);
 const first=execFileSync('pdftotext',['-f','1','-l','1',out.pdf,'-'],{encoding:'utf8'});
 const second=execFileSync('pdftotext',['-f','2','-l','2',out.pdf,'-'],{encoding:'utf8'});
 assert.match(first,/Concept/);
 assert.match(second,/Concept/);
});

test('richText scope can compose spans with configured bold and colors',()=>{
 const out=inspect(configured.document({title:'Rich'})
 .richText(t=>{
   t.add('NORMALTEXT ');
   t.add('BOLDACTUAL ',{bold:true,color:'primary',fontSize:21});
   t.add('TAIL');
 })
 .renderSync());
 assert.match(out.raw,/NORMALTEXT BOLDACTUAL TAIL/);
 assert.match(out.fonts,/NotoSans-Bold/);
});

test('invalid nested layouts reject rather than silently flatten',()=>{
 const doc=configured.document({title:'Bad layouts'});
 assert.throws(()=>doc.row({gap:15},r=>{
   r.column({width:'70%'},c=>c.paragraph('LEFT'));
   r.column({width:'70%'},c=>c.paragraph('RIGHT'));
 }),/do not fit printable/);
 assert.throws(()=>doc.row(r=>r.column({width:30},c=>c.paragraph('BAD'))),/>=60/);
 assert.throws(()=>doc.row(r=>r.column(c=>c.paragraph('bad',{bold:true}))),/regular-font text only/);
 assert.throws(()=>doc.row(r=>r.column(c=>c.paragraph('text').spacer(900))).renderSync(),/unsupported or invalid row column item/);
 assert.throws(()=>doc.row(r=>r.column(c=>c.paragraph('too tall '.repeat(850)))).renderSync(),/row height exceeds/);
 assert.throws(()=>doc.table([{id:1}],{columns:[{key:'id',width:20}]}),/less than 36pt/);
 assert.throws(()=>doc.heading('INVALID',{color:'unknown'}),/color/);
 assert.throws(()=>vufra.document({title:'Missing'}).paragraph('TEXT').renderSync(),/no font configured/);
 assert.throws(()=>doc.row(async r=>{r.column(c=>c.paragraph('TEXT'));}),/callbacks must be synchronous/);
});

test('queued Fluent row with nested PNG counts binary inputs without expanding JSON',async()=>{
 const q=new PdfRenderQueue({maxConcurrent:1,maxQueued:1});
 const first=q.render({title:'Long first render',
   rows:Array.from({length:3000},(_,i)=>'ROW'+i)},regular);
 const second=configured.document({title:'Nested binary row'}).row(r=>{
   r.column({width:'*'},c=>c.image(image,{width:150,height:75}));
 }).enqueue(q);
 const stats=q.stats;
 assert.equal(stats.queued,1);
 assert.ok(stats.queuedBytes>regular.byteLength+bold.byteLength+image.byteLength);
 assert.ok(stats.queuedBytes<regular.byteLength+bold.byteLength+image.byteLength+25000,
   'binary assets should be counted by their raw bytes even when nested');
 await first;
 const rendered=inspect(await second);
 assert.equal(rendered.pages,1);
 assert.match(execFileSync('pdfimages',['-list',rendered.pdf],{encoding:'utf8'}),/160\s+80/);
 q.close();
});
test('explicit page break separates sections with no extra trailing page',()=>{
 const doc=configured.document({title:'Contract',page:'Letter'})
   .heading('FIRSTSECTION')
   .paragraph('First page content')
   .pageBreak()
   .section('SECONDSECTION',section=>{
      section.paragraph('Second page content');
      section.pageBreak();
   });
 const out=inspect(doc.renderSync());
 assert.equal(out.pages,2);
 const first=execFileSync('pdftotext',['-f','1','-l','1',out.pdf,'-'],{encoding:'utf8'});
 const second=execFileSync('pdftotext',['-f','2','-l','2',out.pdf,'-'],{encoding:'utf8'});
 assert.match(first,/FIRSTSECTION/);
 assert.ok(!first.includes('SECONDSECTION'));
 assert.match(second,/SECONDSECTION/);
});
test('direct low-level row AST continues to render for advanced callers',()=>{
 const pdf=inspect(renderPdf({title:'Low level',blocks:[{
  type:'row',row:{gap:10,columns:[
   {width:230,items:[{type:'text',text:'NATIVELEFT'}]},
   {width:257,align:'right',items:[{type:'text',text:'NATIVERIGHT'}]}
  ]}
 }]},regular));
 assert.ok(word(pdf,'NATIVELEFT').x<80);
 assert.ok(word(pdf,'NATIVERIGHT').x>370);
});
