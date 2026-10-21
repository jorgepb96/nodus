import fs from 'node:fs';
import path from 'node:path';

/** Called only after validating the private trial root and both markers. */
export function writeProbeResult(root:string,value:Record<string,unknown>):void {
  const requestId=process.env.NODUS_SUPPORT_REQUEST_ID;
  const result={...value,protocol:1,root};
  if(requestId&&/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(requestId)) {
    const fd=fs.openSync(path.join(root,`probe-result-${requestId}.json`),'wx',0o600);
    try{fs.writeFileSync(fd,JSON.stringify({...result,requestId}));fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
  }
  process.stdout.write(`\n@@NODUS_SUPPORT@@${JSON.stringify(result)}\n`);
}
