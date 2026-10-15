// The little that every IPC domain module needs from the aggregator.
//
// electron/ipc.ts used to be a single 6,000-line function holding all ~1,200
// channels, and the reason it could not simply be cut into files was the state
// its handlers closed over. Measured before the split, that state turned out to
// be almost entirely domain-local — the four AbortController maps, the toolkit
// and translate signal maps, the presenter's pending imports — so each of those
// moves into the module that owns it and stays private there.
//
// Only two things are genuinely shared, and they are what this context carries:
// the `h` wrapper (so every channel keeps the same localization behaviour) and
// the accessor for the main window.
import { ipcMain, type BrowserWindow } from 'electron';
import { localizeIpcPayload, localizeRuntimeError } from '@shared/uiLanguage';
import { getSettings } from '../db/settingsRepo';
import { withoutDatabaseContext } from '../db/database';
import { assertNotBrowserIpcSender } from './trust';
import { isAiModelRequiredError } from '@shared/aiModelRequired';
import { registerMobileOperation } from '../desktopBridge/operations';

export interface IpcContext {
  /**
   * In-flight streaming chats, keyed by the requestId the renderer generates, so a
   * Stop button can abort the provider mid-answer.
   *
   * Genuinely shared, unlike the other closure state the split found: three separate
   * streaming chats key into the same registry — `worldChat:stream`, `db:chatStream`
   * and `research:chatStream` — each paired with its own `:cancel` channel. Since
   * requestIds are unique per request, giving each domain its own map would behave
   * identically, but that is a semantic change and does not belong in a move.
   */
  chatAborters: Map<string, AbortController>;
  /**
   * ipcMain.handle with the app's error and payload localization applied. Every
   * channel goes through it: results are localized for the current UI language,
   * and a thrown message is translated when a translation exists (and rethrown
   * untouched when it does not, so stack traces survive).
   */
  h: typeof ipcMain.handle;
  /** The main window, or null while it is closed or being recreated. */
  getWindow: () => BrowserWindow | null;
}

/**
 * The same localization `h` applies to a handler's return value, for payloads that
 * are PUSHED to the renderer instead of returned. `webContents.send` never goes
 * through `h`, so an event carrying a `message`/`error` field arrived in Spanish
 * while the identical record fetched over IPC arrived localized — visible in the
 * decorative image card, which learns of a failure by event and re-reads it by
 * invoke, and so could show two different texts for one failure.
 */
export function localizedForUi<T>(payload: T): T {
  return withoutDatabaseContext(() => localizeIpcPayload(payload, getSettings().uiLanguage));
}

/** Build the context handed to every `register*Ipc` function. */
export function createIpcContext(getWindow: () => BrowserWindow | null): IpcContext {
  const h: typeof ipcMain.handle = (channel, listener) => {
    registerMobileOperation(channel, listener);
    ipcMain.handle(channel, async (event, ...args) => {
    try {
      // Defence in depth for the entire legacy IPC surface. A Browser renderer
      // that somehow gains ipcRenderer still cannot reach vaults, files, AI,
      // settings, databases or any other handler registered through `h`.
      assertNotBrowserIpcSender(event);
      const result = await listener(event, ...args);
      return localizeIpcPayload(result, getSettings().uiLanguage);
    } catch (error) {
      if (isAiModelRequiredError(error)) {
        getWindow()?.webContents.send('ai:modelRequired');
      }
      const message = error instanceof Error ? error.message : String(error);
      const localized = localizeRuntimeError(message, getSettings().uiLanguage);
      // When the UI gets a translated message the raw one is otherwise lost; keep it in the
      // main-process log so a failure that only shows as a generic sentence can still be traced.
      if (localized !== message) console.error(`[ipc] ${channel} failed (localized for the UI): ${message}`, error);
      if (localized === message) throw error;
      throw new Error(localized);
    }
    });
  };
  return { h, getWindow, chatAborters: new Map() };
}
