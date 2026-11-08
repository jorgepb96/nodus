// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Binds the pure podcast lane (./podcastQueue) and pipeline (./podcastCore) to the real
 * research engines, the text model, the local TTS sidecar, the encoder window, the database
 * and the app windows. Whoever needs the lane first (IPC) wires it.
 */
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { app, BrowserWindow } from 'electron';
import { blendWpm, measuredWpm, podcastEngineOf, podcastPlanningWpm, type PodcastJob, type PodcastRequest } from '@shared/podcast';
import { nodiText } from '@shared/nodiNotifications';
import type { VaultType } from '@shared/vaultTypes';
import { getSettings } from '../db/settingsRepo';
import { openDbPath } from '../db/database';
import { getActiveVault, listVaults } from '../vaults/vaultRegistry';
import { addNotification } from '../notifications';
import { completeJson } from '../ai/aiClient';
import { withJobOutputLanguage } from '../ai/jobOutputLanguage';
import { withJobThinkingEffort } from '../ai/thinkingEffort';
import { ttsService } from '../tts/service';
import { WavFileAssembler } from '../tts/wavConcat';
import { audioDir } from '../audio/audioPaths';
import { podcastAudioFile, savePodcastEpisode } from '../db/podcastRepo';
import { buildPodcastScript, recordScript, speechSeconds } from './podcastCore';
import { gatherAcademicEvidence, gatherStudyEvidence } from './podcastEvidence';
import { encodePodcastWav } from './podcastEncoder';
import { queuePodcastImages } from './podcastImages';
import { PodcastQueue, type PodcastRunContext, type PodcastRunOutcome } from './podcastQueue';

/** The vault types that have a podcast research engine in this version. */
export const PODCAST_VAULT_TYPES = ['academic', 'estudio', 'docencia'] as const;

function servingVault(): { id: string; name: string; type: VaultType } {
  const registryActive = getActiveVault();
  const open = openDbPath();
  const match = open ? listVaults().find((vault) => path.resolve(vault.path) === path.resolve(open)) : null;
  const vault = match ?? registryActive;
  return { id: vault.id, name: vault.name, type: vault.type };
}

function broadcast(channel: string, payload: unknown): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed() && !win.webContents.isDestroyed()) win.webContents.send(channel, payload);
  }
}

const userFile = (name: string) => path.join(app.getPath('userData'), name);

function readJson<T>(file: string, fallback: T): T {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')) as T; } catch { return fallback; }
}

function writeJsonAtomic(file: string, value: unknown): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(value), { encoding: 'utf8', mode: 0o600 });
  fs.renameSync(temporary, file);
}

// ── Speaking pace, measured per model and voices ─────────────────────────────

const PACE_FILE = 'podcast-pace.v1.json';
const paceKey = (request: Pick<PodcastRequest, 'ttsModelId' | 'hosts'>) => `${request.ttsModelId}|${request.hosts.map((host) => host.voiceId).sort().join('+')}`;

/** The pace to plan this request with: measured for these voices, else the engine's own. */
function readPace(request: PodcastRequest): number {
  const pace = readJson<Record<string, number>>(userFile(PACE_FILE), {});
  return podcastPlanningWpm(podcastEngineOf(request.hosts[0]?.voiceId ?? ''), pace[paceKey(request)]);
}

function storePace(request: PodcastRequest, wpm: number): number {
  const file = userFile(PACE_FILE);
  const pace = readJson<Record<string, number>>(file, {});
  const next = blendWpm(pace[paceKey(request)], wpm);
  pace[paceKey(request)] = next;
  try { writeJsonAtomic(file, pace); } catch { /* calibration is a nicety */ }
  return next;
}

// ── The job ──────────────────────────────────────────────────────────────────

const anyJson = (value: unknown): value is unknown => value !== undefined;

function podcastsDir(): string {
  const dir = path.join(audioDir(), 'podcasts');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/** Absolute path of an episode's audio, or null when the row or the file is missing. */
export function podcastAudioPath(episodeId: string): string | null {
  try {
    const found = podcastAudioFile(episodeId);
    if (!found) return null;
    const root = audioDir();
    const file = path.join(root, found.file);
    return path.relative(root, file).startsWith('..') ? null : file;
  } catch {
    return null;
  }
}

async function runPodcastJob(job: PodcastJob, context: PodcastRunContext): Promise<PodcastRunOutcome> {
  const { request } = job;
  const vault = servingVault();
  if (vault.id !== job.vaultId) throw new Error('PODCAST_VAULT_CHANGED');
  if (!(PODCAST_VAULT_TYPES as readonly VaultType[]).includes(vault.type)) throw new Error('PODCAST_VAULT_UNSUPPORTED');
  const settings = getSettings();
  const model = request.model ?? settings.deepResearchModel ?? settings.synthesisModel;
  const modelLabel = model ? `${model.provider}:${model.model}` : undefined;
  return withJobOutputLanguage(request.language, () => withJobThinkingEffort(request.thinkingEffort, model, async () => {
    const built = await buildPodcastScript(request, job.checkpoint ?? {}, {
      gatherEvidence: (req, signal, report) => vault.type === 'academic' ? gatherAcademicEvidence(req, model ?? null, signal, report) : gatherStudyEvidence(req, signal, report),
      json: (call) => completeJson({ system: call.system, user: call.user, maxTokens: call.maxTokens, temperature: call.temperature, signal: call.signal }, anyJson, model),
      wpm: readPace,
      progress: context.progress,
      checkpoint: (checkpoint) => context.checkpoint({ ...checkpoint, writtenWith: checkpoint.writtenWith ?? modelLabel }),
    }, context.signal);
    context.title(built.plan.title);
    if (request.reviewScript) return { outcome: 'awaiting_review' } as const;

    // Recording: one TTS job per turn into a WAV on disk, never the whole episode in memory.
    const workDir = userFile(path.join('podcast-work', job.id));
    await fsp.rm(workDir, { recursive: true, force: true });
    await fsp.mkdir(workDir, { recursive: true });
    const assembler = new WavFileAssembler(path.join(workDir, 'episode.wav'));
    try {
      const tts = ttsService();
      const wpm = readPace(request);
      const timeline = await recordScript(request, built.plan, built.script, wpm, {
        synthesize: async (text, voiceId, signal) => (await tts.synthesize({ text, voiceId, modelId: request.ttsModelId, language: request.language, priority: -10 }, signal)).fragments.map((fragment) => fragment.path),
        append: (paths, gapBeforeMs) => assembler.append(paths, gapBeforeMs),
        progress: context.progress,
      }, context.signal);
      const assembled = await assembler.finish();
      if (!assembled) throw new Error('PODCAST_NOTHING_RECORDED');

      context.progress({ phase: 'encoding' });
      const episodeId = `pod-${randomUUID()}`;
      const encoded = await encodePodcastWav(path.join(workDir, 'episode.wav'), path.join(podcastsDir(), episodeId), {
        title: built.plan.title,
        chapters: timeline.chapters.map((chapter) => ({ startS: chapter.startS, title: chapter.title })),
      }, context.signal, (fraction) => context.progress({ phase: 'encoding', done: Math.round(fraction * 100), total: 100 }));

      context.progress({ phase: 'saving' });
      if (servingVault().id !== job.vaultId) {
        await fsp.rm(encoded.file, { force: true });
        throw new Error('PODCAST_VAULT_CHANGED');
      }
      const measured = measuredWpm(built.script, speechSeconds(timeline));
      const textModel = job.checkpoint?.writtenWith ?? modelLabel;
      const engine = podcastEngineOf(request.hosts[0].voiceId) ?? 'kokoro';
      savePodcastEpisode({
        id: episodeId,
        title: built.plan.title,
        request,
        plan: built.plan,
        script: built.script,
        sources: built.evidence.sources,
        researchLog: built.evidence.log,
        timeline,
        durationS: assembled.durationS,
        audioFile: path.relative(audioDir(), encoded.file),
        audioMime: encoded.mime,
        audioBytes: encoded.bytes,
        generation: {
          ...(textModel ? { textModel } : {}),
          ttsModelId: request.ttsModelId,
          engine,
          codec: encoded.codec,
          ...(measured ? { wordsPerMinute: storePace(request, measured) } : {}),
        },
      });
      broadcast('podcast:changed', { episodeId });
      queuePodcastImages({
        episodeId,
        title: built.plan.title,
        images: built.plan.images,
        style: request.imageStyle,
        vaultType: vault.type,
        onChanged: () => broadcast('podcast:changed', { episodeId }),
      });
      return { outcome: 'done', episodeId } as const;
    } catch (error) {
      await assembler.abort().catch(() => {});
      throw error;
    } finally {
      await fsp.rm(workDir, { recursive: true, force: true }).catch(() => {});
    }
  }, context.signal));
}

function announce(job: PodcastJob): void {
  const title = job.title || job.request.objective.slice(0, 80);
  if (job.status === 'done') {
    addNotification({ title: nodiText('podcastDoneTitle'), body: nodiText('podcastDoneBody', { title }), kind: 'success', dedupeKey: `podcast:${job.id}` });
  } else if (job.status === 'failed') {
    addNotification({ title: nodiText('podcastFailedTitle'), body: nodiText('podcastFailedBody', { title }), kind: 'warning', dedupeKey: `podcast:${job.id}` });
  } else if (job.status === 'awaiting_review') {
    addNotification({ title: nodiText('podcastReviewTitle'), body: nodiText('podcastReviewBody', { title }), kind: 'info', dedupeKey: `podcast-review:${job.id}` });
  }
}

let queue: PodcastQueue | null = null;

export function podcastLane(): PodcastQueue {
  if (queue) return queue;
  queue = new PodcastQueue({
    activeVault: servingVault,
    run: runPodcastJob,
    load: () => {
      const jobs = readJson<unknown>(userFile('podcast-queue.v1.json'), []);
      return Array.isArray(jobs) ? jobs as PodcastJob[] : [];
    },
    persist: (jobs) => writeJsonAtomic(userFile('podcast-queue.v1.json'), jobs),
    onChange: (jobs) => broadcast('podcast:queue', jobs),
    onSettled: announce,
  });
  void queue.drain();
  return queue;
}

export function isPodcastLaneBusy(): boolean {
  return queue?.busy() ?? false;
}
