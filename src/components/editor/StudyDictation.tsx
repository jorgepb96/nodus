import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import type { AppSettings } from '@shared/types';
import { STUDY_STT_LANGUAGES, STUDY_STT_MODELS, WHISPER_CPP_MODELS, buildStudySttPrompt } from '@shared/sttModels';
import { Icon, Spinner } from '../ui';
import { ViewportPopover } from '../world/ViewportPopover';
import { getActiveLang, t } from '../../i18n';
import { localizeRuntimeError } from '@shared/uiLanguage';
import { confirmMicrophonePrivacy } from '../../privacyNotices';
import { createLocalWhisperDictation, decodeWhisperAudio, isLocalWhisperModelReady } from '../../lib/stt/localWhisper';
import { createDictationCapture, type DictationCapture } from '../../lib/stt/dictationCapture';
import { LiveDictationSession } from '../../lib/stt/liveDictation';
import { encodeWavPcm16 } from '../../lib/audio/wav';
import { deleteStudyDictationClip, listStudyDictationClips, saveStudyDictationClip, type StudyDictationClip } from '../../lib/stt/clipStore';

type CaptureState = 'idle' | 'starting' | 'recording' | 'paused' | 'transcribing' | 'error';
type InsertScope = 'cursor' | 'selection';
type LocalModel = { key: string; provider: 'transformers' | 'whisper_cpp'; model: string; label: string };
export interface StudyDictationHandle { start(): Promise<void>; stop(): Promise<void> }

function AudioClipRow({ clip, disabled, canReprocess, onDelete, onReprocess }: {
  clip: StudyDictationClip;
  disabled: boolean;
  canReprocess: boolean;
  onDelete: () => void;
  onReprocess: () => void;
}) {
  const url = useMemo(() => URL.createObjectURL(clip.blob), [clip.blob]);
  useEffect(() => () => URL.revokeObjectURL(url), [url]);
  return (
    <div className="min-w-0 rounded-lg border border-neutral-800 bg-neutral-950/50 p-2">
      <div className="flex min-w-0 items-center gap-2">
        <audio className="h-7 min-w-0 flex-1 [color-scheme:light] dark:[color-scheme:dark]" controls preload="metadata" src={url} />
        <button type="button" className="btn btn-ghost h-7 shrink-0 px-2" disabled={disabled || !canReprocess} aria-label={t('Reprocesar con el modelo actual')} title={t('Reprocesar con el modelo actual')} onClick={onReprocess}><Icon name="refresh" size={11} /></button>
        <button type="button" className="btn btn-ghost h-7 shrink-0 px-2 text-red-400" disabled={disabled} aria-label={t('Eliminar audio local')} title={t('Eliminar audio local')} onClick={onDelete}><Icon name="trash" size={11} /></button>
      </div>
      <p className="mt-1 line-clamp-2 text-[10px] text-neutral-600">{clip.transcript}</p>
      <p className="mt-1 text-[9px] text-neutral-700">{clip.provider === 'openai' ? 'OpenAI' : clip.provider === 'whisper_cpp' ? 'whisper.cpp' : 'ONNX'} · {clip.model} · {new Date(clip.createdAt).toLocaleString()}</p>
    </div>
  );
}

/** Live dictation always stays local, even when recordings use a cloud provider. */
export const StudyDictation = forwardRef<StudyDictationHandle, {
  documentId: string;
  settings: AppSettings;
  language: string;
  vocabulary: string[];
  customDictionary: string[];
  onUpdate(text: string, id: string, final: boolean, scope: InsertScope): void;
  onEnd(): void;
  onStateChange(active: boolean): void;
  onClose(): void;
}>(({ documentId, settings, language, customDictionary, onUpdate, onEnd, onStateChange, onClose }, ref) => {
  const [state, setState] = useState<CaptureState>('idle');
  const [models, setModels] = useState<LocalModel[]>([]);
  const [modelsLoaded, setModelsLoaded] = useState(false);
  const [modelKey, setModelKey] = useState('');
  const [audioLanguage, setAudioLanguage] = useState(language?.split('-')[0] || 'auto');
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [deviceId, setDeviceId] = useState('');
  const [noiseSuppression, setNoiseSuppression] = useState(true);
  const [scope, setScope] = useState<InsertScope>('cursor');
  const [preserveAudio, setPreserveAudio] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [clips, setClips] = useState<StudyDictationClip[]>([]);
  const meter = useRef<HTMLMeterElement>(null);
  const settingsButton = useRef<HTMLButtonElement>(null);
  const [pendingSeconds, setPendingSeconds] = useState(0);
  const [partial, setPartial] = useState('');
  const [error, setError] = useState('');
  const stateRef = useRef<CaptureState>('idle');
  const epoch = useRef(0);
  const mounted = useRef(true);
  const autoStarted = useRef(false);
  const session = useRef<LiveDictationSession | null>(null);
  const capture = useRef<DictationCapture | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const cancelInference = useRef<(() => void) | null>(null);
  const stopping = useRef<Promise<void> | null>(null);
  const onUpdateRef = useRef(onUpdate); onUpdateRef.current = onUpdate;
  const onEndRef = useRef(onEnd); onEndRef.current = onEnd;
  const onStateRef = useRef(onStateChange); onStateRef.current = onStateChange;
  const active = state !== 'idle' && state !== 'error';
  const selected = models.find(model => model.key === modelKey);

  const changeState = (next: CaptureState) => {
    stateRef.current = next;
    if (mounted.current) setState(next);
    onStateRef.current(next !== 'idle' && next !== 'error');
  };
  const releaseCapture = () => {
    const current = capture.current; capture.current = null;
    stream.current?.getTracks().forEach(track => track.stop()); stream.current = null;
    if (meter.current) meter.current.value = 0;
    return current?.close().catch(() => undefined) ?? Promise.resolve();
  };
  const cancel = () => {
    epoch.current++;
    stopping.current = null;
    session.current?.cancel(); session.current = null;
    onEndRef.current();
    cancelInference.current?.(); cancelInference.current = null;
    void releaseCapture();
    if (mounted.current) { setPartial(''); setPendingSeconds(0); changeState('idle'); }
  };
  const fail = (cause: unknown, token: number) => {
    if (!mounted.current || token !== epoch.current) return;
    cancel();
    setError(localizeRuntimeError(cause instanceof Error ? cause.message : String(cause), getActiveLang()));
    changeState('error');
  };
  const reloadClips = async () => {
    const saved = await listStudyDictationClips(documentId);
    if (mounted.current) setClips(saved);
  };
  const refreshDevices = async () => {
    const listed = await navigator.mediaDevices?.enumerateDevices();
    if (mounted.current) setDevices((listed ?? []).filter(device => device.kind === 'audioinput'));
  };
  useEffect(() => {
    mounted.current = true;
    void reloadClips().catch(() => undefined);
    void refreshDevices().catch(() => undefined);
    const media = navigator.mediaDevices;
    media?.addEventListener('devicechange', refreshDevices);
    return () => {
      mounted.current = false;
      cancel();
      onStateRef.current(false);
      media?.removeEventListener('devicechange', refreshDevices);
    };
  }, [documentId]);
  useEffect(() => {
    let alive = true;
    void window.nodus.getWhisperCppStatus().catch(() => null).then(status => {
      if (!alive) return;
      const available: LocalModel[] = [
        ...STUDY_STT_MODELS.filter(model => isLocalWhisperModelReady(model.id)).map(model => ({ key: `transformers:${model.id}`, provider: 'transformers' as const, model: model.id, label: `ONNX · ${model.label}` })),
        ...WHISPER_CPP_MODELS.filter(model => status?.executableReady && status.models.some(entry => entry.id === model.id && entry.downloaded)).map(model => ({ key: `whisper_cpp:${model.id}`, provider: 'whisper_cpp' as const, model: model.id, label: `whisper.cpp · ${model.label}` })),
      ];
      setModels(available);
      if (stateRef.current === 'idle' || stateRef.current === 'error') {
        const preferred = `${settings.sttProvider}:${settings.sttProvider === 'whisper_cpp' ? settings.sttWhisperCppModel : settings.sttTransformersModel}`;
        setModelKey(current => available.some(model => model.key === current) ? current : available.find(model => model.key === preferred)?.key ?? available[0]?.key ?? '');
      }
      setModelsLoaded(true);
    });
    return () => { alive = false; };
  }, [settings.sttProvider, settings.sttTransformersModel, settings.sttWhisperCppModel]);

  const stop = (): Promise<void> => {
    if (stopping.current) return stopping.current;
    if (stateRef.current === 'starting') { cancel(); return Promise.resolve(); }
    if (!['recording', 'paused'].includes(stateRef.current)) return Promise.resolve();
    const token = epoch.current;
    const current = session.current;
    changeState('transcribing');
    const operation = (async () => {
      await capture.current?.pause(); // receive the last PCM frames before flushing
      if (token !== epoch.current) return;
      await releaseCapture();
      await current?.stop();
      if (token !== epoch.current) return;
      onEndRef.current();
      cancelInference.current?.(); cancelInference.current = null;
      session.current = null;
      changeState('idle');
    })();
    const completed = operation.finally(() => { if (stopping.current === completed) stopping.current = null; });
    stopping.current = completed;
    return completed;
  };

  const start = async (clip?: StudyDictationClip) => {
    if (!['idle', 'error'].includes(stateRef.current) || !selected) return;
    const token = ++epoch.current;
    const valid = () => mounted.current && token === epoch.current;
    const model = selected;
    setError(''); setPartial(''); setPendingSeconds(0); changeState('starting');
    const cppRequest = `scriptor-dictation-${crypto.randomUUID()}`;
    const local = model.provider === 'transformers' ? createLocalWhisperDictation(model.model, audioLanguage) : null;
    cancelInference.current = () => {
      local?.cancel();
      if (cppRequest) void window.nodus.cancelStudyTranscription(cppRequest).catch(() => undefined);
    };
    try {
      if (local) {
        try { await local.prepare(); }
        catch { throw new Error(t('Descarga el modelo ONNX seleccionado desde Ajustes antes de transcribir.')); }
      }
      if (!valid()) return;
      const cppOptions = { requestId: cppRequest, realtime: !clip, allowEmpty: true, mimeType: 'audio/wav', provider: 'whisper_cpp' as const, model: model.model, language: audioLanguage, prompt: buildStudySttPrompt(customDictionary) };
      const transcribe = async (samples: Float32Array, onPartial: (text: string) => void) => {
        if (local) return local.transcribe(samples, onPartial);
        const result = await window.nodus.transcribeStudyAudio({ ...cppOptions, audioBytes: encodeWavPcm16(samples, 16_000) }, { onPartial });
        return result.text;
      };
      if (clip) {
        changeState('transcribing');
        const text = await transcribe(await decodeWhisperAudio(clip.blob), value => { if (valid()) setPartial(value); });
        if (!valid()) return;
        await saveStudyDictationClip({ ...clip, transcript: text, provider: model.provider, model: model.model });
        await reloadClips();
        if (!valid()) return;
        cancelInference.current?.(); cancelInference.current = null;
        changeState('idle'); return;
      }
      if (!(await confirmMicrophonePrivacy()) || !valid()) { if (valid()) cancel(); return; }
      if (!local) await window.nodus.transcribeStudyAudio({ ...cppOptions, audioBytes: new Uint8Array() });
      if (!valid()) return;
      const microphone = await navigator.mediaDevices.getUserMedia({ audio: { deviceId: deviceId ? { exact: deviceId } : undefined, noiseSuppression, echoCancellation: noiseSuppression, autoGainControl: true } });
      if (!valid()) { microphone.getTracks().forEach(track => track.stop()); return; }
      stream.current = microphone;
      // A disconnected microphone ends capture and drains all speech already queued.
      microphone.getAudioTracks().forEach(track => track.addEventListener('ended', () => { if (valid()) void stop(); }, { once: true }));
      let first = true;
      const input = await createDictationCapture(microphone, samples => {
        if (!valid()) return;
        let energy = 0; for (const value of samples) energy += value * value;
        if (meter.current) meter.current.value = Math.min(1, Math.sqrt(energy / samples.length) * 7);
        session.current?.push(samples);
      });
      if (!valid()) { await input.close(); microphone.getTracks().forEach(track => track.stop()); return; }
      if (input.sampleRate !== 16_000) { await input.close(); throw new Error(t('No se pudo iniciar el micrófono.')); }
      capture.current = input;
      session.current = new LiveDictationSession({
        sampleRate: input.sampleRate, transcribe,
        onUpdate: (text, id, final) => {
          if (!valid()) return;
          onUpdateRef.current(text, `${token}-${id}`, final, first ? scope : 'cursor');
          if (text) first = false;
        },
        onPending: value => { if (valid()) setPendingSeconds(value); },
        onBackpressure: () => {
          if (!valid()) return;
          void input.pause(); if (meter.current) meter.current.value = 0; changeState('paused');
          setError(t('Dictado pausado para terminar el audio pendiente. Reanuda cuando esté listo.'));
        },
        onError: cause => fail(cause, token),
        onText: async (text, samples) => {
          if (!valid()) return;
          if (preserveAudio) {
            const bytes = encodeWavPcm16(samples, 16_000);
            await saveStudyDictationClip({ id: crypto.randomUUID(), documentId, createdAt: new Date().toISOString(), mimeType: 'audio/wav', provider: model.provider, model: model.model, transcript: text, anchorText: text, anchorFrom: null, anchorTo: null, blob: new Blob([bytes as Uint8Array<ArrayBuffer>], { type: 'audio/wav' }) });
            if (valid()) await reloadClips();
          }
        },
      });
      changeState('recording');
      void refreshDevices().catch(() => undefined);
    } catch (cause) { fail(cause, token); }
  };
  useImperativeHandle(ref, () => ({ start: () => start(), stop }));
  useEffect(() => {
    if (!modelsLoaded || autoStarted.current) return;
    autoStarted.current = true;
    if (selected) void start();
  }, [modelsLoaded, modelKey]);

  const togglePause = async () => {
    const token = epoch.current;
    if (stateRef.current === 'recording') {
      await capture.current?.pause();
      // Show Resume only once capture has flushed and the session can resume.
      // A stop/cancel during that flush must not switch the UI back to Paused.
      if (token !== epoch.current || stateRef.current !== 'recording') return;
      session.current?.pause(); if (meter.current) meter.current.value = 0;
      changeState('paused');
    } else if (stateRef.current === 'paused' && session.current?.resume()) {
      setError(''); capture.current?.resume(); changeState('recording');
    }
  };

  return <div className="border-b border-stone-200 bg-white px-3 py-2 dark:border-neutral-800 dark:bg-neutral-950" data-testid="study-dictation">
    <div className="flex flex-wrap items-center gap-2">
      {!active ? <button type="button" data-testid="study-dictation-start" className="btn btn-primary h-8" disabled={!selected || !modelsLoaded} onClick={() => void start()}><Icon name="microphone" size={13} />{t('Dictar')}</button>
        : state === 'starting' || state === 'transcribing' ? <Spinner label={t(state === 'starting' ? 'Preparando dictado…' : 'Transcribiendo…')} />
        : <>
          <button type="button" data-testid="study-dictation-pause" className="btn btn-ghost h-8" onClick={() => void togglePause()}><Icon name={state === 'paused' ? 'play' : 'pause'} size={12} />{t(state === 'paused' ? 'Reanudar' : 'Pausar')}</button>
          <button type="button" data-testid="study-dictation-stop" className="btn btn-primary h-8" onClick={() => void stop()}><Icon name="stop" size={12} />{t('Detener dictado')}</button>
        </>}
      {active && <button type="button" data-testid="study-dictation-discard" className="btn btn-ghost h-8" onClick={cancel}><Icon name="x" size={12} />{t('Cancelar dictado')}</button>}
      <span className="scriptor-accent-badge rounded-full px-2 py-1 text-[10px]">{t('Dictado en directo · Local')}</span>
      <span className="text-[10px] text-neutral-500" role="status" data-testid="study-dictation-status">{t(state === 'recording' ? 'Escuchando…' : state === 'paused' ? 'Pausado' : state === 'transcribing' ? 'Transcribiendo…' : 'El texto se inserta automáticamente en el cursor.')}</span>
      {(state === 'recording' || state === 'paused') && <meter ref={meter} aria-label={t('Nivel del micrófono')} min={0} max={1} defaultValue={0} className="h-3 w-20" />}
      <button ref={settingsButton} type="button" className="btn btn-ghost ml-auto h-8 px-2" aria-haspopup="dialog" aria-expanded={showSettings} aria-label={t('Opciones de dictado')} title={t('Opciones de dictado')} onClick={() => setShowSettings(!showSettings)}><Icon name="settings" size={12} /></button>
      <button type="button" className="btn btn-ghost h-8 px-2" aria-label={t('Cerrar')} title={t('Cerrar')} onClick={onClose}><Icon name="x" size={12} /></button>
    </div>
    {modelsLoaded && !models.length && <p role="status" className="mt-2 text-xs text-neutral-500">{t('Descarga un modelo local de transcripción en Ajustes → Modelos IA para dictar.')}</p>}
    <span className="sr-only" data-testid="study-dictation-partial">{partial}</span>
    <span className="sr-only">{t('Audio pendiente')}: {Math.ceil(pendingSeconds)} s</span>
    {error && <p role="alert" className="mt-2 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700 dark:bg-red-950/30 dark:text-red-300">{error}</p>}
    <ViewportPopover anchorRef={settingsButton} open={showSettings} onDismiss={() => setShowSettings(false)} width={380} estimatedHeight={350} className="study-dictation-popover rounded-xl border border-stone-200 bg-white p-4 shadow-xl dark:border-neutral-700 dark:bg-neutral-900" testId="study-dictation-settings">
    <div role="dialog" aria-label={t('Opciones de dictado')} className="grid grid-cols-1 gap-3">
      <div className="flex items-center justify-between"><b className="text-sm">{t('Opciones de dictado')}</b><button className="btn btn-ghost h-7 px-2" aria-label={t('Cerrar')} onClick={() => { setShowSettings(false); settingsButton.current?.focus(); }}><Icon name="x" size={12} /></button></div>
      <label className="text-xs text-neutral-500">{t('Modelo local')}<select data-testid="study-dictation-model" className="input mt-1 w-full" disabled={active} value={modelKey} onChange={event => setModelKey(event.target.value)}>{models.map(model => <option key={model.key} value={model.key}>{model.label}</option>)}</select></label>
      <label className="text-xs text-neutral-500">{t('Idioma del audio')}<select data-testid="study-dictation-language" className="input mt-1 w-full" disabled={active} value={audioLanguage} onChange={event => setAudioLanguage(event.target.value)}>{STUDY_STT_LANGUAGES.map(entry => <option key={entry.code} value={entry.code}>{t(entry.label)}</option>)}</select></label>
      <label className="text-xs text-neutral-500">{t('Micrófono')}<select className="input mt-1 w-full" disabled={active} value={deviceId} onChange={event => setDeviceId(event.target.value)}><option value="">{t('Predeterminado')}</option>{devices.map((device, index) => <option key={device.deviceId || index} value={device.deviceId}>{device.label || `${t('Micrófono')} ${index + 1}`}</option>)}</select></label>
      <label className="text-xs text-neutral-500">{t('Insertar')}<select className="input mt-1 w-full" disabled={active} value={scope} onChange={event => setScope(event.target.value as InsertScope)}><option value="cursor">{t('Insertar en el cursor')}</option><option value="selection">{t('Sustituir selección/bloque')}</option></select></label>
      <label className="flex items-center gap-2 text-xs text-neutral-500"><input type="checkbox" disabled={active} checked={noiseSuppression} onChange={event => setNoiseSuppression(event.target.checked)} />{t('Reducción de ruido y eco')}</label>
      <label className="flex items-center gap-2 text-xs text-neutral-500"><input type="checkbox" disabled={active} checked={preserveAudio} onChange={event => setPreserveAudio(event.target.checked)} />{t('Conservar audio original local')}</label>
      <p className="text-[10px] text-neutral-500">{t('El motor, el modelo y las descargas se gestionan desde Ajustes → Modelos IA.')}</p>
      {clips.length > 0 && <div className="min-w-0 space-y-2"><h4 className="text-xs text-neutral-500">{t('Audios de dictado de este apunte')}</h4>{clips.map(clip => <AudioClipRow key={clip.id} clip={clip} disabled={active} canReprocess={Boolean(selected)} onDelete={() => void deleteStudyDictationClip(clip.id).then(reloadClips).catch(cause => setError(String(cause)))} onReprocess={() => { if (!active) void start(clip); }} />)}</div>}
    </div></ViewportPopover>
  </div>;
});
