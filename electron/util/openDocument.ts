// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Jorge Pérez Burgueño and Nodus contributors

import { shell } from 'electron';
import { launchesOnOpen } from './launchableFiles';

/** `shell.openPath` for a document that may have come from someone else: a file that would RUN
 *  when opened is shown in its folder instead, and the user decides. Same return as openPath:
 *  '' on success, otherwise the reason. */
export async function openDocumentPath(filePath: string): Promise<string> {
  if (launchesOnOpen(filePath)) {
    shell.showItemInFolder(filePath);
    return '';
  }
  return shell.openPath(filePath);
}
