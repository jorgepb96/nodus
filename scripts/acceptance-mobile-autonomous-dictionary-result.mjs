import assert from 'node:assert/strict';
import fs from 'node:fs';
import {connectAcceptanceBridge} from './lib/mobileAcceptanceClient.mjs';

const fixture=JSON.parse(fs.readFileSync(`${process.env.NODUS_MOBILE_ACCEPTANCE_LAB}/autonomous-dictionary-fixture.json`,'utf8'));
const client=await connectAcceptanceBridge('Verify phone-owned dictionary in Desktop');
try {
  const settings=await client.operation('getSettings');
  const detail=await client.operation('getDictionaryEntry',[fixture.entryId]);
  const versions=await client.operation('listDictionaryVersions',[fixture.entryId]);
  const version=versions.find(item=>item.id===detail.entry.currentVersionId);
  assert(version && version.id!==fixture.initialVersionId,'The phone must persist a new current version in Desktop');
  assert.equal(version.model.provider,fixture.expectedProvider);
  assert.equal(version.model.model,fixture.expectedModel);
  assert.notDeepEqual(version.model,settings.dictionaryModel,'The laboratory intentionally selects a different Mac model to detect silent fallback');
  assert.equal(version.outcome,'synthesis');
  assert.equal(version.state,'applied');
  assert.equal(version.insufficientEvidence,false);
  assert(detail.entry.contentMarkdown.length>100);
  assert(detail.entry.evidenceCount>=2);
  assert.equal(versions.length,1,'Retries and restart must not create duplicate versions in the fresh laboratory entry');
  assert(version.citations?.length>0,'The saved definition must retain evidence citations');
  console.log(JSON.stringify({executed:1,passed:1,failed:0,skipped:0,entryId:fixture.entryId,versionId:version.id,
    phoneModel:version.model,macModel:settings.dictionaryModel,contentCharacters:detail.entry.contentMarkdown.length,
    evidenceCount:detail.entry.evidenceCount,citationCount:version.citations.length,versionCount:versions.length,
    outcome:version.outcome,state:version.state,persistedInDesktop:true,duplicateVersions:false},null,2));
} finally {await client.close();}
