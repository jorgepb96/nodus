// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Jorge Pérez Burgueño and Nodus contributors

import { detectCaptureCandidates } from './lib/multi-capture.js';
import { filterCollectionRows, normalizeTags } from './lib/collections.js';
import { DEFAULT_NODUS_PORT, discoverNodus, extensionOrigin, normalizeConnectorPort, requestLocalJson } from './lib/connection.js';
import { applyMetadataEdits, formatCreators } from './lib/metadata-form.js';
import { ITEM_TYPES, byline, typeGlyph, typeLabel } from './lib/presentation.js';
import { collectPageSnapshot } from './lib/snapshot.js';
import { createCaptureReview, reviewedCaptureRequest, captureJobSummary } from './lib/capture-review.js';
// The languages the package ships in _locales, keyed by the UI language Chrome
// resolves them for. Anything else falls back to English, exactly like the
// catalog lookup, so the copy and the document types never disagree.
const UI_LOCALES = {
  en: 'en', es: 'es', fr: 'fr', de: 'de', it: 'it', tr: 'tr', ja: 'ja', ko: 'ko', ru: 'ru',
  'pt-pt': 'pt', 'pt-br': 'pt-BR', 'zh-cn': 'zh-CN', 'zh-tw': 'zh-TW',
};
function uiLocale() {
  const language = chrome.i18n.getUILanguage().replace(/_/g, '-').toLowerCase();
  return UI_LOCALES[language] || UI_LOCALES[language.split('-')[0]] || 'en';
}
const $ = (id) => document.getElementById(id);
const state = {
  reviews: [], activeIndex: 0, connected: false, busy: false, jobs: [], missingOrigins: [],
  capture: null, captures: [], selectedCaptureIndexes: new Set(), tab: null,
  port: DEFAULT_NODUS_PORT, token: '', collections: [], tags: [], selectedCollection: null,
  selectedTags: [], tagsDirty: false, metadataDirty: new Set(), savedItemId: null,
};
const msg = (key, substitutions) => chrome.i18n.getMessage(key, substitutions) || key;

function show(id) {
  for (const view of ['loading-view', 'unsupported-view', 'connect-view', 'capture-view', 'success-view']) $(view).classList.toggle('hidden', view !== id);
}

function localize() {
  document.documentElement.lang = chrome.i18n.getUILanguage().split('-')[0] || 'en';
  for (const element of document.querySelectorAll('[data-i18n]')) element.textContent = msg(element.dataset.i18n);
  for (const element of document.querySelectorAll('[data-i18n-placeholder]')) element.placeholder = msg(element.dataset.i18nPlaceholder);
  for (const element of document.querySelectorAll('[data-i18n-title]')) { element.title = msg(element.dataset.i18nTitle); element.setAttribute('aria-label', msg(element.dataset.i18nTitle)); }
}

/**
 * The shared detector and metadata modules stay language-neutral and are used
 * outside the extension, so they default to English labels. This surface passes
 * the catalog of the language the popup is actually rendered in.
 */
function captureLabels() {
  return {
    untitledDocument: msg('untitledDocument'),
    untitledWebPage: msg('untitledWebPage'),
    fullTextPdf: msg('fullTextPdf'),
    fullText: msg('fullText'),
    originalDocument: msg('originalDocument'),
    pageCannotBeCaptured: msg('pageCannotBeCaptured'),
  };
}

function attachmentName(attachment) { return attachment.title || msg('attachment'); }

function captureUiChoices() {
  return {
    itemType: $('item-type')?.value || '',
    snapshot: $('snapshot-checkbox')?.checked,
    attachmentIndexes: new Set([...document.querySelectorAll('[data-attachment-index]')]
      .filter((input) => input.checked).map((input) => Number(input.dataset.attachmentIndex))),
  };
}

function metadataEdits() {
  return {
    title: $('metadata-title').value,
    creators: $('metadata-creators').value,
    date: $('metadata-date').value,
    publicationTitle: $('metadata-publication').value,
    doi: $('metadata-doi').value,
  };
}

function commitReview() {
  if (!state.capture) return;
  state.capture.metadata = { ...applyMetadataEdits(state.capture.metadata, metadataEdits(), captureLabels()), itemType: $('item-type').value, tags: [...state.selectedTags] };
  const choices = captureUiChoices();
  state.capture.attachmentIndexes = [...choices.attachmentIndexes];
  state.capture.includeSnapshot = choices.snapshot;
}
function selectReview(index) {
  if (state.busy || !state.connected) return;
  commitReview(); state.activeIndex = index; state.capture = state.reviews[index];
  state.selectedTags = [...(state.capture.metadata.tags || [])]; state.metadataDirty.clear();
  renderTags(); renderCapture();
}
function renderMultiCapture() {
  const multiple = state.reviews.length > 1;
  $('multi-capture-block').classList.toggle('hidden', !multiple);
  if (!multiple) return;
  $('multi-capture-title').textContent = msg('multipleDetected', [String(state.reviews.length)]);
  $('multi-capture-list').replaceChildren(...state.reviews.map((capture, index) => {
    const row = document.createElement('div'); row.className = 'multi-capture-row';
    const input = document.createElement('input'); input.type = 'checkbox'; input.checked = state.selectedCaptureIndexes.has(index); input.dataset.captureIndex = String(index); input.disabled = state.busy || !state.connected;
    input.setAttribute('aria-label', capture.metadata.title);
    input.onchange = () => { if (input.checked) state.selectedCaptureIndexes.add(index); else state.selectedCaptureIndexes.delete(index); updateSaveLabel(); };
    const button = document.createElement('button'); button.type = 'button'; button.className = 'review-reference'; button.dataset.reviewIndex = String(index); button.setAttribute('aria-pressed', String(state.activeIndex === index)); button.disabled = state.busy || !state.connected;
    const title = document.createElement('strong'); title.textContent = capture.metadata.title;
    const detail = document.createElement('small'); detail.textContent = byline(capture.metadata) || typeLabel(capture.metadata.itemType, uiLocale());
    button.append(title, detail); button.onclick = () => selectReview(index); row.append(input, button); return row;
  }));
}

function updateSaveLabel() {
  const count = state.captures.length > 1 ? state.selectedCaptureIndexes.size : 1;
  $('save-button').disabled = count === 0 || !state.connected || state.busy;
  $('save-button').textContent = state.captures.length > 1 ? msg('saveMultiple', [String(count)]) : msg('save');
}

function renderCapture(choices = null) {
  const metadata = state.capture.metadata;
  const selectedType = choices?.itemType || metadata.itemType;
  choices ||= { attachmentIndexes: new Set(state.capture.attachmentIndexes), snapshot: state.capture.includeSnapshot };
  $('item-type').replaceChildren(...ITEM_TYPES.map(([value]) => {
    const option = document.createElement('option'); option.value = value; option.textContent = typeLabel(value, uiLocale()); option.selected = value === selectedType; return option;
  }));
  $('item-type').onchange = () => { $('type-icon').textContent = typeGlyph($('item-type').value); };
  $('document-title').textContent = metadata.title;
  $('document-byline').textContent = byline(metadata) || new URL(state.capture.pageUrl).hostname;
  $('type-icon').textContent = typeGlyph(selectedType);
  $('files-block').classList.toggle('hidden', !state.capture.attachments.length);
  $('files-list').replaceChildren(...state.capture.attachments.map((attachment, index) => {
    const label = document.createElement('label'); label.className = 'file-row';
    const input = document.createElement('input'); input.type = 'checkbox'; input.checked = choices?.attachmentIndexes ? choices.attachmentIndexes.has(index) : true; input.dataset.attachmentIndex = String(index);
    const copy = document.createElement('span');
    const title = document.createElement('strong'); title.textContent = attachment.title || attachment.fileName || msg('file');
    const detail = document.createElement('small'); detail.textContent = [attachment.mimeType, safeHost(attachment.url)].filter(Boolean).join(' · ');
    copy.append(title, detail); label.append(input, copy); return label;
  }));
  $('snapshot-row').classList.toggle('hidden', !state.capture.snapshotAvailable);
  $('snapshot-checkbox').checked = choices?.snapshot ?? (state.capture.snapshotAvailable && !state.capture.attachments.length);
  const defaults = {
    title: metadata.title || '', creators: formatCreators(metadata.creators),
    date: metadata.date || (metadata.year ? String(metadata.year) : ''),
    publicationTitle: metadata.publicationTitle || '', doi: metadata.doi || '',
  };
  for (const [key, id] of Object.entries({ title: 'metadata-title', creators: 'metadata-creators', date: 'metadata-date', publicationTitle: 'metadata-publication', doi: 'metadata-doi' })) {
    if (!state.metadataDirty.has(key)) $(id).value = defaults[key];
  }
  renderMultiCapture();
  updateSaveLabel();
  for (const input of $('capture-view').querySelectorAll('input,select,textarea,button')) input.disabled = state.busy || !state.connected;
  updateSaveLabel();
  show('capture-view');
}

function safeHost(url) { try { return new URL(url).hostname; } catch { return ''; } }

function foldSearch(value) {
  return String(value || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase();
}

async function detectActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id || !/^https?:/i.test(tab.url || '')) throw new Error(msg('unsupportedPage'));
  state.tab = tab;
  let snapshot = null;
  try {
    const [injected] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: collectPageSnapshot });
    snapshot = injected?.result || null;
  } catch { /* Chrome's built-in PDF viewer does not accept injected scripts. */ }
  if (!snapshot) snapshot = { title: tab.title || '', url: tab.url, lang: chrome.i18n.getUILanguage(), contentType: '', metas: [], links: [], jsonLd: [], coins: [], anchors: [], html: '' };
  state.captures = detectCaptureCandidates(snapshot, captureLabels());
  state.reviews = state.captures.map(createCaptureReview);
  state.capture = state.reviews[0];
  state.selectedCaptureIndexes = new Set(state.captures.map((_capture, index) => index));
  state.selectedTags = normalizeTags(state.capture.metadata.tags || []);
  state.tagsDirty = false;
  state.metadataDirty.clear();
  renderTags();
  renderCapture();
}

function baseUrl(port = state.port) { return `http://127.0.0.1:${port}`; }

async function api(path, options = {}, token = state.token, port = state.port) {
  const origin = extensionOrigin(chrome.runtime.getURL);
  const headers = { ...(options.headers || {}), Origin: origin, 'X-Nodus-Extension-Origin': origin };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (options.body && !(options.body instanceof ArrayBuffer) && !headers['Content-Type']) headers['Content-Type'] = 'application/json';
  const response = await requestLocalJson(`${baseUrl(port)}${path}`, { ...options, headers });
  if (!response.ok) {
    const error = new Error(response.data.error || msg('nodusReturnedError', [String(response.status)]));
    error.status = response.status;
    throw error;
  }
  return response.data;
}

async function findNodus(preferredPort) {
  return discoverNodus(preferredPort, (port) => api('/api/browser/health', {}, '', port));
}

async function adoptConnection(connection) {
  state.port = connection.port;
  $('pair-port').value = String(connection.port);
  await chrome.storage.local.set({ port: connection.port });
}

async function pair() {
  const paired = await chrome.runtime.sendMessage({ type: 'nodus:pair', port: state.port, pageUrl: state.capture?.pageUrl || '' });
  if (!paired?.token) throw new Error(paired?.error || msg('backgroundTransferNoResult'));
  state.token = paired.token;
}

async function connect() {
  const inputPort = normalizeConnectorPort($('pair-port').value);
  state.port = inputPort; $('pair-button').disabled = true; $('connect-error').textContent = '';
  try {
    const connection = await findNodus(inputPort);
    if (!connection) throw new Error(msg('cannotReachNodus', [String(inputPort)]));
    await adoptConnection(connection);
    const { health } = connection;
    if (!health.enabled) throw new Error(msg('enableInNodus'));
    if (!health.libraryReady) throw new Error(msg('libraryNotReady'));
    await pair();
    await loadCatalog(); renderCapture();
  } catch (error) { $('connect-error').textContent = error.message || String(error); }
  finally { $('pair-button').disabled = false; }
}

async function loadCatalog() {
  const data = await api('/api/browser/catalog');
  state.collections = data.collections || []; state.tags = data.tags || [];
  const rememberedCollection = state.collections.find((collection) => collection.id === state.selectedCollection);
  if (!rememberedCollection) state.selectedCollection = null;
  $('collection-label').textContent = rememberedCollection?.name || msg('libraryRoot');
  renderCollectionRows('');
  $('enrichment-status').classList.remove('hidden');
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(4, state.reviews.length) }, async () => {
    while (next < state.reviews.length) {
      const index = next++; const capture = state.reviews[index];
      try {
        const preview = await api('/api/browser/preview', { method: 'POST', body: JSON.stringify({ ...capture, snapshotHtml: undefined }) });
        if (preview.metadata) capture.metadata = { ...capture.metadata, ...preview.metadata };
      } catch { /* Embedded metadata remains reviewable offline. */ }
    }
  }));
  state.connected = true; state.metadataDirty.clear();
  state.selectedTags = [...(state.capture.metadata.tags || [])];
  renderTags(); renderCapture(); $('enrichment-status').classList.add('hidden');
}

function renderCollectionRows(query) {
  const root = document.createElement('button'); root.type = 'button'; root.className = 'collection-row'; root.setAttribute('role', 'option'); root.setAttribute('aria-selected', String(state.selectedCollection === null)); root.textContent = msg('libraryRoot'); root.onclick = () => selectCollection(null);
  const rows = filterCollectionRows(state.collections, query).map((row) => {
    const button = document.createElement('button'); button.type = 'button'; button.className = 'collection-row'; button.setAttribute('role', 'option'); button.setAttribute('aria-selected', String(state.selectedCollection === row.collection.id)); button.style.paddingLeft = `${10 + row.depth * 18}px`; button.title = row.pathLabel;
    const icon = document.createElement('span'); icon.className = 'folder-icon'; if (row.collection.color) icon.style.color = row.collection.color;
    const text = document.createElement('span'); text.textContent = row.collection.name;
    const count = document.createElement('small'); count.textContent = String(row.collection.directItemCount || '');
    button.append(icon, text, count); button.onclick = () => selectCollection(row.collection.id); return button;
  });
  $('collection-list').replaceChildren(root, ...rows);
}

function selectCollection(id) {
  state.selectedCollection = id;
  const selected = state.collections.find((collection) => collection.id === id);
  $('collection-label').textContent = selected?.name || msg('libraryRoot');
  $('collection-popover').classList.add('hidden'); $('collection-button').setAttribute('aria-expanded', 'false');
  renderCollectionRows($('collection-search').value);
}

function renderTags() {
  $('tag-chips').replaceChildren(...state.selectedTags.map((tag) => {
    const chip = document.createElement('span'); chip.className = 'tag-chip';
    const text = document.createElement('span'); text.textContent = tag;
    const remove = document.createElement('button'); remove.type = 'button'; remove.textContent = '×'; remove.setAttribute('aria-label', `${msg('remove')} ${tag}`); remove.onclick = () => { state.tagsDirty = true; state.selectedTags = state.selectedTags.filter((entry) => entry !== tag); renderTags(); };
    chip.append(text, remove); return chip;
  }));
  renderTagSuggestions($('tag-input').value);
}

function addTag(raw) {
  state.tagsDirty = true; state.selectedTags = normalizeTags([...state.selectedTags, raw]); $('tag-input').value = ''; renderTags(); $('tag-input').focus();
}

function renderTagSuggestions(query) {
  const needle = foldSearch(query).trim();
  const choices = state.tags.filter((entry) => !state.selectedTags.some((tag) => foldSearch(tag) === foldSearch(entry.name)) && (!needle || foldSearch(entry.name).includes(needle))).slice(0, 8);
  $('tag-suggestions').classList.toggle('hidden', !choices.length);
  $('tag-suggestions').replaceChildren(...choices.map((entry) => {
    const button = document.createElement('button'); button.type = 'button'; button.className = 'tag-suggestion'; button.textContent = `${entry.name} · ${entry.itemCount}`; button.onclick = () => addTag(entry.name); return button;
  }));
}

async function refreshJobs() {
  const response = await chrome.runtime.sendMessage({ type: 'nodus:jobs' });
  if (!response?.ok) return;
  state.jobs = response.jobs; state.missingOrigins = response.missingOrigins;
  renderJobs();
}
function renderJobs() {
  $('jobs-panel').classList.toggle('hidden', !state.jobs.length);
  $('jobs-list').replaceChildren(...state.jobs.map((job) => {
    const summary = captureJobSummary(job);
    const row = document.createElement('div'); row.className = 'capture-job'; row.dataset.jobId = job.id;
    const title = document.createElement('strong'); title.textContent = job.title;
    const detail = document.createElement('p'); detail.textContent = `${msg('jobProgress', [String(summary.saved), String(summary.total), String(summary.files)])} · ${job.status === 'complete' ? msg('jobComplete') : job.status === 'failed' ? msg('jobFailed') : job.status === 'needs-permission' ? msg('jobNeedsPermission') : job.status === 'downloading' ? msg('jobDownloading') : msg('saving')}`;
    row.append(title, detail);
    const errors = [...summary.errors, ...job.entries.flatMap((entry) => entry.result?.warnings || [])];
    for (const error of errors) { const p = document.createElement('p'); p.className = 'job-error'; p.textContent = error; row.append(p); }
    if (summary.pending) { const pending = document.createElement('p'); pending.textContent = msg('jobPending', [String(summary.pending)]); row.append(pending); }
    if (['failed', 'needs-permission'].includes(job.status)) {
      const retry = document.createElement('button'); retry.type = 'button'; retry.className = 'secondary-button'; retry.textContent = msg('retry');
      retry.onclick = async () => { retry.disabled = true; await chrome.runtime.sendMessage({ type: 'nodus:retry', id: job.id }); await refreshJobs(); };
      row.append(retry);
    }
    for (const entry of job.entries.filter((entry) => entry.result)) {
      const disposition = document.createElement('p'); disposition.textContent = entry.result.disposition === 'existing' ? `${msg('alreadySaved')} · ${msg('duplicateAvoided')}` : entry.result.deduplicated ? msg('updatedExisting') : msg('saved'); row.append(disposition);
      const open = document.createElement('button'); open.type = 'button'; open.className = 'job-open'; open.textContent = `${msg('openInNodus')} · ${entry.title}`;
      open.onclick = async () => {
        const result = await chrome.runtime.sendMessage({ type: 'nodus:open', itemId: entry.result.itemId, port: job.port });
        if (result?.ok) window.close(); else $('jobs-error').textContent = result?.error || msg('backgroundTransferNoResult');
      }; row.append(open);
    }
    return row;
  }));
  $('authorize-button').classList.toggle('hidden', !state.missingOrigins.length);
}
async function save() {
  if (state.busy || !state.connected) return;
  commitReview(); state.busy = true; updateSaveLabel();
  $('capture-error').classList.add('hidden');
  try {
    const requests = [...state.selectedCaptureIndexes].sort((a, b) => a - b).map((index) => reviewedCaptureRequest(state.reviews[index], state.selectedCollection));
    if (!requests.length) throw new Error(msg('selectAtLeastOne'));
    const response = await chrome.runtime.sendMessage({ type: 'nodus:enqueue', port: state.port, requests });
    if (!response?.ok) throw new Error(response?.error || msg('backgroundTransferNoResult'));
    await chrome.storage.local.set({ lastCollectionId: state.selectedCollection });
    state.savedItemId = null;
    $('success-title').textContent = msg('jobQueued'); $('success-summary').textContent = msg('jobContinues');
    $('open-button').classList.add('hidden'); $('success-warnings').classList.add('hidden');
    show('success-view'); await refreshJobs();
  } catch (error) {
    $('capture-error').textContent = error.message || String(error); $('capture-error').classList.remove('hidden');
  } finally { state.busy = false; updateSaveLabel(); }
}

async function initConnection() {
  const stored = await chrome.storage.local.get({ port: DEFAULT_NODUS_PORT, token: '', lastCollectionId: null });
  state.port = normalizeConnectorPort(stored.port); state.token = stored.token || ''; state.selectedCollection = stored.lastCollectionId || null; $('pair-port').value = String(state.port);
  try {
    const connection = await findNodus(state.port);
    if (!connection) { show('connect-view'); return; }
    await adoptConnection(connection);
    const { health } = connection;
    if (!health.enabled) { show('connect-view'); return; }
    if (!health.libraryReady) { show('connect-view'); $('connect-error').textContent = msg('libraryNotReady'); return; }
    if (!state.token) await pair();
    try {
      await loadCatalog();
    } catch (error) {
      if (error.status !== 401) throw error;
      state.token = '';
      await chrome.storage.local.remove(['token']);
      await pair();
      await loadCatalog();
    }
  } catch { show('connect-view'); }
}

function wire() {
  $('authorize-button').onclick = () => {
    // Call directly in the click handler: no asynchronous work before request().
    const origins = [...state.missingOrigins];
    chrome.permissions.request({ origins }).then((granted) => {
      if (!granted) $('jobs-error').textContent = msg('permissionDenied', [origins.join(', ')]);
      return refreshJobs();
    }).catch((error) => { $('jobs-error').textContent = error.message; });
  };
  $('settings-button').onclick = () => chrome.runtime.openOptionsPage();
  $('pair-button').onclick = () => void connect();
  $('metadata-toggle').onclick = () => {
    const hidden = $('metadata-panel').classList.toggle('hidden');
    $('metadata-toggle').setAttribute('aria-expanded', String(!hidden));
    if (!hidden) $('metadata-title').focus();
  };
  for (const [id, key] of Object.entries({
    'metadata-title': 'title', 'metadata-creators': 'creators', 'metadata-date': 'date',
    'metadata-publication': 'publicationTitle', 'metadata-doi': 'doi',
  })) {
    $(id).addEventListener('input', () => {
      state.metadataDirty.add(key);
      if (key === 'title') $('document-title').textContent = $('metadata-title').value || state.capture?.metadata.title || '';
    });
  }
  $('collection-button').onclick = () => { const open = $('collection-popover').classList.toggle('hidden'); $('collection-button').setAttribute('aria-expanded', String(!open)); if (!open) $('collection-search').focus(); };
  $('collection-search').oninput = (event) => renderCollectionRows(event.target.value);
  $('tag-input').oninput = (event) => renderTagSuggestions(event.target.value);
  $('tag-input').onfocus = (event) => renderTagSuggestions(event.target.value);
  $('tag-input').onkeydown = (event) => { if ((event.key === 'Enter' || event.key === ',') && event.currentTarget.value.trim()) { event.preventDefault(); addTag(event.currentTarget.value.replace(/,$/, '')); } else if (event.key === 'Backspace' && !event.currentTarget.value && state.selectedTags.length) { state.tagsDirty = true; state.selectedTags.pop(); renderTags(); } };
  $('save-button').onclick = () => void save();
  $('open-button').onclick = () => void api('/api/browser/open', { method: 'POST', body: JSON.stringify({ itemId: state.savedItemId }) }).then(() => window.close());
  $('done-button').onclick = () => window.close();
  document.addEventListener('click', (event) => { if (!$('collection-popover').contains(event.target) && !$('collection-button').contains(event.target)) { $('collection-popover').classList.add('hidden'); $('collection-button').setAttribute('aria-expanded', 'false'); } if (!$('tag-box').contains(event.target) && !$('tag-suggestions').contains(event.target)) $('tag-suggestions').classList.add('hidden'); });
}

localize(); wire();
chrome.storage.onChanged?.addListener(() => { void refreshJobs(); });
await refreshJobs();
try { await detectActiveTab(); await initConnection(); } catch (error) { $('unsupported-message').textContent = error.message || String(error); show('unsupported-view'); }
