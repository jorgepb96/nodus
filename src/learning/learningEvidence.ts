/** Only a resolved, nonempty source passage can prove the first answer's outcome. */
export async function learningAnswerReferences(answer:string, documentId?:string, revision?:string) {
 const refs = [...answer.matchAll(/nodus:\/\/passage\/([^\s)\]<>]+)/g)].slice(0,64).flatMap(match=>{try{return[decodeURIComponent(match[1])];}catch{return[];}});
 const checked=await Promise.all([...new Set(refs)].map(async id=>{const passage=await window.nodus.getPassage(id).catch(()=>null);return passage && passage.text.trim() && !passage.web && !passage.historical && (!revision || passage.revision===revision) && (!documentId||passage.nodus_id===documentId) ? {id:`passage:${id}`,documentId:passage.nodus_id}:null;}));
 const valid=checked.filter((ref):ref is NonNullable<typeof ref>=>!!ref);
 return {citationIds:valid.map(ref=>ref.id),documentId:documentId??valid[0]?.documentId};
}
