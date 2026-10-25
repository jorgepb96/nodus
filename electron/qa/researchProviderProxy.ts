import type { AiProvider, ModelInfo } from '@shared/types';
import { validateIsolatedRoot } from './isolatedProfile';

/** Test-only routing. The isolated application's OS sandbox still denies direct
 * internet access; the external harness reserves cost before forwarding. */
export function researchTestProviderBase(provider: AiProvider): string | null {
  const configured = process.env.NODUS_RESEARCH_PROVIDER_PROXY;
  if (!configured || !['deepseek', 'openrouter'].includes(provider)) return null;
  const root = process.env.NODUS_ISOLATED_ROOT;
  if (!root || validateIsolatedRoot(root) !== process.env.NODUS_QA_ROOT) throw new Error('Unvalidated research provider proxy');
  const endpoint = new URL(configured);
  if (endpoint.protocol !== 'http:' || endpoint.hostname !== '127.0.0.1' || !endpoint.port || endpoint.port === '23119'
    || endpoint.username || endpoint.password || endpoint.search || endpoint.hash || !/^\/[a-f0-9-]{36}$/.test(endpoint.pathname)) throw new Error('Invalid research provider proxy');
  return `${endpoint.href}/${provider}`;
}

/** The paid gate changes transport, not the embedding space. Keep production's
 * identity hash while the isolated process still sends every request to loopback. */
export function researchTestEmbeddingEndpointIdentity(provider: AiProvider, endpoint: string): string {
  const proxy = researchTestProviderBase(provider);
  if (!proxy || endpoint !== proxy) return endpoint;
  return provider === 'openrouter' ? 'https://openrouter.ai/api/v1'
    : provider === 'deepseek' ? 'https://api.deepseek.com' : endpoint;
}

/** Fixed embedding lists for the isolated proxy. DeepSeek chat capabilities are read
 * through its free catalogue route instead of being supplied by the application. */
const RESEARCH_TEST_MODELS: Record<'chat' | 'embedding', Partial<Record<string, string[]>>> = {
  chat: { openrouter: [] },
  embedding: { openrouter: ['baai/bge-m3'] },
};
export function researchTestProviderModels(provider: string, kind: 'chat' | 'embedding'): ModelInfo[] | null {
  if (!process.env.NODUS_RESEARCH_PROVIDER_PROXY || !['deepseek', 'openrouter'].includes(provider)) return null;
  // Chat metadata must come through the free live catalogue route too.
  if (provider === 'deepseek' && kind === 'chat') return null;
  if (provider === 'openrouter' && kind === 'chat' && process.env.NODUS_RESEARCH_OPENROUTER_CHAT_QA === '1') return null;
  return (RESEARCH_TEST_MODELS[kind][provider] ?? []).map(id => ({ id, name: id }));
}
