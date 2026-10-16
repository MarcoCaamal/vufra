// Ordered page-flow example: paragraph -> table -> very long paragraph -> table -> footer paragraph.
// Run from repo root with: node examples/flow-usage.mjs /path/to/font.ttf artifacts/flow-first.pdf
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync } from 'node:fs';

const require = createRequire(import.meta.url);
const { renderPdf } = require('../packages/vufra/dist/index.js');
const fontPath = process.argv[2] || process.env.VUFRA_FONT;
if (!fontPath) throw new Error('Pass a TTF/OTF path as first argument');
const destination = process.argv[3] || 'artifacts/flow-first.pdf';

const columns = [
  { header: 'Folio', width: 104 },
  { header: 'Descripción del concepto', width: 274 },
  { header: 'Valor MXN', width: 119 }
];
const longParagraph = Array.from({ length: 1100 }, (_, i) =>
  'TEXTO-' + String(i + 1).padStart(4, '0')).join(' ');
const pdf = renderPdf({
  title: 'Vufra — Reporte integrado',
  blocks: [
    { type: 'paragraph', text: 'Introducción: tabla y párrafos comparten una misma página. ¡Hola, Cancún!' },
    { type: 'table', table: {
      columns,
      rows: Array.from({ length: 8 }, (_, i) => [
        'FOL-' + String(i + 1).padStart(3, '0'),
        'Concepto inicial con descripción larga que ocupa dos líneas de ejemplo ' + (i + 1),
        '$ ' + (i * 13 + 49).toFixed(2),
      ]),
    } },
    { type: 'paragraph', text: 'DESARROLLO INICIAL. ' + longParagraph },
    { type: 'paragraph', text: 'Continuación narrativa después del párrafo largo, sin una página nueva obligatoria.' },
    { type: 'table', table: {
      columns,
      rows: Array.from({ length: 72 }, (_, i) => [
        'REC-' + String(i + 1).padStart(3, '0'),
        i % 4 === 0
          ? 'Segunda tabla: descripción extendida para validar saltos de línea con encabezados repetidos'
          : 'Segunda tabla, registro de demostración ' + (i + 1),
        '$ ' + (i + 100).toFixed(2)
      ])
    } },
    { type: 'paragraph', text: 'CONCLUSIÓN FINAL: el compositor mantiene el orden de todos los bloques.' }
  ]
}, readFileSync(fontPath));

writeFileSync(destination, pdf);
console.log('Generated unified-flow PDF:', destination, pdf.byteLength, 'bytes');
