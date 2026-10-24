import { parentPort } from './backgroundParentPort';
import { extractFileText, type FileTextExtractionOptions } from '../extraction/fileTextExtraction';

// This entry only imports file parsers. It cannot resolve a profile or open a vault.
parentPort.on('message', async (request: { filePath: string; options: FileTextExtractionOptions }) => {
  try {
    const doc = await extractFileText(request.filePath, {
      ...request.options,
      onProgress: progress => parentPort.postMessage({ kind: 'progress', progress }),
    });
    parentPort.postMessage({ kind: 'done', doc });
  } catch (error) {
    parentPort.postMessage({ kind: 'error', error: error instanceof Error ? error.message : String(error),
      name: error instanceof Error ? error.name : 'Error' });
  }
});
