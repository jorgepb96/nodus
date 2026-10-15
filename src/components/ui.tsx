import React, { useEffect, useRef, useState } from 'react';
import type { EdgeType, ModelRef, GraphNodeType } from '@shared/types';
import { t } from '../i18n';

export {
  AI_PROVIDERS,
  PROVIDER_LABELS,
  LOCAL_PROVIDERS as LOCAL_AI_PROVIDERS,
  isLocalProvider as isLocalAiProvider,
  sortModelRefs,
} from '@shared/providers';
import { PROVIDER_LABELS } from '@shared/providers';

export function modelLabel(m: ModelRef): string {
  return `${PROVIDER_LABELS[m.provider]} · ${m.model}`;
}

export function sameModel(a: ModelRef | null | undefined, b: ModelRef | null | undefined): boolean {
  return !!a && !!b && a.provider === b.provider && a.model === b.model;
}

export const NODE_COLORS: Record<Exclude<GraphNodeType, 'author'>, string> = {
  theme: '#f97316',
  claim: '#6366f1',
  finding: '#10b981',
  construct: '#f59e0b',
  method: '#ec4899',
  framework: '#06b6d4',
};

export const NODE_LABELS: Record<Exclude<GraphNodeType, 'author'>, string> = {
  theme: 'tema',
  claim: 'afirmación',
  finding: 'hallazgo',
  construct: 'constructo',
  method: 'método',
  framework: 'marco',
};

export const EDGE_LABELS: Record<EdgeType, string> = {
  contains: 'contiene',
  extends: 'extiende',
  contradicts: 'contradice',
  applies_to: 'aplica a',
  shares_method: 'comparte método',
  precondition_of: 'precondición de',
  measures_same: 'mide lo mismo',
  supports: 'apoya',
  refutes: 'refuta',
  variant_of: 'variante de',
  refines: 'refina',
};

// ── Inline icon set (feather-style strokes) ─────────────────────────────────
// Kept inline so buttons with long text labels read at a glance, without a dep.
const ICON_PATHS: Record<string, string> = {
  monitor: '<rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8"/><path d="M12 17v4"/>',
  home: '<path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V21h14V9.5"/><path d="M9 21v-7h6v7"/>',
  building: '<rect x="4" y="3" width="16" height="18" rx="1.5"/><path d="M8 7h2"/><path d="M14 7h2"/><path d="M8 11h2"/><path d="M14 11h2"/><path d="M10 21v-5h4v5"/>',
  flag: '<path d="M5 21V4"/><path d="M5 4h11l-2 3.5L16 11H5"/>',
  ruler: '<path d="M3 15 15 3l6 6L9 21z"/><path d="m7 11 2 2"/><path d="m10 8 2 2"/><path d="m13 5 2 2"/>',
  mapPin: '<path d="M12 21s7-6.2 7-11a7 7 0 1 0-14 0c0 4.8 7 11 7 11Z"/><circle cx="12" cy="10" r="2.6"/>',
  pin: '<path d="M12 17v5"/><path d="M5 17h14"/><path d="M7 17V9l-2-2V5h14v2l-2 2v8"/><path d="M9 5V2h6v3"/>',
  scissors: '<circle cx="6" cy="6" r="2.5"/><circle cx="6" cy="18" r="2.5"/><path d="M8.1 7.7 20 18"/><path d="M8.1 16.3 20 6"/>',
  truck: '<path d="M3 6h11v10H3z"/><path d="M14 9h4l3 3v4h-7z"/><circle cx="7" cy="18" r="1.6"/><circle cx="17.5" cy="18" r="1.6"/>',
  anchor: '<circle cx="12" cy="5" r="2.5"/><path d="M12 7.5V21"/><path d="M8 11H5a7 7 0 0 0 14 0h-3"/>',
  languages: '<path d="m5 8 6 6"/><path d="m4 14 6-6 2-3"/><path d="M2 5h12"/><path d="M7 2h1"/><path d="m22 22-5-10-5 10"/><path d="M14 18h6"/>',
  refresh: '<path d="M23 4v6h-6"/><path d="M1 20v-6h6"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/>',
  undo: '<path d="M9 14 4 9l5-5"/><path d="M4 9h9a7 7 0 0 1 7 7v4"/>',
  redo: '<path d="m15 14 5-5-5-5"/><path d="M20 9h-9a7 7 0 0 0-7 7v4"/>',
  folder: '<path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>',
  tag: '<path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/><line x1="7" y1="7" x2="7.01" y2="7"/>',
  tags: '<path d="M9 5H2v7l6.29 6.29c.94.94 2.48.94 3.42 0l3.58-3.58c.94-.94.94-2.48 0-3.42L9 5Z"/><path d="M6 9.01V9"/><path d="m15 5 6.3 6.3a2.4 2.4 0 0 1 0 3.4L17 19"/>',
  hash: '<line x1="4" y1="9" x2="20" y2="9"/><line x1="4" y1="15" x2="20" y2="15"/><line x1="10" y1="3" x2="8" y2="21"/><line x1="16" y1="3" x2="14" y2="21"/>',
  calendar: '<rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>',
  bell: '<path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9"/><path d="M10 21h4"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2"/><path d="M12 20v2"/><path d="m4.93 4.93 1.42 1.42"/><path d="m17.66 17.66 1.41 1.41"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="m6.34 17.66-1.41 1.41"/><path d="m19.07 4.93-1.41 1.41"/>',
  moon: '<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79Z"/>',
  table: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18"/><path d="M3 15h18"/><path d="M9 3v18"/><path d="M15 3v18"/>',
  chartBar: '<line x1="12" y1="20" x2="12" y2="10"/><line x1="18" y1="20" x2="18" y2="4"/><line x1="6" y1="20" x2="6" y2="16"/><line x1="3" y1="20" x2="21" y2="20"/>',
  bulb: '<path d="M9 18h6"/><path d="M10 22h4"/><path d="M15.09 14c.18-.98.65-1.74 1.41-2.5A4.65 4.65 0 0 0 18 8 6 6 0 0 0 6 8c0 1 .23 2.23 1.5 3.5A4.61 4.61 0 0 1 8.91 14"/>',
  layers: '<polygon points="12 2 2 7 12 12 22 7 12 2"/><polyline points="2 17 12 22 22 17"/><polyline points="2 12 12 17 22 12"/>',
  // A field seen in section: three uneven strata stand for what the corpus
  // covers, where its positions diverge and what remains open.
  strata: '<polyline points="4 5 9 5 11 4 14 6 20 5"/><polyline points="2 12 7 12 10 10 14 11 17 12 22 12"/><polyline points="5 19 9 19 11 18 14 19 17 17 20 18"/>',
  sigma: '<path d="M18 4H6l6 8-6 8h12"/>',
  wand: '<path d="M15 4V2"/><path d="M15 16v-2"/><path d="M8 9h2"/><path d="M20 9h2"/><path d="M17.8 11.8L19 13"/><path d="M15 9h0"/><path d="M17.8 6.2L19 5"/><path d="M3 21l9-9"/><path d="M12.2 6.2L11 5"/>',
  aiPolish: '<path d="m13 6 5 5M4 20l4-1L20 7a2.1 2.1 0 0 0-3-3L5 16z"/><path d="m6 2 1.2 2.8L10 6 7.2 7.2 6 10 4.8 7.2 2 6l2.8-1.2z"/>',
  sliders: '<path d="M4 6h4m4 0h8M4 18h8m4 0h4"/><circle cx="10" cy="6" r="2"/><circle cx="14" cy="18" r="2"/>',
  image: '<rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/>',
  cube: '<path d="M12 2 3 7v10l9 5 9-5V7Z"/><path d="M3 7l9 5 9-5"/><path d="M12 12v10"/>',
  download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>',
  save: '<path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/>',
  upload: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/>',
  file: '<path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><polyline points="13 2 13 9 20 9"/>',
  fileText: '<path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5z"/><polyline points="14 2 14 8 20 8"/><path d="M8 13h8M8 17h8M8 9h2"/>',
  trash: '<polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>',
  alert: '<path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>',
  warning: '<path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>',
  book: '<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/>',
  bookOpen: '<path d="M2 4.5A2.5 2.5 0 0 1 4.5 2H9a3 3 0 0 1 3 3v17a3 3 0 0 0-3-3H2z"/><path d="M22 4.5A2.5 2.5 0 0 0 19.5 2H15a3 3 0 0 0-3 3v17a3 3 0 0 1 3-3h7z"/>',
  library: '<path d="m16 6 4 14"/><path d="M12 6v14"/><path d="M8 8v12"/><path d="M4 4v16"/><path d="M2 20h20"/>',
  vault: '<rect x="3" y="4" width="18" height="16" rx="3"/><circle cx="12" cy="12" r="4"/><path d="M12 8v2M12 14v2M8 12h2M14 12h2"/><path d="M6 8h.01M18 8h.01M6 16h.01M18 16h.01"/>',
  merge: '<circle cx="18" cy="18" r="3"/><circle cx="6" cy="6" r="3"/><path d="M6 21V9a9 9 0 0 0 9 9"/>',
  // Open thesaurus: paired pages make the lexical-alternatives action distinct
  // from the closed-book icon used for ordinary reading and references.
  thesaurus: '<path d="M3 5.5A2.5 2.5 0 0 1 5.5 3H11a2 2 0 0 1 2 2v16a2 2 0 0 0-2-2H5.5A2.5 2.5 0 0 0 3 21.5Z"/><path d="M21 5.5A2.5 2.5 0 0 0 18.5 3H13a2 2 0 0 0-2 2v16a2 2 0 0 1 2-2h5.5a2.5 2.5 0 0 1 2.5 2.5Z"/><path d="M6 8h3M6 12h3M15 8h3M15 12h3"/>',
  // An open lexical reference plus a small AI sparkle. Every path explicitly
  // refuses fill so compact editor themes cannot collapse it into a grey block.
  aiSynonyms: '<path fill="none" d="M3 7a2 2 0 0 1 2-2h5a2 2 0 0 1 2 2v13a2.5 2.5 0 0 0-2-1H5a2 2 0 0 0-2 2Z"/><path fill="none" d="M12 7a2 2 0 0 1 2-2h3"/><path fill="none" d="M6 9h3M6 13h3M15 12h3"/><path fill="none" d="m19 2 .55 1.45L21 4l-1.45.55L19 6l-.55-1.45L17 4l1.45-.55Z"/><path fill="none" d="M12 20a2.5 2.5 0 0 1 2-1h5a2 2 0 0 1 2 2v-9"/>',
  external: '<path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/>',
  x: '<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>',
  help: '<circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/>',
  info: '<circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/>',
  paypal: '<path d="M8.2 3h5.7c3.1 0 5.2 1.7 4.8 4.8-.5 3.8-3.1 5.5-6.7 5.5h-1.5L9.7 19H5.9L8.2 3Z"/><path d="M10.4 6.5h3c1.2 0 1.9.6 1.7 1.6-.2 1.2-1 1.8-2.4 1.8h-1.8l-.5-3.4Z"/><path d="M11 13.3h2.1c2.1 0 3.8-.6 5-1.7-.7 3.2-3 4.8-6.2 4.8h-.8L10.5 21H7.2l.5-3.4h2.7l.6-4.3Z"/>',
  // Ko-fi is "buy me a coffee", so the glyph is the cup its own brand uses.
  kofi: '<path d="M5 9h11v5a5 5 0 0 1-5 5h-1a5 5 0 0 1-5-5V9Z"/><path d="M16 10h1.5a2.5 2.5 0 0 1 0 5H16"/><path d="M8 3v2.5M13 2.5v3"/>',
  // The three social marks are the one place this set drops its feather strokes:
  // a brand is recognised by its exact silhouette, and the eye holes in Snoo and
  // the notches in the X only exist in a filled path. Each one overrides the
  // <svg>'s stroke/fill, so they sit beside the stroked icons without leaking.
  reddit: '<path fill="currentColor" stroke="none" d="M12 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0zm5.01 4.744c.688 0 1.25.561 1.25 1.249a1.25 1.25 0 0 1-2.498.056l-2.597-.547-.8 3.747c1.824.07 3.48.632 4.674 1.488.308-.309.73-.491 1.207-.491.968 0 1.754.786 1.754 1.754 0 .716-.435 1.333-1.01 1.614a3.111 3.111 0 0 1 .042.52c0 2.694-3.13 4.87-6.991 4.87-3.861 0-6.99-2.176-6.99-4.87 0-.183.015-.366.043-.534A1.748 1.748 0 0 1 4.028 12c0-.968.786-1.754 1.754-1.754.463 0 .898.196 1.207.49 1.207-.883 2.878-1.43 4.744-1.487l.885-4.182a.342.342 0 0 1 .14-.197.35.35 0 0 1 .238-.042l2.906.617a1.214 1.214 0 0 1 1.108-.701zM9.25 12c-.688 0-1.25.562-1.25 1.25 0 .687.562 1.248 1.25 1.248.687 0 1.248-.561 1.248-1.249 0-.688-.561-1.249-1.249-1.249zm5.5 0c-.687 0-1.248.561-1.248 1.25 0 .687.561 1.248 1.249 1.248.688 0 1.249-.561 1.249-1.249 0-.687-.562-1.249-1.25-1.249zm-5.466 3.99a.327.327 0 0 0-.231.094.33.33 0 0 0 0 .463c.842.842 2.484.913 2.961.913.477 0 2.105-.056 2.961-.913a.361.361 0 0 0 .029-.463.33.33 0 0 0-.464 0c-.547.533-1.684.73-2.512.73-.828 0-1.979-.196-2.512-.73a.326.326 0 0 0-.232-.095z"/>',
  youtube: '<path fill="currentColor" stroke="none" d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814ZM9.545 15.568V8.432L15.818 12l-6.273 3.568Z"/>',
  // The second subpath is the descending bar and must wind the SAME way as the
  // outline, or nonzero fill turns it into a hole and the mark renders hollow.
  brandX: '<path fill="currentColor" stroke="none" d="M18.901 1.153h3.68l-8.04 9.19L24 22.846h-7.406l-5.8-7.584-6.638 7.584H.474l8.6-9.83L0 1.153h7.594l5.243 6.932ZM4.298 3.24h2.188L19.649 20.644H17.61Z"/>',
  // Open outline + larger paint wells: the prior closed silhouette collapsed
  // into a solid grey smudge when rendered at 12–13 px in compact toolbars.
  palette: '<path fill="none" d="M12 21a9 9 0 1 1 9-9"/><path fill="none" d="M21 12a3 3 0 0 1-3 3h-2.2a1.8 1.8 0 0 0-1.3 3l.3.3A1.6 1.6 0 0 1 13.6 21H12"/><circle cx="8" cy="9" r="1" fill="currentColor" stroke="none"/><circle cx="12" cy="6.5" r="1" fill="currentColor" stroke="none"/><circle cx="16.5" cy="8.5" r="1" fill="currentColor" stroke="none"/><circle cx="7" cy="14" r="1" fill="currentColor" stroke="none"/>',
  highlighter: '<path d="m9 11-6 6v3h9l3-3"/><path d="m22 12-4.6 4.6a2 2 0 0 1-2.8 0l-5.2-5.2a2 2 0 0 1 0-2.8L14 4"/>',
  bookmark: '<path d="M6 3h12a1 1 0 0 1 1 1v17l-7-4-7 4V4a1 1 0 0 1 1-1Z"/>',
  bookmarkFill: '<path fill="currentColor" stroke="none" d="M6 2.25h12A1.75 1.75 0 0 1 19.75 4v18.3L12 17.87 4.25 22.3V4A1.75 1.75 0 0 1 6 2.25Z"/>',
  cursor: '<path d="M4.037 4.688a.495.495 0 0 1 .651-.651l16 6.5a.5.5 0 0 1-.063.947l-6.124 1.58a2 2 0 0 0-1.438 1.435l-1.579 6.126a.5.5 0 0 1-.947.063z"/>',
  fit: '<path d="M8 3H5a2 2 0 0 0-2 2v3"/><path d="M21 8V5a2 2 0 0 0-2-2h-3"/><path d="M3 16v3a2 2 0 0 0 2 2h3"/><path d="M16 21h3a2 2 0 0 0 2-2v-3"/>',
  // Corners pushed out (enter full screen) and pulled back in (leave it).
  maximize: '<path d="M8 3H5a2 2 0 0 0-2 2v3"/><path d="M21 8V5a2 2 0 0 0-2-2h-3"/><path d="M3 16v3a2 2 0 0 0 2 2h3"/><path d="M16 21h3a2 2 0 0 0 2-2v-3"/>',
  minimize: '<path d="M8 3v3a2 2 0 0 1-2 2H3"/><path d="M21 8h-3a2 2 0 0 1-2-2V3"/><path d="M3 16h3a2 2 0 0 1 2 2v3"/><path d="M16 21v-3a2 2 0 0 1 2-2h3"/>',
  plus: '<line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>',
  minus: '<line x1="5" y1="12" x2="19" y2="12"/>',
  search: '<circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>',
  filter: '<polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/>',
  sort: '<path d="M7 20V4m-3 3 3-3 3 3M17 4v16m-3-3 3 3 3-3"/>',
  sortAlphabetical: '<path d="m3 10 3-7 3 7M4 8h4M3 14h6l-6 7h6M17 3v18m-3-3 3 3 3-3"/>',
  sync: '<path d="M23 4v6h-6"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>',
  copy: '<rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
  // Copy as clean text: distinct from the generic duplicate mark and legible in
  // compact reader toolbars. The text lines communicate that formatting such as
  // citations and the reference list is deliberately left behind.
  copyText: '<rect x="7" y="3" width="14" height="17" rx="2"/><path d="M3 8v11a2 2 0 0 0 2 2h11"/><path d="M10 8h8M10 12h8M10 16h5"/>',
  gap: '<path d="M5.5 8.5A8 8 0 0 1 14 4.3"/><path d="M18.8 7.1A8 8 0 0 1 19.7 16"/><path d="M16 19.2A8 8 0 0 1 7.9 18"/><path d="M4.3 14A8 8 0 0 1 4.7 11"/><path d="M9 12h6"/>',
  route: '<circle cx="6" cy="19" r="3"/><circle cx="18" cy="5" r="3"/><path d="M9 19h2.5a3.5 3.5 0 0 0 0-7H11a3.5 3.5 0 0 1 0-7h4"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06A1.7 1.7 0 0 0 15 19.4a1.7 1.7 0 0 0-1 .6 1.7 1.7 0 0 0-.4 1v.17a2 2 0 1 1-4 0V21a1.7 1.7 0 0 0-.4-1 1.7 1.7 0 0 0-1-.6 1.7 1.7 0 0 0-1.87.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-.6-1 1.7 1.7 0 0 0-1-.4H2.83a2 2 0 1 1 0-4H3a1.7 1.7 0 0 0 1-.4 1.7 1.7 0 0 0 .6-1 1.7 1.7 0 0 0-.34-1.87l-.06-.06A2 2 0 1 1 7.03 3.44l.06.06A1.7 1.7 0 0 0 9 4.6a1.7 1.7 0 0 0 1-.6 1.7 1.7 0 0 0 .4-1V2.83a2 2 0 1 1 4 0V3a1.7 1.7 0 0 0 .4 1 1.7 1.7 0 0 0 1 .6 1.7 1.7 0 0 0 1.87-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.7 1.7 0 0 0 19.4 9c.22.35.35.7.6 1 .28.28.63.4 1 .4h.17a2 2 0 1 1 0 4H21c-.37 0-.72.12-1 .4-.25.3-.38.65-.6 1Z"/>',
  arrowUp: '<path d="M12 19V5"/><path d="M5 12l7-7 7 7"/>',
  arrowLeft: '<path d="M19 12H5"/><path d="m12 19-7-7 7-7"/>',
  arrowDown: '<path d="M12 5v14"/><path d="M19 12l-7 7-7-7"/>',
  arrowRight: '<path d="M5 12h14"/><path d="m12 5 7 7-7 7"/>',
  columns: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M12 3v18"/>',
  menu: '<circle cx="9" cy="6" r="1"/><circle cx="15" cy="6" r="1"/><circle cx="9" cy="12" r="1"/><circle cx="15" cy="12" r="1"/><circle cx="9" cy="18" r="1"/><circle cx="15" cy="18" r="1"/>',
  moreVertical: '<circle cx="12" cy="5" r="1.1"/><circle cx="12" cy="12" r="1.1"/><circle cx="12" cy="19" r="1.1"/>',
  brain: '<path d="M12 5a3 3 0 1 0-5.997.125 4 4 0 0 0-2.526 5.77 4 4 0 0 0 .556 6.588A4 4 0 1 0 12 18Z"/><path d="M12 5a3 3 0 1 1 5.997.125 4 4 0 0 1 2.526 5.77 4 4 0 0 1-.556 6.588A4 4 0 1 1 12 18Z"/><path d="M15 13a4.5 4.5 0 0 1-3-4 4.5 4.5 0 0 1-3 4"/><path d="M17.599 6.5a3 3 0 0 0 .399-1.375"/><path d="M6.003 5.125A3 3 0 0 0 6.401 6.5"/><path d="M3.477 10.896a4 4 0 0 1 .585-.396"/><path d="M19.938 10.5a4 4 0 0 1 .585.396"/><path d="M6 18a4 4 0 0 1-1.967-.516"/><path d="M19.967 17.484A4 4 0 0 1 18 18"/>',
  pause: '<rect x="6" y="4" width="4" height="16" rx="1"/><rect x="14" y="4" width="4" height="16" rx="1"/>',
  play: '<polygon points="6 4 20 12 6 20 6 4"/>',
  stop: '<rect x="5" y="5" width="14" height="14" rx="2"/>',
  microphone: '<path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><path d="M12 19v3"/><path d="M8 22h8"/>',
  audio: '<path d="M9 18V5l11-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="17" cy="16" r="3"/>',
  video: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m10 9 5 3-5 3Z"/>',
  mail: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/>',
  status: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="3"/><path d="M12 3v3M21 12h-3M12 21v-3M3 12h3"/>',
  phone: '<rect x="6" y="2" width="12" height="20" rx="2.6"/><path d="M10.5 5.4h3"/><path d="M11 18.6h2"/>',
  star: '<polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>',
  sparkles: '<path d="m12 3-1.35 3.65L7 8l3.65 1.35L12 13l1.35-3.65L17 8l-3.65-1.35L12 3Z"/><path d="m5 14-.9 2.1L2 17l2.1.9L5 20l.9-2.1L8 17l-2.1-.9L5 14Z"/><path d="m19 13-1.05 2.95L15 17l2.95 1.05L19 21l1.05-2.95L23 17l-2.95-1.05L19 13Z"/>',
  // A party popper: marks a holiday in the attendance grid (its own drawing, not a copied set).
  partyPopper: '<path d="M4 20 8.5 9l6.5 6.5z"/><path d="M7.3 13.3l3.4 3.4"/><path d="M11 7c-.4-1.8.6-3.2 2.4-3.4"/><path d="M17 13c1.8.4 3.2-.6 3.4-2.4"/><path d="M13.5 10.5 19 5"/><path d="M17 2.5v.01"/><path d="M21.5 7v.01"/><path d="M21 16.5v.01"/>',
  edit: '<path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>',
  lock: '<rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
  shield: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z"/><path d="m9 12 2 2 4-4"/>',
  share: '<circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="m8.6 10.5 6.8-4"/><path d="m8.6 13.5 6.8 4"/>',
  rotateCcw: '<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/>',
  rotateCw: '<path d="M21 12a9 9 0 1 1-3-6.7L21 8"/><path d="M21 3v5h-5"/>',
  unlock: '<rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 9.9-1"/>',
  check: '<polyline points="20 6 9 17 4 12"/>',
  chat: '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>',
  archive: '<polyline points="21 8 21 21 3 21 3 8"/><rect x="1" y="3" width="22" height="5"/><line x1="10" y1="12" x2="14" y2="12"/>',
  key: '<path d="M21 2l-2 2"/><path d="M17 6l-2 2"/><circle cx="7.5" cy="14.5" r="5.5"/><path d="M12 10l7-7 2 2-7 7"/><path d="M7.5 14.5h.01"/>',
  compass: '<circle cx="12" cy="12" r="10"/><polygon points="16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88 16.24 7.76"/>',
  chevronLeft: '<polyline points="15 18 9 12 15 6"/>',
  chevronRight: '<polyline points="9 18 15 12 9 6"/>',
  skipBack: '<polygon points="19 20 9 12 19 4 19 20"/><line x1="5" y1="19" x2="5" y2="5"/>',
  skipForward: '<polygon points="5 4 15 12 5 20 5 4"/><line x1="19" y1="5" x2="19" y2="19"/>',
  chevronDown: '<polyline points="6 9 12 15 18 9"/>',
  chevronUp: '<polyline points="18 15 12 9 6 15"/>',
  notebook: '<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/><line x1="9.5" y1="7" x2="16" y2="7"/><line x1="9.5" y1="11" x2="14" y2="11"/>',
  folderMove: '<path d="M20 8V6a2 2 0 0 0-2-2h-7L9 2H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h8"/><path d="M14 14h8m-4-4 4 4-4 4"/>',
  folderPlus: '<path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/><line x1="12" y1="11" x2="12" y2="17"/><line x1="9" y1="14" x2="15" y2="14"/>',
  bold: '<path d="M6 4h8a4 4 0 0 1 4 4 4 4 0 0 1-4 4H6z"/><path d="M6 12h9a4 4 0 0 1 4 4 4 4 0 0 1-4 4H6z"/>',
  italic: '<line x1="19" y1="4" x2="10" y2="4"/><line x1="14" y1="20" x2="5" y2="20"/><line x1="15" y1="4" x2="9" y2="20"/>',
  strikethrough: '<path d="M16 4H9a3 3 0 0 0-2.83 4"/><path d="M14 12a4 4 0 0 1 0 8H6"/><line x1="4" y1="12" x2="20" y2="12"/>',
  heading: '<path d="M6 4v16"/><path d="M18 4v16"/><path d="M6 12h12"/>',
  list: '<line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/>',
  grid: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',
  qrCode: '<rect x="3" y="3" width="6" height="6" rx="1"/><rect x="15" y="3" width="6" height="6" rx="1"/><rect x="3" y="15" width="6" height="6" rx="1"/><path d="M6 6h.01M18 6h.01M6 18h.01M12 3v3M12 9v3H9M3 12h3M15 12h3v3h3M12 15v3h3v3h3M21 18v3M12 21h.01"/>',
  clock: '<circle cx="12" cy="12" r="9"/><polyline points="12 7 12 12 15 14"/>',
  // The Marketplace's own mark, reduced to a line glyph: the header rail is a row of
  // 2px strokes, and the gradient basket would read as a sticker among them.
  basket: '<path d="M4 9h16l-1.5 10a2 2 0 0 1-2 1.7H7.5a2 2 0 0 1-2-1.7z"/><path d="M3 9h18"/><path d="m7.5 9 3-5"/><path d="m16.5 9-3-5"/>',
  quote: '<path d="M3 21c3 0 7-1 7-8V5c0-1.25-.756-2-2-2H4c-1.25 0-2 .75-2 2v6c0 1.25.75 2 2 2h2.5"/><path d="M14 21c3 0 7-1 7-8V5c0-1.25-.757-2-2-2h-4c-1.25 0-2 .75-2 2v6c0 1.25.75 2 2 2h2.5"/>',
  code: '<polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/>',
  link: '<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>',
  eye: '<path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7z"/><circle cx="12" cy="12" r="3"/>',
  eyeOff: '<path d="M9.88 9.88a3 3 0 0 0 4.24 4.24"/><path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68"/><path d="M6.61 6.61A13.526 13.526 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61"/><line x1="2" y1="2" x2="22" y2="22"/>',
  graduation: '<path d="M22 10L12 5 2 10l10 5 10-5z"/><path d="M6 12v5c0 1 2.5 2.5 6 2.5s6-1.5 6-2.5v-5"/>',
  globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18"/><path d="M12 3a14 14 0 0 1 0 18"/><path d="M12 3a14 14 0 0 0 0 18"/>',
  rss: '<path d="M4 11a9 9 0 0 1 9 9"/><path d="M4 4a16 16 0 0 1 16 16"/><circle cx="5" cy="19" r="1.5" fill="currentColor" stroke="none"/>',
  presentation: '<rect x="3" y="3" width="18" height="13" rx="2"/><path d="M8 21l4-5 4 5"/><path d="M12 16v5"/><path d="M7 8h4"/><path d="M7 12h7"/>',
  quiz: '<rect x="3" y="3" width="18" height="18" rx="3"/><path d="M8 8.5l1.5 1.5L12 7.5"/><path d="M14 9h3"/><path d="M8 15.5l1.5 1.5 2.5-2.5"/><path d="M14 16h3"/>',
  exam: '<path d="M6 3h9l3 3v15H6z"/><path d="M14 3v4h4"/><path d="M9 11h6"/><path d="M9 15h4"/><path d="m15 18 4-4"/>',
  flashcards: '<rect x="5" y="4" width="15" height="16" rx="2"/><path d="M5 8H3a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2"/><path d="M9 9h7"/><path d="M9 13h5"/>',
  map: '<line x1="6" y1="3" x2="6" y2="15"/><circle cx="18" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M18 9a9 9 0 0 1-9 9"/>',
  telescope: '<path d="m10.065 12.493-6.18 1.318a.934.934 0 0 1-1.108-.702l-.537-2.15a1.07 1.07 0 0 1 .691-1.265l13.504-4.44"/><path d="m13.56 11.747 4.332-.924"/><path d="m16 21-3.105-6.21"/><path d="M16.485 5.94a2 2 0 0 1 1.455-2.425l1.09-.272a1 1 0 0 1 1.212.727l1.515 6.06a1 1 0 0 1-.727 1.213l-1.09.272a2 2 0 0 1-2.425-1.455z"/><path d="m6.158 8.633 1.114 4.456"/><path d="m8 21 3.105-6.21"/><circle cx="12" cy="13" r="2"/>',
  network: '<circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/>',
  scale: '<path d="M12 3v18"/><path d="M7 21h10"/><path d="M5 7h14"/><path d="M6 4l-1 3"/><path d="M18 4l1 3"/><path d="M5 7l-3 6a3 3 0 0 0 6 0z"/><path d="M19 7l-3 6a3 3 0 0 0 6 0z"/>',
  flask: '<path d="M9 3h6"/><path d="M10 3v5.6L4.2 18.7A2.2 2.2 0 0 0 6.1 22h11.8a2.2 2.2 0 0 0 1.9-3.3L14 8.6V3"/><path d="M7.5 16h9"/><path d="M8.8 19h6.4"/>',
  // Study focus sessions: a viewfinder closing in on one point — attention, not time
  // (the clock already means schedules, history and the task queue).
  focus: '<circle cx="12" cy="12" r="3"/><path d="M3 7V5a2 2 0 0 1 2-2h2M17 3h2a2 2 0 0 1 2 2v2M21 17v2a2 2 0 0 1-2 2h-2M7 21H5a2 2 0 0 1-2-2v-2"/>',
  target: '<circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/>',
  radar: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.5"/><path d="M12 12 18.4 5.6"/><path d="M17.4 10.2a6 6 0 0 1 .5 3"/>',
  users: '<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
  user: '<path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>',
  tree: '<circle cx="12" cy="5" r="2.5"/><circle cx="5" cy="19" r="2.5"/><circle cx="19" cy="19" r="2.5"/><path d="M12 7.5V12"/><path d="M12 12H5v4.5"/><path d="M12 12h7v4.5"/>',
  gitPr: '<circle cx="6" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M6 9v6"/><circle cx="18" cy="18" r="3"/><path d="M13 6h3a2 2 0 0 1 2 2v7"/><path d="M11 4l2 2-2 2"/>',
  tools: '<path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/>',
  // Graph research actions. These four glyphs deliberately belong only to the
  // graph action strip, so each action keeps a unique visual meaning in Nodus.
  tutorOrbit: '<circle cx="12" cy="12" r="3"/><path d="M4.2 8.2C6.6 3.8 12 1.8 16.6 3.7c4.5 1.9 6.6 7 4.7 11.5"/><path d="m17.6 2.8-1 4 4-1"/><path d="M19.8 15.8C17.4 20.2 12 22.2 7.4 20.3c-4.5-1.9-6.6-7-4.7-11.5"/><path d="m6.4 21.2 1-4-4 1"/>',
  themePetals: '<path d="M12 12C6 11.2 4.2 7 6.1 4.7 8 2.4 11.5 4.3 12 12Z"/><path d="M12 12c.8-6 5-7.8 7.3-5.9 2.3 1.9.4 5.4-7.3 5.9Z"/><path d="M12 12c6 .8 7.8 5 5.9 7.3-1.9 2.3-5.4.4-5.9-7.3Z"/><path d="M12 12c-.8 6-5 7.8-7.3 5.9-2.3-1.9-.4-5.4 7.3-5.9Z"/>',
  duplicateConverge: '<circle cx="5" cy="6" r="2.5"/><circle cx="5" cy="18" r="2.5"/><circle cx="19" cy="12" r="2.5"/><path d="M7.5 6h2.2a4 4 0 0 1 3.5 2.1l1 1.9M7.5 18h2.2a4 4 0 0 0 3.5-2.1l1-1.9M14 12h2.5"/>',
  relationLedger: '<path d="M7 3h10a2 2 0 0 1 2 2v16H5V5a2 2 0 0 1 2-2Z"/><path d="M9 8h6M9 12h2M13 12h2M9 16h2M13 16h2"/><path d="m3 7 2 2 3-3"/>',
  swap: '<polyline points="17 1 21 5 17 9"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><polyline points="7 23 3 19 7 15"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/>',
  scanText: '<path d="M3 7V5a2 2 0 0 1 2-2h2"/><path d="M17 3h2a2 2 0 0 1 2 2v2"/><path d="M21 17v2a2 2 0 0 1-2 2h-2"/><path d="M7 21H5a2 2 0 0 1-2-2v-2"/><path d="M7 8h8"/><path d="M7 12h10"/><path d="M7 16h6"/>',
  bug: '<path d="M8 2l1.5 1.5"/><path d="M16 2l-1.5 1.5"/><path d="M9 7a3 3 0 0 1 6 0v1H9V7Z"/><rect x="7" y="8" width="10" height="10" rx="5"/><path d="M12 12v6"/><path d="M7 12H3"/><path d="M21 12h-4"/><path d="M6.5 7 4 5"/><path d="M17.5 7 20 5"/><path d="M6.5 17 4 19"/><path d="M17.5 17 20 19"/>',
  plug: '<path d="M9 2v6"/><path d="M15 2v6"/><path d="M6 8h12v3a6 6 0 0 1-12 0V8Z"/><path d="M12 17v5"/>',
  // Word / LibreOffice copilot plugins: a puzzle piece, the universal "add-in" mark.
  puzzle: '<path d="M15.5 3a2 2 0 0 1 2 2v1.5a1 1 0 0 0 1.6.8 1.8 1.8 0 1 1 0 3.4 1 1 0 0 0-1.6.8V16a2 2 0 0 1-2 2h-2.9a1 1 0 0 1-.8-1.6 1.8 1.8 0 1 0-3 0A1 1 0 0 1 8.9 18H6a2 2 0 0 1-2-2v-2.9a1 1 0 0 1 1.6-.8 1.8 1.8 0 1 0 0-3A1 1 0 0 1 4 8.5V5a2 2 0 0 1 2-2h3.2a1 1 0 0 0 .8-1.6"/>',
  // The mascot's face fills the circle: at the 13px the release chip renders, rays
  // or satellite nodes turn it into a smudge.
  nodi: '<circle cx="12" cy="12" r="8.5"/><path d="M9 10.5h.01"/><path d="M15 10.5h.01"/><path d="M9 14.5a4 4 0 0 0 6 0"/>',
  // AirPlay / Screen Mirroring (PDF Presenter).
  cast: '<path d="M2 16.1A5 5 0 0 1 5.9 20M2 12.05A9 9 0 0 1 9.95 20M2 8V6a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-6"/><line x1="2" y1="20" x2="2.01" y2="20"/>',
  // System volume (PDF Presenter).
  volume: '<polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07"/>',
  volumeOff: '<polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07"/><line x1="3" y1="3" x2="21" y2="21"/>',
  // What has arrived from other devices (the header Inbox).
  inbox: '<polyline points="22 12 16 12 14 15 10 15 8 12 2 12"/><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/>',
  // Nodus Drift: the tool itself and the sounds of its catalogue (rain, nature, animals, places, things, transport, urban, noise, binaural).
  drift: '<path d="M5 13.5V12a7 7 0 0 1 14 0v1.5"/><rect x="3" y="13.5" width="4" height="6.5" rx="1.5"/><rect x="17" y="13.5" width="4" height="6.5" rx="1.5"/><path d="M9.5 16.7c.9-1.7 1.7-1.7 2.5 0s1.6 1.7 2.5 0"/>',
  cloudDrizzle: '<path d="M17.5 14.5H7a4 4 0 0 1-.6-7.95A5.5 5.5 0 0 1 17 6.1a4.2 4.2 0 0 1 .5 8.4z"/><path d="M8 18v.01M12 18v.01M16 18v.01M10 21v.01M14 21v.01"/>',
  cloudRain: '<path d="M17.5 14.5H7a4 4 0 0 1-.6-7.95A5.5 5.5 0 0 1 17 6.1a4.2 4.2 0 0 1 .5 8.4z"/><path d="m8 17.5-1 3m5-3-1 3m5-3-1 3"/>',
  cloudLightning: '<path d="M17.5 14.5H16M9 14.5H7a4 4 0 0 1-.6-7.95A5.5 5.5 0 0 1 17 6.1a4.2 4.2 0 0 1 .5 8.4"/><path d="m12.5 11-3 4.5h4l-2.5 4.5"/>',
  window: '<rect x="4" y="3" width="16" height="18" rx="1.5"/><path d="M12 3v18M4 12h16"/>',
  car: '<path d="M3 17v-4.5l2-5A2 2 0 0 1 6.9 6h10.2a2 2 0 0 1 1.9 1.5l2 5V17h-2.2"/><path d="M3 17h2.2M9.8 17h4.4M3 12.5h18"/><circle cx="7.5" cy="17" r="2.3"/><circle cx="16.5" cy="17" r="2.3"/>',
  umbrella: '<path d="M3 12a9 9 0 0 1 18 0z"/><path d="M12 12v6a2 2 0 0 1-4 0"/><path d="M12 3v.01"/>',
  tent: '<path d="M2.5 20 12 4l9.5 16z"/><path d="M12 4v3M9.5 20 12 15l2.5 5"/>',
  leaf: '<path d="M20 4C10.5 4.5 5 10.5 5 16a3.5 3.5 0 0 0 3.5 3.5C14 19.5 19.5 14 20 4z"/><path d="M5 20 14 11"/>',
  waves: '<path d="M2 7c1.7-2 3.3-2 5 0s3.3 2 5 0 3.3-2 5 0 3.3 2 5 0M2 12c1.7-2 3.3-2 5 0s3.3 2 5 0 3.3-2 5 0 3.3 2 5 0M2 17c1.7-2 3.3-2 5 0s3.3 2 5 0 3.3-2 5 0 3.3 2 5 0"/>',
  flame: '<path d="M12 21.5a6 6 0 0 0 6-6c0-3.8-2.8-5.5-4.3-9.5-1 2.8-2.6 3.4-3.7 5C8.7 12.4 6 12.8 6 15.5a6 6 0 0 0 6 6z"/><path d="M12 21.5a2.6 2.6 0 0 0 2.6-2.6c0-1.7-1.3-2.4-2.6-4-1.3 1.6-2.6 2.3-2.6 4A2.6 2.6 0 0 0 12 21.5z"/>',
  wind: '<path d="M3 8h9.5a2.5 2.5 0 1 0-2.5-2.5"/><path d="M3 12h15a2.5 2.5 0 1 1-2.5 2.5"/><path d="M3 16h7a2.5 2.5 0 1 1-2.5 2.5"/>',
  treePine: '<path d="M12 3 7 10h3l-4 6h12l-4-6h3z"/><path d="M12 16v5"/>',
  waterfall: '<path d="M4 4h16"/><path d="M8 4v9M12 4v11M16 4v9"/><path d="M4 18c1.3-1.4 2.7-1.4 4 0s2.7 1.4 4 0 2.7-1.4 4 0 2.7 1.4 4 0"/>',
  snowflake: '<path d="M12 3v18M4.2 7.5l15.6 9M4.2 16.5l15.6-9"/><path d="m9.7 4.8 2.3 2.2 2.3-2.2M9.7 19.2l2.3-2.2 2.3 2.2"/>',
  pebbles: '<circle cx="8" cy="15.5" r="3.2"/><circle cx="16.5" cy="16.5" r="3"/><circle cx="12.5" cy="8" r="3.2"/>',
  droplet: '<path d="M12 3s6 6.4 6 11a6 6 0 0 1-12 0c0-4.6 6-11 6-11z"/>',
  bird: '<path d="M2.5 9C6 6.5 10 7.5 12 12.5c2-5 6-6 9.5-3.5"/><path d="M8 18c1.7-1.2 3-.9 4 .5 1-1.4 2.3-1.7 4-.5"/>',
  paw: '<circle cx="7" cy="9" r="1.9"/><circle cx="12" cy="6.5" r="1.9"/><circle cx="17" cy="9" r="1.9"/><path d="M12 12.5c-3.2 0-5.5 2.7-5.5 5 0 1.6 1.3 2.5 2.8 2.5 1.1 0 1.9-.6 2.7-.6s1.6.6 2.7.6c1.5 0 2.8-.9 2.8-2.5 0-2.3-2.3-5-5.5-5z"/>',
  fish: '<path d="M3 12c2.5-4 6-5.5 9.5-4.5C15 8.2 16.6 9.6 18 12c-1.4 2.4-3 3.8-5.5 4.5C9 17.5 5.5 16 3 12z"/><path d="m18 12 3.5-3.5v7z"/><path d="M7.5 11.2v.01"/>',
  hexagon: '<path d="M12 2.5 20 7v10l-8 4.5L4 17V7z"/><path d="M12 8.5 15 10.25v3.5L12 15.5 9 13.75v-3.5z"/>',
  road: '<path d="M8.5 3 4 21M15.5 3 20 21"/><path d="M12 5v3M12 11v3M12 17v3"/>',
  siren: '<path d="M7 18v-6a5 5 0 0 1 10 0v6"/><path d="M5 18h14v3H5z"/><path d="M12 2v2M4.5 5l1.4 1.4M19.5 5l-1.4 1.4M2 12h2M20 12h2"/>',
  coffee: '<path d="M5 9h11v6a4 4 0 0 1-4 4H9a4 4 0 0 1-4-4z"/><path d="M16 10h1.5a2.5 2.5 0 0 1 0 5H16"/><path d="M8 3c-.7 1-.7 2 0 3M12 3c-.7 1-.7 2 0 3"/>',
  plane: '<path d="M12 2.5c1 0 1.7.9 1.7 2v5.2l7.3 4v2l-7.3-2.2v4.5l2 1.5V21L12 20l-3.7 1v-1.5l2-1.5v-4.5L3 15.7v-2l7.3-4V4.5c0-1.1.7-2 1.7-2z"/>',
  landmark: '<path d="M3 21h18"/><path d="M5 21V10M9.7 21V10M14.3 21V10M19 21V10"/><path d="M12 3 3 9h18z"/>',
  train: '<rect x="5" y="3" width="14" height="14" rx="3"/><path d="M5 11h14"/><path d="M9 14.2v.01M15 14.2v.01"/><path d="m8 21 2-4M16 21l-2-4"/>',
  utensils: '<path d="M5 3v6a3 3 0 0 0 6 0V3"/><path d="M8 12v9"/><path d="M17 21V3c-2.2 1.3-3.5 4-3.5 7.5H17"/>',
  keyboard: '<rect x="2.5" y="6" width="19" height="12" rx="2"/><path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M6 14h.01M18 14h.01M9.5 14h5"/>',
  fan: '<circle cx="12" cy="12" r="1.6"/><ellipse cx="12" cy="6.5" rx="2.2" ry="3.5"/><ellipse cx="12" cy="6.5" rx="2.2" ry="3.5" transform="rotate(120 12 12)"/><ellipse cx="12" cy="6.5" rx="2.2" ry="3.5" transform="rotate(240 12 12)"/>',
  radio: '<rect x="3" y="8" width="18" height="13" rx="2"/><path d="m7 8 10-5"/><circle cx="8.5" cy="14.5" r="2.5"/><path d="M14 13h4M14 16h4"/>',
  disc: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="2.5"/><path d="M12 6.5a5.5 5.5 0 0 1 5.5 5.5"/>',
  washer: '<rect x="4" y="2.5" width="16" height="19" rx="2"/><path d="M4 7.5h16"/><circle cx="12" cy="14.5" r="4"/><path d="M7.5 5h.01M10.5 5h.01"/>',
  waveform: '<path d="M3 12v.01M6 9v6M9 5v14M12 8v8M15 3v18M18 8v8M21 11v2"/>',
  sine: '<path d="M2 10c2-5 4-5 6 0s4 5 6 0 4-5 6 0"/><path d="M2 15c1.5-4 3-4 4.5 0s3 4 4.5 0 3-4 4.5 0 3 4 4.5 0"/>',
  sailboat: '<path d="M12 3v14"/><path d="M12 4l7 11h-7"/><path d="M12 8 7 15h5"/><path d="M4 19h16l-2 2H6z"/>',
};

/** Complete renderer-owned icon catalogue. Pickers should consume this list so
 * newly added icons automatically become available without duplicating it. */
export const ICON_NAMES = Object.freeze(Object.keys(ICON_PATHS).sort());

export function Icon({ name, size = 16, className = '' }: { name: keyof typeof ICON_PATHS | string; size?: number; className?: string }) {
  const path = ICON_PATHS[name];
  if (!path) return null;
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`inline-block shrink-0 ${className}`}
      aria-hidden="true"
      dangerouslySetInnerHTML={{ __html: path }}
    />
  );
}

export function Badge({
  children,
  color = 'neutral',
  title,
}: {
  children: React.ReactNode;
  color?: 'neutral' | 'indigo' | 'green' | 'amber' | 'red' | 'cyan';
  title?: string;
}) {
  const map: Record<string, string> = {
    neutral: 'bg-neutral-800 text-neutral-300',
    indigo: 'bg-indigo-900/50 text-indigo-300',
    green: 'bg-emerald-900/50 text-emerald-300',
    amber: 'bg-amber-900/50 text-amber-300',
    red: 'bg-red-900/50 text-red-300',
    cyan: 'bg-cyan-900/50 text-cyan-300',
  };
  return (
    <span title={title} className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs ${map[color]}`}>
      {children}
    </span>
  );
}

/**
 * Small "generated with AI" marker overlaid on an image. Used on decorative images
 * (Deep Research / immersion), genealogy reference portraits, and AI-generated
 * database attachments so an AI likeness is never mistaken for a real photograph.
 * Render inside a `relative` container; `corner` picks which corner it pins to.
 */
export function AiBadge({
  corner = 'bottom-right',
  size = 'md',
  className = '',
}: {
  corner?: 'bottom-right' | 'bottom-left' | 'top-right' | 'top-left';
  size?: 'sm' | 'md';
  className?: string;
}) {
  const pos: Record<string, string> = {
    'bottom-right': 'bottom-1 right-1',
    'bottom-left': 'bottom-1 left-1',
    'top-right': 'top-1 right-1',
    'top-left': 'top-1 left-1',
  };
  const pad = size === 'sm' ? 'px-1 py-0.5 text-[9px] gap-0.5' : 'px-1.5 py-0.5 text-[10px] gap-1';
  return (
    <span
      title={t('Generado con IA')}
      className={`ai-image-badge pointer-events-none absolute ${pos[corner]} z-10 inline-flex items-center rounded-full font-medium uppercase tracking-wide backdrop-blur-sm ${pad} ${className}`}
    >
      <Icon name="wand" size={size === 'sm' ? 9 : 11} />
      {t('IA')}
    </span>
  );
}

/**
 * An action rendered as an icon that opens its label on hover or keyboard focus, so a
 * row of them reads as a clean rail of icons instead of a wall of text.
 *
 * Shared by the titlebar's action rail and the Deep Research reader header. The label
 * is always in the accessibility tree (`aria-label` plus the `title` tooltip); only its
 * width is animated, so nothing is hidden from a screen reader or a pointerless user.
 * `showLabel` pins the text open — use it for an action in progress or one that must be
 * noticed. `iconOnly` keeps the width fixed and exposes the label through the tooltip.
 * Sizing and tone come from `className` (`h-9 min-h-9 btn-ghost`, …).
 */
export function HoverLabelButton({
  icon,
  label,
  onClick,
  title,
  className = '',
  spinning = false,
  showLabel = false,
  iconOnly = false,
  disabled = false,
  trailing,
  ...rest
}: {
  icon: string;
  label: string;
  onClick: (event: React.MouseEvent<HTMLButtonElement>) => void;
  title?: string;
  className?: string;
  spinning?: boolean;
  showLabel?: boolean;
  iconOnly?: boolean;
  disabled?: boolean;
  /** Rendered inside the expanding label (a keyboard shortcut, a dropdown chevron). */
  trailing?: React.ReactNode;
  'data-tour'?: string;
  'data-vault-trigger'?: string;
  'data-inbox-trigger'?: string;
  'data-notifications-trigger'?: string;
  'data-testid'?: string;
  'aria-pressed'?: boolean;
  'aria-expanded'?: boolean;
  'aria-haspopup'?: 'dialog' | 'menu';
}) {
  return (
    <button
      {...rest}
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title ?? label}
      aria-label={label}
      className={`header-action group btn justify-center px-2.5 py-0 leading-none ${className}`}
    >
      <Icon name={icon} className={spinning ? 'animate-spin' : ''} />
      {!iconOnly && <span
        className={`flex items-center overflow-hidden whitespace-nowrap transition-all duration-200 ${
          showLabel
            ? 'ml-1.5 max-w-[14rem] opacity-100'
            : 'ml-0 max-w-0 opacity-0 group-hover:ml-1.5 group-hover:max-w-[14rem] group-hover:opacity-100 group-focus-visible:ml-1.5 group-focus-visible:max-w-[14rem] group-focus-visible:opacity-100'
        }`}
      >
        {label}
        {trailing}
      </span>}
    </button>
  );
}

export function Spinner({ label }: { label?: string }) {
  return (
    <div className="flex items-center gap-2 text-neutral-400 text-sm">
      <span className="inline-block w-4 h-4 border-2 border-neutral-600 border-t-indigo-400 rounded-full animate-spin" />
      {label}
    </div>
  );
}

/**
 * The pane of a section on its way back to what it had open.
 *
 * A section is unmounted when you leave it, so walking back into one that was left
 * on a report or a session means reading that report back before it can be drawn.
 * What must NOT be drawn in the meantime is the section's gallery: it is a screen
 * full of content, and painting it for the two or three frames the read takes reads
 * as the app opening the list and then clicking the item by itself.
 *
 * So the pane stays quiet instead. It is empty at first — a spinner that appears and
 * vanishes inside 60ms is its own flicker — and only starts spinning if the read is
 * slow enough that the reader would otherwise wonder whether anything is happening.
 */
export function RestoringPane({ delayMs = 250 }: { delayMs?: number }) {
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setSlow(true), delayMs);
    return () => clearTimeout(timer);
  }, [delayMs]);
  return (
    <div className="flex h-full items-center justify-center" data-testid="section-restoring">
      {slow && <Spinner />}
    </div>
  );
}

export function TypeDot({ type }: { type: GraphNodeType }) {
  const color = type === 'author' ? '#a3a3a3' : NODE_COLORS[type];
  return <span className="inline-block h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: color }} />;
}

/**
 * Backdrop for the app's ad-hoc modals.
 *
 * Closes on Escape and on a click outside the panel, which ConfirmModal already did
 * and every hand-rolled modal did not — a dialog that can only be dismissed by finding
 * its button traps the user, and traps automated checks too.
 */
/**
 * Open backdrops, innermost last.
 *
 * Every backdrop listens on `window`, so without a stack an Escape inside a nested
 * dialog closes BOTH it and its parent — the user loses the screen behind the one they
 * meant to dismiss. Only the topmost entry acts.
 */
const backdropStack: symbol[] = [];

export function ModalBackdrop({
  onClose,
  children,
  zIndex = 130,
}: {
  onClose: () => void;
  children: React.ReactNode;
  zIndex?: number;
}) {
  // The handler is read through a ref so this effect can depend on NOTHING and run
  // exactly once per mount. Depending on `onClose` — which is a fresh closure on every
  // render — would re-register the parent dialog ON TOP of a child it already opened,
  // and Escape would then dismiss the wrong one.
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    const id = Symbol('backdrop');
    backdropStack.push(id);
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      if (backdropStack[backdropStack.length - 1] !== id) return;
      closeRef.current();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      const index = backdropStack.indexOf(id);
      if (index >= 0) backdropStack.splice(index, 1);
    };
  }, []);

  return (
    <div
      className="fixed inset-0 grid place-items-center bg-black/60 p-4"
      style={{ zIndex }}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      {children}
    </div>
  );
}
