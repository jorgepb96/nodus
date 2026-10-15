export interface LearningPrompt { vaultId:string; sessionId:string; documentId?:string; prompt:string }
let pending:LearningPrompt|null=null;
export function requestLearningPrompt(value:LearningPrompt) { pending=value; window.dispatchEvent(new Event('nodus:learning-prompt')); }
export function takeLearningPrompt(vaultId?:string,sessionId?:string) { if(pending?.vaultId!==vaultId||pending?.sessionId!==sessionId)return null; const value=pending;pending=null;return value; }
