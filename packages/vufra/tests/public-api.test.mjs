import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {execFileSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
const require=createRequire(import.meta.url);
const sdk=require('../dist/index.js');
const font=readFileSync(execFileSync('fc-match',['Noto Sans','-f','%{file}\\n'],
  {encoding:'utf8'}).trim());
test('only Fluent, composable helpers and queue are public',()=>{
  for(const removed of ['renderPdf','renderPdfAsync','renderPdfAsyncMeasured',
    'tableStyled','PdfDocument'])
    assert.equal(Object.hasOwn(sdk,removed),false,removed+' was not removed');
  assert.equal(typeof sdk.createVufra,'function');
  assert.equal(typeof sdk.box,'function');
  assert.equal(typeof sdk.table,'function');
  assert.equal(typeof sdk.PdfRenderQueue,'function');
  assert.throws(()=>require('vufra/renderer'),/not exported|ERR_PACKAGE_PATH_NOT_EXPORTED/);
});
test('Fluent builder is immutable and toDocument is an isolated deep copy',()=>{
 const builder=sdk.createVufra({font}).document({title:'Immutable'})
  .paragraph('ORIGINAL_CONTENT')
  .table([['SKU001','ITEM']],{columns:[
    {title:'Key',width:'30%'},{title:'Value',width:'70%'}
  ]});
 const snapshot=builder.toDocument();
 snapshot.blocks[0].text='MUTATED';
 snapshot.blocks.pop();
 assert.equal(builder.toDocument().blocks.length,2);
 assert.notEqual(builder.toDocument().blocks[0].text,'MUTATED');
 assert.equal(typeof builder.tableStyled,'undefined');
 assert.equal(Buffer.from(builder.renderSync()).subarray(0,5).toString(),'%PDF-');
});
