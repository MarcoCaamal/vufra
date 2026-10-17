import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {execFileSync} from 'node:child_process';
import {readFileSync, writeFileSync,mkdtempSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';

const require=createRequire(import.meta.url);
const {createVufra,PdfRenderQueue,box,paragraph,heading,image,grid,row,column,flow,table}=require('../dist/index.js');
const font=readFileSync(execFileSync('fc-match',['Noto Sans','-f','%{file}\n'],{encoding:'utf8'}).trim());
const bold=readFileSync(execFileSync('fc-match',['Noto Sans:style=Bold','-f','%{file}\n'],{encoding:'utf8'}).trim());
const logo=readFileSync(new URL('./fixtures/two-tone.png',import.meta.url));
const engine=createVufra({font,fonts:{bold}});

function inspect(data){
  const path=join(mkdtempSync(join(tmpdir(),'vufra-composable-')),'composable.pdf');
  writeFileSync(path,data);
  const call=(cmd,args)=>execFileSync(cmd,args,{encoding:'utf8'});
  const raw=call('pdftotext',['-raw',path,'-']);
  const pages=Number(call('pdfinfo',[path]).match(/Pages:\s+(\d+)/)[1]);
  const xml=call('pdftotext',['-bbox',path,'-']);
  const words=[...xml.matchAll(/<word xMin="([\d.]+)" yMin="([\d.]+)" xMax="([\d.]+)" yMax="([\d.]+)">([^<]+)<\/word>/g)]
    .map(m=>({left:+m[1],top:+m[2],right:+m[3],bottom:+m[4],text:m[5]}));
  return {raw,pages,path,words,fonts:call('pdffonts',[path])};
}
function TotalCard(label,amount){
  return box({padding:14,background:'#E8F2FC',border:{color:'#173D78',width:1}},[
    paragraph(label,{fontSize:11}),
    paragraph(amount,{fontSize:17,bold:true})
  ]);
}
const cols=[
  {title:'Service',width:'50%'},
  {title:'Amount',width:'50%',align:'right'}
];
test('Fluent .add composes reusable nested boxes, text, image, grid and styled table',()=>{
  const pdf=engine.document({title:'Composable',page:'Letter'})
    .heading('FLUENT_ROOT')
    .add(box({padding:18,background:'#FFFFFF',border:{width:1,color:'#333333'}},[
      heading('COMPOSITION_TITLE'),
      paragraph('SHARED_PARAGRAPH'),
      image(logo,{width:60,height:30}),
      grid({columns:2,gap:10},[
        paragraph('GRID_LEFT'),
        paragraph('GRID_RIGHT',{bold:true})
      ]),
      TotalCard('TOTAL_CARD','$1500'),
      table([['SERVICE_A','$125'],['SERVICE_B','$250']],{columns:cols})
    ]))
    .paragraph('OUTSIDE_AFTER')
    .renderSync();
  const o=inspect(pdf);
  assert.equal(o.pages,1);
  for(const mark of ['FLUENT_ROOT','COMPOSITION_TITLE','SHARED_PARAGRAPH',
    'GRID_LEFT','GRID_RIGHT','TOTAL_CARD','$1500','SERVICE_A','SERVICE_B','OUTSIDE_AFTER']){
    assert.match(o.raw,new RegExp(mark.replace('$','\\$')));
    assert.equal((o.raw.split(mark).length-1),1,mark);
  }
  assert.match(o.fonts,/NotoSans-Bold/);
  assert.match(execFileSync('pdfimages',['-list',o.path],{encoding:'utf8'}),/\b160\s+80\b/);
  const outer=o.words.find(w=>w.text==='COMPOSITION_TITLE');
  const nested=o.words.find(w=>w.text==='$1500');
  assert.ok(outer?.left>=65 && nested?.left>outer.left);
});

test('same ContentBuilder interface works for chained nested boxes and callbacks',()=>{
  const o=inspect(engine.document({title:'Shared builder'})
    .box({padding:16},content=>content
      .heading('ONE')
      .paragraph('TWO')
      .box({padding:15,background:'#F0F0F0'},inner=>inner
        .paragraph('THREE',{bold:true})
        .row(row=>row
          .column(c=>c.paragraph('ROW_LEFT'))
          .column(c=>c.paragraph('ROW_RIGHT'))
        )
      )
      .grid({columns:2,gap:8},g=>g
        .cell(c=>c.paragraph('CELL_1'))
        .cell(c=>c.paragraph('CELL_2'))
      )
      .tableStyled([['VALUE_1','VALUE_2']],{columns:cols})
    ).renderSync());
  for(const s of ['ONE','TWO','THREE','ROW_LEFT','ROW_RIGHT','CELL_1','CELL_2','VALUE_1','VALUE_2'])
    assert.match(o.raw,new RegExp(s));
});

test('functional .add supports flow, row columns and nested reusable components',()=>{
  const reusable=flow([
    paragraph('START_COMPONENT'),
    row({gap:12},[
      column(paragraph('FIRST_SIDE'),{width:'50%'}),
      column([heading('SECOND_SIDE',{bold:true}),paragraph('SUBLINE')],{width:'50%'})
    ]),
    TotalCard('SUMMARY_COMPONENT','$330'),
  ]);
  const out=inspect(engine.document({title:'Function reuse'})
    .add(reusable).renderSync());
  for(const t of ['START_COMPONENT','FIRST_SIDE','SECOND_SIDE','SUBLINE','SUMMARY_COMPONENT','$330'])
    assert.match(out.raw,new RegExp(t.replace('$','\\$')));
});
test('functional nodes are snapshotted across builder variants and async queue',async()=>{
  const localLogo=Buffer.from(logo);
  const card=box({padding:12},[
    image(localLogo,{width:40,height:20}),paragraph('IMMUTABLE_COMPONENT')
  ]);
  const base=engine.document({title:'Snapshots'});
  const a=base.add(card),b=base.add(paragraph('OTHER_COMPONENT'));
  localLogo.fill(0);
  const q=new PdfRenderQueue({maxConcurrent:1,maxQueued:2});
  const pdf=inspect(await q.render(a.toDocument(),font));
  const other=inspect(await b.render());
  assert.match(pdf.raw,/IMMUTABLE_COMPONENT/);
  assert.doesNotMatch(other.raw,/IMMUTABLE_COMPONENT/);
  assert.match(other.raw,/OTHER_COMPONENT/);
  assert.match(execFileSync('pdfimages',['-list',pdf.path],{encoding:'utf8'}),/\b160\s+80\b/);
  q.close();
});
test('nested recursion depth, invalid components and impossible atomic boxes reject safely',()=>{
  const base=engine.document({title:'Invalid nodes',page:'Letter'});
  assert.throws(()=>base.add(null),/invalid/);
  assert.throws(()=>base.add({kind:'fake'}),/unsupported/);
  assert.throws(()=>base.add(row({gap:12},[column({kind:'fake'})])),
    /unsupported content node/);
  let nested=paragraph('DEEPEST');
  for(let i=0;i<10;i++)nested=box({padding:9},nested);
  assert.throws(()=>base.add(nested).renderSync(),/depth exceeds 8/);
  assert.throws(()=>base.add(box({padding:12},[
    box({padding:12},paragraph('VERY_BIG_TEXT '.repeat(2000)))
  ])).renderSync(),/nested box exceeds printable|pagination|height/i);
});
test('resource limits count deeply nested images, not just root images',()=>{
  const c=box({padding:0},Array.from({length:65},(_,i)=>
    box({padding:0},image(logo,{width:25,height:12}))
  ));
  assert.throws(()=>engine.document({title:'Budget'}).add(c).renderSync(),/too many images|image bytes/i);
});


test('Grid and Row cells can nest boxes, grids and rich tables through the shared node tree',()=>{
  const wrapped=grid({columns:2,gap:10},[
    TotalCard('GRID_CARD','$200'),
    box({padding:9,background:'#F7F7F7'},[
      paragraph('INNER_GRID_BOX'),
      grid({columns:2,gap:8},[
        paragraph('DEEP_A'),
        paragraph('DEEP_B')
      ]),
      table([['GRID_TABLE_ROW','$44']],{columns:[
        {title:'Item',width:'50%'},{title:'Total',width:'50%'}
      ]})
    ])
  ]);
  const out=inspect(engine.document({title:'Nested grid',page:'Letter'})
    .add(wrapped)
    .add(row({gap:12},[
      column(TotalCard('ROW_CARD','$300'),{width:'50%'}),
      column(paragraph('ROW_NEXT'),{width:'50%'})
    ]))
    .renderSync());
  for(const label of ['GRID_CARD','$200','INNER_GRID_BOX','DEEP_A','DEEP_B',
    'GRID_TABLE_ROW','$44','ROW_CARD','$300','ROW_NEXT']){
    assert.match(out.raw,new RegExp(label.replace('$','\\$')));
  }
  const first=out.words.find(w=>w.text==='GRID_CARD');
  const second=out.words.find(w=>w.text==='INNER_GRID_BOX');
  assert.ok(first && second && first.left<second.left,'real two-column positions');
});
test('nested boxes in row/grid obey image resource and height budgets',()=>{
  const nodes=Array.from({length:65},()=>box({padding:0},
    image(logo,{width:25,height:12})));
  const many=grid({columns:1,gap:0},nodes);
  assert.throws(()=>engine.document({title:'Nested grid image budget'})
    .add(many).renderSync(),/too many images|image bytes/i);
});


test('Fluent grid columns expose box, grid and table through shared ContentBuilder',()=>{
  const out=inspect(engine.document({title:'Fluent nested grid',page:'Letter'})
    .grid({columns:2,gap:12},g=>g
      .cell(c=>c.box({padding:14,background:'#EDF5FF'},b=>b
        .paragraph('FLUENT_CARD')
        .image(logo,{width:44,height:22})
      ))
      .cell(c=>c
        .paragraph('SIDE_DESCRIPTION')
        .grid({columns:1},inner=>inner
          .cell(x=>x.paragraph('NESTED_GRID_CELL')))
        .table([['NESTED_TABLE_VALUE']],{
          columns:[{title:'Label',width:'100%'}]
        })
      )
    )
    .renderSync());
  for(const mark of ['FLUENT_CARD','SIDE_DESCRIPTION','NESTED_GRID_CELL','NESTED_TABLE_VALUE'])
    assert.match(out.raw,new RegExp(mark));
  assert.match(execFileSync('pdfimages',['-list',out.path],{encoding:'utf8'}),/\b160\s+80\b/);
});


test('cyclic functional component graph rejected without mutating immutable document',()=>{
  const cyclic={kind:'flow',children:[]};
  cyclic.children.push(cyclic);
  const base=engine.document({title:'Cycle'});
  assert.throws(()=>base.add(cyclic),/circular component tree/);
  assert.equal(base.toDocument().blocks.length,0);
});
