import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
import {createHash} from 'node:crypto';
// Fingerprints captured before mechanically moving the canonical Desktop bodies.
// A change here is a deliberate algorithm/prompt change, not an adapter change.
const originalBodies={
  "orchestrateGenealogyDeepResearch": "2cc5583123274ede6f7d26e7d2879d49d810cb3d0dc271d2e2a65439e6e34d37",
  "isAiPlan": "855bf064747f9eb6a99a4191b9ef6510af31351c20e61443f577dbb8037e243a",
  "aiPlan": "9ccf494b664d23084b7566b73a2210bffb7c38fd11b714e444c2a2de903e3837",
  "aiWriteSection": "f4d133c71a20e07e4d791646395a1133b79558469db14a597edd572a08c89e31",
  "aiReviseGenealogySection": "36761c1a9aaf5aedef18ea8a4a7470924e499c91c3a014871a8e6e1010d0c8f8",
  "isAiFinal": "dec1e43e9e45fb5a8ef3049f830c53a481a00a7d870b56546c47c61827b2ae35",
  "aiFinalize": "43cf9d9552b70277f26a0dac3393c8d7c0d889b37d04dde96a3dd7c8c2f89514",
  "aiAuditGenealogyFinalSummary": "69afbcb22de26cc122e12591133b269bb0148ba3a26cfceeae356ba786dfdb72",
  "genealogyQualitySources": "5959aac24ae230fb185a0afc237966d1aacf42c0012f29177c14c650b4bddbca",
  "applyGenealogyCitations": "c594d68f2bfcd1be47fca0df4e18a65559d485314313efbc6a72556ac3a52c4c",
  "buildReferences": "f3fe077f717651b78a8d6fec86fd53b328eaab994e282a048dcbfb7252a4364d",
  "buildMatrix": "bc521a5772efae8bd8937a765ec176c3f181bf1a4343043792dabb110b2af27c",
  "normalizePlan": "7ddc6dbc52bb45043a0e913e5065f17a9c0ddaa08a9c0e3a628eda267863797f",
  "assignGenealogyCoverage": "55a22bd16f679cee2faf9b31ae9f78a4e8bb9faa9cee02edd6100ffed9ac534d",
  "genealogyTerms": "8cdae8674cef7a21b726d7032c08f7fc613051f4ba99fda3d10a77cb76ce0a84",
  "fallbackPlan": "917f0db01bbf468a8d450bf2df03f909ef192ba7f60f12472b6a6bce69d8e3db",
  "degradedSection": "a31d5df3871ed073a3d114bbd7bb9cc446ef73ea0d7cf0e656afcc61c4601652",
  "assemble": "b353d351c7afe28d906f8383775545e87d95572e2224a79237fe66333b17750c",
  "resolveSections": "2e6ee0005dd9e67d719d78b6d261ef1ec6eef8aaa8dda3699bca7a8a723240d2",
  "summarizePrior": "9f6e569d9cb2703345f8e26e2cebe34dea4217799bf0ee703992735604c4711d",
  "pages": "0baf2d83098dceb1a79ebeb54e5ba862449743df2dffc2212983d1d0fb904991",
  "clip": "d56883eb4b1195720a20785baeca592bc95741839755e9a707c2dc9ea125c411",
  "cleanStr": "1c985ae4f2add80ab8d0e2ef00a424458a9f2cb5c2fc50a127aa56934303c97e",
  "strList": "38ff3a61136aa8f16921255952c2988388f5efc78d1f251d13fa9e1aeba7fa4a",
  "labels": "0e7467e068109af7dc2764b1eb8228d14f4927b5d0f58d78308d107a346c9e5f"
};
test('All 25 canonical genealogy orchestration/prompt/helper bodies survive the portable extraction byte-for-byte',()=>{
 const text=fs.readFileSync(new URL('../shared/portableGenealogyDeepResearch.ts',import.meta.url),'utf8');
 const source=ts.createSourceFile('portable.ts',text,ts.ScriptTarget.Latest,true),found=new Map();
 function visit(node){if(ts.isFunctionDeclaration(node)&&node.name&&originalBodies[node.name.text])found.set(node.name.text,createHash('sha256').update(node.getText(source).replace(/^export /u,'')).digest('hex'));ts.forEachChild(node,visit);}
 visit(source);for(const [name,hash] of Object.entries(originalBodies))assert.equal(found.get(name),hash,name+' changed its canonical body');
});
