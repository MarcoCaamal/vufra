import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {execFileSync} from 'node:child_process';
import {readFileSync, writeFileSync, mkdtempSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';

const require = createRequire(import.meta.url);
const {createVufra, renderPdf, PdfRenderQueue} = ({...require('../dist/index.js'),...require('../dist/renderer.js')});
const regular = readFileSync(execFileSync('fc-match', ['Noto Sans', '-f', '%{file}\n'], {encoding:'utf8'}).trim());
const bold = readFileSync(execFileSync('fc-match', ['Noto Sans:style=Bold', '-f', '%{file}\n'], {encoding:'utf8'}).trim());
const logo = readFileSync(new URL('./fixtures/two-tone.png', import.meta.url));
const engine = createVufra({font:regular, fonts:{bold}});

function inspect(bytes) {
  const dir = mkdtempSync(join(tmpdir(), 'vufra-chrome-'));
  const path = join(dir, 'test.pdf');
  writeFileSync(path, bytes);
  const count = Number(execFileSync('pdfinfo', [path], {encoding:'utf8'}).match(/Pages:\s+(\d+)/)[1]);
  const page = n => execFileSync('pdftotext', ['-f', String(n), '-l', String(n), '-raw', path, '-'], {encoding:'utf8'});
  const bbox = execFileSync('pdftotext', ['-bbox', path, '-'], {encoding:'utf8'});
  const words = [...bbox.matchAll(/<word xMin="([\d.]+)" yMin="([\d.]+)" xMax="([\d.]+)" yMax="([\d.]+)">([^<]+)<\/word>/g)]
    .map(m => ({x:+m[1], y:+m[2], right:+m[3], bottom:+m[4], text:m[5]}));
  return {path, count, page, words, raw:execFileSync('pdftotext',['-raw',path,'-'], {encoding:'utf8'})};
}

test('header and footer repeat and page/total placeholders resolve AFTER pagination', () => {
  const doc = engine.document({title:'Quarterly result', page:'Letter'})
    .header(h => h.text('REPEATING_HEADER'))
    .footer(f => f.text(({page,total}) => 'PAGE-'+page+'-OF-'+total))
    .paragraph('PAGE_ONE_CONTENT')
    .pageBreak().paragraph('PAGE_TWO_CONTENT')
    .pageBreak().paragraph('PAGE_THREE_CONTENT');
  const out = inspect(doc.renderSync());
  assert.equal(out.count, 3);
  for (let n=1; n<=3; n++) {
    const text=out.page(n);
    assert.match(text, /REPEATING_HEADER/);
    assert.match(text, new RegExp('PAGE-'+n+'-OF-3'));
    assert.equal((text.match(/REPEATING_HEADER/g)??[]).length,1);
  }
  assert.doesNotMatch(out.raw, /\{\{page\}\}|\{\{total\}\}|Vufra • Documento/);
  for (const w of out.words.filter(w=>w.text.startsWith('PAGE-') || w.text==='REPEATING_HEADER')) {
    assert.ok(w.bottom < 120 || w.y > 716, 'page band must avoid body: '+JSON.stringify(w));
  }
});

test('different first-page bands, with page count retained in all variants', () => {
  const out = inspect(engine.document({title:'Different cover',page:'Letter'})
    .header(h => h.text('NORMAL_HEADER'))
    .firstHeader(h => h.text('COVER_HEADER'))
    .footer(f => f.text(({page,total}) => 'STANDARD_'+page+'_'+total))
    .firstFooter(f => f.text('COVER_FOOTER'))
    .paragraph('COVER_BODY')
    .pageBreak()
    .paragraph('NEXT_BODY')
    .renderSync());
  assert.equal(out.count,2);
  assert.match(out.page(1),/COVER_HEADER/);
  assert.doesNotMatch(out.page(1),/NORMAL_HEADER|STANDARD_/);
  assert.match(out.page(1),/COVER_FOOTER/);
  assert.match(out.page(2),/NORMAL_HEADER/);
  assert.doesNotMatch(out.page(2),/COVER_HEADER|COVER_FOOTER/);
  assert.match(out.page(2),/STANDARD_2_2/);
});

test('firstHeader(null) hides only first header; footer(null) disables default numbering', () => {
  const out = inspect(engine.document({title:'Suppression',page:'Letter'})
    .header(h=>h.text('BODY_HEADER'))
    .firstHeader(null)
    .footer(null)
    .paragraph('FIRST_BODY')
    .pageBreak()
    .paragraph('SECOND_BODY')
    .renderSync());
  assert.doesNotMatch(out.page(1),/BODY_HEADER/);
  assert.match(out.page(2),/BODY_HEADER/);
  assert.doesNotMatch(out.raw,/Página \d+ \/ \d+/);
});

test('company row includes a genuine bold font and PNG logo; body does not overlap', () => {
  const out = inspect(engine.document({title:'Company report',page:'Letter'})
    .header(h=>h.row({gap:14},row=>{
      row.column({width:'35%'},col=>col.image(logo,{width:55,height:33}));
      row.column({width:'65%',align:'right'},col=>col.paragraph('COMPANY_MARK',{bold:true,fontSize:14,
        lineHeight:19,spaceBefore:0,spaceAfter:0}));
    }))
    .footer(f=>f.grid({columns:2,gap:10},g=>{
      g.cell(c=>c.paragraph('CONFIDENTIAL'));
      g.cell(c=>c.paragraph('AUDITED_2026',{bold:true}));
    }))
    .paragraph('BODY_START')
    .renderSync());
  const fonts = execFileSync('pdffonts',[out.path],{encoding:'utf8'});
  const images = execFileSync('pdfimages',['-list',out.path],{encoding:'utf8'});
  assert.match(fonts,/NotoSans-Bold/);
  assert.match(images,/\b160\s+80\b/);
  for(const s of ['COMPANY_MARK','CONFIDENTIAL','AUDITED_2026','BODY_START']) assert.match(out.raw,new RegExp(s));
  const company=out.words.find(w=>w.text==='COMPANY_MARK');
  const body=out.words.find(w=>w.text==='BODY_START');
  assert.ok(company?.y<110 && body?.y>110,JSON.stringify({company,body}));
});

test('invalid or oversized page bands fail instead of crossing body margins', () => {
  const base=engine.document({title:'Too large',page:'Letter'});
  assert.throws(()=>base.header(h=>h.text('')), /nonempty|text must/);
  assert.throws(()=>base.header(h=>{h.text('ONE');h.text('TWO');}),/one text/i);
  const enlarged=inspect(base.header(h=>h.row(row=>row.column(c=>
    c.image(logo,{width:90,height:150})))).paragraph('AUTO_RESERVED_BODY').renderSync());
  const body=enlarged.words.find(w=>w.text==='AUTO_RESERVED_BODY');
  assert.ok(body && body.y>160,JSON.stringify(body));
  assert.throws(()=>base.header(h=>h.row(row=>row.column(c=>
    c.image(logo,{width:90,height:500}))))
    .footer(f=>f.row(row=>row.column(c=>c.image(logo,{width:90,height:500}))))
    .paragraph('overflow').renderSync(), /invalid page geometry|margin|height/i);
  assert.throws(()=>renderPdf({title:'bad',blocks:[{type:'paragraph',text:'x'}],
    pageChrome:{header:{gap:0,columns:[{width:500,items:[{type:'text',text:'TOO_WIDE'}]}]}}},regular),
    /row columns exceed|column|width/i);
});

test('low-level pageChrome and high-level Fluent document produce same dynamic numbering', () => {
  const out = inspect(renderPdf({title:'AST',blocks:[{type:'paragraph',text:'CUSTOM_LOW_LEVEL'}],
    page:{format:'letter'},pageChrome:{
      footer:{columns:[{width:500,items:[{type:'text',text:'RAW_{{page}}_{{total}}',
        style:{fontSize:10,lineHeight:15,spaceBefore:0,spaceAfter:0}}]}]}
    }}, regular));
  assert.match(out.raw,/RAW_1_1/);
  assert.match(out.raw,/CUSTOM_LOW_LEVEL/);
  assert.doesNotMatch(out.raw,/Página 1 \/ 1/);
});

test('async render and queue retain decorated page bands with caller-owned logo snapshot', async () => {
  const bytes=Buffer.from(logo);
  const doc=engine.document({title:'Queue Chrome',page:'Letter'})
    .header(h=>h.row(row=>row.column(c=>c.image(bytes,{width:48,height:24}))))
    .footer(f=>f.text(({page,total})=>'ASYNC_'+page+'_'+total))
    .paragraph('QUEUED_BODY');
  const q=new PdfRenderQueue({maxConcurrent:1,maxQueued:2});
  const pending=q.render(doc.toDocument(),regular);
  bytes.fill(0);
  const out=inspect(await pending);
  assert.match(out.raw,/ASYNC_1_1/);
  assert.match(out.raw,/QUEUED_BODY/);
  assert.match(execFileSync('pdfimages',['-list',out.path],{encoding:'utf8'}),/\b160\s+80\b/);
  const second=inspect(await doc.footer(f=>f.text('SIMPLE_ASYNC')).render());
  assert.match(second.raw,/SIMPLE_ASYNC/);
  assert.doesNotMatch(second.raw,/ASYNC_/);
  q.close();
});


test('immutable header snapshots original logo bytes and sibling template options', () => {
  const source=Buffer.from(logo);
  const base=engine.document({title:'Immutable chrome',page:'Letter'});
  const withLogo=base.header(h=>h.image(source,{width:48,height:24}))
    .paragraph('IMMUTABLE_BODY');
  const withoutLogo=base.header(h=>h.text('TEXT_ONLY')).paragraph('TEXT_BODY');
  source.fill(0);
  const first=inspect(withLogo.renderSync());
  const second=inspect(withoutLogo.renderSync());
  assert.match(execFileSync('pdfimages',['-list',first.path],{encoding:'utf8'}),
    /\b160\s+80\b/);
  assert.doesNotMatch(second.raw,/IMMUTABLE_BODY/);
  assert.match(second.raw,/TEXT_ONLY/);
  assert.equal(base.toDocument().pageChrome,undefined);
});
