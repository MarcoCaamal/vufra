import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {execFileSync} from 'node:child_process';
import {readFileSync,writeFileSync,mkdtempSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
const {createVufra}=createRequire(import.meta.url)('../dist/index.js');
const font=readFileSync(execFileSync('fc-match',['Noto Sans','-f','%{file}\n'],{encoding:'utf8'}).trim());
const app=createVufra({font});
function boxText(bytes){
 const path=join(mkdtempSync(join(tmpdir(),'vufra40-')),'layout.pdf');writeFileSync(path,bytes);
 const bbox=execFileSync('pdftotext',['-bbox',path,'-'],{encoding:'utf8'});
 const words=[...bbox.matchAll(/<word xMin="([\d.]+)" yMin="([\d.]+)" xMax="([\d.]+)" yMax="([\d.]+)">([^<]+)<\/word>/g)]
 .map(m=>({x:+m[1],y:+m[2],right:+m[3],text:m[5]}));
 const find=t=>{const w=words.find(x=>x.text===t);assert.ok(w,t+' missing');return w;};
 return {find,words};
}
test('row columns measure centered text and vertically center against a taller neighbor',()=>{
 const long='TOPSTART '+'wrap '.repeat(88);
 const builder=app.document({title:'Row alignment',page:'Letter'}).row({gap:12},r=>{
   r.column({width:'70%'},c=>c.paragraph(long));
   r.column({width:'30%',align:'center',verticalAlign:'center',padding:{left:10,right:14,top:6,bottom:8}},
     c=>c.paragraph('CENTERROW'));
 });
 const snap=builder.toDocument();
 const row=snap.blocks[0].row;
 assert.equal(row.columns[1].align,'center');
 assert.deepEqual(row.columns[1].cell.padding,{top:6,right:14,bottom:8,left:10});
 const out=boxText(builder.renderSync());
 const mid=out.find('CENTERROW'),top=out.find('TOPSTART');
 assert.ok(mid.y>top.y+25,'vertical center should move content within tall row');
 const rowWidth=row.columns[0].width+12+row.columns[1].width;
 const left=48;
 const x0=left+row.columns[0].width+12;
 const expected=x0+10+(row.columns[1].width-10-14)/2;
 assert.ok(Math.abs((mid.x+mid.right)/2-expected)<3,JSON.stringify({mid,expected,rowWidth}));
});
test('row column padding validates remaining width and supported alignment',()=>{
 assert.throws(()=>app.document().row(r=>r.column({width:60,padding:{left:30,right:30}},c=>c.paragraph('X'))),/padding/);
 assert.throws(()=>app.document().row(r=>r.column({width:180,align:'justify'},c=>c.paragraph('X'))),/align/);
 const bytes=app.document().row(r=>r.column({width:220,align:'center'},c=>c.paragraph('CENTER_NO_PAD'))).renderSync();
 assert.ok(bytes.length>500);
});
