import * as electron from 'electron';

/** Keep diagnostics useful without copying URLs, query tokens or headers from a transport error. */
export function modelResourceError(url: string, cause: unknown): Error {
  let code = 'NETWORK_ERROR';
  const seen = new Set<unknown>();
  for (let current = cause; current && typeof current === 'object' && !seen.has(current);) {
    seen.add(current);
    const error = current as { code?: unknown; message?: unknown; cause?: unknown };
    const candidate = typeof error.code === 'string' ? error.code
      : typeof error.message === 'string' ? /\b(ERR_[A-Z0-9_]+)\b/.exec(error.message)?.[1] : undefined;
    if (candidate && /^E[A-Z0-9_]{1,70}$/.test(candidate)) { code = candidate; break; }
    current = error.cause;
  }
  return new Error(`No se pudo conectar con ${new URL(url).hostname}. Comprueba la conexión y el proxy del sistema. (${code})`);
}

/** Model setup uses Chromium's system proxy/certificate support, without browser cookies. */
export async function fetchModelResource(url: string, init: RequestInit = {}): Promise<Response> {
  try {
    return await electron.net.fetch(url, { ...init, credentials: 'omit' });
  } catch (cause) {
    if (init.signal?.aborted) throw cause;
    throw modelResourceError(url, cause);
  }
}
