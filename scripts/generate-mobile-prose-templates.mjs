// Source serialization only: no app, vault, network, compilation or acceptance run.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';
const require=createRequire(import.meta.url),ts=require('typescript');
require.extensions['.ts']=(module,filename)=>module._compile(ts.transpileModule(fs.readFileSync(filename,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,filename);
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const {portableProseReviewTemplate}=require('../shared/companionProseDraft.ts');
const {PROMPT_LANGUAGES}=require('../shared/types.ts');
const {canonicalJson}=require('../shared/canonicalJson.ts');
const templates=Object.fromEntries(PROMPT_LANGUAGES.map(language=>{const source=portableProseReviewTemplate(language);return [language,{source,templateRevision:createHash('sha256').update(canonicalJson(source)).digest('hex')}];}));
const target=path.resolve(root,'../nodus-mobile/ios/Packages/NodusKit/Sources/NodusKit/Resources/prose-draft-templates.json');
const content=JSON.stringify({version:1,templates},null,2)+'\n';
fs.mkdirSync(path.dirname(target),{recursive:true});
if(!fs.existsSync(target)||fs.readFileSync(target,'utf8')!==content)fs.writeFileSync(target,content);
console.log(`Serialized ${PROMPT_LANGUAGES.length} shared prose templates.`);
