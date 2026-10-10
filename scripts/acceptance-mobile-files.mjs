import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { connectAcceptanceBridge } from './lib/mobileAcceptanceClient.mjs';

const lab = process.env.NODUS_MOBILE_ACCEPTANCE_LAB;
assert(lab && fs.existsSync(`${lab}/.nodus-mobile-acceptance-lab`));
const fixtures = JSON.parse(fs.readFileSync(`${lab}/private-file-fixtures.json`));
assert.equal(fixtures.records.length,6,'Every supported file domain must have actual content.');
const client = await connectAcceptanceBridge('Private files end-to-end acceptance');
const results=[];
try {
  for (const record of fixtures.records) {
    const root=`/bridge/v2/vaults/${encodeURIComponent(record.vaultId)}/files/${record.kind}/${encodeURIComponent(record.id)}`;
    const file=await client.request(`${root}/descriptor`);
    assert.equal(file.kind,record.kind); assert.equal(file.id,record.id);
    assert(file.byteSize>0); assert.equal(file.sha256.length,64);
    const chunks=[];
    for(let offset=0;offset<file.byteSize;offset+=65_536) {
      const chunk=await client.binary(`${root}/content?offset=${offset}&limit=${Math.min(65_536,file.byteSize-offset)}`);
      assert.equal(chunk.length,Math.min(65_536,file.byteSize-offset)); chunks.push(chunk);
    }
    const bytes=Buffer.concat(chunks);
    assert.equal(createHash('sha256').update(bytes).digest('hex'),file.sha256);
    await client.request(`${root}/content?offset=-1`,'GET',undefined,416);
    await client.request(root.replace('/files/', '/files/sqlite_master/')+'/descriptor','GET',undefined,404);
    results.push({kind:record.kind,vaultId:record.vaultId,recordId:record.id,byteSize:bytes.length,sha256:file.sha256,chunks:chunks.length,result:'passed'});
  }
  const result={result:'passed',transport:'production pinned HTTPS',operations:results};
  fs.writeFileSync(`${lab}/private-file-acceptance-result.json`,JSON.stringify(result,null,2),{mode:0o600});
  console.log(JSON.stringify(result));
} finally { await client.close(); }
