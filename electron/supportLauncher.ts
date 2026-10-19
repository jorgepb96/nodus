import { app, dialog, shell } from 'electron';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { supportText } from '../shared/support/messages';
import type { AppLanguage } from '../shared/types';

export async function openNodusSupport(language: AppLanguage): Promise<void> {
  const resources = process.resourcesPath;
  const executable = process.platform === 'darwin'
    ? path.join(resources, 'nodus-support/Nodus Support.app/Contents/MacOS/nodus-support')
    : path.join(resources, 'nodus-support/app', process.platform === 'win32' ? 'nodus-support.exe' : 'nodus-support');
  if (!fs.existsSync(executable)) {
    await shell.openExternal('https://github.com/jorgepb96/nodus/releases/latest'); return;
  }
  const response = await dialog.showMessageBox({ type: 'info', message: supportText(language, 'title'), detail: supportText(language, 'backupHelp'), buttons: [supportText(language, 'cancel'), supportText(language, 'confirm')], defaultId: 0, cancelId: 0, noLink: true });
  if (response.response !== 1) return;
  const installed = process.platform === 'linux' && process.env.APPIMAGE ? process.env.APPIMAGE : process.execPath;
  const child = spawn(executable, [`--nodus-profile=${process.env.NODUS_SUPPORT_ORIGINAL_PROFILE ?? app.getPath('userData')}`, `--nodus-executable=${installed}`], { detached: true, stdio: 'ignore' });
  await new Promise<void>((resolve, reject) => { child.once('spawn', resolve); child.once('error', reject); });
  child.unref();
  // Existing before-quit/editor guards must save work. Support never forces termination.
  app.quit();
}
