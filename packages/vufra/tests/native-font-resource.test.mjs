import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFileSync,writeFileSync,mkdtempSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
const require=createRequire(import.meta.url);
const {createVufra}=require('../dist/index.js');
const native=require('../native/vufra.node');
const regular=readFileSync(execFileSync('fc-match',
  ['Noto Sans','-f','%{file}\n'],{encoding:'utf8'}).trim());
const bold=readFileSync(execFileSync('fc-match',
  ['Noto Sans:style=Bold','-f','%{file}\n'],{encoding:'utf8'}).trim());
function extract(bytes){
 const path=join(mkdtempSync(join(tmpdir(),'vufra-native-font-')),'a.pdf');
 writeFileSync(path,bytes);
 return execFileSync('pdftotext',['-raw',path,'-'],{encoding:'utf8'});
}
test('NativeFont stores immutable private bytes and rejects empty resources',()=>{
 const bytes=Buffer.from(regular);
 const resource=new native.NativeFont(bytes);
 assert.equal(resource.byteLength,bytes.length);
 assert.equal(resource.bytes,undefined,'never expose a mutable Rust byte slice');
 bytes.fill(0);
 assert.equal(resource.byteLength,regular.length);
 assert.throws(()=>new native.NativeFont(Buffer.alloc(0)),/1\.\.12 MiB/);
 const result=native.renderPdfNative('Native font resource',
  [{kind:'paragraph',text:'NATIVE_HANDLE_OK'}],resource,undefined,new native.NativeAssets([]));
 assert.match(extract(result),/NATIVE_HANDLE_OK/);
});
test('one Fluent factory reuses its immutable native font after caller mutation',async()=>{
 const caller=Buffer.from(regular);
 const app=createVufra({font:caller,fonts:{bold}});
 const a=app.document({title:'First'}).paragraph('FIRST_NATIVE_FONT').renderSync();
 caller.fill(0);
 const [b,c]=await Promise.all([
  app.document({title:'Second'}).paragraph('SECOND_NATIVE_FONT').render(),
  app.document({title:'Third'}).paragraph('THIRD_NATIVE_FONT').render()
 ]);
 assert.match(extract(a),/FIRST_NATIVE_FONT/);
 assert.match(extract(b),/SECOND_NATIVE_FONT/);
 assert.match(extract(c),/THIRD_NATIVE_FONT/);
});
test('document font overrides snapshot caller data separately from default resource',()=>{
 const app=createVufra({font:regular});
 const alternate=Buffer.from(bold);
 const override=app.document({title:'Override',font:alternate})
  .paragraph('OVERRIDE_FONT_OK');
 alternate.fill(0);
 assert.match(extract(override.renderSync()),/OVERRIDE_FONT_OK/);
 assert.match(extract(app.document({title:'Default'}).paragraph('DEFAULT_FONT_OK').renderSync()),
  /DEFAULT_FONT_OK/);
});
