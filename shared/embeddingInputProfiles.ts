import type { EmbeddingProvider } from './types';
import { isEmbeddingGemma2 } from './embeddingGemma2';

/** Input formatting is part of the vector space, never a live query preference. */
export interface EmbeddingInputProfile {
  version: 1;
  kind: 'plain' | 'e5' | 'nomic' | 'gemma2' | 'gemini' | 'custom';
  queryPrefix: string;
  documentPrefix: string;
}
export function defaultEmbeddingInputProfile(provider: EmbeddingProvider, model: string): EmbeddingInputProfile {
  const base = { version: 1 as const, queryPrefix: '', documentPrefix: '' };
  if (provider === 'nodus' && isEmbeddingGemma2(model)) return { ...base, kind: 'gemma2' };
  if (provider === 'gemini') return { ...base, kind: 'gemini' };
  if (/(?:^|[/:_-])(?:multilingual-)?e5(?:[-/:]|$)/i.test(model) && !/instruct/i.test(model)) return { ...base, kind: 'e5', queryPrefix: 'query: ', documentPrefix: 'passage: ' };
  if (/nomic[-_](?:embed[-_])?text/i.test(model)) return { ...base, kind: 'nomic', queryPrefix: 'search_query: ', documentPrefix: 'search_document: ' };
  return { ...base, kind: 'plain' };
}
export function validateEmbeddingInputProfile(input: EmbeddingInputProfile, provider: EmbeddingProvider, model: string): EmbeddingInputProfile {
  if (!input || input.version !== 1 || !['plain', 'e5', 'nomic', 'gemma2', 'gemini', 'custom'].includes(input.kind)
    || typeof input.queryPrefix !== 'string' || typeof input.documentPrefix !== 'string'
    || input.queryPrefix.length > 512 || input.documentPrefix.length > 512 || (input.queryPrefix + input.documentPrefix).includes('\u0000')) throw new Error('Perfil de entrada de embeddings no válido.');
  const native = provider === 'nodus' && isEmbeddingGemma2(model);
  if ((input.kind === 'gemma2') !== native || (input.kind === 'gemini' && provider !== 'gemini')) throw new Error('El perfil de entrada no es compatible con este modelo.');
  if (input.kind !== 'custom') {
    const expected = input.kind === 'e5' ? { queryPrefix: 'query: ', documentPrefix: 'passage: ' }
      : input.kind === 'nomic' ? { queryPrefix: 'search_query: ', documentPrefix: 'search_document: ' } : { queryPrefix: '', documentPrefix: '' };
    if (input.queryPrefix !== expected.queryPrefix || input.documentPrefix !== expected.documentPrefix) throw new Error('Los prefijos no coinciden con el perfil seleccionado.');
  }
  return { version: 1, kind: input.kind, queryPrefix: input.queryPrefix, documentPrefix: input.documentPrefix };
}
export function embeddingInputText(text: string, role: 'query' | 'document', profile?: EmbeddingInputProfile): string {
  // Gemma owns its tokenizer, task template and title prefix in the native runtime.
  if (profile?.kind === 'gemma2') return text;
  const prefix = profile ? role === 'query' ? profile.queryPrefix : profile.documentPrefix : '';
  return prefix + text.slice(0, Math.max(0, 8000 - prefix.length));
}
