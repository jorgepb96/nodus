import {validateMobileDatabaseSourcePack,type MobileDatabaseSourcePack} from './mobileDatabaseResearch';
import {composeDatabaseChatSources,type DatabaseChatSource} from './databaseChatSources';
import {databaseChatSystem,buildDbChatUser,type DbChatTurn} from './databaseChat';
import {chatProseForHistory} from './chatSkills';
import type {PromptLanguage} from './types';
export {prepareStudyChat} from './mobileStudyChat';
export {validateMobileStudyChatSourcePack} from './mobileStudyChat';
export {validateMobileStudyChatOriginal} from './mobileStudyChat';
export {composeProjectSystemPrompt} from './researchSystemPrompts';
export {validateStudyAssistantAnswer} from './studyAssistant';
export {prepareWorldChat,validateMobileWorldChatSourcePack,validateMobileWorldChatAnswer} from './mobileWorldChat';

/** Runs only the existing deterministic, provider-free Desktop context writers.
 * Native SwiftUI owns navigation, source choice, streaming and durable history. */
export function prepareDatabaseChat(input:{packs:MobileDatabaseSourcePack[];databaseIds:string[];question:string;history:DbChatTurn[];language:PromptLanguage;vaultId:string}) {
  if(!input.packs.length||!input.databaseIds.length||input.databaseIds.length>30||new Set(input.databaseIds).size!==input.databaseIds.length||!input.question.trim())throw new Error('invalid_database_chat_request');
  const sources=new Map<string,DatabaseChatSource>();
  const captureTimes=new Map<string,number>();
  for(const pack of input.packs) {
    validateMobileDatabaseSourcePack(pack);
    if(pack.vaultId!==input.vaultId)throw new Error('database_chat_vault_mismatch');
    for(const source of pack.databases)if(source.chat&&(!captureTimes.has(source.database.id)||Date.parse(pack.capturedAt)>captureTimes.get(source.database.id)!)) {
      sources.set(source.database.id,source.chat);captureTimes.set(source.database.id,Date.parse(pack.capturedAt));
    }
  }
  const selected=input.databaseIds.map(id=>{
    const source=sources.get(id);if(!source)throw new Error('Descarga de nuevo la base seleccionada: esta copia no incluye su perfil completo de chat.');return source;
  });
  const {context,names}=composeDatabaseChatSources(selected,input.language);
  const history=input.history.map(turn=>turn.role==='assistant'?{...turn,content:chatProseForHistory(turn.content)}:turn);
  return {system:databaseChatSystem(input.language),user:buildDbChatUser(context,input.question,history,input.language),temperature:0.3,maxTokens:1500,names};
}
