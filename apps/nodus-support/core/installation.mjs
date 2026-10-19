import fs from 'node:fs';
import path from 'node:path';
import { assert,noLinks,readJson } from './files.mjs';

// Read package metadata without executing the damaged application or loading its graph.
export function readInstalledPackage(resources) {
  const loose=path.join(resources,'app/package.json');
  if(fs.existsSync(loose))return readJson(loose);
  const archive=path.join(resources,'app.asar');noLinks(archive);
  const fd=fs.openSync(archive,'r');
  try {
    const size=fs.fstatSync(fd).size,prefix=Buffer.alloc(16);
    assert(fs.readSync(fd,prefix,0,16,0)===16,'INSTALLATION_UNAVAILABLE');
    const headerSize=prefix.readUInt32LE(4),jsonSize=prefix.readUInt32LE(12);
    assert(headerSize>=8&&headerSize<=32*1024**2&&jsonSize<=headerSize-8,'INSTALLATION_UNAVAILABLE');
    const json=Buffer.alloc(jsonSize);assert(fs.readSync(fd,json,0,jsonSize,16)===jsonSize,'INSTALLATION_UNAVAILABLE');
    const entry=JSON.parse(json.toString('utf8')).files?.['package.json'];
    assert(entry&&!entry.link&&!entry.unpacked&&Number.isSafeInteger(entry.size)&&entry.size>0&&entry.size<128*1024&&/^\d+$/.test(entry.offset),'INSTALLATION_UNAVAILABLE');
    const offset=8+headerSize+Number(entry.offset);assert(Number.isSafeInteger(offset)&&offset+entry.size<=size,'INSTALLATION_UNAVAILABLE');
    const value=Buffer.alloc(entry.size);assert(fs.readSync(fd,value,0,value.length,offset)===value.length,'INSTALLATION_UNAVAILABLE');return JSON.parse(value.toString('utf8'));
  } finally{fs.closeSync(fd);}
}
export function executableArchitectures(file) {
  noLinks(file);const fd=fs.openSync(file,'r');
  try {
    const header=Buffer.alloc(512);const bytes=fs.readSync(fd,header,0,header.length,0);assert(bytes>=32,'INSTALLATION_UNAVAILABLE');
    if(header.subarray(0,4).equals(Buffer.from([0x7f,0x45,0x4c,0x46]))) {
      assert(header[4]===2&&header[5]===1,'RELEASE_INCOMPATIBLE');return [{62:'x64',183:'arm64'}[header.readUInt16LE(18)]].filter(Boolean);
    }
    if(header.readUInt32LE(0)===0xfeedfacf)return [{[0x1000007]:'x64',[0x100000c]:'arm64'}[header.readUInt32LE(4)]].filter(Boolean);
    if(header.readUInt32BE(0)===0xcafebabe) {
      const count=header.readUInt32BE(4);assert(count<=16,'RELEASE_INCOMPATIBLE');const result=[];
      for(let i=0;i<count;i++)result.push({[0x1000007]:'x64',[0x100000c]:'arm64'}[header.readUInt32BE(8+i*20)]);return result.filter(Boolean);
    }
    if(header.toString('ascii',0,2)==='MZ') {
      const offset=header.readUInt32LE(0x3c),pe=Buffer.alloc(6);assert(offset<=4*1024**2&&fs.readSync(fd,pe,0,6,offset)===6&&pe.readUInt32LE(0)===0x4550,'INSTALLATION_UNAVAILABLE');
      return [{[0x8664]:'x64',[0xaa64]:'arm64'}[pe.readUInt16LE(4)]].filter(Boolean);
    }
    return [];
  }finally{fs.closeSync(fd);}
}
