import { BrowserWindow } from 'electron';
import { isAiModelRequiredError } from '@shared/aiModelRequired';
import { localizedForUi } from '../ipc/context';
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
});
