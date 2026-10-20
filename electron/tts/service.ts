// SPDX-License-Identifier: AGPL-3.0-only
import fs from 'node:fs/promises';
import path from 'node:path';
import {
  TTS_MODELS, defaultTtsModelId, ttsBackendForModel, ttsBackendForPlatform, ttsModelsForPlatform,
  type TtsBackend, type TtsEngine, type TtsFragmentEvent, type TtsJobProgress, type TtsRuntimeStatus, type TtsStatus,
} from '@shared/ttsModels';
import { PHONON_VOICES, phononVoiceUrl } from '@shared/phononVoices';
import { downloadVerifiedNodusAsset } from '../ai/nodusLocalAi';
import { clearAudioKey, getAudioKey, hasAudioKey, setAudioKey } from '../secrets/secretStore';
import { resolveTtsLanguage } from '@shared/ttsLanguage';
import type { TtsEvent, TtsSpeakRequest, TtsSpeakStarted } from '@shared/api/tts';
import type { TtsVoiceSaveInput } from '@shared/ttsVoices';
import { getSettings } from '../db/settingsRepo';
import { probeNvidia } from '../ai/nodusLocalAi';
import { saveClipAsync, deleteClip } from '../audio/audioService';
import { audioClipBytesByKind, listExpiredAudioClips, setAudioClipPinned } from '../db/audioClipsRepo';
import { TtsInstaller, type TtsInstalledRuntime } from './install';
import { TtsModelStore } from './models';
import { TtsEngineHost, type TtsVoiceRef } from './host';
import { TtsVoiceLibrary } from './voices';
import { concatWavFiles } from './wavConcat';
import { liveFragmentUrl } from './audioUrls';
import { sweepNarrationClips } from './retention';
import {
  directoryBytes, ttsAssetsDir, ttsBundledPythonRoot, ttsBundledVoicesDir, ttsLiveDir, ttsLogPath, ttsModelsDir, ttsRuntimeDir, ttsVoicesDir,
} from './paths';

/**
 * Ties the installer, the model store, the voice library and the sidecar host together for
 * IPC. Events go to every listener (the main window) as small objects; audio itself is served
 * by `nodus-audio://`, never sent over IPC.
 */
export class TtsService {
  readonly installer = new TtsInstaller(ttsRuntimeDir(), ttsAssetsDir(), ttsBundledPythonRoot(), {
    platform: process.platform,
    arch: process.arch,
    hasNvidia: async () => (await probeNvidia())?.detected === true,
  });
  readonly phononInstaller = new TtsInstaller(path.join(ttsRuntimeDir(), 'phonon'), ttsAssetsDir(), ttsBundledPythonRoot(), {
    platform: process.platform, arch: process.arch, hasNvidia: async () => false,
  }, undefined, 'phonon');
  readonly voices = new TtsVoiceLibrary(ttsVoicesDir(), ttsBundledVoicesDir());
  readonly host: TtsEngineHost;
  readonly models: TtsModelStore;
  private listeners = new Set<(event: TtsEvent) => void>();
  private runtime: TtsInstalledRuntime | null = null;
  private phononRuntime: TtsInstalledRuntime | null = null;
  private install: { phase: string; fraction: number; engine: TtsEngine } | null = null;
  private installError: { engine: TtsEngine; message: string } | undefined;
  private jobs = new Map<string, { progress: TtsJobProgress; started: number }>();

  constructor() {
    this.host = new TtsEngineHost({
      python: async (backend: TtsBackend) => backend === 'phonon'
        ? (this.phononRuntime ??= await this.phononInstaller.installed())?.python ?? null
        : (this.runtime ??= await this.installer.installed())?.python ?? null,
      backend: (modelId) => ttsBackendForModel(TTS_MODELS.find((model) => model.id === modelId), process.platform, process.arch),
      serveScript: path.join(ttsAssetsDir(), 'serve.py'),
      modelPath: (modelId) => this.models.dir(modelId),
      liveDir: ttsLiveDir(),
      logPath: ttsLogPath(),
      idleMs: () => getSettings().ttsIdleUnloadMin * 60_000,
      onState: () => { void this.emitStatus(); },
    });
    this.models = new TtsModelStore(ttsModelsDir(), (modelId) => this.host.isModelInUse(modelId));
    // Fragments of a previous session can never be resumed; clear them in the background.
    void fs.rm(ttsLiveDir(), { recursive: true, force: true }).catch(() => {});
  }

  onEvent(listener: (event: TtsEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(event: TtsEvent): void {
    for (const listener of this.listeners) { try { listener(event); } catch { /* a closed window */ } }
  }

  private async emitStatus(): Promise<void> {
    this.emit({ kind: 'status', status: await this.status() });
  }

  selectedModelId(): string {
    const saved = getSettings().ttsModelId;
    const available = ttsModelsForPlatform(process.platform, process.arch);
    return available.some((model) => model.id === saved) ? saved : defaultTtsModelId(process.platform, process.arch);
  }

  private runtimeStatus(engineName: TtsEngine): TtsRuntimeStatus {
    const runtime = engineName === 'phonon' ? this.phononRuntime : this.runtime;
    const installer = engineName === 'phonon' ? this.phononInstaller : this.installer;
    const install = this.install?.engine === engineName ? this.install : null;
    const error = this.installError?.engine === engineName ? this.installError.message : undefined;
    return {
      engine: engineName,
      backend: engineName === 'phonon' ? 'phonon' : ttsBackendForPlatform(process.platform, process.arch),
      installed: !!runtime,
      installing: installer.busy,
      ...(install ? { phase: install.phase, progress: install.fraction } : {}),
      ...(runtime ? { device: runtime.device, fallbackReason: runtime.fallbackReason } : {}),
      ...(error ? { error } : {}),
    };
  }

  async status(): Promise<TtsStatus> {
    this.runtime ??= await this.installer.installed();
    this.phononRuntime ??= await this.phononInstaller.installed();
    const engine = this.host.snapshot();
    const supported = ['darwin', 'win32', 'linux'].includes(process.platform) && ['arm64', 'x64'].includes(process.arch);
    return {
      platformSupported: supported,
      runtime: this.runtimeStatus('ming'),
      phononRuntime: this.runtimeStatus('phonon'),
      models: (await this.models.statuses()).filter((model) => ttsModelsForPlatform(process.platform, process.arch).some((entry) => entry.id === model.id)),
      engine: { state: engine.state, modelId: engine.modelId, idleUnloadAt: engine.idleUnloadAt, ...(engine.error ? { error: engine.error } : {}) },
    };
  }

  async installRuntime(engineName: TtsEngine = 'ming'): Promise<TtsStatus> {
    this.installError = undefined;
    const installer = engineName === 'phonon' ? this.phononInstaller : this.installer;
    try {
      const runtime = await installer.install((progress) => {
        this.install = { ...progress, engine: engineName };
        this.emit({ kind: 'install', phase: progress.phase, fraction: progress.fraction });
      });
      if (engineName === 'phonon') this.phononRuntime = runtime; else this.runtime = runtime;
    } catch (error) {
      this.installError = { engine: engineName, message: error instanceof Error ? error.message : String(error) };
      throw error;
    } finally {
      this.install = null;
      void this.emitStatus();
    }
    return this.status();
  }

  async removeRuntime(engineName: TtsEngine = 'ming'): Promise<TtsStatus> {
    await this.host.unload();
    if (engineName === 'phonon') { await this.phononInstaller.remove(); this.phononRuntime = null; }
    else { await this.installer.remove(); this.runtime = null; }
    void this.emitStatus();
    return this.status();
  }

  async downloadModel(modelId: string): Promise<TtsStatus> {
    const model = TTS_MODELS.find((entry) => entry.id === modelId);
    if (!model) throw new Error('TTS_MODEL_UNAVAILABLE');
    // CC BY-NC weights are never fetched until the user accepted their terms in Nodus.
    if (model.nonCommercial && !getSettings().ttsAcceptedLicenses.includes(model.id)) throw new Error('TTS_LICENSE_NOT_ACCEPTED');
    const token = model.gated ? getAudioKey('huggingface') : null;
    if (model.gated && !token) throw new Error('TTS_HF_TOKEN_REQUIRED');
    try {
      await this.models.download(model, (status) => this.emit({ kind: 'model', status }), token);
    } finally { void this.emitStatus(); }
    return this.status();
  }

  async deleteModel(modelId: string): Promise<TtsStatus> {
    const model = TTS_MODELS.find((entry) => entry.id === modelId);
    if (!model) throw new Error('TTS_MODEL_UNAVAILABLE');
    await this.models.remove(model);
    void this.emitStatus();
    return this.status();
  }

  async load(modelId = this.selectedModelId()): Promise<TtsStatus> {
    await this.assertModelReady(modelId);
    await this.host.load(modelId);
    return this.status();
  }

  async unload(): Promise<TtsStatus> {
    await this.host.unload();
    return this.status();
  }

  private async assertModelReady(modelId: string): Promise<void> {
    const model = TTS_MODELS.find((entry) => entry.id === modelId);
    if (!model || !(await this.models.isReady(model))) throw new Error('TTS_MODEL_NOT_DOWNLOADED');
    if (model.engine === 'phonon') {
      this.phononRuntime ??= await this.phononInstaller.installed();
      if (!this.phononRuntime) throw new Error('TTS_RUNTIME_NOT_INSTALLED');
      return;
    }
    this.runtime ??= await this.installer.installed();
    if (!this.runtime) throw new Error('TTS_RUNTIME_NOT_INSTALLED');
  }

  async speak(request: TtsSpeakRequest): Promise<TtsSpeakStarted> {
    const text = String(request.text ?? '').trim();
    if (!text) throw new Error('TTS_EMPTY_TEXT');
    const settings = getSettings();
    const modelId = this.selectedModelId();
    await this.assertModelReady(modelId);
    const model = TTS_MODELS.find((entry) => entry.id === modelId)!;
    const phonon = model.engine === 'phonon';
    const voiceId = request.voiceId || (phonon ? settings.ttsPhononVoiceId : settings.ttsVoiceId);
    if (phonon !== voiceId.startsWith('phonon:')) throw new Error('TTS_VOICE_ENGINE_MISMATCH');
    const { ref, language: voiceLanguage } = phonon ? await this.phononVoice(voiceId) : await this.voices.resolve(voiceId);
    const detected = resolveTtsLanguage(request.language ?? settings.ttsLanguage, text, voiceLanguage);
    // A checkpoint only speaks its own languages: a single-language model always uses its one.
    const language = model.languages.includes(detected) ? detected : model.languages[0];
    const started = Date.now();
    const { jobId, done } = this.host.synth(modelId, { text, voice: ref, language, priority: request.priority ?? 0 }, {
      onStart: (id) => this.progress(id, { state: 'generating' }),
      onFragment: (fragment) => {
        const event: TtsFragmentEvent = { jobId: fragment.jobId, index: fragment.index, total: fragment.total, url: liveFragmentUrl(fragment.jobId, fragment.path), durationS: fragment.durationS, genS: fragment.genS };
        this.emit({ kind: 'fragment', fragment: event });
        const job = this.jobs.get(fragment.jobId);
        const finished = fragment.index + 1;
        const audioS = (job?.progress.audioS ?? 0) + fragment.durationS;
        const genS = (job?.progress.genS ?? 0) + fragment.genS;
        const rtf = audioS > 0 ? genS / audioS : null;
        // Remaining time: fragments left × mean generation time per fragment so far.
        const etaS = ((fragment.total - finished) * genS) / finished;
        this.progress(fragment.jobId, { done: finished, total: fragment.total, audioS, genS, rtf, etaS, state: 'generating' });
      },
    });
    this.jobs.set(jobId, { started, progress: { jobId, done: 0, total: 0, audioS: 0, genS: 0, rtf: null, etaS: null, state: 'queued' } });
    void done.then(async (result) => {
      if (result.cancelled) { this.progress(jobId, { state: 'cancelled' }); return; }
      let clip;
      if (request.save && result.fragments.length) {
        const bytes = await concatWavFiles(result.fragments.sort((a, b) => a.index - b.index).map((fragment) => fragment.path));
        clip = await saveClipAsync(request.save.kind, request.save.id, {
          segmentIndex: request.save.segmentIndex, segmentLabel: request.save.segmentLabel,
          provider: 'ming', voice: voiceId, language, bytes,
        });
      }
      this.progress(jobId, { state: 'done', etaS: 0 }, clip);
    }, (error) => {
      this.progress(jobId, { state: 'error', error: error instanceof Error ? error.message : String(error) });
    }).finally(() => {
      this.jobs.delete(jobId);
      // Live fragments outlive the job briefly so playback that is still reading them finishes.
      const dir = path.join(ttsLiveDir(), jobId);
      setTimeout(() => { void fs.rm(dir, { recursive: true, force: true }).catch(() => {}); }, 10 * 60_000).unref?.();
    });
    return { jobId, language, voiceId };
  }

  cancel(jobId: string): void {
    this.host.cancel(jobId);
  }

  private progress(jobId: string, patch: Partial<TtsJobProgress>, clip?: import('@shared/types').AudioClip): void {
    const job = this.jobs.get(jobId);
    const progress: TtsJobProgress = { ...(job?.progress ?? { jobId, done: 0, total: 0, audioS: 0, genS: 0, rtf: null, etaS: null, state: 'queued' }), ...patch };
    if (job) job.progress = progress;
    this.emit({ kind: 'job', progress, ...(clip ? { clip } : {}) });
  }

  async saveVoice(input: TtsVoiceSaveInput) { return this.voices.save(input); }

  /** A Phonon catalogue voice, downloaded on first use (pinned revision, size and SHA-256). */
  private async phononVoice(voiceId: string): Promise<{ ref: TtsVoiceRef; language: import('@shared/ttsModels').TtsLanguage }> {
    const voice = PHONON_VOICES.find((entry) => `phonon:${entry.id}` === voiceId);
    if (!voice) throw new Error('TTS_VOICE_NOT_FOUND');
    const file = path.join(ttsVoicesDir(), 'phonon', `${voice.id}.safetensors`);
    await downloadVerifiedNodusAsset(phononVoiceUrl(voice), file, voice.bytes, voice.sha256, () => {});
    return { ref: { kind: 'embedding', name: voice.id, path: file }, language: voice.language };
  }

  setHuggingFaceToken(token: string): boolean {
    if (token.trim()) setAudioKey('huggingface', token.trim()); else clearAudioKey('huggingface');
    return hasAudioKey('huggingface');
  }

  hasHuggingFaceToken(): boolean { return hasAudioKey('huggingface'); }

  pinClip(clipId: string, pinned: boolean): void { setAudioClipPinned(clipId, pinned); }

  async sweepNow(): Promise<number> {
    return sweepNarrationClips(getSettings().ttsRetention, {
      listExpired: (kind, cutoff, limit) => listExpiredAudioClips(kind, cutoff, limit),
      remove: (id) => deleteClip(id),
    });
  }

  async diskUsage() {
    const [voices, runtime, models] = await Promise.all([directoryBytes(ttsVoicesDir()), directoryBytes(ttsRuntimeDir()), directoryBytes(ttsModelsDir())]);
    return { clips: audioClipBytesByKind(), voices, runtime, models };
  }

  killSync(): void {
    this.host.killSync();
  }
}

let service: TtsService | null = null;
export function ttsService(): TtsService {
  return (service ??= new TtsService());
}
/** For quit paths: only kills a sidecar that was actually started. */
export function killTtsSync(): void {
  service?.killSync();
}
