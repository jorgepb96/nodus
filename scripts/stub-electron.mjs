// Minimal `electron` stub for headless smoke tests (esbuild --alias:electron=…).
// Only what the DB/AI modules touch at import time is provided; safeStorage is
// never actually invoked on the pure-assembly code path.
const tmp = process.env.NODUS_TEST_USERDATA || '/tmp/nodus-smoke-userdata';
export const app = { getPath: () => tmp, getAppPath: () => process.cwd(), isPackaged: false };
export const safeStorage = {
  isEncryptionAvailable: () => false,
  encryptString: (s) => Buffer.from(String(s)),
  decryptString: (b) => Buffer.from(b).toString(),
};
// Present so modules that import them at load time bundle cleanly; the pure-DB
// smoke paths never invoke these.
export const dialog = { showSaveDialog: async () => ({ canceled: true, filePath: undefined }) };
export const ipcMain = { handle: () => undefined, on: () => undefined };
export class BrowserWindow {}
export const shell = { openExternal: async () => undefined };
export const utilityProcess = { fork: () => { throw new Error('utilityProcess is unavailable in headless tests'); } };
export default { app, safeStorage, dialog, ipcMain, BrowserWindow, shell, utilityProcess };

export const nativeImage = { createFromPath: () => ({ isEmpty: () => true }) };
