import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { renderPdf } = require('../dist/index.js');

const fontPath = process.env.VUFRA_FONT || execFileSync('fc-match', ['Noto Sans', '-f', '%{file}\n'], { encoding: 'utf8' }).trim();
const font = readFileSync(fontPath);

function inspect(pdf) {
  const dir = mkdtempSync(join(tmpdir(), 'vufra-sdk-test-'));
  const path = join(dir, 'generated.pdf');
  writeFileSync(path, pdf);
  const info = execFileSync('pdfinfo', [path], { encoding: 'utf8' });
  const text = execFileSync('pdftotext', ['-layout', path, '-'], { encoding: 'utf8' });
  return { info, text };
}

test('Node -> Rust -> PDF with Latin unicode and multiple pages', () => {
  const pdf = renderPdf({
    title: 'Vufra desde TypeScript',
    paragraphs: ['¡Hola, Cancún! Niño, acción, México y ¿Qué?', 'Un párrafo largo que debe partirse en muchas líneas. '.repeat(32)],
    rows: ['Fila uno', 'Fila dos', ...Array.from({ length: 130 }, (_, i) => 'Registro ' + i)]
  }, font);
  assert.equal(Buffer.isBuffer(pdf), true);
  assert.ok(pdf.subarray(0, 5).equals(Buffer.from('%PDF-')));
  const { info, text } = inspect(pdf);
  assert.match(info, /Pages:\s+([2-9]|\d{2,})/);
  for (const word of ['Cancún', 'Niño', 'acción', 'México', '¿Qué', 'Registro 129']) assert.ok(text.includes(word), word);
  console.log('SDK smoke PDF pages:', info.match(/Pages:\s+(\d+)/)?.[1]);
});

test('1000 rows survive PDF pagination and extraction in order', () => {
  const pdf = renderPdf({ title: '1000 registros', rows: Array.from({length: 1000}, (_,i) => 'Elemento ' + String(i + 1).padStart(4, '0')) }, font);
  const { info, text } = inspect(pdf);
  const numbers = [...text.matchAll(/\b(\d{4})\s+\|\s+Elemento\s+(\d{4})/g)].map((m) => Number(m[1]));
  assert.deepEqual(numbers, Array.from({length: 1000}, (_,i) => i + 1));
  assert.ok(Number(info.match(/Pages:\s+(\d+)/)?.[1]) > 1);
});

test('invalid title/font/paragraphs are rejected', () => {
  assert.throws(() => renderPdf({ title: '' }, font), /title/);
  assert.throws(() => renderPdf({ title: 'valid' }, new Uint8Array()), /font/);
  assert.throws(() => renderPdf({ title: 'valid', paragraphs: [123] }, font), /paragraphs/);
  assert.throws(() => renderPdf({ title: 'valid' }, Uint8Array.of(0, 1, 2)), /Font/);
});

test('overlong title and unbreakable paragraph are rejected', () => {
  assert.throws(() => renderPdf({ title: 'W'.repeat(500) }, font), /title exceeds printable width/);
  assert.throws(() => renderPdf({ title: 'normal', paragraphs: ['W'.repeat(1200)] }, font),
    /unbreakable text exceeds printable width|exceeds one printable page/);
});

test('overlong indivisible row returns error', () => {
  assert.throws(() => renderPdf({ title: 'long', rows: ['mucho texto '.repeat(2000)] }, font), /exceeds one printable page/);
});
