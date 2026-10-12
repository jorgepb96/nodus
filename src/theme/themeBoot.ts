import { sanitizeCustomThemes } from '@shared/appThemes';
import { VAULT_TYPE_COLORS } from '@shared/vaultColors';
import type { ThemeMode } from '@shared/types';
import { deriveThemeTokens, SHADES, THEMES } from './themes.mjs';

/**
 * Applies the persisted colour theme before the first paint.
 *
 * The renderer's real source of truth is settings/profile data, but those load
 * asynchronously. The last active definition is mirrored to localStorage so a
 * custom theme also paints without flashing the default palette on reload.
 */
export const APP_THEME_STORAGE_KEY = 'nodus-app-theme';
export const APP_THEME_DEFINITIONS_STORAGE_KEY = 'nodus-app-theme-definitions';

/** Keep floating editor UI on the same canonical vault accent as the app shell. */
export function applyVaultAccent(type: string | null | undefined): void {
  const color = VAULT_TYPE_COLORS[type as keyof typeof VAULT_TYPE_COLORS] ?? VAULT_TYPE_COLORS.academic;
  document.documentElement.style.setProperty('--vault-accent', color);
}

/** Apply the light/dark root classes immediately, including system-mode resolution. */
export function applyThemeMode(theme: ThemeMode): boolean {
  const dark = theme === 'system'
    ? window.matchMedia('(prefers-color-scheme: dark)').matches
    : theme === 'dark';
  document.documentElement.classList.toggle('light', !dark);
  document.documentElement.classList.toggle('dark', dark);
  return dark;
}

type RuntimeTheme = {
  id: string;
  label: string;
  anchors: { accent: string; deep: string; pale: string; appBackground: { light: string; dark: string }; lightText: string; darkText: string; tint?: number };
};

type CustomTheme = {
  id: string;
  label: string;
  accent: string;
  deep: string;
  pale: string;
  appBackground: { light: string; dark: string };
  lightText: string;
  darkText: string;
  tint: number;
};

/** Toggle the generic runtime palette marker on <html>, clearing any stale one. */
export function applyAppThemeClass(id: string | null | undefined): void {
  const root = document.documentElement;
  const normalized = id || 'default';
  for (const cls of Array.from(root.classList)) if (cls.startsWith('theme-')) root.classList.remove(cls);
  if (normalized !== 'default') root.classList.add('theme-active');
  root.dataset.appTheme = normalized;
}

function definitionFor(id: string, customThemes: CustomTheme[] = []): RuntimeTheme | null {
  const builtIn = THEMES.find((theme) => theme.id === id);
  if (builtIn) return builtIn;
  const custom = customThemes.find((theme) => theme.id === id);
  return custom ? { id: custom.id, label: custom.label, anchors: custom } : null;
}

/** Whether an id is the default palette or one of the built-in THEMES (as opposed to a custom theme). */
export function isBuiltInTheme(id: string | null | undefined): boolean {
  return !id || id === 'default' || THEMES.some((theme) => theme.id === id);
}

/** Apply a built-in or user-created palette through runtime CSS variables. */
export function applyAppTheme(id: string | null | undefined, customThemes: CustomTheme[] = []): void {
  const normalized = id || 'default';
  const root = document.documentElement;
  const safeCustomThemes = sanitizeCustomThemes(customThemes);
  const definition = definitionFor(normalized, safeCustomThemes);
  applyAppThemeClass(definition ? normalized : 'default');
  if (definition) {
    const tokens = deriveThemeTokens(definition);
    for (const shade of SHADES) {
      root.style.setProperty(`--n-${shade}`, tokens.n[shade]);
      root.style.setProperty(`--a-dark-${shade}`, tokens.a.dark[shade]);
      root.style.setProperty(`--a-light-${shade}`, tokens.a.light[shade]);
      // The mode class is applied after settings load; initialize the aliases
      // with the dark ramp, then let the `.light` alias replace them when needed.
      root.style.setProperty(`--a-${shade}`, tokens.a.dark[shade]);
    }
    root.style.setProperty('--theme-text-light', tokens.text.light);
    root.style.setProperty('--theme-text-dark', tokens.text.dark);
    root.style.setProperty('--app-background-light', tokens.appBackground.light);
    root.style.setProperty('--app-background-dark', tokens.appBackground.dark);
  } else {
    for (const shade of SHADES) {
      root.style.removeProperty(`--n-${shade}`);
      root.style.removeProperty(`--a-dark-${shade}`);
      root.style.removeProperty(`--a-light-${shade}`);
      root.style.removeProperty(`--a-${shade}`);
    }
    root.style.removeProperty('--theme-text-light');
    root.style.removeProperty('--theme-text-dark');
    root.style.removeProperty('--app-background-light');
    root.style.removeProperty('--app-background-dark');
  }
}

function readCachedCustomThemes(): CustomTheme[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(APP_THEME_DEFINITIONS_STORAGE_KEY) || '[]');
    return sanitizeCustomThemes(parsed);
  } catch {
    return [];
  }
}

try {
  applyAppTheme(localStorage.getItem(APP_THEME_STORAGE_KEY), readCachedCustomThemes());
} catch {
  applyAppTheme('default');
}
