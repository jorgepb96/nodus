import fs from 'node:fs';
import {connectAcceptanceBridge} from './lib/mobileAcceptanceClient.mjs';
const lab=process.env.NODUS_MOBILE_ACCEPTANCE_LAB;
const client=await connectAcceptanceBridge('Autonomous dictionary acceptance preparation');
try {
  const name=process.env.NODUS_ACCEPTANCE_DICTIONARY_NAME ?? 'Propaganda autónoma móvil 0.1.0';
  const page=await client.operation('listDictionaryEntries',[{query:name,offset:0,limit:200}]);
  const entry=page.items.find(item=>item.name===name) ?? await client.operation('createDictionaryEntry',[{name,aliases:['propaganda'],focusPrompt:'Define el concepto y sus matices a partir de las evidencias del corpus. Conserva las citas de las fuentes.',scope:{kind:'vault'},outputLanguage:'es',detailLevel:'concise',tags:['mobile-acceptance','autonomous']}]);
  const context=await client.operation('getDictionaryGenerationContext',[entry.id,'off']);
  if (context.evidence.length < 2) throw new Error('The autonomous lab must have actual corpus evidence.');
  const fixture={entryId:entry.id,name,expectedProvider:'deepseek',expectedModel:'deepseek-chat',initialVersionId:context.entry.currentVersionId,evidenceCount:context.evidence.length,contextRevision:context.revision};
  fs.writeFileSync(`${lab}/autonomous-dictionary-fixture.json`,JSON.stringify(fixture,null,2),{mode:0o600});
  console.log(JSON.stringify({prepared:true,...fixture}));
} finally {await client.close();}
