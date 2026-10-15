import {ResearchRetrievalBudget} from './researchRetrievalBudget';
import {validateResearchDocumentRead,type ResearchDocumentRead,type RetrievalSettings} from './researchCorpus';
export interface DocumentaryRetrievalPassage {id:string;document_id:string;index_key:string;text:string;locator_json:string}
export interface DocumentaryRetrievalHost {
 lexicalSearch(query:string,keys:string[],limit:number):DocumentaryRetrievalPassage[];
 semanticSearch(vector:number[],keys:string[],limit:number,threshold:number):DocumentaryRetrievalPassage[];
 physicalPages(keys:string[],from:number,to:number,limit:number,attachmentId?:string):DocumentaryRetrievalPassage[];
 adjacentPassages(id:string,keys:string[],radius?:number):DocumentaryRetrievalPassage[];
 activity?(key:string,operation:'lexical'|'semantic'|'expand'|'pages'|'references',status:'active'|'completed',count?:number):void;
}
/** Canonical independent-source fusion, bounded adjacency and evidence allowance. */
export function retrieveDocumentary(input:{query:string;lexicalKeys:string[];vectorKeys:string[];vector:number[]|null;settings:RetrievalSettings;threshold:number;read?:ResearchDocumentRead},host:DocumentaryRetrievalHost) {
 const activity=host.activity??(()=>{});
    const budget = new ResearchRetrievalBudget(input.settings);
    budget.nextRound();
    const read = input.read ? validateResearchDocumentRead(input.read) : null;
    const operation = read?.kind === 'pages' ? 'pages' : read?.kind === 'context' ? 'expand' : read?.kind === 'references' ? 'references' : 'lexical';
    activity('lexical', operation, 'active');
    const lexical = read?.kind === 'pages' ? host.physicalPages(input.lexicalKeys, read.from, read.to ?? read.from, input.settings.candidates, read.attachmentId)
      : read?.kind === 'context' ? host.adjacentPassages(read.passageId, input.lexicalKeys, read.radius ?? 1)
      : host.lexicalSearch(input.query, input.lexicalKeys, input.settings.candidates);
    activity('lexical', operation, 'completed', lexical.length);
    if (input.vector) activity('semantic', 'semantic', 'active');
    const semantic = input.vector ? host.semanticSearch(input.vector, input.vectorKeys, input.settings.candidates, input.threshold) : [];
    if (input.vector) activity('semantic', 'semantic', 'completed', semantic.length);
    const fused = new Map<string, { score: number; passage: typeof lexical[number] }>();
    for (const lane of [lexical, semantic]) lane.forEach((passage, index) => {
      // The same text can have separate lexical/vector index keys. Deduplicate
      // evidence by document, text and locator rather than raw index identity.
      const key = JSON.stringify([passage.document_id, passage.text, passage.locator_json]);
      const prior = fused.get(key);
      fused.set(key, { score: (prior?.score ?? 0) + 1 / (60 + index + 1), passage: prior?.passage ?? passage });
    });
    budget.candidates = fused.size;
    const ranked = [...fused.values()].sort((a, b) => b.score - a.score);
    const chosen: typeof lexical = [];
    const works = new Set<string>();
    // First pass prioritizes independent works, then fills remaining slots.
    for (const diverse of [true, false]) for (const { passage } of ranked) {
      if (chosen.length >= input.settings.passagesPerRound) break;
      if (diverse && works.has(passage.document_id)) continue;
      if (budget.accept(passage.id, passage.text)) { chosen.push(passage); works.add(passage.document_id); }
    }
    let frontier = chosen.slice();
    while (!read && input.settings.autoExpand && frontier.length && budget.rounds < input.settings.rounds && budget.nextRound()) {
      activity(`expand-${budget.rounds}`, 'expand', 'active');
      const next: typeof lexical = [];
      for (const passage of frontier) {
        for (const adjacent of host.adjacentPassages(passage.id, [...input.lexicalKeys, ...input.vectorKeys])) {
          if (next.length >= input.settings.passagesPerRound) break;
          if (budget.accept(adjacent.id, adjacent.text)) next.push(adjacent);
        }
      }
      activity(`expand-${budget.rounds}`, 'expand', 'completed', next.length);
      chosen.push(...next);
      frontier = next;
    }
 return {passages:chosen,traversal:{rounds:budget.rounds,candidates:budget.candidates,evidenceTokens:budget.usedEvidenceTokens,partial:budget.partial||chosen.length<ranked.length||lexical.length>=input.settings.candidates||semantic.length>=input.settings.candidates,visited:[...budget.visited]}};
}
