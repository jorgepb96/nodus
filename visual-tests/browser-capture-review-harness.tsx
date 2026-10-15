// SPDX-License-Identifier: AGPL-3.0-only
import React, { useState } from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserCaptureModal } from '../src/components/browser/BrowserCaptureModal';
import { createCaptureQueue } from '../browser-extension/lib/capture-jobs.js';
import type { BrowserCaptureJob, BrowserConnectorCapturePreviewItem } from '../shared/browserConnector';
import type { NodusApi } from '../shared/types';
import { setActiveLang } from '../src/i18n';
import '../src/index.css';
setActiveLang('es');
const records = new Map<string, BrowserCaptureJob>();
const captured: unknown[] = [];
const queue = createCaptureQueue({
  list: async () => structuredClone([...records.values()]), put: async (job) => { records.set(job.id, structuredClone(job)); },
  save: async (request) => { captured.push(request); return { ok: true, itemId: `nodus:${request.metadata.title}`, title: request.metadata.title, disposition: 'created', deduplicated: false, attachmentCount: request.attachments?.length ?? 0, extractionStatus: null, warnings: [], pendingUploads: [] }; },
  canUpload: async () => true, upload: async () => { throw Error('Unexpected upload'); },
});
const candidates: BrowserConnectorCapturePreviewItem[] = ['First paper', 'Second book'].map((title, index) => ({ warnings: [], request: {
  pageUrl: 'https://catalog.test/results', metadataSource: 'coins', sourceIsResultPage: true, metadata: {
    title, itemType: index ? 'book' : 'journal-article', creators: [{ creatorType: index ? 'editor' : 'author', firstName: 'Ada', lastName: 'Lovelace', fieldMode: 0 }], year: 2020, isbn: [], issn: [], tags: [index ? 'book-tag' : 'paper-tag'],
  }, attachments: [{ url: `https://files.test/${index}.txt`, title: `${title} file`, mimeType: 'text/plain' }], snapshotAvailable: false,
} }));
window.nodus = {
  ...(window.nodus ?? {}), listGlobalLibraryCollections: async () => [], listGlobalLibraryTags: async () => [],
  setBrowserOverlayVisible: async () => undefined,
  listBrowserCaptureJobs: queue.list,
  enqueueBrowserCaptures: async (requests) => { const job = await queue.enqueue(requests); void queue.run(job.id); return job; },
  retryBrowserCaptureJob: async (id) => { await queue.run(id, true); },
} as unknown as NodusApi;
Object.assign(window, { captured });
function Harness() {
  const [open, setOpen] = useState(true);
  return <main className="min-h-screen bg-neutral-100 p-8 dark:bg-neutral-950"><button id="reopen" onClick={() => setOpen(true)}>Open capture</button>{open && <BrowserCaptureModal preview={candidates[0].request} candidates={candidates} warnings={[]} onClose={() => setOpen(false)} onSaved={() => undefined} onOpenInNodus={() => undefined} onOpenSettings={() => undefined} />}</main>;
}
ReactDOM.createRoot(document.getElementById('root')!).render(<Harness />);
