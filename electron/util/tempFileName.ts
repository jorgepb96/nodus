// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Jorge Pérez Burgueño and Nodus contributors

import path from 'node:path';

/** A file directly inside `folder`, named from a record id. Ids can arrive by sync or import, so
 *  `/../../Documents/x` must not climb out: everything but letters, digits, `_` and `-` goes. */
export function tempFileFor(folder: string, prefix: string, id: string, extension: string): string {
  const stem = String(id).replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 80) || 'item';
  return path.join(folder, `${prefix}${stem}${extension}`);
}
