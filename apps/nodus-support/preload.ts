import { contextBridge, ipcRenderer } from 'electron';
import type { SupportApi } from '../../shared/support/types';
const invoke = async (method: string, ...args: unknown[]) => {
  const result = await ipcRenderer.invoke(`support:${method}`, ...args);
  if (!result.ok) throw new Error(result.code); return result.value;
};
const methods = ['setLanguage','inspect','chooseProfile','chooseExecutable','chooseStorage','create','protect','test','answer','cancel','resume','launchRecovered','applySolution','undoSolution','report','saveReport','exportOriginalLogs','copyReport','openIssue','reinstall','restore','reveal','openGuide'] as const;
const api = Object.fromEntries(methods.map(method => [method, (...args: unknown[]) => invoke(method, ...args)])) as unknown as Omit<SupportApi, 'onProgress'>;
contextBridge.exposeInMainWorld('nodusSupport', {
  ...api,
  onProgress(callback: Parameters<SupportApi['onProgress']>[0]) { const listener = (_event: Electron.IpcRendererEvent, value: Parameters<typeof callback>[0]) => callback(value); ipcRenderer.on('support:progress', listener); return () => ipcRenderer.removeListener('support:progress', listener); },
} as SupportApi);
