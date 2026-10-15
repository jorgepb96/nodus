import { app } from 'electron';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { readGlobalPrefsRaw } from '../db/appPrefs';
import { atomicWriteJson, readJsonFile } from './libraryFileUtils';
export {
  assertInside,
  atomicWriteFile,
  atomicWriteJson,
  fitLibraryFileName,
  libraryFilePathWithLiteralExtension,
  pathStaysInside,
  readJsonFile,
  resolveLibraryFile,
  safeLibraryFileName,
  safeLibraryFolderName,
} from './libraryFileUtils';

export function configuredLibraryRoot(): string | null {
  if(process.env.NODUS_LEARNING_WORKSPACE==='1')return path.join(app.getPath('userData'),'storage','nodus-library');
  const configured = readGlobalPrefsRaw().autoBackupFolder;
  if (typeof configured !== 'string' || !configured.trim()) return null;
  return path.join(path.resolve(configured.trim()), 'nodus-library');
}

export function configuredLibraryRootOrThrow(): string {
  const root = configuredLibraryRoot();
  if (!root) throw new Error('Configura primero la carpeta de copias de seguridad de Nodus.');
  return root;
}

export function localLibraryDirectory(): string {
  return path.join(app.getPath('userData'), 'library');
}

export function localLibraryDatabasePath(): string {
  return path.join(localLibraryDirectory(), 'catalog.sqlite');
}

export function libraryDeviceId(): string {
  const directory = localLibraryDirectory();
  const file = path.join(directory, 'device.json');
  const current = readJsonFile<{ id?: unknown }>(file);
  if (typeof current?.id === 'string' && /^[a-f0-9-]{16,64}$/i.test(current.id)) return current.id;
  const id = randomUUID();
  atomicWriteJson(file, { format: 'nodus.library-device', formatVersion: 1, id, createdAt: new Date().toISOString() });
  return id;
}
