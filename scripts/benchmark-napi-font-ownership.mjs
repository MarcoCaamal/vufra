// Cross-language font snapshot/ownership profile using an intentionally
// padded, valid TTF. Padding tests allocation copies, NOT real glyph load.
// node scripts/benchmark-napi-font-ownership.mjs REGULAR.ttf BOLD.ttf [runs=3]
import {readFileSync,writeFileSync,mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {execFileSync} from 'node:child_process';
const [regular,bold,amount='3']=process.argv.slice(2);
if(!regular||!bold)throw Error('usage: benchmark-napi-font-ownership.mjs regular.ttf bold.ttf [runs]');
const bytes=readFileSync(regular);
const paddedBytes=10*1024*1024;
if(bytes.length>paddedBytes)throw Error('regular font exceeds synthetic 10MiB test payload');
const dir=mkdtempSync(join(tmpdir(),'vufra-owned-font-'));
const fontFile=join(dir,'padded-font.ttf');
try{
  const padding=Buffer.alloc(paddedBytes);
  bytes.copy(padding,0,0,bytes.length);
  writeFileSync(fontFile,padding);
  const out=execFileSync(process.execPath,
    [new URL('./benchmark-font-rows.mjs',import.meta.url).pathname,
      fontFile,bold,amount],
    {encoding:'utf8',maxBuffer:8*1024*1024});
  const result=JSON.parse(out);
  console.log(JSON.stringify({
    ...result,
    syntheticFontBytes:paddedBytes,
    actualFontBytes:bytes.byteLength,
    caution:'Synthetic TTF padding stresses buffer-copy allocations; it does not simulate a 10MiB glyph library. MaxRSS measures the whole Node process.'
  },null,2));
}finally{
  rmSync(dir,{recursive:true,force:true});
}
