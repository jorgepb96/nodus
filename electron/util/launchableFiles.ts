// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Jorge Pérez Burgueño and Nodus contributors

import fs from 'node:fs';
import path from 'node:path';

/** Extensions macOS (and the usual add-ons) RUN, or hand to something that runs them, when the
 *  file is opened: a script in Terminal, a bundle, an installer, a link that opens an arbitrary
 *  URL or path. A preserved source or a library attachment can arrive from someone else (a
 *  research package, server sync, a Zotero group), and the copy Nodus writes for "open" carries no
 *  quarantine flag, so opening `transcription.command` would run it without a Gatekeeper prompt. */
const LAUNCHING_EXTENSIONS = new Set([
  'app', 'command', 'tool', 'sh', 'bash', 'zsh', 'csh', 'ksh', 'fish', 'terminal', 'term',
  'fileloc', 'webloc', 'inetloc', 'url', 'jar', 'jnlp', 'pkg', 'mpkg', 'scpt', 'scptd',
  'applescript', 'workflow', 'action', 'prefpane', 'saver', 'qlgenerator', 'osax', 'kext',
  'bundle', 'plugin', 'dylib', 'shortcut', 'definition', 'py', 'pyw', 'pl', 'rb', 'php',
  'mobileconfig', 'configprofile', 'xpc', 'service', 'appex', 'widget',
]);

/** True when opening this path would run something rather than show a document. A directory is a
 *  bundle; an extensionless file with an execute bit opens in Terminal and runs. */
export function launchesOnOpen(filePath: string): boolean {
  const extension = path.extname(filePath).slice(1).toLowerCase();
  if (LAUNCHING_EXTENSIONS.has(extension)) return true;
  let stat: fs.Stats;
  try { stat = fs.statSync(filePath); } catch { return false; }
  if (stat.isDirectory()) return true;
  return !extension && (stat.mode & 0o111) !== 0;
}
