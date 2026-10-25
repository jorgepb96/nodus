// SPDX-License-Identifier: AGPL-3.0-only
// Narration with Ming TTS: engine install, model downloads, the voice library and jobs.
// Paired with shared/api/tts.ts and electron/preload/tts.ts. Every channel belongs to the
// main frame of the main Nodus window only. Engine, download and job events are pushed on
// `tts:event`; the audio itself is served by the `nodus-audio://` protocol.
import type { TtsLanguage } from '@shared/ttsModels';
import type { TtsSpeakRequest } from '@shared/api/tts';
import type { TtsVoiceSaveInput } from '@shared/ttsVoices';
import { ttsService } from '../tts/service';
import type { IpcContext } from './context';
import { assertTrustedNodusMainFrame } from './trust';

export function registerTtsIpc({ h, getWindow }: IpcContext): void {
  const service = ttsService();
  service.onEvent((event) => {
    const win = getWindow();
    if (win && !win.isDestroyed() && !win.webContents.isDestroyed()) win.webContents.send('tts:event', event);
  });
  const trusted = (event: Electron.IpcMainInvokeEvent) => assertTrustedNodusMainFrame(event, getWindow());

  h('tts:status', async (event) => { trusted(event); return service.status(); });
  h('tts:runtime:install', async (event, engine?: string) => { trusted(event); return service.installRuntime(engine === 'phonon' ? 'phonon' : engine === 'kokoro' ? 'kokoro' : engine === 'pocket' ? 'pocket' : 'ming'); });
  h('tts:runtime:cancel', async (event) => { trusted(event); service.installer.cancel(); service.phononInstaller.cancel(); service.kokoroInstaller.cancel(); service.pocketInstaller.cancel(); });
  h('tts:runtime:remove', async (event, engine?: string) => { trusted(event); return service.removeRuntime(engine === 'phonon' ? 'phonon' : engine === 'kokoro' ? 'kokoro' : engine === 'pocket' ? 'pocket' : 'ming'); });
  h('tts:hfToken:set', async (event, token: string) => { trusted(event); return service.setHuggingFaceToken(String(token ?? '')); });
  h('tts:hfToken:status', async (event) => { trusted(event); return service.hasHuggingFaceToken(); });
  h('tts:model:download', async (event, modelId: string) => { trusted(event); return service.downloadModel(String(modelId)); });
  h('tts:model:cancel', async (event, modelId: string) => { trusted(event); service.models.cancel(String(modelId)); });
  h('tts:model:delete', async (event, modelId: string) => { trusted(event); return service.deleteModel(String(modelId)); });
  h('tts:engine:load', async (event, modelId?: string) => { trusted(event); return service.load(typeof modelId === 'string' && modelId ? modelId : undefined); });
  h('tts:engine:unload', async (event) => { trusted(event); return service.unload(); });
  h('tts:speak', async (event, request: TtsSpeakRequest) => { trusted(event); return service.speak(request); });
  h('tts:cancel', async (event, jobId: string) => { trusted(event); service.cancel(String(jobId)); });
  h('tts:voices:list', async (event) => { trusted(event); return service.voices.list(); });
  h('tts:voices:download', async (event, voiceId: string) => { trusted(event); return service.downloadVoice(String(voiceId)); });
  h('tts:voices:save', async (event, input: TtsVoiceSaveInput) => { trusted(event); return service.saveVoice(input); });
  h('tts:voices:update', async (event, voiceId: string, patch: { name?: string; transcript?: string; language?: TtsLanguage }) => {
    trusted(event);
    return service.voices.update(String(voiceId), patch ?? {});
  });
  h('tts:voices:delete', async (event, voiceId: string) => { trusted(event); return service.voices.remove(String(voiceId)); });
  h('tts:clips:pin', async (event, clipId: string, pinned: boolean) => { trusted(event); service.pinClip(String(clipId), pinned === true); });
  h('tts:clips:sweep', async (event) => { trusted(event); return service.sweepNow(); });
  h('tts:disk', async (event) => { trusted(event); return service.diskUsage(); });
}
