// SPDX-License-Identifier: AGPL-3.0-only
// The narration (Ming TTS) slice of the window.nodus contract, paired with
// electron/ipc/tts.ts and electron/preload/tts.ts.
import type { TtsFragmentEvent, TtsJobProgress, TtsLanguage, TtsLanguageSetting, TtsModelStatus, TtsStatus } from '../ttsModels';
import type { TtsVoice, TtsVoiceSaveInput } from '../ttsVoices';
import type { AudioClip, AudioEntityKind } from '../types';

export interface TtsSpeakRequest {
  text: string;
  /** Defaults to the saved `ttsVoiceId`. */
  voiceId?: string;
  /** Defaults to the saved `ttsLanguage`. */
  language?: TtsLanguageSetting;
  /** Higher runs first: playback the user is waiting for outranks background generation. */
  priority?: number;
  /** When set, the fragments are joined into a vault clip once the job ends. */
  save?: { kind: AudioEntityKind; id: string; segmentIndex: number; segmentLabel: string };
}

export interface TtsSpeakStarted { jobId: string; language: TtsLanguage; voiceId: string }

export type TtsEvent =
  | { kind: 'status'; status: TtsStatus }
  | { kind: 'install'; phase: string; fraction: number }
  | { kind: 'model'; status: TtsModelStatus }
  | { kind: 'fragment'; fragment: TtsFragmentEvent }
  | { kind: 'job'; progress: TtsJobProgress; clip?: AudioClip };

export interface TtsApi {
  ttsStatus(): Promise<TtsStatus>;
  ttsInstallRuntime(): Promise<TtsStatus>;
  ttsCancelInstall(): Promise<void>;
  ttsRemoveRuntime(): Promise<TtsStatus>;
  ttsDownloadModel(modelId: string): Promise<TtsStatus>;
  ttsCancelModelDownload(modelId: string): Promise<void>;
  ttsDeleteModel(modelId: string): Promise<TtsStatus>;
  /** Loads the selected (or given) model into memory; resolves once it is warm. */
  ttsLoad(modelId?: string): Promise<TtsStatus>;
  ttsUnload(): Promise<TtsStatus>;
  ttsSpeak(request: TtsSpeakRequest): Promise<TtsSpeakStarted>;
  ttsCancel(jobId: string): Promise<void>;
  ttsVoices(): Promise<TtsVoice[]>;
  ttsSaveVoice(input: TtsVoiceSaveInput): Promise<TtsVoice>;
  ttsUpdateVoice(voiceId: string, patch: { name?: string; transcript?: string; language?: TtsLanguage }): Promise<void>;
  ttsDeleteVoice(voiceId: string): Promise<void>;
  /** Marks a clip as kept: automatic deletion never removes it. */
  ttsPinClip(clipId: string, pinned: boolean): Promise<void>;
  /** Removes every unpinned clip older than the retention rules now; returns how many went. */
  ttsSweepNow(): Promise<number>;
  /** Bytes used by narration clips per surface, plus the voice library and engine. */
  ttsDiskUsage(): Promise<{ clips: Record<string, number>; voices: number; runtime: number; models: number }>;
  /** Subscribe to engine, download and job events. Returns the unsubscribe function. */
  onTtsEvent(listener: (event: TtsEvent) => void): () => void;
}
