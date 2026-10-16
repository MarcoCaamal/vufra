// FIFO rendering with bounded native concurrency, and 3 independent PDFs.
// Run from repo root: node examples/queue-usage.mjs /path/to/font.ttf
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync } from 'node:fs';
const require = createRequire(import.meta.url);
const { PdfRenderQueue, PdfQueueError } = require('../packages/vufra/dist/index.js');
const fontPath = process.argv[2] || process.env.VUFRA_FONT;
if (!fontPath) throw new Error('Pass a TTF/OTF font path');
const font = readFileSync(fontPath);

const queue = new PdfRenderQueue({
  maxConcurrent: 1, maxQueued: 2, maxQueuedBytes: 16 * 1024 * 1024,
});
const jobs = [1,2,3].map(i=>queue.render({
  title: 'Vufra Queue — lote ' + i,
  blocks: [
    {type: 'heading', level: 1, text: 'Inventario ' + i},
    {type: 'table', table:{
      columns: [{header:'Folio',width:120},{header:'Detalle',width:355}],
      rows: Array.from({length:700},(_,row)=>[
        'LOT'+i+'-'+String(row+1).padStart(4,'0'),
        'Producto '+(row+1)+' desde Rust y Node.js'
      ])
    }}
  ]
},font));
console.log('After enqueue',queue.stats);
try {
  for(const [i,pdf] of (await Promise.all(jobs)).entries()){
    const path='artifacts/queue-'+(i+1)+'.pdf';
    writeFileSync(path,pdf);
    console.log(path,pdf.length,'bytes');
  }
  console.log('Completed',queue.stats);
} catch(error) {
  if(error instanceof PdfQueueError) console.error('Queue control:',error.code,error.message);
  throw error;
} finally {
  queue.close();
}
