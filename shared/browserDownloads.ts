// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Jorge Pérez Burgueño and Nodus contributors

/**
 * How a download is classified, and what Nodus offers to do with it.
 *
 * Pure and Electron-free so the table can be asserted directly
 * (scripts/test-browser-downloads.mjs). The classification decides whether the
 * user is offered "save and import into the Library", so getting it wrong is
 * either a missing offer on a paper or a nonsense offer on an installer.
 */

/** What kind of thing arrived. */
export type DownloadKind = 'pdf' | 'document' | 'dataset' | 'media' | 'other';

/** Extensions worth importing, mapped to their kind. Mirrors the detector's table. */
const BY_EXTENSION: Record<string, DownloadKind> = {
  pdf: 'pdf',
  epub: 'document', doc: 'document', docx: 'document', odt: 'document', rtf: 'document',
  txt: 'document', md: 'document', xml: 'document', jats: 'document', html: 'document', htm: 'document',
  csv: 'dataset', tsv: 'dataset', xls: 'dataset', xlsx: 'dataset', ods: 'dataset',
  ppt: 'document', pptx: 'document', odp: 'document',
  mp3: 'media', m4a: 'media', wav: 'media', ogg: 'media', flac: 'media', mp4: 'media', webm: 'media',
};

const BY_MIME: Record<string, DownloadKind> = {
  'application/pdf': 'pdf',
  'application/epub+zip': 'document',
  'application/msword': 'document',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'document',
  'application/vnd.oasis.opendocument.text': 'document',
  'application/rtf': 'document',
  'text/plain': 'document',
  'text/markdown': 'document',
  'text/csv': 'dataset',
  'text/tab-separated-values': 'dataset',
  'application/vnd.ms-excel': 'dataset',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'dataset',
};

/** The largest download Nodus will accept at all. */
export const MAX_DOWNLOAD_BYTES = 2 * 1024 * 1024 * 1024;

/** The largest download Nodus will route through the Library import path. */
export const MAX_IMPORTABLE_BYTES = 64 * 1024 * 1024;

/** A site-controlled Content-Disposition value must never become a path. */
export function safeBrowserDownloadName(value: unknown): string {
  const leaf = String(value ?? '').replace(/\\/g, '/').split('/').at(-1) ?? '';
  const clean = leaf
    // eslint-disable-next-line no-control-regex -- Content-Disposition is hostile input
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/[/:]/g, '-')
    .trim()
    .replace(/^\.+$/, '');
  return clean.slice(0, 240) || 'download';
}

/**
 * Where a download with this (already cleaned) name goes inside `folder`: never onto a file that
 * is already there, and never as a hidden dot-file. A page chooses the name, and with a
 * configured folder there is no dialog — so `paper.pdf` silently replaced the paper the user
 * downloaded yesterday, and `.zshrc` would have replaced a shell profile in a folder that is
 * also home to one. The next free `name (n).ext` is used instead, as browsers do.
 *
 * `join` and `exists` are passed in so this stays free of Node in the shared bundle.
 */
export function availableDownloadPath(
  folder: string,
  filename: string,
  exists: (candidate: string) => boolean,
  join: (folder: string, name: string) => string,
): string {
  const visible = filename.replace(/^\.+/, '') || 'download';
  const dot = visible.lastIndexOf('.');
  const stem = dot > 0 ? visible.slice(0, dot) : visible;
  const extension = dot > 0 ? visible.slice(dot) : '';
  for (let n = 0; n < 10_000; n++) {
    const candidate = join(folder, n === 0 ? visible : `${stem} (${n})${extension}`);
    if (!exists(candidate)) return candidate;
  }
  return join(folder, `${stem} (${Date.now()})${extension}`);
}

function extensionOf(filename: string): string {
  const match = /\.([A-Za-z0-9]+)$/.exec(filename.trim());
  return match ? match[1].toLowerCase() : '';
}

/**
 * Classify a download.
 *
 * MIME wins over extension when it is one we recognise, because a server that
 * declares application/pdf is more reliable than a URL ending in `.php`. But an
 * unhelpful generic MIME — which is most of them — falls back to the extension
 * rather than giving up.
 */
export function classifyDownload(filename: string, mimeType: string): DownloadKind {
  const mime = String(mimeType ?? '').split(';')[0].trim().toLowerCase();
  if (Object.hasOwn(BY_MIME, mime)) return BY_MIME[mime];

  const extension = extensionOf(String(filename ?? ''));
  if (Object.hasOwn(BY_EXTENSION, extension)) return BY_EXTENSION[extension];

  // Generic containers say nothing useful on their own.
  if (mime.startsWith('audio/') || mime.startsWith('video/')) return 'media';
  return 'other';
}

/**
 * Whether Nodus should offer to import this into the Library.
 *
 * Media is deliberately excluded even though the Library accepts audio and
 * video: a download of one is nearly always a file the user wants on disk, and
 * offering an import for every MP3 turns the prompt into noise. Size is the
 * other gate — the import path holds the bytes in memory.
 */
export function isImportable(kind: DownloadKind, totalBytes: number): boolean {
  if (kind !== 'pdf' && kind !== 'document' && kind !== 'dataset') return false;
  // A server that does not declare a length reports 0; allow it, and let the
  // byte cap during transfer catch it if it turns out to be enormous.
  return totalBytes <= MAX_IMPORTABLE_BYTES;
}

/** Whether the download should be refused outright. */
export function isTooLarge(totalBytes: number): boolean {
  return totalBytes > MAX_DOWNLOAD_BYTES;
}
