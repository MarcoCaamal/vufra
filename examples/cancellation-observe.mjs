// Demonstrates true Rust cancellation and per-job timing telemetry.
// Run: node examples/cancellation-observe.mjs /path/to/NotoSans-Regular.ttf
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync } from 'node:fs';

const require = createRequire(import.meta.url);
const { PdfRenderQueue } = require('../packages/vufra/dist/index.js');
const fontPath = process.argv[2] || process.env.VUFRA_FONT;
if (!fontPath) throw new Error('Pass a TTF/OTF font file');
const font = readFileSync(fontPath);

const events = [];
const queue = new PdfRenderQueue({
  maxConcurrent: 1, maxQueued: 2,
  onJobEvent: event => {
    events.push(event);
    console.log('Vufra job event:', event);
  },
});
const controller = new AbortController();
const long = queue.render({
  title: 'Interrumpible',
  rows: Array.from({length:9500}, (_,i) =>
    'CANCEL-'+String(i+1).padStart(4, '0')+' trabajo nativo Rust de ejemplo')
}, font, {signal:controller.signal});

const next = queue.render({
  title: 'Documento recuperado',
  blocks: [
    {type:'heading',level:1,text:'Cancelación cooperativa'},
    {type:'paragraph',text:'Rust liberó el worker y Vufra continuó procesando.'}
  ]
},font);

setTimeout(()=>controller.abort(),20);
try {
  await long;
  console.log('The long PDF finished before cancellation, so it was not cancelled');
} catch(error) {
  if(error?.code!=='ABORTED') throw error;
  console.log('The active native render was cancelled cooperatively');
}
const pdf=await next;
writeFileSync('artifacts/cancel-recovered.pdf',pdf);
console.log('Final queue counters:',queue.stats);
console.log('Observed events:',events.length);
queue.close();
