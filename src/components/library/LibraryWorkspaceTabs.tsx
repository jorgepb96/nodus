import { useEffect, useRef, type KeyboardEvent } from 'react';
import type { LibraryScope } from '@shared/libraryTypes';
import type { LibraryReaderReference } from '@shared/types';
import { t } from '../../i18n';
import { Icon } from '../ui';

export interface LibraryWorkspaceTab {
  key: string;
  scope: LibraryScope;
  reference: LibraryReaderReference;
  sourceId?: string;
}

export function libraryWorkspaceTabKey(scope: LibraryScope, reference: LibraryReaderReference): string {
  return `${scope}:${reference.id}`;
}

/** Una pestaña cualquiera de la tira: lo que se abre junto a la vista principal. */
export interface WorkspaceStripTab {
  key: string;
  title: string;
  icon: string;
}

/**
 * Navegación de documentos con el diseño de pestañas de Ideas y Autores.
 *
 * La primera pestaña es la vista principal y no se cierra. Los editores de Estudio
 * y Docencia pueden omitirla cuando su contenedor ya gestiona el catálogo.
 * Todas las vistas comparten las teclas, el cierre y el desplazamiento a la pestaña activa.
 */
export function WorkspaceTabStrip({
  homeLabel,
  homeIcon,
  homeTestId,
  tabTestId,
  closeTestId,
  tabs,
  activeKey,
  onActivateHome,
  onActivateTab,
  onCloseTab,
  alwaysShowHome = true,
  showHome = true,
  onRenameTab,
  className = '',
}: {
  homeLabel: string;
  homeIcon: string;
  homeTestId: string;
  tabTestId: (tab: WorkspaceStripTab) => string;
  closeTestId: (tab: WorkspaceStripTab) => string;
  tabs: WorkspaceStripTab[];
  activeKey: string | null;
  onActivateHome: () => void;
  onActivateTab: (key: string) => void;
  onCloseTab: (key: string) => void;
  alwaysShowHome?: boolean;
  showHome?: boolean;
  onRenameTab?: (key: string) => void;
  className?: string;
}) {
  const stripRef = useRef<HTMLDivElement>(null);
  const focusAfterActivation = useRef(false);
  const activeTitle = tabs.find((tab) => tab.key === activeKey)?.title;

  useEffect(() => {
    const active = stripRef.current?.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]');
    // Scroll this strip only. scrollIntoView also moves outer scroll containers,
    // which makes the workspace header and sidebar jump during activation.
    const strip = stripRef.current;
    if (active && strip) {
      // Include the close and rename controls, not just the title button.
      const item = (active.closest('.library-workspace-tab') ?? active).getBoundingClientRect();
      const bounds = strip.getBoundingClientRect();
      const delta = item.left < bounds.left ? item.left - bounds.left : item.right > bounds.right ? item.right - bounds.right : 0;
      if (delta) strip.scrollLeft += delta;
    }
    // Activation can load a document asynchronously. Wait for its selected tab,
    // rather than moving focus to the old one on the next animation frame.
    if (active && focusAfterActivation.current) {
      const dialog = document.querySelector('[role="dialog"][aria-modal="true"]');
      if (!dialog || dialog.contains(active)) {
        active.focus({ preventScroll: true });
        focusAfterActivation.current = false;
      }
    }
  }, [activeKey, tabs.length, activeTitle, homeLabel]);

  if (!tabs.length && (!alwaysShowHome || !showHome)) return null;

  const activateAdjacentTab = (currentKey: string | null, direction: -1 | 1) => {
    const keys: Array<string | null> = [...(showHome ? [null] : []), ...tabs.map((tab) => tab.key)];
    const currentIndex = Math.max(0, keys.indexOf(currentKey));
    const nextKey = keys[(currentIndex + direction + keys.length) % keys.length];
    if (nextKey === null) onActivateHome();
    else onActivateTab(nextKey);
  };

  const tabKeyDown = (event: KeyboardEvent, key: string | null) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End', 'Delete'].includes(event.key)) return;
    event.preventDefault();
    event.stopPropagation();
    if (event.key === 'Delete') {
      if (key !== null) closeTab(key);
      return;
    }
    focusAfterActivation.current = true;
    if (event.key === 'Home') { if (showHome || !tabs.length) onActivateHome(); else onActivateTab(tabs[0].key); }
    else if (event.key === 'End') { if (tabs.length) onActivateTab(tabs[tabs.length - 1].key); else onActivateHome(); }
    else activateAdjacentTab(key, event.key === 'ArrowLeft' ? -1 : 1);
    requestAnimationFrame(() => {
      const active = stripRef.current?.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]');
      const dialog = document.querySelector('[role="dialog"][aria-modal="true"]');
      if (active && (!dialog || dialog.contains(active))) active.focus({ preventScroll: true });
    });
  };

  const closeTab = (key: string) => {
    focusAfterActivation.current = true;
    onCloseTab(key);
    // Restore focus in the effect after the tab actually closes. An editor may
    // first ask for confirmation or save asynchronously; its dialog keeps focus.
  };

  return (
    <div data-testid="library-workspace-tabs" className={`library-workspace-tabs shrink-0 ${className}`}>
      <div ref={stripRef} className="library-workspace-tabs-scroll" role="tablist" aria-label={homeLabel}>
        {showHome && <div className={`library-workspace-tab is-library ${activeKey === null ? 'is-active' : ''}`}>
          <button
            type="button"
            role="tab"
            aria-selected={activeKey === null}
            tabIndex={activeKey === null ? 0 : -1}
            data-testid={homeTestId}
            className="library-workspace-tab-main"
            onClick={onActivateHome}
            onKeyDown={(event) => tabKeyDown(event, null)}
          >
            <Icon name={homeIcon} size={13} />
            <span>{homeLabel}</span>
          </button>
        </div>}
        {tabs.map((tab) => {
          const active = activeKey === tab.key;
          return (
            <div key={tab.key} className={`library-workspace-tab ${active ? 'is-active' : ''}`} title={tab.title}>
              <button
                type="button"
                role="tab"
                aria-selected={active}
                tabIndex={active ? 0 : -1}
                data-testid={tabTestId(tab)}
                className="library-workspace-tab-main"
                onClick={() => onActivateTab(tab.key)}
                onAuxClick={(event) => {
                  if (event.button === 1) closeTab(tab.key);
                }}
                onKeyDown={(event) => tabKeyDown(event, tab.key)}
              >
                <Icon name={tab.icon} size={12} />
                <span className="truncate">{tab.title}</span>
              </button>
              {active && onRenameTab && <button
                type="button"
                className="library-workspace-tab-close"
                aria-label={t('Renombrar apunte')}
                title={t('Renombrar apunte')}
                onClick={() => onRenameTab(tab.key)}
              ><Icon name="edit" size={11} /></button>}
              <button
                type="button"
                data-testid={closeTestId(tab)}
                className="library-workspace-tab-close"
                aria-label={`${t('Cerrar pestaña')}: ${tab.title}`}
                title={t('Cerrar pestaña')}
                onClick={(event) => {
                  event.stopPropagation();
                  closeTab(tab.key);
                }}
              >
                <Icon name="x" size={11} />
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function LibraryWorkspaceTabs({
  tabs,
  activeKey,
  onActivateLibrary,
  onActivateTab,
  onCloseTab,
}: {
  tabs: LibraryWorkspaceTab[];
  activeKey: string | null;
  onActivateLibrary: () => void;
  onActivateTab: (key: string) => void;
  onCloseTab: (key: string) => void;
}) {
  return (
    <WorkspaceTabStrip
      homeLabel={t('Biblioteca')}
      homeIcon="library"
      homeTestId="library-workspace-tab-library"
      tabTestId={(tab) => `library-workspace-tab-document-${tab.key.split(':').slice(1).join(':')}`}
      closeTestId={(tab) => `library-workspace-close-${tab.key.split(':').slice(1).join(':')}`}
      tabs={tabs.map((tab) => ({ key: tab.key, title: tab.reference.title, icon: 'file' }))}
      activeKey={activeKey}
      onActivateHome={onActivateLibrary}
      onActivateTab={onActivateTab}
      onCloseTab={onCloseTab}
    />
  );
}
