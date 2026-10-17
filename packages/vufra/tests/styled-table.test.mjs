import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {execFileSync} from 'node:child_process';
import {readFileSync, writeFileSync, mkdtempSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';

const require=createRequire(import.meta.url);
const {createVufra,renderPdf,PdfRenderQueue}=require('../dist/index.js');
const font=readFileSync(execFileSync('fc-match',['Noto Sans','-f','%{file}\n'],{encoding:'utf8'}).trim());
const bold=readFileSync(execFileSync('fc-match',['Noto Sans:style=Bold','-f','%{file}\n'],{encoding:'utf8'}).trim());
const app=createVufra({font,fonts:{bold},theme:{colors:{accent:'#C6F2C3'}}});
const logo=readFileSync(new URL('./fixtures/two-tone.png',import.meta.url));
const columns=[{title:'ITEM',width:'25%'},{title:'DETAILS',width:'50%'},{title:'TOTAL',width:'25%',align:'right'}];
const records=n=>Array.from({length:n},(_,i)=>[
  {text:'REC'+String(i+1).padStart(4,'0'),bold:i===0},
  i===1?{runs:[{text:'IMPORTANT ',bold:true,color:'#AA1144'},{text:'service item'}]}:
    'Service description '+String(i+1),
  {text:'$'+(i+1)*7,background:i===0?'accent':undefined,align:'right'}
]);
function inspect(bytes){
  const dir=mkdtempSync(join(tmpdir(),'vufra-unit18-'));
  const path=join(dir,'test.pdf');
  writeFileSync(path,bytes);
  const pages=Number(execFileSync('pdfinfo',[path],{encoding:'utf8'}).match(/Pages:\s+(\d+)/)[1]);
  const raw=execFileSync('pdftotext',['-raw',path,'-'],{encoding:'utf8'});
  const page=n=>execFileSync('pdftotext',['-raw','-f',String(n),'-l',String(n),path,'-'],{encoding:'utf8'});
  const fonts=execFileSync('pdffonts',[path],{encoding:'utf8'});
  return {path,pages,raw,page,fonts};
}

test('nested styled table repeats measured header and conserves 210 records across pages',()=>{
  const result=inspect(app.document({title:'Enterprise table',page:'Letter'})
    .box({padding:14,border:{width:1,color:'#99AABB'},background:'#FFFFFF'},b=>{
      b.heading('FINANCIAL_STATEMENT',{bold:true});
      b.table(records(210),{columns});
      b.paragraph('AFTER_TABLE');
    }).renderSync());
  assert.ok(result.pages>=4,'Expected multipage native table: '+result.pages);
  const found=[...result.raw.matchAll(/REC(\d{4})/g)].map(m=>Number(m[1]));
  assert.deepEqual(found,Array.from({length:210},(_,i)=>i+1));
  assert.match(result.raw,/AFTER_TABLE/);
  assert.match(result.fonts,/NotoSans-Bold/);
  for(let i=1;i<=result.pages;i++){
    const text=result.page(i);
    assert.match(text,/ITEM.*DETAILS.*TOTAL/s,'header on page '+i);
    assert.equal((text.match(/\bITEM\b/g)??[]).length,1,'header repeated once');
  }
});
test('single row with inline mixed runs has genuine font and text color',()=>{
  const out=inspect(app.document({title:'Rich cells',page:'Letter'})
    .tableStyled(records(2),{columns}).renderSync());
  assert.match(out.raw,/IMPORTANT/);
  assert.match(out.raw,/service item/);
  assert.match(out.fonts,/NotoSans-Bold/);
});
test('narrow box table columns measure against inner box width',()=>{
  const out=inspect(app.document({title:'Narrow',page:'Letter'})
    .box({width:350,align:'center',padding:20},b=>{
      b.table([['LEFT_VAL','RIGHT_VAL']],{columns:[
        {title:'LEFT',width:'50%'},{title:'RIGHT',width:'50%'}
      ]});
    }).renderSync());
  assert.equal(out.pages,1);
  assert.match(out.raw,/LEFT_VAL/);
  assert.match(out.raw,/RIGHT_VAL/);
  assert.throws(()=>app.document().box({width:350,padding:20},b=>{
    b.table([['L','R']],{columns:[
      {title:'left',width:250},{title:'right',width:150}
    ]});
  }),/columns exceed/);
});
test('oversized atomic row rejects and previous plain table API is unaffected',()=>{
  const huge='SUPERTOKEN '.repeat(2600);
  assert.throws(()=>app.document({title:'Impossible',page:'Letter'}).tableStyled([
    ['OK',huge,'$1']
  ],{columns}).renderSync(),/row height exceeds|pagination|InvalidHeight|Invalid document/i);
  const standard=inspect(app.document({title:'Legacy unaffected'})
    .table([{service:'OLD_TABLE_ROW',amount:22}]).renderSync());
  assert.match(standard.raw,/OLD_TABLE_ROW/);
});
test('validates styled cells, missing faces, bad fills and row mismatch',()=>{
  const doc=app.document({title:'Bad table'});
  assert.throws(()=>doc.tableStyled([['A']],{columns}),/row cells must match/);
  assert.throws(()=>doc.tableStyled([['A','B','C']],{columns:[
    {...columns[0],width:500},columns[1],columns[2]
  ]}),/columns exceed/);
  assert.throws(()=>doc.tableStyled([[{text:'A',font:'unconfigured'},'B','C']],{columns}),
    /must be configured/);
  assert.throws(()=>doc.tableStyled([[{text:'A',background:'invalid'},'B','C']],{columns}),
    /color/i);
  assert.throws(()=>renderPdf({title:'Low-level invalid',blocks:[{type:'box',box:{
    items:[{type:'table',table:{header:{columns:[]},rows:[],fills:[]}}]}}]},font),
    /table/i);
});
test('async and FIFO queue retain caller data snapshots',async()=>{
  const data=records(35), queue=new PdfRenderQueue({maxConcurrent:1,maxQueued:2});
  const builder=app.document({title:'Queue nested table',page:'Letter'})
    .footer(f=>f.text(({page,total})=>'PAGE_'+page+'_'+total))
    .box({padding:12},b=>b.table(data,{columns}));
  const task=queue.render(builder.toDocument(),font);
  data[0][0].text='MUTATED';
  const out=inspect(await task);
  assert.match(out.raw,/REC0001/);
  assert.doesNotMatch(out.raw,/MUTATED/);
  assert.match(out.raw,/PAGE_1_/);
  const async=inspect(await builder.render());
  assert.match(async.raw,/REC0035/);
  queue.close();
});


test('PNG in a styled cell is embedded, and impossible image dimensions reject',()=>{
  const out=inspect(app.document({title:'Cell artwork',page:'Letter'})
    .box({padding:16},b=>b.table([
      ['LOGO_CELL',{image:logo,width:55,height:30,background:'#DDEEFF'},'$200']
    ],{columns})).renderSync());
  assert.match(out.raw,/LOGO_CELL/);
  assert.match(execFileSync('pdfimages',['-list',out.path],{encoding:'utf8'}),
    /\b160\s+80\b/);
  assert.throws(()=>app.document({title:'Oversized image'}).tableStyled([
    ['A',{image:logo,width:999,height:30},'B']
  ],{columns}),/invalid styled table cell image/);
});

test('styled cell background is a real PDF pixel fill, not styling metadata',()=>{
  const out=inspect(app.document({title:'Cell fill',page:'Letter'})
    .tableStyled([['COLOR_ROW',{text:'GREEN_VALUE',background:'accent'},'$42']],
      {columns}).renderSync());
  const bbox=execFileSync('pdftotext',['-bbox',out.path,'-'],{encoding:'utf8'});
  const word=bbox.match(/<word xMin="([\d.]+)" yMin="([\d.]+)" xMax="([\d.]+)" yMax="([\d.]+)">GREEN_VALUE<\/word>/);
  assert.ok(word,'find styled cell text bounds');
  const pixelBuffer=execFileSync('pdftoppm',['-f','1','-l','1','-r','72',
    '-singlefile',out.path],{maxBuffer:6*1024*1024});
  const header=pixelBuffer.subarray(0,90).toString('latin1')
    .match(/^P6\s+(\d+)\s+(\d+)\s+255\s/);
  assert.ok(header,'ppm raster header');
  const [width,height]=[+header[1],+header[2]];
  const x=Math.floor(+word[1]+20);
  const y=Math.floor(+word[2]-4);
  assert.ok(x>=0 && y>=0 && x<width && y<height);
  const at=header[0].length+(y*width+x)*3;
  const rgb=[...pixelBuffer.subarray(at,at+3)];
  assert.deepEqual(rgb,[198,242,195]);
});


test('two independent boxed tables repeat only their own headers and keep all records',()=>{
  const first=Array.from({length:85},(_,i)=>['ALPHA'+String(i+1).padStart(3,'0'),'Service '+i]);
  const second=Array.from({length:85},(_,i)=>['BETA'+String(i+1).padStart(3,'0'),'Payment '+i]);
  const out=inspect(app.document({title:'Multiple tables',page:'Letter'})
    .box({padding:10},b=>{
      b.table(first,{columns:[{title:'FIRST_KEY',width:'40%'},{title:'FIRST_DESC',width:'60%'}]});
      b.paragraph('BETWEEN_TABLES');
      b.table(second,{columns:[{title:'SECOND_KEY',width:'40%'},{title:'SECOND_DESC',width:'60%'}]});
    }).renderSync());
  assert.ok(out.pages>=5);
  assert.deepEqual([...out.raw.matchAll(/ALPHA(\d{3})/g)].map(m=>+m[1]),
    Array.from({length:85},(_,i)=>i+1));
  assert.deepEqual([...out.raw.matchAll(/BETA(\d{3})/g)].map(m=>+m[1]),
    Array.from({length:85},(_,i)=>i+1));
  assert.equal((out.raw.match(/BETWEEN_TABLES/g)??[]).length,1);
  for(let page=1;page<=out.pages;page++){
    const text=out.page(page);
    if(text.includes('ALPHA'))assert.match(text,/FIRST_KEY/);
    if(text.includes('BETA'))assert.match(text,/SECOND_KEY/);
  }
});

test('nested table PNGs count towards native image preflight (65 rejected)',()=>{
  const imageRows=Array.from({length:65},(_,i)=>[
    {image:logo,width:30,height:15}, 'IMAGE_'+i
  ]);
  assert.throws(()=>app.document({title:'Images budget'}).tableStyled(imageRows,{
    columns:[{title:'Artwork',width:'50%'},{title:'Description',width:'50%'}]
  }).renderSync(),/too many images|image bytes/i);
});
