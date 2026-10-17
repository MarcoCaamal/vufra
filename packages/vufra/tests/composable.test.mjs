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
  const pages=inspect(base.add(box({padding:12},[
    box({padding:12},paragraph('VERY_BIG_TEXT '.repeat(2000)))
  ])).renderSync());
  assert.ok(pages.pages>=3, 'nested content must now paginate');
  assert.equal((pages.raw.match(/VERY_BIG_TEXT/g)??[]).length,2000);
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


test('deep nested boxes fragment across pages without duplicate data or text beyond margins',()=>{
  const markers=Array.from({length:250},(_,i)=>
    paragraph('NESTED_'+String(i+1).padStart(4,'0')+' complete entry'));
  const wrapped=box({padding:18,background:'#F6F9FF',border:{color:'#557799',width:1}},[
    heading('OUTER_HEADING'),
    box({padding:16,background:'#FFF5EA',border:{color:'#DD6633',width:1}},[
      paragraph('INNER_HEADING'),
      box({padding:14,background:'#EDF9EC',border:{color:'#338833',width:1}},markers),
      paragraph('AFTER_INNER_BOX')
    ]),
    paragraph('AFTER_OUTER_BOX')
  ]);
  const result=inspect(engine.document({title:'Deep fragmentation',page:'Letter'})
    .add(wrapped).renderSync());
  assert.ok(result.pages>=7, 'expected >=7 paginated pages');
  assert.deepEqual([...result.raw.matchAll(/NESTED_(\d{4})/g)].map(m=>+m[1]),
    Array.from({length:250},(_,i)=>i+1));
  assert.equal((result.raw.match(/AFTER_OUTER_BOX/g)??[]).length,1);
  assert.equal((result.raw.match(/AFTER_INNER_BOX/g)??[]).length,1);
  // All painted text stays strictly within US Letter content area.
  for(const w of result.words.filter(w=>w.text.startsWith('NESTED_') ||
    w.text==='OUTER_HEADING' || w.text==='INNER_HEADING' ||
    w.text==='AFTER_INNER_BOX' || w.text==='AFTER_OUTER_BOX')) {
    assert.ok(w.left>=49-1 && w.right<=612-49+1,
      'horizontal overflow: '+w.text+' at '+w.left);
    assert.ok(w.top>=120-5 && w.bottom<=792-72+5,
      'vertical overflow: '+w.text+' at '+w.top);
  }
});

test('styled table inside nested box repeats heading and preserves invoice entries',()=>{
  const records=Array.from({length:175},(_,i)=>[
    'HIER_'+String(i+1).padStart(4,'0'),'$'+(i+1)*3
  ]);
  const result=inspect(engine.document({title:'Nested tables',page:'Letter'})
    .add(box({padding:10},[
      box({padding:13,border:{width:1,color:'#557799'}},[
        table(records,{columns:[
          {title:'REPEAT_LABEL',width:'60%'},{title:'AMOUNT_COL',width:'40%'}
        ]})
      ])
    ])).renderSync());
  assert.ok(result.pages>=5);
  assert.deepEqual([...result.raw.matchAll(/HIER_(\d{4})/g)].map(m=>+m[1]),
    Array.from({length:175},(_,i)=>i+1));
  for(let i=1;i<=result.pages;i++){
    const pageText=execFileSync('pdftotext',['-raw','-f',String(i),'-l',String(i),
      result.path,'-'],{encoding:'utf8'});
    assert.equal((pageText.match(/REPEAT_LABEL/g)??[]).length,1,
      'repeated table header on page '+i);
  }
});


test('tall parallel Row content splits at item boundaries instead of rejecting whole row',()=>{
  const out=inspect(engine.document({title:'Fragmented row',page:'Letter'})
    .row(r=>r
      .column({width:'50%'},c=>{
        for(let i=1;i<=42;i++)c.paragraph('LEFT_'+String(i).padStart(3,'0'));
      })
      .column({width:'50%'},c=>{
        for(let i=1;i<=35;i++)c.paragraph('RIGHT_'+String(i).padStart(3,'0'));
      })
    ).renderSync());
  assert.ok(out.pages>=2);
  const tokens=[...out.raw.matchAll(/LEFT_(\d{3})/g)].map(m=>+m[1]);
  assert.deepEqual(tokens,Array.from({length:42},(_,i)=>i+1));
  const right=[...out.raw.matchAll(/RIGHT_(\d{3})/g)].map(m=>+m[1]);
  assert.deepEqual(right,Array.from({length:35},(_,i)=>i+1));
});

test('tall Row nested inside deeply decorated boxes resumes correctly on later pages',()=>{
  const out=inspect(engine.document({title:'Nested fragmented row',page:'Letter'})
    .box({padding:15,border:{color:'#556677',width:1}},b=>b
      .box({padding:13,background:'#F3F7FC'},inner=>inner
        .row(r=>r
          .column({width:'50%'},c=>{
            for(let i=1;i<=41;i++)c.paragraph('NLEFT_'+String(i).padStart(3,'0'));
          })
          .column({width:'50%'},c=>{
            for(let i=1;i<=42;i++)c.paragraph('NRIGHT_'+String(i).padStart(3,'0'));
          })
        )
        .paragraph('NESTED_ROW_AFTER')
      )
    ).renderSync());
  assert.ok(out.pages>=2);
  assert.deepEqual([...out.raw.matchAll(/NLEFT_(\d{3})/g)].map(m=>+m[1]),
    Array.from({length:41},(_,i)=>i+1));
  assert.deepEqual([...out.raw.matchAll(/NRIGHT_(\d{3})/g)].map(m=>+m[1]),
    Array.from({length:42},(_,i)=>i+1));
  assert.match(out.raw,/NESTED_ROW_AFTER/);
});


test('nested keepTogether and breakBefore preserve explicit pagination policies',()=>{
  const lead=Array.from({length:17},(_,i)=>
    paragraph('LEAD_'+String(i+1).padStart(2,'0')));
  const fixed=Array.from({length:10},(_,i)=>
    paragraph('KEPT_'+String(i+1).padStart(2,'0')));
  const out=inspect(engine.document({title:'Keep policies',page:'Letter'})
    .add(box({padding:10},[
      ...lead,
      box({padding:8,keepTogether:true,background:'#EEF4FF'},fixed)
    ])).renderSync());
  assert.ok(out.pages>=2);
  assert.deepEqual([...out.raw.matchAll(/KEPT_(\d{2})/g)].map(m=>+m[1]),
    Array.from({length:10},(_,i)=>i+1));
  const page1=execFileSync('pdftotext',['-raw','-f','1','-l','1',out.path,'-'],
    {encoding:'utf8'});
  assert.doesNotMatch(page1,/KEPT_01/);
  const broken=inspect(engine.document({title:'Break policies',page:'Letter'})
    .add(box({padding:10},[
      paragraph('BEFORE_BREAK'),
      box({padding:8,breakBefore:true},paragraph('AFTER_BREAK'))
    ])).renderSync());
  assert.equal(broken.pages,2);
  assert.equal((broken.raw.match(/BEFORE_BREAK/g)??[]).length,1);
  assert.equal((broken.raw.match(/AFTER_BREAK/g)??[]).length,1);
});

test('oversized nested keepTogether box rejects instead of clipping or silently splitting',()=>{
  const body=Array.from({length:120},(_,i)=>paragraph('ATOMIC_'+i));
  assert.throws(()=>engine.document({title:'Too large keep together',page:'Letter'})
    .add(box({padding:8},box({padding:8,keepTogether:true},body)))
    .renderSync(),/InvalidHeight|invalid layout|height/i);
});


test('nested boxes repaint actual RGB backgrounds on first, middle and last page',()=>{
  const lines=Array.from({length:180},(_,i)=>
    paragraph('COLORLINE_'+String(i+1).padStart(4,'0')));
  const out=inspect(engine.document({title:'Fragment RGB',page:'Letter'})
    .add(box({padding:18,background:'#EEF4FF'},[
      box({padding:16,background:'#EDF9EC'},lines)
    ])).renderSync());
  assert.ok(out.pages>=5);
  for(const page of [...new Set([1,Math.ceil(out.pages/2),out.pages])]){
    const xml=execFileSync('pdftotext',['-bbox','-f',String(page),'-l',
      String(page),out.path,'-'],{encoding:'utf8'});
    const match=xml.match(/<word xMin="([\d.]+)" yMin="([\d.]+)" xMax="([\d.]+)" yMax="([\d.]+)">COLORLINE_\d{4}<\/word>/);
    assert.ok(match,'content on page '+page);
    const ppm=execFileSync('pdftoppm',['-f',String(page),'-l',String(page),
      '-r','72','-singlefile',out.path],{maxBuffer:8*1024*1024});
    const header=ppm.subarray(0,90).toString('latin1')
      .match(/^P6\s+(\d+)\s+(\d+)\s+255\s/);
    assert.ok(header,'valid raster');
    const width=+header[1],height=+header[2];
    const x=Math.floor(+match[1]-4),y=Math.floor(+match[2]+2);
    assert.ok(x>=0&&y>=0&&x<width&&y<height);
    const offset=header[0].length+(y*width+x)*3;
    assert.deepEqual([...ppm.subarray(offset,offset+3)],[237,249,236],
      'inner box background must be repainted on page '+page);
  }
});

test('complex rich-text row still rejects a single indivisible overheight run',()=>{
  const huge='IMPOSSIBLE_RICH '.repeat(2200);
  assert.throws(()=>engine.document({title:'Oversized one rich run'})
    .row(r=>r.column(c=>c.paragraph(huge,{bold:true})))
    .renderSync(),/row height exceeds printable page/i);
});
