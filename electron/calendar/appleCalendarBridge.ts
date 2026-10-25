import { app } from 'electron';
import path from 'node:path';
import { createRequire } from 'node:module';
import type { AppleCalendarDestination, AppleCalendarMutation } from '@shared/appleCalendar';
import { assertSupportExternalActionAllowed } from '../support/externalActions';

let bridge: { invoke: (json: string) => Promise<string> } | undefined;
async function invoke<T>(request: object): Promise<T> {
  assertSupportExternalActionAllowed();
  if (process.platform !== 'darwin') throw new Error('APPLE_CALENDAR_UNAVAILABLE');
  if (!bridge) {
    const file = app.isPackaged
      ? path.join(process.resourcesPath, 'apple-calendar', 'nodus-apple-calendar.node')
      : path.join(app.getAppPath(), 'build', 'apple-calendar', process.arch, 'nodus-apple-calendar.node');
    try { bridge = createRequire(import.meta.url)(file); }
    catch { throw new Error('APPLE_CALENDAR_UNAVAILABLE'); }
  }
  const result = JSON.parse(await bridge!.invoke(JSON.stringify(request)));
  if (result.error) throw new Error(String(result.error));
  return result as T;
}

export async function listAppleCalendars(requestAccess = false): Promise<AppleCalendarDestination[]> {
  const result = await invoke<{ calendars: AppleCalendarDestination[] }>({ action: 'calendars', requestAccess });
  return result.calendars;
}
export const mutateAppleCalendar = (mutation: AppleCalendarMutation): Promise<{ nativeId?: string }> => invoke(mutation);
