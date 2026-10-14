import { ACADEMIC_ALWAYS_VISIBLE, academicCustomizationPatch } from '../academicInterfaceProfiles';
// Nodus Tools combines nested file utilities and existing standalone research
// views. Standalone cards reuse their sidebar visibility; nested tools use pins.
import { useState } from 'react';
import type { AppSettings } from '@shared/types';
import { effectiveSidebarHidden } from '@shared/vaultTypes';
import { normalizeToolkitToolPages } from '@shared/toolkitNavigation';
import { Icon } from '../components/ui';
import { t } from '../i18n';
import { TOOLKIT_TOOLS, isToolkitStandalonePage, scriptorViewForVault, toolkitSidebarId, type ToolkitCatalogPage, type ToolkitStandalonePage, type ToolkitPage } from '../navigation';
import { ToolkitBackupsView } from './ToolkitBackupsView';
import { ToolkitConvertView } from './ToolkitConvertView';
import { ToolkitProtectView } from './ToolkitProtectView';
import { ToolkitPresenterView } from './ToolkitPresenterView';
import { ToolkitAiOcrView } from './ToolkitAiOcrView';
import { ToolkitAppsView } from './ToolkitAppsView';
import { ToolkitTranslateView } from './ToolkitTranslateView';
import { ToolkitDriftView } from './ToolkitDriftView';

interface ToolCardProps {
  testid: string;
  icon: string;
  /** Nombre de marca de la herramienta; no se traduce. */
  name: string;
  description: string;
  /** 'wip' = navegable pero en construcción; 'soon' = tarjeta deshabilitada. */
  state: 'wip' | 'soon';
  pinned: boolean;
  pinBusy: boolean;
  onOpen?: () => void;
  onTogglePinned: () => void;
  alwaysVisible?: boolean;
}

/** Tarjeta del hub. Todas se renderizan con la MISMA estructura y altura
 *  (grid + h-full); el icono va en una loseta cuadrada fija para que quede
 *  perfectamente centrado. Solo las herramientas aún no disponibles muestran
 *  estado: las aplicaciones navegables no necesitan una etiqueta de desarrollo. */
function ToolCard({ testid, icon, name, description, state, pinned, pinBusy, alwaysVisible = false, onOpen, onTogglePinned }: ToolCardProps) {
  const disabled = state === 'soon';
  return (
    <div className="relative h-full">
      <button
        data-testid={testid}
        disabled={disabled}
        aria-disabled={disabled}
        title={disabled ? t('Próximamente') : undefined}
        onClick={disabled ? undefined : onOpen}
        className={`toolkit-card flex h-full w-full flex-col items-start gap-3 rounded-xl border p-5 pr-16 text-left transition-colors ${
          disabled
            ? 'cursor-not-allowed border-neutral-200 bg-neutral-50 opacity-60 dark:border-neutral-800 dark:bg-neutral-900/20'
            : 'border-neutral-200 bg-white hover:border-amber-400 dark:border-neutral-800 dark:bg-neutral-900/40 dark:hover:border-amber-500/60'
        }`}
      >
        <span className="toolkit-card-icon flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300">
          <Icon name={icon} size={22} />
        </span>
        <span className="toolkit-card-title text-base font-semibold text-neutral-900 dark:text-neutral-100">{name}</span>
        <span className="toolkit-card-description text-sm leading-relaxed text-neutral-500 dark:text-neutral-400">{description}</span>
        {disabled && (
          <span className="toolkit-card-status mt-auto inline-flex items-center gap-1 rounded-md bg-neutral-200 px-2 py-0.5 text-xs text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300">
            {t('Próximamente')}
          </span>
        )}
      </button>
      <button
        type="button"
        data-testid={`${testid}-pin`}
        aria-pressed={pinned}
        aria-label={`${name} · ${t(alwaysVisible ? 'Siempre visible' : pinned ? 'Desfijar' : 'Fijar')}`}
        title={t(alwaysVisible ? 'Siempre visible' : pinned ? 'Desfijar' : 'Fijar')}
        disabled={disabled || pinBusy || alwaysVisible}
        onClick={onTogglePinned}
        className={`toolkit-pin-button absolute right-4 top-4 z-10 flex h-9 w-9 items-center justify-center rounded-lg border transition-colors disabled:cursor-wait disabled:opacity-50 ${
          pinned
            ? 'border-amber-300 bg-amber-100 text-amber-700 dark:border-amber-500/50 dark:bg-amber-500/20 dark:text-amber-300'
            : 'border-neutral-200 bg-white/90 text-neutral-400 hover:border-amber-300 hover:text-amber-600 dark:border-neutral-700 dark:bg-neutral-900/90 dark:hover:border-amber-500/50 dark:hover:text-amber-300'
        }`}
      >
        <Icon name="pin" size={17} />
      </button>
    </div>
  );
}

export function ToolkitView({
  page,
  onNavigate,
  onOpenView,
  settings,
  vaultType,
}: {
  page: ToolkitPage;
  onNavigate: (page: ToolkitPage) => void;
  onOpenView: (view: ToolkitStandalonePage) => void;
  settings: AppSettings | null;
  vaultType: string | undefined;
}) {
  const [pinBusy, setPinBusy] = useState<ToolkitCatalogPage | null>(null);
  const [query, setQuery] = useState('');
  const normalizeSearch = (value: string) => value.normalize('NFD').replace(/\p{M}/gu, '').toLocaleLowerCase();
  const search = normalizeSearch(query.trim());
  const visibleTools = TOOLKIT_TOOLS.filter((tool) => normalizeSearch(`${tool.name} ${t(tool.description)}`).includes(search));
  const customization = settings && vaultType === 'academic' ? academicCustomizationPatch(settings) : {};
  const navigationSettings = settings ? { ...settings, ...customization } : null;
  const sidebarHidden = effectiveSidebarHidden(navigationSettings?.sidebarHidden ?? [], navigationSettings?.sidebarCustomized ?? false, vaultType);
  const pinnedPages = normalizeToolkitToolPages(settings?.toolkitPinnedPages);
  const pinned = new Set(pinnedPages);

  const destination = (page: ToolkitCatalogPage): ToolkitCatalogPage => page === 'workspace' ? scriptorViewForVault(vaultType) : page;
  const isToolPinned = (toolPage: ToolkitCatalogPage) => isToolkitStandalonePage(toolPage)
    ? Boolean(settings && !sidebarHidden.includes(destination(toolPage)))
    : pinned.has(toolPage);

  const togglePinned = async (toolPage: ToolkitCatalogPage) => {
    toolPage = destination(toolPage);
    if (!settings || pinBusy) return;
    setPinBusy(toolPage);
    try {
      // Standalone tools already have canonical sidebar entries. Reuse their
      // visibility preferences so pinning never creates duplicate shortcuts.
      if (isToolkitStandalonePage(toolPage)) {
        const wasPinned = isToolPinned(toolPage);
        await window.nodus.updateSettings({
          ...customization,
          sidebarCustomized: true,
          sidebarHidden: wasPinned
            ? [...sidebarHidden, toolPage]
            : sidebarHidden.filter((id) => id !== toolPage),
          sidebarOrder: navigationSettings!.sidebarOrder,
        });
        return;
      }
      const id = toolkitSidebarId(toolPage);
      const isPinned = pinned.has(toolPage);
      await window.nodus.updateSettings({
          ...customization,
        toolkitPinnedPages: isPinned
          ? pinnedPages.filter((pageId) => pageId !== toolPage)
          : [...pinnedPages, toolPage],
        // A fresh pin must be visible. Unpinning also retires its ordering and
        // visibility residue so pinning it again starts beside Nodus Tools.
        sidebarHidden: navigationSettings!.sidebarHidden.filter((itemId) => itemId !== id),
        sidebarOrder: isPinned
          ? navigationSettings!.sidebarOrder.filter((itemId) => itemId !== id)
          : navigationSettings!.sidebarOrder,
      });
    } catch (error) {
      console.error('[toolkit] no se pudo actualizar la chincheta', error);
    } finally {
      setPinBusy(null);
    }
  };

  if (page === 'drift') return <ToolkitDriftView onBack={() => onNavigate('home')} settings={settings} />;

  return (
    <div className="theme-workspace-surface toolkit-workspace h-full overflow-y-auto px-6 py-6 max-md:px-4">
      {/* Las herramientas tienen página propia; cualquier otra página
          cae en el catálogo en lugar de dejar el panel en blanco. */}
      {page === 'backups' ? (
        <ToolkitBackupsView onBack={() => onNavigate('home')} />
      ) : page === 'convert' ? (
        <ToolkitConvertView onBack={() => onNavigate('home')} />
      ) : page === 'apps' ? (
        <ToolkitAppsView onBack={() => onNavigate('home')} settings={settings} />
      ) : page === 'translate' ? (
        <ToolkitTranslateView onBack={() => onNavigate('home')} settings={settings} />
      ) : page === 'protect' ? (
        <ToolkitProtectView onBack={() => onNavigate('home')} />
      ) : page === 'presenter' ? (
        <ToolkitPresenterView onBack={() => onNavigate('home')} />
      ) : page === 'ocr' ? (
        <ToolkitAiOcrView onBack={() => onNavigate('home')} settings={settings} />
      ) : (
        <div data-testid="toolkit-home" className="mx-auto max-w-5xl space-y-6">
          <header className="flex items-start gap-3">
            <span className="toolkit-home-icon flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300">
              <Icon name="tools" size={22} />
            </span>
            <div className="min-w-0">
              <h1 className="toolkit-page-title text-lg font-semibold text-neutral-900 dark:text-neutral-100">Nodus Tools</h1>
              <p className="toolkit-page-description text-sm text-neutral-500">
                {t('Explora fuentes, sigue novedades y trabaja con tus archivos sin salir de Nodus.')}
              </p>
            </div>
          </header>
          <div className="relative">
            <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400">
              <Icon name="search" size={18} />
            </span>
            <input
              type="search"
              data-testid="toolkit-search"
              aria-label={t('Buscar herramientas')}
              placeholder={t('Buscar herramientas')}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => { if (event.key === 'Escape') setQuery(''); }}
              className="w-full rounded-xl border border-neutral-200 bg-white py-3 pl-10 pr-12 text-sm text-neutral-900 outline-none focus:border-amber-400 focus:ring-2 focus:ring-amber-400/20 dark:border-neutral-800 dark:bg-neutral-900/40 dark:text-neutral-100 [&::-webkit-search-cancel-button]:hidden"
            />
            {query && (
              <button
                type="button"
                aria-label={t('Limpiar búsqueda')}
                title={t('Limpiar búsqueda')}
                onClick={() => setQuery('')}
                className="absolute right-2 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-lg text-neutral-500 hover:bg-neutral-100 dark:hover:bg-neutral-800"
              >
                <Icon name="x" size={16} />
              </button>
            )}
          </div>
          {visibleTools.length === 0 && (
            <p role="status" className="py-12 text-center text-sm text-neutral-500">{t('Sin resultados')}</p>
          )}
          <div className="grid auto-rows-fr gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {visibleTools.map((tool) => (
              <ToolCard
                key={tool.page}
                testid={`toolkit-card-${tool.testid}`}
                icon={tool.icon}
                name={tool.name}
                description={t(tool.description)}
                state={tool.state}
                pinned={isToolPinned(tool.page) || (vaultType === 'academic' && ['workspace', 'drift', 'presenter'].includes(tool.page))}
                alwaysVisible={vaultType === 'academic' && ACADEMIC_ALWAYS_VISIBLE.includes(tool.page === 'workspace' ? tool.page : `toolkit:${tool.page}`)}
                pinBusy={!settings || pinBusy !== null}
                onOpen={() => { const target = destination(tool.page); if (isToolkitStandalonePage(target)) onOpenView(target); else onNavigate(target); }}
                onTogglePinned={() => void togglePinned(tool.page)}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
