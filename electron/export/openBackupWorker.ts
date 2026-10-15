import { buildOpenBackup, type OpenBackupBuildInput } from './openBackupCore';
const controller = new AbortController();
process.parentPort?.on('message', (event) => {
  const data = event.data as { kind: 'run'; input: OpenBackupBuildInput } | { kind: 'cancel' };
  if (data.kind === 'cancel') {
    controller.abort();
    return;
  }
  void buildOpenBackup(
    data.input,
    (progress) => process.parentPort?.postMessage({ kind: 'progress', progress }),
    controller.signal,
  ).then(
    (result) => process.parentPort?.postMessage({ kind: 'done', result }),
    (error) =>
      process.parentPort?.postMessage({
        kind: 'error',
        error: error instanceof Error ? error.message : String(error),
      }),
  );
});
