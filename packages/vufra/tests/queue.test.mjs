import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const require = createRequire(import.meta.url);
const { PdfRenderQueue, PdfQueueError } = require('../dist/index.js');
const font = readFileSync(process.env.VUFRA_FONT ||
  execFileSync('fc-match', ['Noto Sans', '-f', '%{file}\n'], {encoding:'utf8'}).trim());

function heavyDoc() {
  return {
    title: 'Large PDF job',
    rows: Array.from({length:9000}, (_,i) =>
      'ITEM' + String(i+1).padStart(4,'0') + ' texto grande para ejecutar la tarea nativa'),
  };
}

function textOf(bytes) {
  assert.equal(bytes.subarray(0,5).toString(),'%PDF-');
  const path=join(mkdtempSync(join(tmpdir(), 'vufra-queue-')),'queued.pdf');
  writeFileSync(path,bytes);
  return execFileSync('pdftotext', ['-layout',path,'-'], {encoding:'utf8'});
}

async function queueRejects(job, code) {
  await assert.rejects(job, error => {
    assert.ok(error instanceof PdfQueueError);
    assert.equal(error.code,code);
    return true;
  });
}

test('FIFO and bounded slots: third waiting job rejected, others finish in order', async () => {
  const q = new PdfRenderQueue({maxConcurrent:1,maxQueued:2});
  const completed=[];
  const first=q.render(heavyDoc(),font).then(result=>{completed.push('A');return result;});
  const second=q.render({title:'SECOND',paragraphs:['QUEUED SECOND']},font)
    .then(result=>{completed.push('B');return result;});
  const third=q.render({title:'THIRD',paragraphs:['QUEUED THIRD']},font)
    .then(result=>{completed.push('C');return result;});
  assert.equal(q.stats.active,1);
  assert.equal(q.stats.queued,2);
  assert.ok(q.stats.queuedBytes>0);
  await queueRejects(q.render({title:'FOURTH'},font),'QUEUE_FULL');
  assert.equal(q.stats.rejected,1);
  const results=await Promise.all([first,second,third]);
  assert.deepEqual(completed,['A','B','C']);
  assert.ok(textOf(results[1]).includes('QUEUED SECOND'));
  assert.ok(textOf(results[2]).includes('QUEUED THIRD'));
  assert.deepEqual({active:q.stats.active,queued:q.stats.queued,queuedBytes:q.stats.queuedBytes},
    {active:0,queued:0,queuedBytes:0});
  assert.equal(q.stats.completed,3);
  q.close();
});

test('AbortSignal and waiting deadline remove jobs without stopping active Rust render', async () => {
  const q=new PdfRenderQueue({maxConcurrent:1,maxQueued:4});
  const controller=new AbortController();
  const active=q.render(heavyDoc(),font,{signal:controller.signal});
  const waiting=q.render({title:'Aborted'},font,{signal:controller.signal});
  const timed=q.render({title:'Timed out'},font,{waitTimeoutMs:5});
  assert.equal(q.stats.queued,2);
  controller.abort();
  await queueRejects(waiting,'ABORTED');
  await queueRejects(timed,'WAIT_TIMEOUT');
  assert.equal(q.stats.queued,0);
  assert.equal(q.stats.active,1);
  const completed=await active;
  assert.ok(completed.length>10000);
  assert.equal(q.stats.completed,1);
  assert.equal(q.stats.rejected,2);
  q.close();
});

test('the queued snapshot is independent of caller document and font mutations', async () => {
  const q=new PdfRenderQueue({maxConcurrent:1,maxQueued:1});
  const running=q.render(heavyDoc(),font);
  const inputFont=Buffer.from(font);
  const mutable={title:'Snapshot',blocks:[{type:'paragraph',text:'ORIGINAL DOCUMENT TEXT'}]};
  const waiting=q.render(mutable,inputFont);
  mutable.blocks[0].text='CHANGED AFTER ENQUEUE';
  inputFont.fill(0);
  await running;
  const output=textOf(await waiting);
  assert.match(output,/ORIGINAL DOCUMENT TEXT/);
  assert.doesNotMatch(output,/CHANGED AFTER ENQUEUE/);
  q.close();
});

test('releases capacity after a native failure, then processes next job', async () => {
  const q=new PdfRenderQueue({maxConcurrent:1,maxQueued:1});
  const bad=q.render({title:'Bad font'},Uint8Array.of(0,1,2));
  const next=q.render({title:'Recovered',paragraphs:['RECOVERED OK']},font);
  await assert.rejects(bad,/Font/);
  assert.match(textOf(await next),/RECOVERED OK/);
  assert.equal(q.stats.failed,1);
  assert.equal(q.stats.completed,1);
  assert.equal(q.stats.active,0);
  q.close();
});

test('close rejects waiting/new jobs but lets active jobs finish normally', async () => {
  const q=new PdfRenderQueue({maxConcurrent:1,maxQueued:1});
  const active=q.render(heavyDoc(),font);
  const queued=q.render({title:'Waiting'},font);
  q.close();
  q.close(); // idempotent
  await queueRejects(queued,'CLOSED');
  await queueRejects(q.render({title:'Another'},font),'CLOSED');
  assert.ok((await active).length>10000);
  assert.equal(q.stats.active,0);
  assert.equal(q.stats.queued,0);
  assert.equal(q.stats.closed,true);
});

test('budget limits reject large input before copying into the queue', async () => {
  assert.throws(()=>new PdfRenderQueue({maxConcurrent:0}),/maxConcurrent/);
  assert.throws(()=>new PdfRenderQueue({maxQueued:-1}),/maxQueued/);
  assert.throws(()=>new PdfRenderQueue({maxJobBytes:Infinity}),/maxJobBytes/);
  const tooSmall=new PdfRenderQueue({maxJobBytes:1});
  await queueRejects(tooSmall.render({title:'Too large'},font),'JOB_TOO_LARGE');
  tooSmall.close();

  const q=new PdfRenderQueue({maxConcurrent:1,maxQueued:2,maxQueuedBytes:1});
  const active=q.render(heavyDoc(),font);
  await queueRejects(q.render({title:'Waiting'},font),'QUEUE_FULL');
  assert.equal(q.stats.queued,0);
  assert.equal(q.stats.queuedBytes,0);
  await assert.rejects(q.render({title:'Bad timeout'},font,{waitTimeoutMs:0}),/waitTimeoutMs/);
  await active;
  q.close();
});

test('multiple instances maintain separate local counters', async()=>{
  const a=new PdfRenderQueue({maxConcurrent:1,maxQueued:0});
  const b=new PdfRenderQueue({maxConcurrent:1,maxQueued:0});
  const [first,second]=await Promise.all([
    a.render({title:'Q-A',paragraphs:['LOCAL A']},font),
    b.render({title:'Q-B',paragraphs:['LOCAL B']},font),
  ]);
  assert.match(textOf(first),/LOCAL A/);
  assert.match(textOf(second),/LOCAL B/);
  assert.equal(a.stats.completed,1);
  assert.equal(b.stats.completed,1);
  a.close();b.close();
});
