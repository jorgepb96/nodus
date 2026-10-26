import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {installRuntimeHooks} from './lib/tsRuntimeHooks.mjs';
import {connectAcceptanceBridge} from './lib/mobileAcceptanceClient.mjs';
installRuntimeHooks('/tmp/nodus-translation-read-only-runtime');
const require=createRequire(import.meta.url);
const {stripLeadingAbstract}=require('../shared/writingDocument.ts');
const {assertTranslationIntegrity}=require('../shared/translationGeneration.ts');
const client=await connectAcceptanceBridge('Verify phone-owned translation in Desktop');
try {
  const id=process.env.NODUS_ACCEPTANCE_TRANSLATION_REPORT_ID;
  assert(id,'Identify the real report used by the iPhone');
  const source=(await client.operation('listWritingWorkshopDrafts')).find(item=>item.id===id);assert(source?.draft);
  const list=await client.operation('listContentTranslations',['deep_research',id]);
  const english=list.filter(item=>item.language==='en');assert.equal(english.length,1);
  const saved=await client.operation('getContentTranslation',[english[0].id]);
  assert.equal(saved.status,'ready');assert.equal(saved.model.provider,'deepseek');assert.equal(saved.model.model,'deepseek-chat');
  assert.notDeepEqual(saved.model,source.model,'The translation must use the phone model rather than the original report model');
  const markdown=`# ${source.draft.title}\n\n${source.draft.abstract ? `${source.draft.abstract}\n\n` : ''}${stripLeadingAbstract(source.draft.draftMarkdown,source.draft.abstract)}`;
  assertTranslationIntegrity(markdown,saved.markdown);assert.match(saved.markdown,/Francoist/);assert(saved.markdown.length>100);
  console.log(JSON.stringify({executed:1,passed:1,failed:0,skipped:0,reportId:id,translationId:saved.id,phoneModel:saved.model,originalModel:source.model,language:saved.language,characters:saved.markdown.length,protectedCitations:true,persistedInDesktop:true,duplicates:0},null,2));
} finally {await client.close();}
