/**
 * When the two first-run reminders are due. Pure, so the timing can be tested.
 *
 * Both follow from the same decision: nothing may stand between a newcomer and their
 * first answer. The recovery kit is asked for afterwards, and someone who never got
 * that far is asked what stopped them instead of being left to close the window.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

/** A quick start is left alone for this long before the kit reminder appears. */
export const RECOVERY_KIT_REMINDER_AFTER_MS = DAY_MS;
/** "Later" on either reminder hides it for this long. */
export const REMINDER_SNOOZE_MS = 7 * DAY_MS;
/** How long an install may sit with no sources before Nodus asks whether it is stuck. */
export const STUCK_NUDGE_AFTER_MS = 2 * DAY_MS;

function time(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined || value === '') return null;
  // Browser storage only holds strings, so an epoch arrives as "1795…" as often as a
  // number; `Date.parse` reads that as a year and answers NaN.
  const parsed = typeof value === 'number' ? value : /^\d+$/.test(value.trim()) ? Number(value) : Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/** The folder was prepared without asking, a day has passed, and no kit was saved. */
export function recoveryKitReminderDue(input: {
  credentialsPending?: boolean;
  quickStartAt?: string | null;
  snoozedUntil?: string | number | null;
  now: number;
}): boolean {
  if (!input.credentialsPending) return false;
  const since = time(input.quickStartAt);
  if (since === null || input.now - since < RECOVERY_KIT_REMINDER_AFTER_MS) return false;
  const snoozed = time(input.snoozedUntil);
  return snoozed === null || input.now >= snoozed;
}

/** A new install that, days later, still has no sources and never reached an answer. */
export function stuckNudgeDue(input: {
  firstSeenAt?: string | number | null;
  firstAnswerCompleted: boolean;
  workCount: number | null;
  dismissed: boolean;
  now: number;
}): boolean {
  if (input.dismissed || input.firstAnswerCompleted || input.workCount !== 0) return false;
  const since = time(input.firstSeenAt);
  return since !== null && input.now - since >= STUCK_NUDGE_AFTER_MS;
}
