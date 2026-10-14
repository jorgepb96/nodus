// The Nodus Bookmarks start page with its sort popover and favourite stars, rendered
// from the real component over a synthetic collection. The backend is an in-memory
// store driven by the same shared mutations main uses, so a click on a star goes
// through updateBrowserBookmark exactly as the IPC handler does.
import React, { useEffect, useState } from 'react';
import ReactDOM from 'react-dom/client';
import type { NodusApi } from '../shared/types';
import type { BrowserBookmarkStore } from '../shared/browserBookmarks';
import {
  emptyBrowserBookmarkStore,
  insertBrowserBookmark,
  insertBrowserBookmarkFolder,
  updateBrowserBookmark,
} from '../shared/browserBookmarks';
import { NodusBookmarksPage } from '../src/components/browser/NodusStartPages';
import { setActiveLang } from '../src/i18n';

setActiveLang('es');
try {
  window.localStorage.removeItem('nodus.browser.bookmarks.sort');
  window.localStorage.removeItem('nodus.browser.bookmarks.view');
} catch { /* file:// may refuse */ }

function seed(): BrowserBookmarkStore {
  let store = emptyBrowserBookmarkStore();
  const day = (n: number) => `2026-09-${String(n).padStart(2, '0')}T10:00:00.000Z`;
  let sequence = 0;
  const folder = (name: string, n: number) => {
    const made = insertBrowserBookmarkFolder(store, { name }, `folder-${++sequence}`, day(n));
    store = made.store;
    return made.folder;
  };
  const save = (title: string, url: string, description: string, n: number, extra: { favorite?: boolean; parentId?: string } = {}) => {
    store = insertBrowserBookmark(store, { title, url, description, ...extra }, `bookmark-${++sequence}`, day(n)).store;
  };
  const archives = folder('Archivos nacionales', 4);
  folder('Revistas', 11);
  save('Europeana', 'https://www.europeana.eu/', 'Patrimonio cultural digitalizado de museos, archivos y bibliotecas europeas.', 2, { favorite: true });
  save('arXiv', 'https://arxiv.org/', 'Preprints de física, matemáticas e informática.', 12);
  save('Biblioteca Digital Hispánica', 'https://bdh.bne.es/', 'Fondos digitalizados de la Biblioteca Nacional de España.', 7);
  save('JSTOR', 'https://www.jstor.org/', 'Revistas académicas, libros y fuentes primarias.', 9, { favorite: true });
  save('PARES', 'https://pares.mcu.es/', 'Portal de Archivos Españoles.', 5, { parentId: archives.id, favorite: true });
  return store;
}

let current = seed();
const listeners = new Set<(store: BrowserBookmarkStore) => void>();
const publish = (store: BrowserBookmarkStore) => { current = store; for (const listener of listeners) listener(store); };

window.nodus = {
  ...(window.nodus ?? {}),
  resolveBrowserBookmarkFavicons: async () => undefined,
  openBrowserTab: async () => undefined,
  navigateBrowserStartPage: async () => undefined,
  submitBrowserOmnibox: async () => undefined,
  moveBrowserBookmarkNode: async () => current,
  updateBrowserBookmark: async (id: string, patch: Parameters<NodusApi['updateBrowserBookmark']>[1]) => {
    publish(updateBrowserBookmark(current, id, patch));
    return current;
  },
} as unknown as NodusApi;

function Harness() {
  const [store, setStore] = useState(current);
  useEffect(() => { listeners.add(setStore); return () => { listeners.delete(setStore); }; }, []);
  return <NodusBookmarksPage store={store} onEditBookmark={() => undefined} onNewBookmark={() => undefined} onNewFolder={() => undefined} onNotice={() => undefined} />;
}

ReactDOM.createRoot(document.getElementById('root')!).render(<Harness />);
