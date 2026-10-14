import type { AcademicInterfaceProfile, AppSettings } from '@shared/types';
import { effectiveSidebarHidden, isViewAllowedForVaultType } from '@shared/vaultTypes';
import { NAV_ITEMS, NAV_GROUPS, groupedNav, pinnedToolkitSidebarItems, type NavGroup, type SidebarNavItem, type View } from './navigation';

export const ACADEMIC_GUIDE_VERSION = 1;
export const ACADEMIC_INTERFACE_PROFILES = [
  { id: 'simple', label: 'Sencillo', icon: 'chat', description: 'Añade tus fuentes y conversa con ellas.', tools: 'Research chat · Biblioteca · Nodus Tools · Nodus Scriptor · Nodus Drift · Nodus Presenter' },
  { id: 'intermediate', label: 'Intermedio', icon: 'bulb', description: 'Extrae ideas, explora conexiones y profundiza en tus fuentes.', tools: 'Ideas · Autores · Deep Research · Mapa de argumentos · Grafo' },
  { id: 'advanced', label: 'Avanzado', icon: 'network', description: 'Accede al entorno completo de investigación.', tools: 'Estado de la cuestión · Hipótesis · Ruta de lectura · Scriptor' },
  { id: 'custom', label: 'Personalizado', icon: 'settings', description: 'Elige qué aparece y en qué orden.', tools: 'Visibilidad y orden de las secciones' },
] as const;

export function academicProfileLabel(profile?: AcademicInterfaceProfile): string {
  return ACADEMIC_INTERFACE_PROFILES.find(p => p.id === (profile ?? 'custom'))!.label;
}

export const ACADEMIC_ALWAYS_VISIBLE = ['workspace', 'toolkit:drift', 'toolkit:presenter'];
export function academicToolkitPages(pages: AppSettings['toolkitPinnedPages']): AppSettings['toolkitPinnedPages'] {
  return [...new Set<AppSettings['toolkitPinnedPages'][number]>(['drift', 'presenter', ...pages])];
}
const SIMPLE = ['library', 'researchChat', 'toolkit', ...ACADEMIC_ALWAYS_VISIBLE, 'settings'];
const INTERMEDIATE = ['home', 'library', 'ideas', 'authors', 'argument', 'graph', 'researchChat', 'dictionary', 'deepResearch', 'toolkit', ...ACADEMIC_ALWAYS_VISIBLE, 'settings'];

export function academicNavigationCatalog(settings: Pick<AppSettings, 'toolkitPinnedPages'>): SidebarNavItem[] {
  return [...NAV_ITEMS.filter(n => n.id !== 'notes' && isViewAllowedForVaultType(n.id, 'academic')), ...pinnedToolkitSidebarItems(academicToolkitPages(settings.toolkitPinnedPages))];
}

/** Presets never overwrite the saved custom layout or the global Toolkit pins. */
export function academicNavigation(settings: AppSettings): SidebarNavItem[] {
  const profile = settings.academicInterfaceProfile;
  const catalog = academicNavigationCatalog(settings);
  if (profile === 'simple' || profile === 'intermediate') {
    return (profile === 'simple' ? SIMPLE : INTERMEDIATE).map(id => catalog.find(n => n.id === id)!);
  }
  if (!profile) {
    const hidden = effectiveSidebarHidden(settings.sidebarHidden, settings.sidebarCustomized, 'academic');
    const groups = groupedNav(settings.sidebarOrder, ['library', 'notes', ...hidden.filter(id => !ACADEMIC_ALWAYS_VISIBLE.includes(id)), ...NAV_ITEMS.filter(n => !isViewAllowedForVaultType(n.id, 'academic')).map(n => n.id)], academicToolkitPages(settings.toolkitPinnedPages));
    return [catalog.find(n => n.id === 'home')!, catalog.find(n => n.id === 'library')!, ...groups.flatMap(g => g.items), catalog.find(n => n.id === 'settings')!];
  }
  if (profile === 'advanced') {
    const groups = groupedNav([], NAV_ITEMS.filter(n => !isViewAllowedForVaultType(n.id, 'academic') || n.id === 'notes' || n.id === 'library').map(n => n.id), academicToolkitPages(settings.toolkitPinnedPages));
    return [catalog.find(n => n.id === 'home')!, catalog.find(n => n.id === 'library')!, ...groups.flatMap(g => g.items), catalog.find(n => n.id === 'settings')!];
  }
  const hidden = new Set(effectiveSidebarHidden(settings.sidebarHidden, settings.sidebarCustomized, 'academic'));
  const groups = groupedNav(settings.sidebarOrder, ['library', 'notes', ...[...hidden].filter(id => !ACADEMIC_ALWAYS_VISIBLE.includes(id)), ...NAV_ITEMS.filter(n => !isViewAllowedForVaultType(n.id, 'academic')).map(n => n.id)], academicToolkitPages(settings.toolkitPinnedPages));
  return [catalog.find(n => n.id === 'home')!, ...(!hidden.has('library') ? [catalog.find(n => n.id === 'library')!] : []), ...groups.flatMap(group => group.items), catalog.find(n => n.id === 'settings')!];
}

/** Keep the same section boundaries in the sidebar and its settings editor. */
export function academicNavigationGroups(settings: AppSettings): NavGroup[] {
  const items = academicNavigation(settings);
  return NAV_GROUPS.map(group => ({ ...group, items: items.filter(item => item.id !== 'library' && item.group === group.id) })).filter(group => group.items.length > 0);
}

export function academicInitialView(profile?: AcademicInterfaceProfile): View {
  return profile === 'simple' || profile === 'intermediate' ? 'researchChat' : 'home';
}

/** Materialize the CURRENT presentation when the user starts editing it. */
export function academicCustomizationPatch(settings: AppSettings): Partial<AppSettings> {
  if (!settings.academicInterfaceProfile || settings.academicInterfaceProfile === 'custom') {
    return {
      academicInterfaceProfile: 'custom', sidebarCustomized: true,
      sidebarOrder: [...settings.sidebarOrder],
      sidebarHidden: effectiveSidebarHidden(settings.sidebarHidden, settings.sidebarCustomized, 'academic'),
    };
  }
  const visible = new Set(academicNavigation(settings).map(n => n.id));
  return {
    academicInterfaceProfile: 'custom', sidebarCustomized: true,
    sidebarOrder: academicNavigation(settings).filter(n => n.id !== 'home' && n.id !== 'settings').map(n => n.id),
    sidebarHidden: academicNavigationCatalog(settings).filter(n => n.id !== 'home' && n.id !== 'settings' && !visible.has(n.id)).map(n => n.id),
  };
}

/** Hidden sections keep their saved positions while the editor shows the full catalogue. */
export function academicSidebarEditorState(settings: AppSettings): { order: string[]; hidden: string[] } {
  const layout = academicCustomizationPatch(settings);
  return {
    order: layout.sidebarOrder!,
    hidden: layout.sidebarHidden!.filter(id => !ACADEMIC_ALWAYS_VISIBLE.includes(id)),
  };
}

export function academicProfilePatch(settings: AppSettings, profile: AcademicInterfaceProfile): Partial<AppSettings> {
  // Freeze legacy preferences before leaving them; missing profile is a compatibility marker.
  if (!settings.academicInterfaceProfile) {
    return { ...academicCustomizationPatch(settings), academicInterfaceProfile: profile };
  }
  if (profile === 'custom' && !settings.sidebarCustomized) return academicCustomizationPatch(settings);
  return { academicInterfaceProfile: profile };
}
