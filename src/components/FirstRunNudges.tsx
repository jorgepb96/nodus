import { useEffect, useState } from 'react';
import type { RecoveryStatus } from '@shared/types';
import { REMINDER_SNOOZE_MS, recoveryKitReminderDue, stuckNudgeDue } from '@shared/firstRunNudges';
import { t, tx } from '../i18n';
import { Icon } from './ui';

const KIT_SNOOZE_KEY = 'nodus.recoveryKitReminder.snoozedUntil';
const FIRST_SEEN_KEY = 'nodus.firstRun.firstSeenAt';
const STUCK_DISMISSED_KEY = 'nodus.firstRun.stuckNudgeDismissed';

function stored(key: string): string | null {
  try { return localStorage.getItem(key); } catch { return null; }
}
function store(key: string, value: string): void {
  try { localStorage.setItem(key, value); } catch { /* A reminder is not worth failing over. */ }
}

/**
 * "Save your recovery kit", for an install whose folder Nodus prepared by itself.
 *
 * The first run no longer asks for a folder and a master password, so this is where
 * that question lands: a day later, once there is something to protect, as one line
 * above the workspace that can be answered or postponed.
 */
export function RecoveryKitReminder({ status, onSaved }: { status: RecoveryStatus | null; onSaved: () => void }) {
  const [snoozedUntil, setSnoozedUntil] = useState(() => stored(KIT_SNOOZE_KEY));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  if (!status || !recoveryKitReminderDue({ credentialsPending: status.credentialsPending, quickStartAt: status.quickStartAt, snoozedUntil, now: Date.now() })) return null;
  const later = () => { const until = String(Date.now() + REMINDER_SNOOZE_MS); store(KIT_SNOOZE_KEY, until); setSnoozedUntil(until); };
  const save = async () => {
    setBusy(true); setError('');
    try {
      const result = await window.nodus.saveBackupRecoveryKit();
      if (result.ok) onSaved();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally { setBusy(false); }
  };
  return (
    <div className="flex flex-wrap items-center gap-3 border-b border-indigo-200 bg-indigo-50 px-4 py-1.5 text-xs text-indigo-900 dark:border-indigo-500/30 dark:bg-indigo-500/10 dark:text-indigo-200" data-testid="recovery-kit-reminder" role="status">
      <Icon name="lock" size={14} />
      <span className="min-w-0 flex-1">
        {tx('Tu trabajo se guarda en {folder}, con copias cifradas automáticas. Guarda tu kit de recuperación para poder restaurarlo en otro ordenador.', { folder: status.configuredRoot })}
        {error && <span role="alert" className="ml-2 text-red-600 dark:text-red-300">{error}</span>}
      </span>
      <button className="btn btn-ghost border border-indigo-300 py-0.5 dark:border-indigo-500/40" data-testid="recovery-kit-save" disabled={busy} onClick={() => void save()}>{t('Guardar kit de recuperación')}</button>
      <button className="btn btn-ghost py-0.5" data-testid="recovery-kit-later" disabled={busy} onClick={later}>{t('Más tarde')}</button>
    </div>
  );
}

/**
 * "Are you stuck?", for an install that still has no sources days after its first run.
 *
 * Nodus is local-first and sends nothing home, so the people who give up never leave a
 * trace. This asks the ones who come back: one line offering the first steps again and
 * a way to say what got in the way. It is shown once the conditions hold and never
 * again after it is dismissed.
 */
export function StuckNudge({ eligible, firstAnswerCompleted, onResume, onFeedback }: {
  /** A new academic install, past the startup sequence, with nothing else on screen. */
  eligible: boolean;
  firstAnswerCompleted: boolean;
  onResume: () => void;
  onFeedback: () => void;
}) {
  const [dismissed, setDismissed] = useState(() => stored(STUCK_DISMISSED_KEY) === '1');
  const [workCount, setWorkCount] = useState<number | null>(null);
  const [firstSeenAt] = useState(() => {
    const existing = stored(FIRST_SEEN_KEY);
    if (existing) return existing;
    const now = String(Date.now());
    store(FIRST_SEEN_KEY, now);
    return now;
  });
  const old = stuckNudgeDue({ firstSeenAt: Number(firstSeenAt), firstAnswerCompleted, workCount: 0, dismissed, now: Date.now() });
  // The library is only counted once everything cheaper already says "show it".
  useEffect(() => {
    if (!eligible || !old) return;
    let cancelled = false;
    void window.nodus.listWorks().then((works) => { if (!cancelled) setWorkCount(works.length); }).catch(() => { /* Unknown is not zero: stay hidden. */ });
    return () => { cancelled = true; };
  }, [eligible, old]);
  if (!eligible || !stuckNudgeDue({ firstSeenAt: Number(firstSeenAt), firstAnswerCompleted, workCount, dismissed, now: Date.now() })) return null;
  const dismiss = () => { store(STUCK_DISMISSED_KEY, '1'); setDismissed(true); };
  return (
    <div className="flex flex-wrap items-center gap-3 border-b border-amber-300 bg-amber-50 px-4 py-1.5 text-xs text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200" data-testid="stuck-nudge" role="status">
      <Icon name="help" size={14} />
      <span className="min-w-0 flex-1">{t('¿Te has atascado? Todavía no hay ninguna fuente en esta bóveda. Podemos retomar los primeros pasos, o puedes contarnos qué te ha frenado.')}</span>
      <button className="btn btn-ghost border border-amber-400/60 py-0.5 dark:border-amber-500/40" data-testid="stuck-nudge-resume" onClick={() => { dismiss(); onResume(); }}>{t('Retomar los primeros pasos')}</button>
      <button className="btn btn-ghost py-0.5" data-testid="stuck-nudge-feedback" onClick={() => { dismiss(); onFeedback(); }}>{t('Contar qué me ha frenado')}</button>
      <button className="btn btn-ghost !p-1" data-testid="stuck-nudge-dismiss" aria-label={t('Cerrar')} onClick={dismiss}><Icon name="x" size={13} /></button>
    </div>
  );
}
