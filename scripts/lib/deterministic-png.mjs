// Deterministic, high-entropy RGB PNG fixture for native PDF benchmarks.
// No image libraries, disk fixtures or external HTTP services are needed.
import {deflateSync} from 'node:zlib';

function crc32(data){
  let crc=0xffffffff;
  for(const byte of data){
    crc^=byte;
    for(let i=0;i<8;i++)crc=(crc>>>1)^(0xedb88320&-(crc&1));
  }
  return (crc^0xffffffff)>>>0;
}

function chunk(name,payload){
  const type=Buffer.from(name),size=Buffer.alloc(4),check=Buffer.alloc(4);
  size.writeUInt32BE(payload.length);
  check.writeUInt32BE(crc32(Buffer.concat([type,payload])));
  return Buffer.concat([size,type,payload,check]);
}

/** Repeatable PNG; width=height and 8-bit RGB, no alpha channel. */
export function deterministicPng(width){
  if(!Number.isInteger(width)||width<1||width>1800)throw new RangeError('invalid PNG width');
  const scan=Buffer.alloc((1+width*3)*width);
  let seed=0x91ac1234;
  for(let y=0;y<width;y++)for(let x=1;x<=width*3;x++){
    seed^=seed<<13;seed^=seed>>>17;seed^=seed<<5;
    scan[y*(1+width*3)+x]=seed&255;
  }
  const ihdr=Buffer.alloc(13);
  ihdr.writeUInt32BE(width,0);ihdr.writeUInt32BE(width,4);ihdr[8]=8;ihdr[9]=2;
  return Buffer.concat([
    Buffer.from([137,80,78,71,13,10,26,10]),
    chunk('IHDR',ihdr),chunk('IDAT',deflateSync(scan,{level:1})),
    chunk('IEND',Buffer.alloc(0))
  ]);
}
