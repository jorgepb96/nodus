import { BrowserWindow } from 'electron';
import { isAiModelRequiredError } from '@shared/aiModelRequired';
import { localizedForUi } from '../ipc/context';
import { withoutDatabaseContext, withVaultDatabase } from '../db/database';
import { getActiveVault, withOwningVault } from '../vaults/vaultRegistry';
import { generateDictionaryEntry } from './dictionary';
import { DictionaryGenerationQueue } from './dictionaryGenerationQueue';

/** IPC and harness continuation share the same per-entry jobs and broadcasts. */
export function broadcastDictionaryChanged(entryId: string): void {
  for (const win of BrowserWindow.getAllWindows()) if (!win.isDestroyed() && !win.webContents.isDestroyed()) win.webContents.send('dictionary:changed', entryId);
}
export const dictionaryGenerationJobs = new DictionaryGenerationQueue(async (request, report) => {
  const version = await generateDictionaryEntry(request, report);
  broadcastDictionaryChanged(request.entryId);
  return version;
}, progress => {
  for (const win of BrowserWindow.getAllWindows()) if (!win.isDestroyed() && !win.webContents.isDestroyed()) {
    win.webContents.send('dictionary:progress', localizedForUi(progress));
    if (progress.phase === 'failed' && isAiModelRequiredError(progress.error)) win.webContents.send('ai:modelRequired');
  }
}, work => {
  // Capture the owning vault synchronously, before the job leaves this call
  // stack: timers keep the caller's AsyncLocalStorage store, whose dedicated
  // connection is already closed by the time the background work starts.
  const vaultId = getActiveVault().id;
  return () => withoutDatabaseContext(() => withOwningVault(vaultId, () => withVaultDatabase(vaultId, work)));
});
