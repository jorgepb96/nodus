import { t, tx } from '../../i18n';

/**
 * A three-layer bar for narration: what has been heard, what is already generated and what
 * is still to come. With live narration the generated band runs ahead of the playhead; the
 * rest of the track is the estimate of what remains.
 */
export function ProgressTrack({ playedS, generatedS, totalS, etaS, onSeekFraction, testId }: {
  playedS: number;
  generatedS: number;
  totalS: number;
  etaS?: number | null;
  onSeekFraction?: (fraction: number) => void;
  testId?: string;
}) {
  const total = Math.max(totalS, generatedS, 0.001);
  const played = Math.min(1, playedS / total);
  const generated = Math.min(1, generatedS / total);
  return (
    <div data-testid={testId}>
      <div
        className={`relative h-1.5 w-full overflow-hidden rounded bg-neutral-200 dark:bg-neutral-800 ${onSeekFraction ? 'cursor-pointer' : ''}`}
        role="progressbar"
        aria-label={t('Progreso de la narración')}
        aria-valuemin={0}
        aria-valuemax={Math.round(total)}
        aria-valuenow={Math.round(playedS)}
        aria-valuetext={tx('{played} de {total}; generado {generated}', { played: formatClock(playedS), total: formatClock(total), generated: formatClock(generatedS) })}
        onClick={onSeekFraction ? (event) => {
          const rect = event.currentTarget.getBoundingClientRect();
          onSeekFraction(Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)));
        } : undefined}
      >
        <div className="absolute inset-y-0 left-0 bg-indigo-300/60 transition-[width] dark:bg-indigo-500/35" style={{ width: `${generated * 100}%` }} />
        <div className="absolute inset-y-0 left-0 bg-indigo-500 transition-[width]" style={{ width: `${played * 100}%` }} />
      </div>
      <div className="mt-1 flex justify-between font-mono text-[10px] text-neutral-500">
        <span>{formatClock(playedS)}</span>
        <span>
          {generatedS < total - 0.5 ? tx('generado {generated} de ~{total}', { generated: formatClock(generatedS), total: formatClock(total) }) : formatClock(total)}
          {etaS != null && etaS > 1 ? ` · ${tx('quedan ~{eta}', { eta: formatClock(etaS) })}` : ''}
        </span>
      </div>
    </div>
  );
}

export function formatClock(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return '0:00';
  const total = Math.round(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`;
}
