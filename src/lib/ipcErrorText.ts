/** Electron prefixes invoke failures with its channel name; the user needs the actual cause. */
export const ipcErrorText = (cause: unknown): string =>
  (cause instanceof Error ? cause.message : String(cause)).replace(/^Error invoking remote method '[^']+':\s*(?:Error:\s*)?/, '');
