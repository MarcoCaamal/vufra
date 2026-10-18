import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {execFileSync} from 'node:child_process';
import {readFileSync,writeFileSync,mkdtempSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';

const require=createRequire(import.meta.url);
const {createVufra}=require('../dist/index.js');
const font=readFileSync(execFileSync('fc-match',['Noto Sans','-f','%{file}\n'],{encoding:'utf8'}).trim());
const bold=readFileSync(execFileSync('fc-match',['Noto Sans:style=Bold','-f','%{file}\n'],{encoding:'utf8'}).trim());
const app=createVufra({font,fonts:{bold}});
function inspect(pdf){
  const file=join(mkdtempSync(join(tmpdir(),'vufra-u38-')),'cells.pdf');
  writeFileSync(file,pdf);
  const bbox=execFileSync('pdftotext',['-bbox',file,'-'],{encoding:'utf8'});
  const raw=execFileSync('pdftotext',['-raw',file,'-'],{encoding:'utf8'});
  const pages=Number(execFileSync('pdfinfo',[file],{encoding:'utf8'}).match(/Pages:\s+(\d+)/)[1]);
  const words=[...bbox.matchAll(/<word xMin="([\d.]+)" yMin="([\d.]+)" xMax="([\d.]+)" yMax="([\d.]+)">([^<]+)<\/word>/g)]
    .map(m=>({x:Number(m[1]),y:Number(m[2]),end:Number(m[3]),bottom:Number(m[4]),text:m[5]}));
  const find=t=>{
    const found=words.filter(w=>w.text===t);
    assert.equal(found.length,1,'word '+t+' should appear exactly once');
    return found[0];
  };
  return {file,raw,pages,words,find};
}

test('table/column/cell padding precedence and horizontal alignment use real measured text widths',()=>{
  const result=inspect(app.document({title:'Cell width alignment',page:'Letter'})
    .table([[
      {text:'LEFT_ONLY',padding:{left:14}},
      {text:'CENTER_ONLY',padding:{right:22}},
      {text:'RIGHT_ONLY',padding:{right:17}}
    ]],{padding:{left:8,right:8,top:9,bottom:9},columns:[
      {title:'LEFT_HEADER',width:170,align:'left'},
      {title:'CENTER_HEADER',width:170,align:'center',padding:{left:16}},
      {title:'RIGHT_HEADER',width:174,align:'right'}
    ]}).renderSync());
  const l=result.find('LEFT_ONLY'),c=result.find('CENTER_ONLY'),r=result.find('RIGHT_ONLY');
  // Letter defaults: the table starts at the page's left printable margin.
  const start=result.find('LEFT_HEADER').x-8;
  assert.ok(Math.abs(l.x-(start+14))<2.5,JSON.stringify({start,l}));
  const centerTarget=start+170+16+(170-16-22)/2;
  assert.ok(Math.abs((c.x+c.end)/2-centerTarget)<2.5,JSON.stringify({centerTarget,c}));
  const rightTarget=start+170+170+174-17;
  assert.ok(Math.abs(r.end-rightTarget)<2.5,JSON.stringify({rightTarget,r}));
  const head=result.find('CENTER_HEADER');
  const headerCenter=start+170+16+(170-16-8)/2;
  assert.ok(Math.abs((head.x+head.end)/2-headerCenter)<2.5,JSON.stringify({headerCenter,head}));
});

test('vertical top center bottom alignment respects tallest cell and independent padding',()=>{
  const result=inspect(app.document({title:'Cell vertical alignment',page:'Letter'})
    .table([[
      {runs:[{text:'LONGTOP ',bold:true},{text:'A B C D E F G H I J K L M N O P Q R S T U V W X Y Z '.repeat(5)}]},
      {text:'TOP_TOKEN',verticalAlign:'top'},
      {text:'MID_TOKEN',verticalAlign:'center'},
      {text:'BOT_TOKEN',verticalAlign:'bottom'}
    ]],{padding:{top:10,bottom:14,left:6,right:6},columns:[
      {title:'DETAIL',width:145},
      {title:'TOP',width:123},
      {title:'MIDDLE',width:123},
      {title:'BOTTOM',width:123}
    ]}).renderSync());
  assert.equal(result.pages,1);
  const top=result.find('TOP_TOKEN').y,mid=result.find('MID_TOKEN').y,bot=result.find('BOT_TOKEN').y;
  assert.ok(top+12<mid && mid+12<bot,JSON.stringify({top,mid,bot}));
  assert.match(result.raw,/LONGTOP/);
});

test('styled rich cells align text and padded continuation keeps long text in order',()=>{
  const many=Array.from({length:450},(_,i)=>'ROWID_'+String(i+1).padStart(3,'0'));
  const result=inspect(app.document({title:'Long rows'})
    .table([[
      {runs:[{text:'RICHSTART',bold:true},{text:' RICHEND'}],align:'center'},
      {text:many.join(' '),align:'center',padding:{left:12,right:12,top:18,bottom:20}}
    ]],{padding:7,columns:[
      {title:'LEFT',width:'35%'},{title:'RIGHT',width:'65%'}
    ]}).renderSync());
  assert.ok(result.pages>=2,'Expected continued table');
  assert.deepEqual([...result.raw.matchAll(/ROWID_(\d{3})/g)].map(m=>Number(m[1])),many.map((_,i)=>i+1));
  assert.equal((result.raw.match(/RICHSTART/g)??[]).length,1);
  assert.equal((result.raw.match(/RICHEND/g)??[]).length,1);
  for(let pg=1;pg<=result.pages;pg++){
    const txt=execFileSync('pdftotext',['-raw','-f',String(pg),'-l',String(pg),result.file,'-'],{encoding:'utf8'});
    assert.equal((txt.match(/LEFT/g)??[]).length,1,'Repeated header page '+pg);
  }
});

test('cell image sizing subtracts padding before validation',()=>{
  const image=readFileSync(new URL('./fixtures/two-tone.png',import.meta.url));
  const columns=[{title:'LOGO',width:100}];
  const valid=inspect(app.document({title:'Padded image',page:'Letter'})
    .table([[{image,width:60,height:24,padding:{left:20,right:20}}]],{columns}).renderSync());
  assert.equal(valid.pages,1);
  assert.throws(()=>app.document({title:'Image too wide',page:'Letter'})
    .table([[{image,width:61,height:24,padding:{left:20,right:20}}]],{columns}),
    /image or dimensions/);
});

test('table rejects invalid padding, alignment and insufficient inner width',()=>{
  const doc=app.document({title:'Cell errors'});
  const cols=[{title:'COL',width:'*'}];
  assert.throws(()=>doc.table([['X']],{columns:cols,padding:-1}),/padding/);
  assert.throws(()=>doc.table([['X']],{columns:cols,padding:{left:Infinity}}),/padding/);
  assert.throws(()=>doc.table([['X']],{columns:cols,padding:{around:2}}),/padding/);
  assert.throws(()=>doc.table([['X']],{columns:cols,verticalAlign:'baseline'}),/verticalAlign/);
  assert.throws(()=>doc.table([[{text:'X',align:'justify'}]],{columns:cols}),/invalid styled table cell/);
  assert.throws(()=>doc.table([[{text:'X',padding:{left:40,right:40}}]],{columns:[{title:'X',width:80}]}).renderSync(),/padding/);
});
