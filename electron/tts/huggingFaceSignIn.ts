// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The main-process half of "Sign in with Hugging Face" (pure parts in shared/huggingFaceOAuth):
 * opens the authorization page in the default browser, waits for the `nodus://` callback,
 * exchanges the code with PKCE, keeps the session encrypted next to the pasted token and
 * refreshes it before downloads. The session wins over a pasted token while it is valid.
 */
import { createHash, randomBytes } from 'node:crypto';
import {
  HF_OAUTH_TOKEN, HF_OAUTH_USERINFO, accountFromUserInfo, authorizeUrl, codeFromCallback, exchangeFields,
  isHuggingFaceCallback, refreshFields, sessionExpired, sessionFromTokenResponse, tokenRequestBody,
  type HuggingFaceSession,
} from '@shared/huggingFaceOAuth';
import { clearAudioKey, getAudioKey, setAudioKey } from '../secrets/secretStore';

const SESSION_KEY = 'huggingface_oauth';
const TOKEN_KEY = 'huggingface';
const SIGN_IN_TIMEOUT_MS = 10 * 60_000;

const base64Url = (bytes: Buffer) => bytes.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

import type { HuggingFaceAuthStatus } from '@shared/api/tts';
export type { HuggingFaceAuthStatus };

let pending: { state: string; verifier: string; resolve: (url: string) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> } | null = null;

function readSession(): HuggingFaceSession | null {
  const raw = getAudioKey(SESSION_KEY);
  if (!raw) return null;
  try { const session = JSON.parse(raw) as HuggingFaceSession; return session.accessToken ? session : null; } catch { return null; }
}

function writeSession(session: HuggingFaceSession): void {
  setAudioKey(SESSION_KEY, JSON.stringify(session));
}

async function postToken(fields: Record<string, string>): Promise<unknown> {
  const response = await fetch(HF_OAUTH_TOKEN, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: tokenRequestBody(fields),
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) throw new Error(response.status === 400 || response.status === 401 ? 'HF_OAUTH_EXPIRED' : `HF_OAUTH_HTTP_${response.status}`);
  return response.json();
}

export function huggingFaceAuthStatus(): HuggingFaceAuthStatus {
  const session = readSession();
  return { signedIn: Boolean(session), account: session?.account ?? null, hasToken: getAudioKey(TOKEN_KEY) !== null };
}

/** Routes a deep link; returns true when it was the sign-in callback. */
export function handleHuggingFaceCallback(url: string): boolean {
  if (!isHuggingFaceCallback(url)) return false;
  pending?.resolve(url);
  return true;
}

export async function signInWithHuggingFace(): Promise<HuggingFaceAuthStatus> {
  if (pending) { clearTimeout(pending.timer); pending.reject(new Error('HF_OAUTH_SUPERSEDED')); pending = null; }
  const verifier = base64Url(randomBytes(32));
  const state = base64Url(randomBytes(16));
  const challenge = base64Url(createHash('sha256').update(verifier).digest());
  let timer: ReturnType<typeof setTimeout> | undefined;
  const callback = new Promise<string>((resolve, reject) => {
    timer = setTimeout(() => { pending = null; reject(new Error('HF_OAUTH_TIMEOUT')); }, SIGN_IN_TIMEOUT_MS);
    pending = { state, verifier, resolve, reject, timer };
  });
  // Loaded on use: the TTS service imports this module, and tests bundle that service without Electron.
  const { shell } = await import('electron');
  await shell.openExternal(authorizeUrl({ state, challenge }));
  let url: string;
  try { url = await callback; } finally { clearTimeout(timer); pending = null; }
  const code = codeFromCallback(url, state);
  const session = sessionFromTokenResponse(await postToken(exchangeFields(code, verifier)), null, Date.now());
  try {
    const info = await fetch(HF_OAUTH_USERINFO, { headers: { Authorization: `Bearer ${session.accessToken}` }, signal: AbortSignal.timeout(15_000) });
    if (info.ok) session.account = accountFromUserInfo(await info.json());
  } catch { /* the account name is only for display */ }
  writeSession(session);
  return huggingFaceAuthStatus();
}

export function signOutOfHuggingFace(): HuggingFaceAuthStatus {
  clearAudioKey(SESSION_KEY);
  return huggingFaceAuthStatus();
}

/** The token for a gated download: a fresh OAuth session first, else the pasted token. */
export async function huggingFaceToken(): Promise<string | null> {
  const session = readSession();
  if (session) {
    if (!sessionExpired(session, Date.now())) return session.accessToken;
    if (session.refreshToken) {
      try {
        const next = sessionFromTokenResponse(await postToken(refreshFields(session.refreshToken)), session, Date.now());
        writeSession(next);
        return next.accessToken;
      } catch (error) {
        // A refresh token Hugging Face no longer accepts ends the session, so Settings stops
        // showing "Signed in"; a network failure keeps it for the next try. Either way the
        // pasted token, if any, is the fallback.
        if (error instanceof Error && error.message === 'HF_OAUTH_EXPIRED') clearAudioKey(SESSION_KEY);
      }
    }
  }
  return getAudioKey(TOKEN_KEY);
}
