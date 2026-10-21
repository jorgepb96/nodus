// SPDX-License-Identifier: AGPL-3.0-only
// The narration half of the renderer bridge, paired with electron/ipc/tts.ts.
// Typed as TtsApi so the compiler guarantees the slice is complete.
import { ipcRenderer, type IpcRendererEvent } from 'electron';
import type { TtsApi, TtsEvent } from '@shared/api/tts';

export const ttsApi: TtsApi = {
  ttsStatus: () => ipcRenderer.invoke('tts:status'),
  ttsInstallRuntime: (engine) => ipcRenderer.invoke('tts:runtime:install', engine),
  ttsCancelInstall: () => ipcRenderer.invoke('tts:runtime:cancel'),
  ttsRemoveRuntime: (engine) => ipcRenderer.invoke('tts:runtime:remove', engine),
  ttsSetHuggingFaceToken: (token) => ipcRenderer.invoke('tts:hfToken:set', token),
  ttsHasHuggingFaceToken: () => ipcRenderer.invoke('tts:hfToken:status'),
  ttsDownloadModel: (modelId) => ipcRenderer.invoke('tts:model:download', modelId),
  ttsCancelModelDownload: (modelId) => ipcRenderer.invoke('tts:model:cancel', modelId),
  ttsDeleteModel: (modelId) => ipcRenderer.invoke('tts:model:delete', modelId),
  ttsLoad: (modelId) => ipcRenderer.invoke('tts:engine:load', modelId),
  ttsUnload: () => ipcRenderer.invoke('tts:engine:unload'),
  ttsSpeak: (request) => ipcRenderer.invoke('tts:speak', request),
  ttsCancel: (jobId) => ipcRenderer.invoke('tts:cancel', jobId),
  ttsVoices: () => ipcRenderer.invoke('tts:voices:list'),
  ttsSaveVoice: (input) => ipcRenderer.invoke('tts:voices:save', input),
  ttsUpdateVoice: (voiceId, patch) => ipcRenderer.invoke('tts:voices:update', voiceId, patch),
  ttsDeleteVoice: (voiceId) => ipcRenderer.invoke('tts:voices:delete', voiceId),
  ttsPinClip: (clipId, pinned) => ipcRenderer.invoke('tts:clips:pin', clipId, pinned),
  ttsSweepNow: () => ipcRenderer.invoke('tts:clips:sweep'),
  ttsDiskUsage: () => ipcRenderer.invoke('tts:disk'),
  onTtsEvent: (listener) => {
    const handler = (_event: IpcRendererEvent, payload: TtsEvent) => listener(payload);
    ipcRenderer.on('tts:event', handler);
    return () => { ipcRenderer.removeListener('tts:event', handler); };
  },
};
