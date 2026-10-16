// Generate a real multi-column PDF with the installed Rust-backed SDK.
// Usage: node examples/table-usage.mjs /path/to/font.ttf [output.pdf]
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync } from 'node:fs';

const require = createRequire(import.meta.url);
const { renderPdf } = require('../packages/vufra/dist/index.js');
const fontPath = process.argv[2] || process.env.VUFRA_FONT;
if (!fontPath) throw new Error('Provide a .ttf/.otf file as the first argument');
const destination = process.argv[3] || 'artifacts/table-first.pdf';

const pdf = renderPdf({
  title: 'Vufra — catálogo de productos',
  paragraphs: ['Tabla multipágina con 3 columnas, medidas en puntos PDF y cabeceras repetidas.'],
  table: {
    columns: [
      { header: 'Código', width: 100 },
      { header: 'Descripción del producto', width: 275 },
      { header: 'Precio MXN', width: 122 },
    ],
    rows: Array.from({ length: 200 }, (_, i) => [
      'SKU-' + String(i + 1).padStart(4, '0'),
      i % 4 === 0
        ? 'Artículo especial de Cancún, edición limitada, con descripción amplia que ocupa varias líneas y requiere ajuste de texto.'
        : 'Producto de ejemplo ' + (i + 1),
      '$ ' + ((i + 1) * 14.5).toFixed(2),
    ]),
  },
}, readFileSync(fontPath));

writeFileSync(destination, pdf);
console.log('Vufra created multi-column PDF:', destination, pdf.byteLength, 'bytes');
