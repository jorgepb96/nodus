// SPDX-License-Identifier: AGPL-3.0-only
/**
 * "Sign in with Hugging Face": an alternative to pasting a read token, as in Nodus Reader.
 *
 * Nodus is a public OAuth client (no secret ships in the app) using PKCE. Its client id is a
 * Client ID Metadata Document published in this repository (`oauth/huggingface-client.json`),
 * served as JSON by jsDelivr at a fixed tag, so nothing is registered on anyone's account. The
 * browser step runs in the user's default browser; the app receives the authorization code on
 * its own `nodus://oauth/huggingface` deep link. Pure functions only: the main process owns the
 * network and the storage.
 */

export const HF_OAUTH_CLIENT_ID = 'https://cdn.jsdelivr.net/gh/jorgepb96/nodus@hf-oauth-v1/oauth/huggingface-client.json';
export const HF_OAUTH_REDIRECT_URI = 'nodus://oauth/huggingface';
/** Profile for "Signed in as …" and read access to public gated models whose licence the user accepted. */
export const HF_OAUTH_SCOPE = 'openid profile gated-repos';
export const HF_OAUTH_AUTHORIZE = 'https://huggingface.co/oauth/authorize';
export const HF_OAUTH_TOKEN = 'https://huggingface.co/oauth/token';
export const HF_OAUTH_USERINFO = 'https://huggingface.co/oauth/userinfo';

export interface HuggingFaceOAuthRequest { verifier: string; state: string; challenge: string }

export interface HuggingFaceSession {
  accessToken: string;
  refreshToken?: string;
  /** Epoch milliseconds. */
  expiresAt?: number;
  account?: string;
}

export function authorizeUrl(request: Pick<HuggingFaceOAuthRequest, 'state' | 'challenge'>): string {
  const url = new URL(HF_OAUTH_AUTHORIZE);
  url.searchParams.set('client_id', HF_OAUTH_CLIENT_ID);
  url.searchParams.set('redirect_uri', HF_OAUTH_REDIRECT_URI);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', HF_OAUTH_SCOPE);
  url.searchParams.set('state', request.state);
  url.searchParams.set('code_challenge', request.challenge);
  url.searchParams.set('code_challenge_method', 'S256');
  return url.toString();
}

/** Whether a deep link is the sign-in callback. */
export function isHuggingFaceCallback(url: string): boolean {
  return url.startsWith(`${HF_OAUTH_REDIRECT_URI}?`) || url === HF_OAUTH_REDIRECT_URI;
}

/** The authorization code of a callback that answers `state`; throws a code otherwise. */
export function codeFromCallback(callback: string, state: string): string {
  let url: URL;
  try { url = new URL(callback); } catch { throw new Error('HF_OAUTH_INVALID_RESPONSE'); }
  const error = url.searchParams.get('error');
  if (error) throw new Error(`HF_OAUTH_DENIED: ${url.searchParams.get('error_description') ?? error}`);
  if (url.searchParams.get('state') !== state) throw new Error('HF_OAUTH_STATE_MISMATCH');
  const code = url.searchParams.get('code');
  if (!code) throw new Error('HF_OAUTH_INVALID_RESPONSE');
  return code;
}

export function tokenRequestBody(fields: Record<string, string>): string {
  return Object.keys(fields).sort().map((key) => `${encodeURIComponent(key)}=${encodeURIComponent(fields[key])}`).join('&');
}

export function exchangeFields(code: string, verifier: string): Record<string, string> {
  return { grant_type: 'authorization_code', code, redirect_uri: HF_OAUTH_REDIRECT_URI, client_id: HF_OAUTH_CLIENT_ID, code_verifier: verifier };
}

export function refreshFields(refreshToken: string): Record<string, string> {
  return { grant_type: 'refresh_token', refresh_token: refreshToken, client_id: HF_OAUTH_CLIENT_ID };
}

/** Decodes a token endpoint answer; a refresh keeps the previous refresh token and account when not reissued. */
export function sessionFromTokenResponse(body: unknown, previous: HuggingFaceSession | null, now: number): HuggingFaceSession {
  const value = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
  const accessToken = typeof value.access_token === 'string' ? value.access_token : '';
  if (!accessToken) throw new Error('HF_OAUTH_INVALID_RESPONSE');
  const expiresIn = typeof value.expires_in === 'number' ? value.expires_in : null;
  const refreshToken = typeof value.refresh_token === 'string' ? value.refresh_token : previous?.refreshToken;
  return {
    accessToken,
    ...(refreshToken ? { refreshToken } : {}),
    ...(expiresIn ? { expiresAt: now + expiresIn * 1000 } : {}),
    ...(previous?.account ? { account: previous.account } : {}),
  };
}

/** Refresh a minute early so a download never carries a token that expires in flight. */
export function sessionExpired(session: HuggingFaceSession, now: number): boolean {
  return typeof session.expiresAt === 'number' && session.expiresAt - 60_000 <= now;
}

export function accountFromUserInfo(body: unknown): string | undefined {
  const value = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
  const name = value.preferred_username ?? value.name;
  return typeof name === 'string' && name.trim() ? name.trim() : undefined;
}
