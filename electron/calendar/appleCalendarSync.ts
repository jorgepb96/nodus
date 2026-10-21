import { app } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import type { AppleCalendarSyncStatus } from '@shared/appleCalendar';
import { withVaultDatabase } from '../db/database';
import { getStudyPlanner } from '../db/studyLearningRepo';
import { getVault } from '../vaults/vaultRegistry';
import { listAppleCalendars, mutateAppleCalendar } from './appleCalendarBridge';
import { syncAppleCalendarBinding } from './appleCalendarCore';
import { readAppleCalendarState, writeAppleCalendarState, type AppleCalendarState } from './appleCalendarState';

let state: AppleCalendarState | undefined;
let stateError: string | null = null;
let timer: NodeJS.Timeout | undefined;
let wake: NodeJS.Timeout | undefined;
let running = false;
let started = false;
let queue: Promise<unknown> = Promise.resolve();
const runtime = new Map<string, { phase: AppleCalendarSyncStatus['phase']; pending: number; error: string | null; retryAt: number; failures: number }>();
const configuring = new Set<string>();
const stateFile = () => path.join(app.getPath('userData'), 'calendar-sync', 'apple.json');
const errorCode = (error: unknown) => error instanceof Error && /^APPLE_CALENDAR_[A-Z_]+$/.test(error.message) ? error.message : 'APPLE_CALENDAR_SAVE';
function load(): AppleCalendarState | undefined {
  if (!state && !stateError) {
    try { state = readAppleCalendarState(stateFile()); }
    catch { stateError = 'APPLE_CALENDAR_STATE'; }
  }
  return state;
}
function persist(): void {
  try { writeAppleCalendarState(stateFile(), state!); }
  catch { stateError = 'APPLE_CALENDAR_STATE'; throw new Error(stateError); }
}
function serial<T>(work: () => Promise<T>): Promise<T> {
  const next = queue.then(work);
  queue = next.catch(() => undefined);
  return next;
}

export function getAppleCalendarSyncStatus(vaultId: string): AppleCalendarSyncStatus {
  const vault = process.platform === 'darwin' ? load()?.vaults[vaultId] : undefined;
  const binding = vault?.bindings[vault.selected];
  const current = runtime.get(vaultId);
  return {
    available: process.platform === 'darwin', enabled: !!binding?.enabled,
    calendarId: binding?.calendarId ?? null, calendarName: binding?.calendarName ?? null,
    phase: stateError ? 'error' : !binding?.enabled ? 'off' : current?.phase ?? 'idle',
    pending: current?.pending ?? Object.keys(binding?.pending ?? {}).length,
    lastSyncedAt: binding?.lastSyncedAt ?? null, error: stateError ?? current?.error ?? null,
  };
}

export async function configureAppleCalendarSync(vaultId: string, input: { enabled: boolean; calendarId?: string }): Promise<AppleCalendarSyncStatus> {
  if (process.platform !== 'darwin') throw new Error('APPLE_CALENDAR_UNAVAILABLE');
  if (!input || typeof input.enabled !== 'boolean') throw new Error('APPLE_CALENDAR_REQUEST');
  configuring.add(vaultId);
  try { await serial(async () => {
    const saved = load();
    if (!saved || stateError) throw new Error('APPLE_CALENDAR_STATE');
    const vault = getVault(vaultId);
    if (!vault || !['estudio', 'docencia'].includes(vault.type)) throw new Error('APPLE_CALENDAR_VAULT');
    const previous = saved.vaults[vaultId];
    if (!input.enabled) {
      if (previous) previous.bindings[previous.selected].enabled = false;
    } else {
      // Consent happens only through the user's explicit "Choose calendar" action.
      const calendar = (await listAppleCalendars()).find((item) => item.id === input.calendarId);
      if (!calendar) throw new Error('APPLE_CALENDAR_DESTINATION');
      const entry = previous ?? { selected: calendar.id, bindings: {} };
      if (previous) previous.bindings[previous.selected].enabled = false;
      const binding = entry.bindings[calendar.id] ?? { enabled: false, calendarId: calendar.id, calendarName: '', links: {}, lastSyncedAt: null };
      binding.enabled = true;
      binding.calendarName = `${calendar.title} · ${calendar.source}`;
      entry.selected = calendar.id;
      entry.bindings[calendar.id] = binding;
      saved.vaults[vaultId] = entry;
    }
    persist();
    runtime.delete(vaultId);
  }); } finally { configuring.delete(vaultId); }
  requestAppleCalendarSync();
  return getAppleCalendarSyncStatus(vaultId);
}

async function cycle(): Promise<void> {
  if (running || !started || stateError) return;
  running = true;
  try {
    await serial(async () => {
      for (const [vaultId, config] of Object.entries(load()?.vaults ?? {})) {
        if (!started || stateError) break;
        const binding = config.bindings[config.selected];
        if (!binding.enabled || (runtime.get(vaultId)?.retryAt ?? 0) > Date.now()) continue;
        const current = { phase: 'syncing' as AppleCalendarSyncStatus['phase'], pending: 0, error: null as string | null, retryAt: 0, failures: runtime.get(vaultId)?.failures ?? 0 };
        runtime.set(vaultId, current);
        try {
          const vault = getVault(vaultId);
          // Missing/unmounted/deleted vaults must never be mistaken for an empty calendar.
          if (!vault || !fs.existsSync(vault.path) || !['estudio', 'docencia'].includes(vault.type)) throw new Error('APPLE_CALENDAR_VAULT');
          const events = await withVaultDatabase(vaultId, () => getStudyPlanner().events);
          await syncAppleCalendarBinding(vaultId, events, binding, {
            persist, mutate: mutateAppleCalendar, progress: (pending) => { current.pending = pending; },
            shouldContinue: () => started && !configuring.has(vaultId) && !stateError,
          });
          current.phase = 'idle'; current.failures = 0;
        } catch (error) {
          current.phase = 'error'; current.error = errorCode(error); current.failures += 1;
          current.retryAt = Date.now() + Math.min(300_000, 5_000 * 2 ** Math.min(current.failures, 6));
        }
      }
    });
  } finally { running = false; }
}

export function requestAppleCalendarSync(): void {
  if (!started || wake) return;
  wake = setTimeout(() => { wake = undefined; void cycle(); }, 250);
  wake.unref();
}
export function startAppleCalendarSync(): void {
  if(process.env.NODUS_SUPPORT_INTERACTIVE==='1'||process.env.NODUS_SUPPORT_PROBE==='1')return;
  if (started || process.platform !== 'darwin') return;
  started = true;
  timer = setInterval(() => { void cycle(); }, 5_000);
  timer.unref();
  requestAppleCalendarSync();
}
export function stopAppleCalendarSync(): void {
  started = false;
  if (timer) clearInterval(timer);
  if (wake) clearTimeout(wake);
  timer = undefined; wake = undefined;
}
