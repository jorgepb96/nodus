import assert from 'node:assert/strict';
import fs from 'node:fs';import {createHash} from 'node:crypto';import ts from 'typescript';
// Canonical Desktop function bodies before this host-only extraction. The only
// body change is awaiting stores, allowing durable native receipts before return.
const expected={
 svgRepairTokens:'0ecca27a5682ba402cd45303eaeb16ec0900f328761885c739f1f716d8462527',
 inspectChatSvg:'8f86a30ef0d79f7cb7211aea2b6803890284ce07ec08e3a6709ce57a5396b0be',
 refineChatSvg:'6d5cddeeb33a5ef49837768271eba929a2f1f6a954be63a032bae819edb62f55',
 executeSkillResources:'6f4dd0234fffdfbe9dca5b64073d4c582bc3d517f56cc9fec3fd6ddaea0c90fd',
 executeImageRequest:'38c4f534114954029cea4c90b945e68293d59ec5a3e82e4a1ba2c9d4d0c42cdd',
};
let checked=0;
for(const file of ['shared/portableChatSvgQuality.ts','shared/portableResourceExecution.ts','shared/portableImageRequest.ts']) {
 const source=ts.createSourceFile(file,fs.readFileSync(file,'utf8'),ts.ScriptTarget.Latest,true);
 const visit=node=>{if(ts.isFunctionDeclaration(node)&&expected[node.name?.text]){const body=node.body.getText(source).replace(/await (storeCapabilityFile|storeChatImage)\(/g,'$1(');assert.equal(createHash('sha256').update(body).digest('hex'),expected[node.name.text],node.name.text+' preserves the canonical implementation');checked++;}ts.forEachChild(node,visit);};visit(source);
}
assert.equal(checked,5);console.log('Canonical resource extraction: 5 original function bodies preserved.');
