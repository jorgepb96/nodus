import type { AppSettings } from './types';
import { effectiveSidebarHidden } from './vaultTypes';

/** Adopt an existing layout without rebuilding it from only its visible entries. */
export function migrateLegacyAcademicInterface(settings: Partial<AppSettings>, vaultType: unknown): Partial<AppSettings> {
  if (vaultType !== 'academic' || settings.academicInterfaceProfile !== undefined) return {};
  const order = settings.sidebarOrder ?? [];
  const hidden = settings.sidebarHidden ?? [];
  if (!settings.sidebarCustomized && order.length === 0 && hidden.length === 0) return {};
  return {
    academicInterfaceProfile: 'custom',
    sidebarCustomized: true,
    sidebarOrder: [...order],
    sidebarHidden: settings.sidebarCustomized || hidden.length > 0
      ? [...hidden]
      : effectiveSidebarHidden([], false, 'academic'),
  };
}
