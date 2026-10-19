// Pure troubleshooting contracts shared by the UI and the worker host.
export const SUPPORT_CATALOG = [
  {id:'startup',actions:['fresh-profile','software-graphics','copy-profile','disable-plugins'],guides:['graphics','antivirus']},
  {id:'installation',actions:['configuration-check'],guides:['installation','system']},
  {id:'configuration',actions:['configuration-check','copy-profile'],guides:[]},
  {id:'storage',actions:['database-check','library-check','rebuild-library','recover-database'],guides:['recovery']},
  {id:'plugins',actions:['disable-plugins'],guides:['plugins']},
  {id:'models',actions:['model-check','repair-local-endpoints'],guides:['ollama','lmstudio']},
  {id:'sync',actions:['configuration-check','pause-sync'],guides:['connection']},
  {id:'backup',actions:['archive-roundtrip'],guides:['recovery']},
];
export const SUPPORT_ACTIONS = [...new Set(SUPPORT_CATALOG.flatMap(entry=>entry.actions))];
export const DIAGNOSTIC_ACTIONS = ['fresh-profile','database-check','library-check','configuration-check','model-check','archive-roundtrip'];
export function suggestedActions(symptom) {
  const first={startup:['configuration-check','fresh-profile','software-graphics','copy-profile','disable-plugins'],tool:['configuration-check','model-check','disable-plugins'],data:['database-check','library-check','rebuild-library','recover-database'],sync:['configuration-check','model-check','pause-sync'],update:['configuration-check','fresh-profile'],other:['configuration-check','database-check','model-check','library-check','archive-roundtrip']}[symptom] ?? [];
  return [...new Set([...first,...SUPPORT_ACTIONS])];
}
