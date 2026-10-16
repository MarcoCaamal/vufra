import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { readFileSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const require = createRequire(import.meta.url);
const { renderPdf } = require('../dist/index.js');
const font = readFileSync(process.env.VUFRA_FONT ||
  execFileSync('fc-match', ['Noto Sans', '-f', '%{file}\n'], { encoding: 'utf8' }).trim());

function pdfDetails(bytes) {
  const path = join(mkdtempSync(join(tmpdir(), 'vufra-table-')), 'table.pdf');
  writeFileSync(path, bytes);
  const info = execFileSync('pdfinfo', [path], { encoding: 'utf8' });
  const pages = Number(info.match(/Pages:\s+(\d+)/)?.[1]);
  const text = execFileSync('pdftotext', ['-layout', path, '-'], { encoding: 'utf8' });
  return { pages, text };
}

const columns = [
  { header: 'Código SKU', width: 110 },
  { header: 'Descripción de producto', width: 270 },
  { header: 'Importe MXN', width: 117 }
];

test('multi-column table: 600 rows, wrapping, repeated header and no lost records', () => {
  const rows = Array.from({ length: 600 }, (_, i) => [
    'SKU-' + String(i + 1).padStart(4, '0'),
    i % 5 === 0
      ? 'Cancún, niño, acción. ' + 'Descripción extensa para ajustar las líneas. '.repeat(3)
      : 'Producto de ejemplo ' + (i + 1),
    '$ ' + ((i + 1) * 12).toFixed(2)
  ]);
  const { pages, text } = pdfDetails(renderPdf({
    title: 'Vufra — tabla multicolumna',
    table: { columns, rows }
  }, font));
  assert.ok(pages > 12, pages);
  const ids = [...text.matchAll(/SKU-(\d{4})/g)].map(m => Number(m[1]));
  assert.deepEqual(ids, Array.from({ length: 600 }, (_, i) => i + 1));
  assert.equal((text.match(/Código SKU/g) || []).length, pages, 'header must repeat on every table page');
  assert.ok(text.includes('Cancún'), 'Spanish text was lost');
  assert.ok(text.includes('Importe MXN'), 'column header missing');
  console.log('Multi-column PDF validated:', pages, 'pages and', ids.length, 'records');
});

test('table after paragraphs has the right repeated-header page count', () => {
  const result = pdfDetails(renderPdf({
    title: 'Reporte mixto',
    paragraphs: ['Introducción para el reporte'],
    table: { columns, rows: Array.from({length: 120}, (_,i) => ['SKU-'+String(i).padStart(4,'0'),'Producto','10.50']) }
  }, font));
  assert.match(result.text, /Introducción para el reporte/);
  assert.equal((result.text.match(/Código SKU/g) || []).length, result.pages - 1);
});

test('header-only table produces one page without blank preliminary page', () => {
  const result = pdfDetails(renderPdf({
    title: 'Tabla vacía',
    table: {columns,rows:[]}
  }, font));
  assert.equal(result.pages, 1);
  assert.ok(result.text.includes('Código SKU'));
});

test('bad table structures and too-wide columns rejected', () => {
  const make = table => renderPdf({title:'Test',table}, font);
  assert.throws(() => make({columns:[],rows:[]}), /columns/);
  assert.throws(() => make({columns:[{header:'H',width:500}],rows:[]}), /width/);
  assert.throws(() => make({columns:[{header:'H',width:NaN}],rows:[]}), /width/);
  assert.throws(() => make({columns:[{header:'H',width:100}],rows:[['a','b']]}), /rows/);
  assert.throws(() => make({columns:[{header:'H',width:100}],rows:[['W'.repeat(1000)]]}), /printable width/);
  assert.throws(() => make({columns:[{header:'H',width:100}],rows:[['a\0b']]}), /null/);
});

test('a very long row continues across many pages with no duplicated tokens', () => {
  const entries = Array.from({ length: 850 }, (_, index) =>
    'FRAG' + String(index + 1).padStart(4, '0'));
  const result = pdfDetails(renderPdf({
    title: 'Continuación de celdas',
    table: { columns, rows: [
      ['SKU-BEGIN', 'Producto inicial', '$ 12'],
      ['SKU-LARGE', entries.join(' '), '$ 100'],
      ['SKU-END', 'Producto final', '$ 13']
    ] }
  }, font));
  assert.ok(result.pages >= 5, result.pages);
  assert.deepEqual(
    [...result.text.matchAll(/FRAG(\d{4})/g)].map(match => Number(match[1])),
    Array.from({ length: 850 }, (_, index) => index + 1),
    'all tokens of long cell must survive in order without duplication'
  );
  assert.equal((result.text.match(/SKU-LARGE/g) || []).length, 1);
  assert.equal((result.text.match(/SKU-END/g) || []).length, 1);
  assert.equal((result.text.match(/Código SKU/g) || []).length, result.pages);
});

test('different length cells share line offset across page breaks', () => {
  const short = Array.from({length: 160}, (_, i) => 'SHORT' + String(i).padStart(4, '0'));
  const long = Array.from({length: 500}, (_, i) => 'LONG' + String(i).padStart(4, '0'));
  const result = pdfDetails(renderPdf({
    title: 'Column continuation',
    table: {columns, rows: [
      [short.join(' '), long.join(' '), 'FINAL']
    ]}
  }, font));
  assert.ok(result.pages >= 3);
  for (const [prefix, n] of [['SHORT', 160], ['LONG', 500]]) {
    assert.deepEqual(
      [...result.text.matchAll(new RegExp(prefix + '(\\d{4})', 'g'))].map(m => Number(m[1])),
      Array.from({length: n}, (_, i) => i)
    );
  }
  assert.equal((result.text.match(/FINAL/g) || []).length, 1);
});
