import type { AppSettings, RecoveryHealth } from '@shared/types';
import { t, tx } from './i18n';

/**
 * One place that turns an assessed backup state into user-facing words, shared by the
 * global warning bar and the Settings panel. Two copies of this logic would eventually
 * disagree about whether the user is protected, which is the exact confusion the health
 * check exists to remove.
 *
 * Every branch uses a literal `t()` key: the i18n coverage test only sees static
 * strings, so an interpolated key would silently ship untranslated.
 */
export function recoveryHealthHeadline(health: RecoveryHealth): string {
  switch (health.code) {
    case 'disabled':
      return t('Las copias de seguridad automáticas están desactivadas.');
    case 'folder-unreachable':
      return t('No se puede acceder a la carpeta de copias de seguridad.');
    case 'last-run-failed':
      return t('La última copia de seguridad falló.');
    case 'never-run':
      return t('Todavía no se ha completado ninguna copia de seguridad.');
    case 'stale':
      return t('Hace demasiado tiempo que no se completa una copia de seguridad.');
    default:
      return t('Tus datos están protegidos.');
  }
}

/** Short call to action matching the problem, or null when nothing is wrong. */
export function recoveryHealthAdvice(health: RecoveryHealth): string | null {
  switch (health.code) {
    case 'disabled':
      return t('Actívalas para que Nodus guarde copias cifradas y recuperables.');
    case 'folder-unreachable':
      return t('Conecta la unidad o vuelve a elegir la carpeta de destino.');
    case 'last-run-failed':
      return t('Revisa el detalle y vuelve a introducir la contraseña maestra si es necesario.');
    case 'never-run':
      return t('Haz una copia ahora para comprobar que todo funciona.');
    case 'stale':
      return t('Comprueba que el equipo está encendido a la hora programada.');
    default:
      return null;
  }
}

/** Days-since-last-backup as a sentence, or null when there is nothing to report. */
export function recoveryHealthAge(health: RecoveryHealth): string | null {
  if (health.daysSinceLastBackup === null) return null;
  if (health.daysSinceLastBackup === 0) return t('Última copia: hoy.');
  if (health.daysSinceLastBackup === 1) return t('Última copia: ayer.');
  // tx() keeps the whole sentence one translatable key, so word order stays natural
  // in every language instead of being hardcoded by concatenation.
  return tx('Última copia hace {days} días.', { days: health.daysSinceLastBackup });
}

/**
 * Settings patch for an explicit "configure recovery" request.
 *
 * The wizard is a startup guard, not a modal, so resetting `recoverySetupVersion` only
 * works when the guard is allowed to fire. An academic vault whose learning invitations
 * are still pending is deliberately skipped by that guard until `realSetupStarted` is
 * set — and only the learning flow used to set it, which made the Settings buttons and
 * the update notice inert for exactly that user. An explicit request is the same signal
 * the learning flow emits, so the guard stops deferring and the wizard mounts.
 *
 * The whole progress object is carried over because `updateSettings` replaces
 * `academicLearningProgress` in place; only `lessons` receives a merge of its own.
 */
export function recoverySetupRequest(settings: AppSettings): Partial<AppSettings> {
  const progress = settings.academicLearningProgress;
  if (!progress?.invitationsEligible || progress.realSetupStarted) {
    return { recoverySetupVersion: 0 };
  }
  return {
    recoverySetupVersion: 0,
    academicLearningProgress: { ...progress, realSetupStarted: true },
  };
}
