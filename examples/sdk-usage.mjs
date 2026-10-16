// Requires npm build and native build. Pass a TTF font path as first argument.
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync } from 'node:fs';
const require = createRequire(import.meta.url);
const { renderPdf } = require('../packages/vufra/dist/index.js');

const fontPath = process.argv[2] || process.env.VUFRA_FONT;
if (!fontPath) throw new Error('Please pass a path to your installed TTF/OTF font');
const pdf = renderPdf({
  title: 'Vufra SDK — ¡Hola, Cancún!',
  paragraphs: [
    'Nuestro primer SDK TypeScript llama directamente a una biblioteca nativa de Rust.',
    'Este párrafo contiene texto largo para demostrar saltos de línea automáticos. '.repeat(10),
    'Documento de ejemplo sin navegador, Chromium ni dependencia de HTML.'
  ],
  rows: Array.from({length: 1000}, (_,index) =>
    'Registro de ejemplo ' + String(index + 1).padStart(4,'0') + ' — México, acción y creación de PDFs nativos.'
  )
}, readFileSync(fontPath));
const target = process.argv[3] || 'artifacts/sdk-first.pdf';
writeFileSync(target, pdf);
console.log('Vufra TypeScript SDK generated', target, pdf.byteLength, 'bytes');
