import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {join} from 'node:path';
const script=fileURLToPath(new URL('../../../scripts/benchmark-regressions.mjs',import.meta.url));
const baseline=fileURLToPath(new URL('../../../docs/performance/2026-10-18-unit57-baseline.json',import.meta.url));
const font=execFileSync('fc-match',['Noto Sans','-f','%{file}\n'],{encoding:'utf8'}).trim();
test('performance harness exports consistent JSON for current and historical scenarios',()=>{
 const result=execFileSync(process.execPath,['--expose-gc',script,'--font',font,'--runs','3',
   '--compare',baseline],{encoding:'utf8',timeout:30_000});
 const report=JSON.parse(result);
 assert.equal(report.schemaVersion,1);
 assert.equal(report.identity.node,process.version);
 assert.equal(report.runs,3);
 assert.equal(report.comparison.baselineRevision,'a65e9d9');
 assert.equal(report.comparison.deltas['flex-100'].status,'new-scenario');
 for(const name of ['table-250','nested-50','mixed-150','flex-100']){
  const item=report.scenarios[name];
  assert.equal(item.samplesMs.length,3);
  assert.ok(item.medianMs>0&&Number.isFinite(item.medianMs),name);
  assert.ok(item.p95Ms>=item.medianMs,name);
  assert.ok(item.peakRssMiB>20,name);
  assert.ok(item.pdfBytes>1000,name);
 }
});
