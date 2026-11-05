import {createHmac,randomBytes,timingSafeEqual} from 'node:crypto';
import {canonicalJson} from '../../shared/canonicalJson';
import {getDb} from '../db/database';
import {getActiveVault} from '../vaults/vaultRegistry';
import type {StudySearchIndexEntry} from '../../shared/studySearch';
import type {MobileStudyChatEvidence} from '../../shared/mobileStudyChat';
import type {StudyAssistantCitation} from '../../shared/studyAssistant';
import {compressStudyAssistantEvidence} from '../../shared/studyAssistant';
import {studyChatCitation} from '../../shared/studyChatPrompt';

function key():Buffer {
  const db=getDb();db.exec('CREATE TABLE IF NOT EXISTS mobile_study_chat_signing(key_id TEXT PRIMARY KEY,key_hex TEXT NOT NULL)');
  const row=db.prepare('SELECT key_hex FROM mobile_study_chat_signing WHERE key_id=?').get('v1') as {key_hex:string}|undefined;
  if(row){if(!/^[a-f\d]{64}$/.test(row.key_hex))throw new Error('invalid_study_chat_signing_key');return Buffer.from(row.key_hex,'hex');}
  const created=randomBytes(32);db.prepare('INSERT INTO mobile_study_chat_signing VALUES(?,?)').run('v1',created.toString('hex'));return created;
}
export function signStudyChatEntry(entry:StudySearchIndexEntry):string {
  return createHmac('sha256',key()).update(canonicalJson({version:1,vaultId:getActiveVault().id,entry})).digest('hex');
}
/** Validates the captured source even after Desktop edits/reindexes it. A
 * companion never fabricates evidence from an unrelated vault or model prose. */
export function verifyStudyChatCitation(citation:StudyAssistantCitation,evidence:MobileStudyChatEvidence,question:string):boolean {
  if(!citation||!/^S\d+$/.test(citation.id)||!evidence?.entry||!Number.isInteger(evidence.maxChars)||evidence.maxChars<1||evidence.maxChars>3600||!/^[a-f\d]{64}$/.test(evidence.signature??''))return false;
  const expected=Buffer.from(signStudyChatEntry(evidence.entry),'hex'),received=Buffer.from(evidence.signature,'hex');
  if(!timingSafeEqual(expected,received))return false;
  const quote=compressStudyAssistantEvidence(evidence.entry.text,question,evidence.maxChars).text;
  return canonicalJson(citation)===canonicalJson(studyChatCitation(citation.id,evidence.entry,quote));
}
