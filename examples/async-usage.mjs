// Run: node examples/async-usage.mjs /path/to/NotoSans-Regular.ttf [output.pdf]
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync } from 'node:fs';

const require = createRequire(import.meta.url);
const { renderPdfAsync } = require('../packages/vufra/dist/index.js');
const fontPath = process.argv[2] || process.env.VUFRA_FONT;
if (!fontPath) throw new Error('Provide a TTF/OTF font path');
const output = process.argv[3] || 'artifacts/async-first.pdf';

const records = Array.from({ length: 3000 }, (_, i) => [
  'INV-' + String(i + 1).padStart(4, '0'),
  'Producto ' + (i + 1) + ' — Cancún, México',
  '$ ' + ((i + 1) * 12.5).toFixed(2)
]);

const pdf = await renderPdfAsync({
  title: 'Vufra — reporte asíncrono',
  page: { format: 'letter' },
  blocks: [
    { type: 'heading', level: 1, text: 'Inventario de octubre' },
    { type: 'paragraph', text: 'Este PDF se renderiza en el pool nativo sin bloquear el event loop.' },
    { type: 'table', table: {
      columns: [
        { header: 'Folio', width: 100 },
        { header: 'Descripción', width: 275 },
        { header: 'Importe MXN', width: 120 }
      ],
      rows: records
    }}
  ]
}, readFileSync(fontPath));

writeFileSync(output, pdf);
console.log('Async SDK generated', output, 'bytes=', pdf.length);
