import { verdictEntries, isAiVerdicts, normalizeCitationVerdict } from '@shared/citationVerdicts';
import { dictionaryGenerators, generateDictionaryDefinition } from '@shared/dictionaryGenerationCore';
import type { DictionaryEntry, DictionaryEvidenceItem, DictionaryGenerationRequest, DictionaryProgress } from '@shared/dictionary';
import type { CitationClaim, CitationVerdict } from '../../electron/ai/deepResearchCore';
import { deepResearchQualityPromptPack } from '@shared/deepResearchQualityPromptPacks';
import {structuredPrompt} from './structuredPrompt';

type Call = (method: string, ...args: unknown[]) => Promise<any>;
type Checkpoint = { id: string; request: DictionaryGenerationRequest; state: 'accepted' | 'running' | 'saved' | 'available' | 'failed'; context?: {entry: DictionaryEntry; evidence: DictionaryEvidenceItem[]; revision: string}; definition?: Awaited<ReturnType<typeof generateDictionaryDefinition>>; error?: string };
const active = new Map<string, Promise<DictionaryProgress>>();
function parseStructured(text: string): unknown {
  const cleaned = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  try { return JSON.parse(cleaned); } catch { throw new Error('JSON malformed_output: the provider did not return a complete JSON object.'); }
}

export function autonomousDictionary(call: Call, emit: (progress: DictionaryProgress) => void, request: DictionaryGenerationRequest): Promise<DictionaryProgress> {
  if (active.has(request.entryId)) return active.get(request.entryId)!;
  const promise = execute(call, emit, request).finally(() => active.delete(request.entryId));
  active.set(request.entryId, promise); return promise;
}
async function execute(call: Call, emit: (progress: DictionaryProgress) => void, request: DictionaryGenerationRequest): Promise<DictionaryProgress> {
  if (!request.model) throw new Error('Elige un modelo y configura su proveedor en los ajustes del móvil.');
  if (request.webSearch && request.webSearch !== 'off') throw new Error('La búsqueda web autónoma requiere un proveedor web configurado en este dispositivo. Desactívala para investigar el corpus descargado.');
  const previous = await call('mobileDictionaryCheckpoint', 'load', request.entryId);
  const checkpoint: Checkpoint = previous && previous.state !== 'available' && previous.request.mode === request.mode
    ? previous : { id: crypto.randomUUID(), request, state: 'accepted' };
  request = checkpoint.request;
  const save = () => call('mobileDictionaryCheckpoint', 'save', request.entryId, checkpoint);
  const progress = (phase: DictionaryProgress['phase'], message: string, error?: string): DictionaryProgress => ({ entryId: request.entryId, mode: request.mode, phase, message, ...(error ? { error } : {}) });
  await save(); emit(progress('retrieving', 'Leyendo las evidencias del corpus'));
  try {
    checkpoint.context ??= await call('getDictionaryGenerationContext', request.entryId, request.webSearch ?? 'off');
    checkpoint.state = 'running'; await save();
    const context = checkpoint.context!;
    const completion = async <T>(prompt: {system:string;user:string;temperature:number;maxTokens:number}, valid: (value:unknown) => value is T, _model: unknown = null, validation=false): Promise<T> => {
      const response = await call('mobileStructuredCompletion', {...structuredPrompt(prompt,request.model!,validation?'standard':request.thinkingEffort), generationId:checkpoint.id});
      const result = parseStructured(response);
      if (!valid(result)) throw new Error('Schema error: the provider returned an invalid structured dictionary response.');
      return result;
    };
    const verifyCitations = async (claims: CitationClaim[]): Promise<CitationVerdict[]> => {
      const verdicts: CitationVerdict[] = [];
      for (let start = 0; start < claims.length; start += 12) {
        const batch = claims.slice(start, start + 12);
        let parsed: Array<{i:number;veredicto:CitationVerdict}> | undefined;
        let last: unknown;
        for (let attempt = 0; attempt < 3; attempt++) {
          try {
            const result = await completion({ system:deepResearchQualityPromptPack(request.language ?? context.entry.outputLanguage).citationVerifier, user:JSON.stringify({pares:batch.map((claim,i)=>({i,afirmacion:claim.sentence,tipo_de_fuente:claim.kind,contenido_de_la_fuente:claim.content}))}),temperature:0,maxTokens:1800 }, isAiVerdicts, null, true);
            const map = new Map(verdictEntries(result).map(row => [row.i ?? row.index, normalizeCitationVerdict(row.veredicto ?? row.verdict)]));
            if (batch.some((_,i)=>!map.get(i))) throw new Error('JSON schema: incomplete citation verdicts');
            parsed=batch.map((_,i)=>({i,veredicto:map.get(i)!})); break;
          } catch (error) { last=error; }
        }
        if (!parsed) throw last;
        verdicts.push(...parsed.map(row=>row.veredicto));
      }
      return verdicts;
    };
    if (!checkpoint.definition) {
      emit(progress('generating', 'Generando con el proveedor del móvil'));
      checkpoint.definition = await generateDictionaryDefinition(context.entry, context.evidence, {...request,language:request.language ?? context.entry.outputLanguage}, {...dictionaryGenerators(context.entry, completion), verifyCitations});
      checkpoint.state = 'saved'; await save();
    }
    await call('saveDictionaryGeneratedVersion', {definition:checkpoint.definition, contextRevision:context.revision, webSearch:request.webSearch ?? 'off', requestId:checkpoint.id});
    checkpoint.state='available'; await save();
    const result = progress(checkpoint.definition!.outcome === 'degraded' ? 'degraded' : 'done', checkpoint.definition!.outcome === 'degraded' ? 'La síntesis necesita revisión' : 'Definición guardada');
    emit(result); return result;
  } catch (error) {
    checkpoint.state='failed'; checkpoint.error=String(error); await save(); emit(progress('failed','La generación no pudo completarse.',String(error))); throw error;
  }
}
