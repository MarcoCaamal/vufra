import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { readFileSync, mkdtempSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const require = createRequire(import.meta.url);
const { renderPdfAsync, renderPdfAsyncMeasured, PdfRenderQueue, PdfRenderCancelledError } =
  require('../dist/index.js');
const font = readFileSync(process.env.VUFRA_FONT ||
  execFileSync('fc-match', ['Noto Sans', '-f', '%{file}\n'], {encoding:'utf8'}).trim());

function heavyDoc() {
  return {title:'Cancelable PDF',rows:Array.from({length:9500},(_,i)=>
    'ROW'+String(i+1).padStart(4,'0')+' renderizado cancelable de Vufra')};
}
function inspect(pdf) {
  const file=join(mkdtempSync(join(tmpdir(),'vufra-cancellation-')),'report.pdf');
  writeFileSync(file,pdf);
  return execFileSync('pdftotext',['-layout',file,'-'],{encoding:'utf8'});
}

test('abort already set rejects without launching native PDF work', async ()=>{
  const abort=new AbortController();abort.abort();
  await assert.rejects(renderPdfAsync(heavyDoc(),font,{signal:abort.signal}),err=>{
    assert.ok(err instanceof PdfRenderCancelledError);assert.equal(err.code,'ABORTED');return true;
  });
});

test('abort active legacy rendering stops Rust cooperatively', async ()=>{
  const controller=new AbortController();
  let completed=false;
  const work=renderPdfAsync(heavyDoc(),font,{signal:controller.signal})
    .finally(()=>{completed=true;});
  await new Promise(resolve=>setTimeout(resolve,20));
  assert.equal(completed,false,'work completed before cancellation could be requested');
  controller.abort();
  await assert.rejects(work,err=>{
    assert.ok(err instanceof PdfRenderCancelledError);assert.equal(err.code,'ABORTED');return true;
  });
});

test('abort active multi-column flow work and allow a subsequent job', async ()=>{
  const q=new PdfRenderQueue({maxConcurrent:1,maxQueued:1});
  const controller=new AbortController();
  const massive={title:'Cancel table',blocks:[{type:'table',table:{
    columns:[{header:'ID',width:110},{header:'Concepto',width:300}],
    rows:Array.from({length:9500},(_,i)=>['TEST'+String(i).padStart(4,'0'),
      'Descripción amplia que requiere medición y dibujo de fila '+i])
  }}]};
  const active=q.render(massive,font,{signal:controller.signal});
  const queued=q.render({title:'After cancellation',paragraphs:['RECOVERED AFTER CANCEL']},font);
  await new Promise(resolve=>setTimeout(resolve,20));
  assert.equal(q.stats.active,1);
  assert.equal(q.stats.queued,1);
  controller.abort();
  await assert.rejects(active,err=>err?.code==='ABORTED');
  const text=inspect(await queued);
  assert.match(text,/RECOVERED AFTER CANCEL/);
  assert.equal(q.stats.active,0);
  assert.equal(q.stats.queued,0);
  assert.equal(q.stats.cancelled,1);
  assert.equal(q.stats.failed,0);
  assert.equal(q.stats.completed,1);
  q.close();
});

test('queue emits typed telemetry for immediate rejects and close', async ()=>{
  const events=[];
  const q=new PdfRenderQueue({maxConcurrent:1,maxQueued:0,onJobEvent:e=>events.push(e)});
  const doc={title:'Bounded PDF'};
  const inFlight=q.render({title:'Lengthy',rows:Array.from({length:9500},(_,i)=>'R'+i+' valid text')},font);
  await assert.rejects(q.render(doc,font),err=>err?.code==='QUEUE_FULL');
  q.close();
  await assert.rejects(q.render(doc,font),err=>err?.code==='CLOSED');
  await inFlight;
  const rejected=events.filter(e=>e.outcome==='rejected');
  assert.deepEqual(rejected.map(e=>e.errorCode),['QUEUE_FULL','CLOSED']);
  assert.equal(q.stats.rejected,2);
  assert.equal(q.stats.completed,1);
});

test('native measured success and queue job events provide bounded durations',async()=>{
  const doc={title:'Observed PDF',blocks:[{type:'paragraph',text:'Medición nativa correcta, Cancún'}]};
  const measured=await renderPdfAsyncMeasured(doc,font);
  assert.ok(measured.renderMs >= 0 && Number.isFinite(measured.renderMs));
  assert.match(inspect(measured.pdf),/Cancún/);
  const events=[];
  const q=new PdfRenderQueue({maxConcurrent:1,maxQueued:1,
    onJobEvent:evt=>{events.push(evt);throw new Error('Observer cannot break queue');}});
  const first=q.render(heavyDoc(),font);
  const second=q.render(doc,font);
  await Promise.all([first,second]);
  assert.equal(q.stats.completed,2);
  assert.equal(q.stats.active,0);
  assert.equal(events.length,2);
  assert.ok(events.every(e=>e.outcome==='completed' && e.queueMs>=0 && e.renderMs>=0
    && e.outputBytes>0 && e.estimatedInputBytes>0));
  assert.ok(events[1].queueMs>0,events[1].queueMs);
  assert.ok(q.stats.totalRenderMs>=0);
  assert.ok(q.stats.totalQueueMs>=events[1].queueMs);
  assert.ok(q.stats.lastRenderMs>=0);
  q.close();
});
