/**
 * Debug transcript of text generation, appended as one JSON line per event. Off unless
 * `NODUS_AI_TRANSCRIPT` is set — then it is the file to append to, or a directory (an
 * `ai-transcript.jsonl` is written inside it). For local debugging only; it records whole prompts
 * and responses, so it is never on in a normal run. Two kinds of event:
 *   - `call`: the logical request (system/user) and the final response text, around a public
 *     completion (withTranscript), for every provider.
 *   - `http` / `http-response`: the exact bytes sent to and received from the provider, with a key
 *     fingerprint, via a fetch the provider client is given (transcriptFetch). This is what shows a
 *     provider-side refusal (an empty body with `stop_reason: refusal`) versus an app-side one.
 */
import { appendFileSync, existsSync, statSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import type { CallOpts } from './aiClient';
import type { ModelRef } from '@shared/types';

/** The transcript file when enabled, else null (the whole feature is a no-op). */
function transcriptFile(): string | null {
  const configured = process.env.NODUS_AI_TRANSCRIPT;
  if (!configured) return null;
  try {
    if (existsSync(configured) && statSync(configured).isDirectory()) return path.join(configured, 'ai-transcript.jsonl');
    const dir = path.dirname(configured);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    return configured;
  } catch {
    return null;
  }
}

function append(record: Record<string, unknown>): void {
  const file = transcriptFile();
  if (!file) return;
  try {
    appendFileSync(file, JSON.stringify({ ts: new Date().toISOString(), ...record }) + '\n');
  } catch {
    // Never let transcript logging break a generation.
  }
}

/** Wrap a completion so its logical request and response are recorded when the transcript is on.
 *  A no-op (just awaits the call) when off, so the hot path pays nothing. */
export async function withTranscript(
  model: ModelRef | null | undefined,
  opts: Pick<CallOpts, 'system' | 'user'>,
  run: () => Promise<string>,
): Promise<string> {
  if (!process.env.NODUS_AI_TRANSCRIPT) return run();
  const started = Date.now();
  const base = { phase: 'call', model: model ? `${model.provider}/${model.model}` : null, system: opts.system, user: opts.user };
  try {
    const response = await run();
    append({ ...base, ms: Date.now() - started, response });
    return response;
  } catch (error) {
    append({ ...base, ms: Date.now() - started, error: error instanceof Error ? error.message : String(error) });
    throw error;
  }
}

/** A counted event the trace should carry beside the calls: what retrieval actually did on this
 *  turn. The prompt deliberately shows a model no counters (researchScopeForPrompt strips them),
 *  and nothing else logged them, so a run could not say how many rounds ran — which is exactly
 *  what hid "retrieval never ran at all". A no-op when the transcript is off. */
export function recordRetrieval(fields: Record<string, unknown>): void {
  if (!process.env.NODUS_AI_TRANSCRIPT) return;
  append({ phase: 'retrieval', ...fields });
}

/** A `fetch` for a provider client that records the exact request and response (and a key
 *  fingerprint, never the key) when the transcript is on; undefined when off, so the client keeps its
 *  default fetch and pays nothing. */
export function transcriptFetch(key: string | null | undefined): typeof fetch | undefined {
  if (!process.env.NODUS_AI_TRANSCRIPT) return undefined;
  const keyFp = key ? createHash('sha256').update(key).digest('hex').slice(0, 12) : null;
  return (async (url: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
    const body = typeof init?.body === 'string' ? init.body : undefined;
    append({ phase: 'http', url: String(url), keyFp, bodyLen: body?.length, headers: init?.headers, body });
    const response = await fetch(url, init);
    try {
      const raw = await response.clone().text();
      append({ phase: 'http-response', status: response.status, keyFp, len: raw.length, raw });
    } catch {
      // A non-cloneable body (rare) just skips the response record.
    }
    return response;
  }) as typeof fetch;
}
