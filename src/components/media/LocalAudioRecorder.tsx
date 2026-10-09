import { useEffect, useRef, useState } from 'react';
import { Icon } from '../ui';
import { confirmMicrophonePrivacy } from '../../privacyNotices';
import { bestRecorderMime, blobDuration, formatMediaTimestamp, recorderExtension, type MediaAccent } from './mediaFormat';
import { t } from '../../i18n';

/**
 * La captura de audio local, extraída de `StudyRecordingsView` para que Estudio y
 * Testimonios graben con el mismo motor.
 *
 * ES EL ÚNICO SITIO DE LA APLICACIÓN QUE PIDE EL MICRÓFONO ADEMÁS DEL DICTADO, y por eso
 * el aviso de privacidad va aquí, antes de `getUserMedia`, no en cada pantalla que lo
 * use. Un test recorre todo `src/` y comprueba que ningún otro archivo abra el micrófono
 * sin ese aviso delante.
 *
 * Se reparte en un HOOK y un PANEL en vez de un solo componente porque el botón de
 * empezar y el panel en directo viven en sitios distintos de la pantalla, y obligarlos a
 * salir del mismo nodo habría cambiado la maquetación de Estudio al extraerlo — que es
 * justamente lo que esta extracción no puede permitirse.
 *
 * `allowSilenceTrim` es la diferencia crítica entre los dos verticales, y no es una
 * preferencia: en una clase, saltarse los silencios largos ahorra archivo; EN HISTORIA
 * ORAL UNA PAUSA PUEDE SER PARTE DEL SENTIDO de lo que se está contando, y recortarla
 * altera la fuente y desplaza todos los códigos de tiempo de la transcripción. Por eso
 * Testimonios no pasa la opción: no es que venga desactivada, es que no existe.
 */
export type CaptureState = 'idle' | 'recording' | 'paused' | 'saving';

export interface RecordedAudio {
  bytes: Uint8Array;
  fileName: string;
  mimeType: string;
  durationSeconds: number;
}

export interface LocalAudioRecorderHandle {
  state: CaptureState;
  seconds: number;
  level: number;
  trimSilence: boolean;
  setTrimSilence: (value: boolean) => void;
  start: () => Promise<void>;
  togglePause: () => void;
  finish: (discard?: boolean) => Promise<void>;
}

export function useLocalAudioRecorder({
  fileBaseName,
  allowSilenceTrim = false,
  onError,
  onSaved,
}: {
  /** Prefijo del nombre de archivo generado (`clase-…`, `entrevista-…`). */
  fileBaseName: string;
  allowSilenceTrim?: boolean;
  onError: (message: string) => void;
  onSaved: (audio: RecordedAudio) => Promise<void> | void;
}): LocalAudioRecorderHandle {
  const [state, setState] = useState<CaptureState>('idle');
  const [seconds, setSeconds] = useState(0);
  const [level, setLevel] = useState(0);
  const [trimSilence, setTrimSilence] = useState(allowSilenceTrim);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<number | null>(null);
  const animationRef = useRef<number | null>(null);
  const contextRef = useRef<AudioContext | null>(null);
  const silenceSinceRef = useRef<number | null>(null);
  const autoPausedRef = useRef(false);
  const manuallyPausedRef = useRef(false);
  const trimRef = useRef(trimSilence);
  trimRef.current = trimSilence;
  const stateRef = useRef(state);
  stateRef.current = state;

  // Starting awaits the privacy notice and the microphone permission; a recorder whose view
  // closed meanwhile must not open the microphone afterwards with nothing left to stop it.
  const mountedRef = useRef(true);
  useEffect(() => { mountedRef.current = true; return () => { mountedRef.current = false; }; }, []);

  useEffect(() => () => {
    if (timerRef.current) window.clearInterval(timerRef.current);
    if (animationRef.current) cancelAnimationFrame(animationRef.current);
    if (recorderRef.current && recorderRef.current.state !== 'inactive') recorderRef.current.stop();
    streamRef.current?.getTracks().forEach((track) => track.stop());
    void contextRef.current?.close();
  }, []);

  const cleanup = async (): Promise<void> => {
    if (timerRef.current) window.clearInterval(timerRef.current);
    timerRef.current = null;
    if (animationRef.current) cancelAnimationFrame(animationRef.current);
    animationRef.current = null;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    recorderRef.current = null;
    setLevel(0);
    if (contextRef.current) await contextRef.current.close().catch(() => undefined);
    contextRef.current = null;
    silenceSinceRef.current = null;
    autoPausedRef.current = false;
    manuallyPausedRef.current = false;
  };

  const startLevelMeter = (stream: MediaStream): void => {
    const context = new AudioContext();
    contextRef.current = context;
    const analyser = context.createAnalyser();
    analyser.fftSize = 512;
    context.createMediaStreamSource(stream).connect(analyser);
    const values = new Uint8Array(analyser.fftSize);
    const frame = () => {
      analyser.getByteTimeDomainData(values);
      let sum = 0;
      for (const value of values) {
        const centered = (value - 128) / 128;
        sum += centered * centered;
      }
      const rms = Math.sqrt(sum / values.length);
      setLevel(Math.min(1, rms * 7));
      const recorder = recorderRef.current;
      if (allowSilenceTrim && trimRef.current && recorder && !manuallyPausedRef.current) {
        if (rms < 0.014) silenceSinceRef.current ??= performance.now();
        else silenceSinceRef.current = null;
        if (!autoPausedRef.current && silenceSinceRef.current && performance.now() - silenceSinceRef.current > 1800 && recorder.state === 'recording') {
          recorder.pause();
          autoPausedRef.current = true;
        } else if (autoPausedRef.current && rms >= 0.02 && recorder.state === 'paused') {
          recorder.resume();
          autoPausedRef.current = false;
          silenceSinceRef.current = null;
        }
      }
      animationRef.current = requestAnimationFrame(frame);
    };
    frame();
  };

  const start = async (): Promise<void> => {
    onError('');
    setSeconds(0);
    if (!(await confirmMicrophonePrivacy()) || !mountedRef.current) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { noiseSuppression: true, echoCancellation: true, autoGainControl: true },
      });
      if (!mountedRef.current) { stream.getTracks().forEach((track) => track.stop()); return; }
      streamRef.current = stream;
      const mime = bestRecorderMime();
      const recorder = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
      recorderRef.current = recorder;
      chunksRef.current = [];
      recorder.ondataavailable = (event) => { if (event.data.size) chunksRef.current.push(event.data); };
      recorder.start(1000);
      setState('recording');
      startLevelMeter(stream);
      timerRef.current = window.setInterval(
        () => setSeconds((value) => value + (recorder.state === 'recording' ? 1 : 0)),
        1000,
      );
    } catch (cause) {
      onError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  const togglePause = (): void => {
    const recorder = recorderRef.current;
    if (!recorder) return;
    if (stateRef.current === 'recording') {
      recorder.pause();
      manuallyPausedRef.current = true;
      setState('paused');
    } else {
      recorder.resume();
      manuallyPausedRef.current = false;
      autoPausedRef.current = false;
      setState('recording');
    }
  };

  const finish = async (discard = false): Promise<void> => {
    const recorder = recorderRef.current;
    if (!recorder || recorder.state === 'inactive') return;
    setState('saving');
    const blob = await new Promise<Blob>((resolve) => {
      recorder.addEventListener(
        'stop',
        () => resolve(new Blob(chunksRef.current, { type: recorder.mimeType || 'audio/webm' })),
        { once: true },
      );
      recorder.requestData();
      recorder.stop();
    });
    await cleanup();
    if (discard) {
      setState('idle');
      setSeconds(0);
      return;
    }
    try {
      const mimeType = blob.type || 'audio/webm';
      await onSaved({
        bytes: new Uint8Array(await blob.arrayBuffer()),
        fileName: `${fileBaseName}-${Date.now()}.${recorderExtension(mimeType)}`,
        mimeType,
        durationSeconds: await blobDuration(blob),
      });
    } catch (cause) {
      onError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setState('idle');
      setSeconds(0);
    }
  };

  return { state, seconds, level, trimSilence, setTrimSilence, start, togglePause, finish };
}

/** El panel en directo: cronómetro, medidor de nivel y los tres controles. */
export function LocalAudioRecorderPanel({
  recorder,
  accent,
  allowSilenceTrim = false,
  testid = 'local-audio-recorder',
}: {
  recorder: LocalAudioRecorderHandle;
  accent: MediaAccent;
  allowSilenceTrim?: boolean;
  testid?: string;
}) {
  if (recorder.state === 'idle') return null;
  return (
    <section className={`rounded-xl border p-4 ${accent.panel}`} data-testid={testid}>
      <div className="flex flex-wrap items-center gap-3">
        <span className={`h-3 w-3 rounded-full ${recorder.state === 'recording' ? 'animate-pulse bg-red-500' : 'bg-amber-400'}`} />
        <strong data-testid={`${testid}-elapsed`}>{formatMediaTimestamp(recorder.seconds)}</strong>
        <div className="h-2 min-w-32 flex-1 overflow-hidden rounded-full bg-neutral-200 dark:bg-neutral-800">
          <div className={`h-full transition-[width] ${accent.bar}`} style={{ width: `${recorder.level * 100}%` }} />
        </div>
        {allowSilenceTrim && (
          <label className="flex items-center gap-2 text-xs text-neutral-400">
            <input type="checkbox" checked={recorder.trimSilence} onChange={(event) => recorder.setTrimSilence(event.target.checked)} />
            {t('Omitir silencios largos')}
          </label>
        )}
        {recorder.state !== 'saving' && (
          <button className="btn btn-secondary" onClick={recorder.togglePause}>
            <Icon name={recorder.state === 'paused' ? 'play' : 'pause'} />
            {recorder.state === 'paused' ? t('Reanudar') : t('Pausar')}
          </button>
        )}
        <button className="btn btn-primary" disabled={recorder.state === 'saving'} onClick={() => void recorder.finish()}>
          <Icon name="stop" />{t('Guardar')}
        </button>
        <button className="btn btn-ghost" disabled={recorder.state === 'saving'} onClick={() => void recorder.finish(true)}>
          {t('Descartar')}
        </button>
      </div>
    </section>
  );
}
