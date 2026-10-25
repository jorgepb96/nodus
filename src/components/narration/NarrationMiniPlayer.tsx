import { useEffect, useState } from 'react';
import type { TtsStatus } from '@shared/ttsModels';
import { Icon } from '../ui';
import { useAudioPlayer } from '../AudioPlayer';
import { ProgressTrack, formatClock } from './ProgressTrack';
import { subscribeTtsStatus } from '../../lib/narration/ttsClient';
import { t, tx } from '../../i18n';

/**
 * The narration controls in the header's sound balloon: what is playing and where it came
 * from, transport, a seek bar that also shows how much is already generated, speed, stop,
 * generation progress with cancel, and whether the model is in memory.
 */
export function NarrationMiniPlayer() {
  const player = useAudioPlayer();
  const [status, setStatus] = useState<TtsStatus | null>(null);
  useEffect(() => subscribeTtsStatus(setStatus), []);
  const generation = player.generation;
  const generating = generation && (generation.state === 'queued' || generation.state === 'loading' || generation.state === 'generating');
  const { playedS, generatedS, totalS } = player.timeline;
  const track = player.tracks[player.index];
  const engineActive = status?.engine.state === 'ready' || status?.engine.state === 'busy';

  const seekFraction = (fraction: number) => {
    // Seek across the whole narration: find the track that holds that moment.
    let target = fraction * totalS;
    for (let i = 0; i < player.tracks.length; i += 1) {
      const length = player.tracks[i].durationS ?? 0;
      if (target <= length || i === player.tracks.length - 1) {
        if (i === player.index) player.seek(target);
        else if (target <= generatedS) {
          // Jumping to another generated fragment: play it, then offset.
          player.play(player.tracks, i, player.source ?? undefined);
          window.setTimeout(() => player.seek(target), 60);
        }
        return;
      }
      target -= length;
    }
  };

  // One minmax(0,1fr) column: an implicit auto column grows to a truncated title's full
  // width (a long chat question) and pushes the close button and controls out of the balloon.
  return (
    <div data-testid="narration-mini-player" className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-2 p-1 text-xs text-neutral-200">
      <div className="flex items-start gap-2">
        <Icon name="volume" size={14} className="mt-0.5 shrink-0 text-indigo-300" />
        <div className="min-w-0 flex-1">
          {player.source?.open
            ? <button className="block max-w-full truncate text-left font-medium hover:underline" title={t('Ir al contenido')} onClick={player.source.open}>{player.source.title}</button>
            : <div className="truncate font-medium">{player.source?.title ?? t('Narración')}</div>}
          <div className="truncate text-[11px] text-neutral-500">
            {player.buffering ? t('Esperando al siguiente fragmento…') : track?.label ?? (generating ? t('Preparando…') : '')}
          </div>
        </div>
        <button className="rounded p-1 text-neutral-400 hover:bg-neutral-800 hover:text-red-300" title={t('Detener y cerrar')} aria-label={t('Detener y cerrar')} onClick={player.stop}><Icon name="x" size={13} /></button>
      </div>

      <ProgressTrack playedS={playedS} generatedS={generatedS} totalS={totalS} etaS={generating ? generation?.etaS ?? null : null} onSeekFraction={player.tracks.length ? seekFraction : undefined} testId="narration-progress" />

      <div className="flex items-center justify-center gap-1">
        <button className="rounded p-1.5 text-neutral-300 hover:bg-neutral-800 disabled:opacity-30" title={t('Parte anterior')} aria-label={t('Parte anterior')} disabled={player.index === 0} onClick={player.prev}><Icon name="skipBack" size={14} /></button>
        <button className="rounded px-1.5 py-1 font-mono text-[10px] text-neutral-300 hover:bg-neutral-800" title={t('Retroceder 15 segundos')} onClick={() => player.skip(-15)}>−15</button>
        <button className="rounded-full bg-indigo-600 p-2 text-white hover:bg-indigo-500 disabled:opacity-40" title={player.isPlaying ? t('Pausar') : t('Reproducir')} aria-label={player.isPlaying ? t('Pausar') : t('Reproducir')} disabled={!player.tracks.length} onClick={player.toggle}>
          <Icon name={player.isPlaying ? 'pause' : 'play'} size={14} />
        </button>
        <button className="rounded px-1.5 py-1 font-mono text-[10px] text-neutral-300 hover:bg-neutral-800" title={t('Avanzar 15 segundos')} onClick={() => player.skip(15)}>+15</button>
        <button className="rounded p-1.5 text-neutral-300 hover:bg-neutral-800 disabled:opacity-30" title={t('Parte siguiente')} aria-label={t('Parte siguiente')} disabled={player.index >= player.tracks.length - 1} onClick={player.next}><Icon name="skipForward" size={14} /></button>
      </div>

      <label className="grid grid-cols-[auto_1fr_auto] items-center gap-2 text-[11px] text-neutral-400" title={t('Velocidad de reproducción')}>
        <span>{t('Velocidad')}</span>
        <input type="range" min={0.5} max={2} step={0.05} value={player.rate} className="w-full accent-indigo-500" aria-label={t('Velocidad de reproducción')} onChange={(event) => player.setRate(Number(event.target.value))} />
        <output className="w-10 text-right font-mono">{player.rate.toFixed(2)}×</output>
      </label>

      {generating && <div className="flex items-center justify-between gap-2 rounded-md bg-neutral-800/60 px-2 py-1.5 text-[11px] text-neutral-300" data-testid="narration-generation">
        <span className="min-w-0 truncate">
          <Icon name="sync" size={11} className="mr-1 inline animate-spin" />
          {generation.segmentsTotal > 1
            ? tx('Generando parte {n} de {total}', { n: Math.min(generation.segmentsDone + 1, generation.segmentsTotal), total: generation.segmentsTotal })
            : t('Generando audio…')}
          {generation.etaS != null && generation.etaS > 1 ? ` · ${tx('quedan ~{eta}', { eta: formatClock(generation.etaS) })}` : ''}
        </span>
        <button className="shrink-0 rounded px-1.5 py-0.5 text-neutral-400 hover:bg-neutral-700 hover:text-neutral-100" onClick={player.cancelGeneration}>{t('Cancelar')}</button>
      </div>}
      {generation?.slow && generating && <p className="text-[10px] text-amber-400">{t('Este equipo genera más despacio de lo que se escucha: puede haber pausas.')}</p>}
      {generation?.state === 'error' && <p className="text-[10px] text-red-300">{t('No se pudo generar el resto del audio.')}</p>}

      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-neutral-800 pt-2 text-[10px] text-neutral-500">
        <span className="flex min-w-0 items-center gap-1.5">
          <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${engineActive ? 'bg-emerald-500' : 'bg-neutral-600'}`} />
          <span className="min-w-0">{engineActive ? t('Modelo de voz en memoria') : t('Modelo de voz descargado de la memoria')}</span>
        </span>
        {engineActive && !generating && <button className="shrink-0 rounded px-1.5 py-0.5 hover:bg-neutral-800 hover:text-neutral-200" onClick={() => void window.nodus.ttsUnload()}>{t('Liberar memoria')}</button>}
      </div>
    </div>
  );
}
