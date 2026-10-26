/** Canonical web charset decoding for both Desktop and device research hosts. */
export function decodeWebText(bytes:Uint8Array,contentType:string):string {
 const declared=/charset=["']?([\w-]+)/i.exec(contentType)?.[1]
  ?? /<meta[^>]+charset=["']?([\w-]+)/i.exec(String.fromCharCode(...bytes.subarray(0,4096)))?.[1];
 try{return new TextDecoder(declared&&declared.toLowerCase()!=='utf8'?declared:'utf-8').decode(bytes);}
 catch{return new TextDecoder('utf-8').decode(bytes);}
}
