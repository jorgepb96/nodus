/** A valid publication whose table schema this build cannot import. Kept separate from the
 * utility host so the worker never imports Electron's process-management code. */
export class UnsupportedReplicaSchemaError extends Error {
  constructor(readonly schemaVersion: number, readonly revision: string | null, localSchemaVersion: number) {
    super(`Este espacio se publica con un esquema más reciente (v${schemaVersion}) que el de esta instalación (v${localSchemaVersion}). Actualiza Nodus para recibirlo.`);
    this.name = 'UnsupportedReplicaSchemaError';
  }
}
