/** Routing changes invalidate persisted decisions, including completed direct turns. */
export const RESEARCH_TURN_INTENT_POLICY = 'source-routing-v3';

const fold = (text: string) => text.normalize('NFKD').replace(/\p{M}/gu, '').toLocaleLowerCase().trim();
const TRANSFORM = /^(?:(?:por favor|please)[,\s]+)?(?:traduce|traducir|parafrasea|parafrasear|reescribe|reformula|resume|resumir|acorta|simplifica|corrige|translate|paraphrase|rewrite|rephrase|summari[sz]e|shorten|proofread|traduis|traduisez|reformule|reformulez|resumez)\b/iu;
const ACTION_PREFIX = /^(?:(?:ahora(?:\s+si)?|si|por favor|please|entonces|tambien|ademas|luego|vale|ok|pero|now|yes|then|again)[,\s]+)*/u;
const LOOKUP = /^(?:(?:puedes|podrias|puede|quiero que|necesito que|can you|could you|please)\s+)?(?:usa(?:r)?|utiliza(?:r)?|consulta(?:r|lo|la|los|las|s)?|consultalo|consultala|revisa(?:r|lo|la)?|mira|recurre|busca(?:r|me|lo|la|los|las)?|buscalo|buscala|investiga(?:r)?|explora(?:r)?|comprueba(?:lo|la)?|contrasta(?:lo|la)?|verifica(?:lo|la)?|use|search|check|consult|query|browse|look\s+(?:in|at|through|up)|find)\b/u;
const LIBRARY = /\b(?:zotero|mcp|biblioteca|corpus|documentos|fuentes|lecturas|referencias|bibliografia|library|documents|sources|references|bibliography)\b/u;
const BARE_LOOKUP = /^(?:vuelve a (?:buscar|consultar)|busca(?:lo|la|los|las)?|buscalo|buscala|consulta(?:lo|la|los|las)?|consultalo|consultala|search(?: again)?|look it up)(?:\s+(?:ahora|de nuevo|otra vez|por favor|please|now|again))*$/u;
const NEGATIVE_USE = /\b(?:sin\s+(?:buscar|consultar|usar|utilizar)|without\s+(?:searching|consulting|using)|no\s+(?:uses|busques|consultes)|(?:do not|don't)\s+(?:use|search|consult))\b/u;

/** Only the user's instructions can request tools. Quoted/fenced text and the
 * payload after a transformation header are data, even if they say "search". */
export function researchTurnInstructionText(message: string): string {
  let text = message.replace(/```[^]*?(?:```|$)/gu, ' ').replace(/^\s*>.*$/gmu, ' ');
  const boundary = text.search(/[:：]\s*|\n\s*\n/u);
  if (boundary >= 0 && TRANSFORM.test(text.slice(0, boundary).trim())) text = text.slice(0, boundary);
  return text.replace(/«[^»]*»|“[^”]*”|‘[^’]*’|「[^」]*」|『[^』]*』|(?<!\p{L})'[^'\n]+'(?!\p{L})|"[^"\n]*"|`[^`\n]*`/gu, quoted => {
    const value = quoted.slice(1, -1).trim();
    return /^(?:zotero|mcp|mi biblioteca|my library)$/iu.test(value) ? value : ' ';
  });
}

export function positiveResearchInstructions(message: string): string[] {
  return researchTurnInstructionText(message).split(/[.!?;\n,]+|\b(?:y|pero|luego|and|then|but)\b/iu)
    .map(text => fold(text).replace(/^[¿¡\s]+|[?!.\s]+$/gu, '').replace(ACTION_PREFIX, '').trim())
    .map(text => {
      const at = text.search(NEGATIVE_USE);
      if (at <= 0) return text;
      const before = text.slice(0, at).trim();
      // "Find synonyms without using my sources" does not request those sources.
      // A real target before the exclusion (library or web) retains its grant.
      return LOOKUP.test(before) && !LIBRARY.test(before) && !/\b(?:web|internet|online|google)\b/u.test(before) ? '' : before;
    })
    .filter(text => text && !/^(?:no\b(?!\s+solo\b)|sin\b|do not\b|don't\b|without\b|never\b)/u.test(text));
}

export function researchLookupFollowUp(message: string): boolean {
  return positiveResearchInstructions(message).some(text => BARE_LOOKUP.test(text)
    || LOOKUP.test(text) && /^(?:(?:en|con|a|in|the|my|mi|mis|la|el|las|los)\s+)*(?:zotero(?:\s+mcp)?|mcp|biblioteca|corpus|fuentes|documentos|library|sources|documents)$/u.test(text.replace(LOOKUP, '').trim()));
}

export function explicitResearchLibraryRequest(message: string): boolean {
  return researchLookupFollowUp(message) || positiveResearchInstructions(message).some(text => LOOKUP.test(text) && LIBRARY.test(text))
    || positiveResearchInstructions(message).some(text => /^(?:otros|mas|demas|other|more)\s+(?:autores|authors)\b/u.test(text));
}

export type ResearchDirectKind = 'transform' | 'conversation' | 'general';

/** Deliberately small deterministic fast path. Ambiguous requests still receive
 * semantic planning; a subject/title alone never proves that its text is supplied. */
export function researchDirectTurnKind(message: string): ResearchDirectKind | null {
  const text = fold(message).replace(/^[¿¡\s]+|[?!.\s]+$/gu, '');
  if (/^(?:hola|hola de nuevo|buenos dias|buenas tardes|buenas noches|gracias|muchas gracias|gracias por (?:todo|la respuesta|tu ayuda)|hello|hi|thanks|thank you|bonjour|merci)[,!\s.]*$/u.test(text)) return 'conversation';
  if (explicitResearchLibraryRequest(message)) return null;
  const instructions = researchTurnInstructionText(message);
  const header = fold(instructions);
  const factualCorrection = /\b(?:corrig(?:e|iendo|as)|corregir)\b/u.test(header) && (!/\b(?:ortografia|gramatica|redaccion|estilo|puntuacion|erratas|sintaxis)\b/u.test(header) || /\b(?:datos|fechas|hechos|cifras)\b/u.test(header));
  const compound = LIBRARY.test(header) || /\b(?:y|and|then|luego|despues|ademas|para|mientras|with|while|to)\b|\b(?!following\b)\p{L}+(?:ando|iendo|ing)\b/u.test(header);
  if (TRANSFORM.test(instructions.trim()) && !factualCorrection && !compound
    && !/\b(?:busca(?:r)?|consulta(?:r)?|contrasta(?:r)?|verifica(?:r)?|comprueba(?:r)?|localiza(?:r)?|encuentra|actualiza(?:r|lo|la)?|anade|agrega|incorpora|incluye|completa|search|check|verify|find|locate|update|add|include)\b/u.test(header)) {
    const boundary = /[:：]\s*|\n\s*\n/u.exec(message);
    const payload = boundary ? message.slice(boundary.index + boundary[0].length).trim() : '';
    if (/\n\s*\n[^]*\b(?:consulta|busca|contrasta|comprueba|search|check|verify)\b/iu.test(payload)) return null;
    if (/^(?:https?:\/\/|nodus:\/\/|\[[^\]]+\]\((?:https?|nodus):\/\/)/iu.test(payload)
      && payload.replace(/\[[^\]]*\]\([^)]+\)|(?:https?|nodus):\/\/\S+/gu, '').trim().length < 3) return null;
    const supplied = /[:：]\s*\S|\n\s*\n\s*\S|«[^»]+»|“[^”]+”|‘[^’]+’|「[^」]+」|『[^』]+』|(?<!\p{L})'[^'\n]+'(?!\p{L})|"[^"\n]+"|```/u.test(message);
    const refersToConversation = /\b(?:lo anterior|tu (?:ultima )?respuesta|la respuesta anterior|ese (?:texto|parrafo)|este (?:texto|parrafo)|this (?:text|paragraph)|your (?:last )?(?:answer|response)|the previous (?:answer|text))\b/u.test(text);
    if (supplied || refersToConversation || /^(?:traduce|parafrasea|reescribe|translate|paraphrase|rewrite)$/u.test(text)) return 'transform';
  }
  const command = fold(instructions);
  if (!/\b(?:web|internet|online|google)\b/u.test(command)
    && /\b(?:sin\s+(?:buscar|consultar|usar|utilizar)|no\s+(?:busques|consultes|uses)|without\s+(?:searching|consulting|using)|(?:do not|don't)\s+(?:search|consult|use))\b[^.!?;\n]{0,35}\b(?:fuentes|corpus|biblioteca|documentos|sources|library|documents)\b/u.test(command)) return 'general';
  return null;
}
