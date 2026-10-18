import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFileSync,writeFileSync,mkdtempSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
const {createVufra}=createRequire(import.meta.url)('../dist/index.js');
const font=readFileSync(execFileSync('fc-match',['Noto Sans','-f','%{file}\n'],{encoding:'utf8'}).trim());
const app=createVufra({font});
function measure(doc){
 const file=join(mkdtempSync(join(tmpdir(),'vufra-justify-')),'row.pdf');writeFileSync(file,doc.renderSync());
 const content=execFileSync('pdftotext',['-bbox',file,'-'],{encoding:'utf8'});
 const words=[...content.matchAll(/<word xMin="([\d.]+)" yMin="([\d.]+)" xMax="([\d.]+)" yMax="([\d.]+)">([^<]+)<\/word>/g)].map(x=>({x:+x[1],text:x[5]}));
 return name=>{const w=words.find(w=>w.text===name);assert.ok(w,name);return w.x;};
}
test('row justify space-between fills unused width with measured native gaps',()=>{
 const make=justify=>app.document({page:'Letter'}).row({gap:12,justify},row=>row
  .column({width:120},col=>col.paragraph('LEFT_LABEL'))
  .column({width:120},col=>col.paragraph('MIDDLE_LABEL'))
  .column({width:120},col=>col.paragraph('RIGHT_LABEL')));
 const spread=make('space-between'),tight=make('start');
 const row=spread.toDocument().blocks[0].row;
 const expected=(612-49-49-360)/2;
 assert.ok(Math.abs(row.gap-expected)<0.01);
 const s=measure(spread),t=measure(tight);
 assert.ok(Math.abs(s('LEFT_LABEL')-t('LEFT_LABEL'))<1);
 assert.ok(s('MIDDLE_LABEL')>t('MIDDLE_LABEL')+40);
 assert.ok(s('RIGHT_LABEL')>t('RIGHT_LABEL')+85);
});
test('row justify rejects implicit widths and invalid options instead of inventing tracks',()=>{
 assert.throws(()=>app.document().row({justify:'space-between'},r=>r
  .column(c=>c.paragraph('X')).column({width:120},c=>c.paragraph('Y'))),/explicitly sized/);
 assert.throws(()=>app.document().row({justify:'space-between'},r=>r
  .column({width:120},c=>c.paragraph('X'))),/at least two/);
 assert.throws(()=>app.document().row({justify:'around'},r=>r
  .column({width:120},c=>c.paragraph('X'))),/row.justify/);
});
