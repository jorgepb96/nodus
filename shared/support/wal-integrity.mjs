// Read-only validation before SQLite may silently discard a damaged WAL tail.
// Format/checksums: SQLite wal.c (WAL_MAGIC / walChecksumBytes).
import fs from 'node:fs';
const fail=()=>{throw Object.assign(new Error('SUPPORT_WAL_UNVERIFIED'),{code:'SUPPORT_WAL_UNVERIFIED'});};
export function verifySupportWal(database) {
  const file=`${database}-wal`;let fd;
  try{fd=fs.openSync(file,'r');}catch(error){if(error.code==='ENOENT')return;throw error;}
  try {
    const size=fs.fstatSync(fd).size;if(size===0)return;
    const read=(length,position)=>{const bytes=Buffer.alloc(length);if(fs.readSync(fd,bytes,0,length,position)!==length)fail();return bytes;};
    if(size<32)fail();const header=read(32,0),magic=header.readUInt32BE(0),page=header.readUInt32BE(8);
    if((magic!==0x377f0682&&magic!==0x377f0683)||header.readUInt32BE(4)!==3007000||page<512||page>65536||(page&(page-1)))fail();
    let first=0,second=0;
    const checksum=bytes=>{for(let i=0;i<bytes.length;i+=8){const a=magic&1?bytes.readUInt32BE(i):bytes.readUInt32LE(i),b=magic&1?bytes.readUInt32BE(i+4):bytes.readUInt32LE(i+4);first=(first+a+second)>>>0;second=(second+b+first)>>>0;}};
    checksum(header.subarray(0,24));if(first!==header.readUInt32BE(24)||second!==header.readUInt32BE(28))fail();
    let frames=0,committed=0;
    for(let offset=32;offset<size;offset+=24+page) {
      if(size-offset<24)fail();const frame=read(24,offset);
      // A salt mismatch may be recycled trailing data OR damage to a current
      // committed frame. Without a verified commit index we cannot distinguish
      // them. Retain the whole WAL and refuse to silently discard either case.
      if(!frame.subarray(8,16).equals(header.subarray(16,24)))fail();
      if(size-offset<24+page||frame.readUInt32BE(0)===0)fail();
      checksum(frame.subarray(0,8));checksum(read(page,offset+24));
      if(first!==frame.readUInt32BE(16)||second!==frame.readUInt32BE(20))fail();
      frames++;if(frame.readUInt32BE(4)>0)committed=frames;
    }
    if(frames!==committed)fail();
    if(fs.fstatSync(fd).size!==size)fail();
  }finally{fs.closeSync(fd);}
}
