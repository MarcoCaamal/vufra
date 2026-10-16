// Generate a table where ONE row crosses multiple page boundaries.
// Usage: node examples/long-row-usage.mjs /path/to/NotoSans-Regular.ttf [output.pdf]
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync } from 'node:fs';
const require = createRequire(import.meta.url);
const { renderPdf } = require('../packages/vufra/dist/index.js');
const fontPath = process.argv[2] || process.env.VUFRA_FONT;
if (!fontPath) throw new Error('A valid .ttf or .otf font is required.');
const path = process.argv[3] || 'artifacts/long-row.pdf';
const longDescription = Array.from({ length: 680 }, (_, i) =>
  'detalle-' + String(i + 1).padStart(4, '0')).join(' ');
const pdf = renderPdf({
  title: 'Vufra — una fila que continúa entre páginas',
  table: {
    columns: [
      { header: 'Código', width: 105 },
      { header: 'Descripción extendida', width: 280 },
      { header: 'Importe MXN', width: 112 },
    ],
    rows: [
      ...Array.from({length: 15}, (_, i) => [
        'REG-' + String(i + 1).padStart(3, '0'), 'Fila ordinaria de ejemplo', '$ 14.50'
      ]),
      ['REG-LARGA', longDescription, '$ 999.00'],
      ['REG-FIN', 'Fila inmediatamente después de una celda multipágina', '$ 25.00']
    ]
  }
}, readFileSync(fontPath));
writeFileSync(path, pdf);
console.log('Generated multi-page row example:', path, pdf.length, 'bytes');
