/*
 * Bundled into the Zotero XPI by build-zotero-xpi.mjs.  The worker keeps the
 * transformer and ONNX runtime away from Zotero's UI thread. Model weights are
 * downloaded once and persisted in a small IndexedDB-backed custom cache.
 *
 * Do not use Firefox Cache Storage here. Zotero 9.0.6 can segfault in its native
 * DOMCacheThread while committing the quantised ONNX response. IndexedDB keeps
 * the same one-time-download behaviour without touching that unstable path.
 */
import '../zotero-plugin/content/embedding-models.js';
import { env, pipeline, AutoModel, AutoTokenizer } from '@nodus/embeddinggemma-transformers';

const catalog = globalThis.NodusEmbeddingModels;
let activeModel = catalog.get(catalog.defaultKey);
const MODEL_DTYPE = 'q8';
const WASM_ROOT = 'chrome://nodus/content/runtime/';
const CACHE_DB = 'nodus-local-embedding-models-v1';
const CACHE_STORE = 'responses';

env.allowLocalModels = false;
env.allowRemoteModels = true;
env.useBrowserCache = false;
env.useFSCache = false;
env.useCustomCache = true;
env.customCache = createIndexedDbCache();
env.backends.onnx.wasm.wasmPaths = WASM_ROOT;
env.backends.onnx.wasm.proxy = false;
env.backends.onnx.wasm.numThreads = Math.max(
  1,
  Math.min(4, Number(globalThis.navigator?.hardwareConcurrency) || 2),
);

let extractorPromise = null;
let backendUsed = null;

function createIndexedDbCache() {
  let dbPromise = null;

  function cacheKey(value) {
    return typeof value === 'string' ? value : String(value && value.url || value);
  }

  function openDatabase() {
    if (!dbPromise) {
      dbPromise = new Promise((resolve, reject) => {
        const request = indexedDB.open(CACHE_DB, 1);
        request.onupgradeneeded = () => {
          const db = request.result;
          if (!db.objectStoreNames.contains(CACHE_STORE)) db.createObjectStore(CACHE_STORE);
        };
        request.onerror = () => reject(request.error || new Error('local-model-cache-open-failed'));
        request.onblocked = () => reject(new Error('local-model-cache-blocked'));
        request.onsuccess = () => {
          const db = request.result;
          db.onversionchange = () => {
            db.close();
            dbPromise = null;
          };
          resolve(db);
        };
      }).catch((error) => {
        dbPromise = null;
        throw error;
      });
    }
    return dbPromise;
  }

  async function read(key) {
    const db = await openDatabase();
    return new Promise((resolve, reject) => {
      const request = db.transaction(CACHE_STORE, 'readonly').objectStore(CACHE_STORE).get(key);
      request.onerror = () => reject(request.error || new Error('local-model-cache-read-failed'));
      request.onsuccess = () => resolve(request.result);
    });
  }

  async function write(key, value) {
    const db = await openDatabase();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(CACHE_STORE, 'readwrite');
      transaction.onerror = () => reject(transaction.error || new Error('local-model-cache-write-failed'));
      transaction.onabort = () => reject(transaction.error || new Error('local-model-cache-write-aborted'));
      transaction.oncomplete = () => resolve();
      transaction.objectStore(CACHE_STORE).put(value, key);
    });
  }

  return {
    async match(request) {
      // The pinned Q8 export uses a CPU-only GatherBlockQuantized kernel.
      // Bundle its equivalent standard-op graph; external Q8 weights retain
      // their pinned upstream address and are downloaded only on selection.
      const url = cacheKey(request);
      if (url.split('?')[0].endsWith('/harrier-oss-v1-270m-ONNX/resolve/' + catalog.get('harrier-270m').revision + '/onnx/model_quantized.onnx')) {
        return fetch('chrome://nodus/content/models/harrier-270m-q8-wasm.onnx');
      }
      const record = await read(cacheKey(request));
      if (!record || !record.body) return undefined;
      return new Response(record.body, {
        status: Number(record.status) || 200,
        statusText: String(record.statusText || ''),
        headers: Array.isArray(record.headers) ? record.headers : [],
      });
    },
    async put(request, response) {
      const body = await response.blob();
      await write(cacheKey(request), {
        body,
        status: response.status,
        statusText: response.statusText,
        headers: Array.from(response.headers.entries()),
        savedAt: Date.now(),
      });
    },
  };
}

function progressCallback(progress) {
  const safe = progress && typeof progress === 'object'
    ? {
        status: String(progress.status || ''),
        file: String(progress.file || ''),
        progress: Number(progress.progress) || 0,
        loaded: Number(progress.loaded) || 0,
        total: Number(progress.total) || 0,
      }
    : { status: String(progress || '') };
  globalThis.postMessage({ type: 'progress', progress: safe });
}

async function extractor() {
  if (!extractorPromise) {
    extractorPromise = createExtractor().catch((error) => {
      extractorPromise = null;
      throw error;
    });
  }
  return extractorPromise;
}

async function createExtractor() {
  const m = activeModel;
  const options = { revision: m.revision, dtype: MODEL_DTYPE, device: 'wasm', progress_callback: progressCallback };
  // CPU/WASM is the common Zotero backend. One input at a time bounds padding
  // and memory; never keep two model sessions resident.
  backendUsed = 'wasm';
  globalThis.postMessage({ type: 'backend', backend: backendUsed });
  if (m.pooling !== 'sentence_embedding') return pipeline('feature-extraction', m.id, options);
  const tokenizer = await AutoTokenizer.from_pretrained(m.id, { revision: m.revision });
  const model = await AutoModel.from_pretrained(m.id, options);
  const run = async (texts) => {
    const inputs = tokenizer(texts, { padding: true, truncation: true, max_length: m.maxTokens });
    const { sentence_embedding } = await model(inputs);
    return sentence_embedding;
  };
  run.dispose = () => model.dispose();
  return run;
}

async function embed(role, values) {
  const model = await extractor();
  const vectors = [];
  for (const value of Array.isArray(values) ? values : []) {
    const output = await model([catalog.input(activeModel, role, value)], {
      pooling: activeModel.pooling, normalize: true, truncation: true, max_length: activeModel.maxTokens,
    });
    const vector = output.tolist()[0];
    const norm = Math.hypot(...vector);
    if (vector.length !== activeModel.dimensions || !vector.every(Number.isFinite) || !(norm > 0)) throw new Error('local-embedding-shape-mismatch');
    vectors.push(vector.map(v => v / norm));
  }
  return vectors;
}

let queue = Promise.resolve();
globalThis.addEventListener('message', (event) => {
  queue = queue.then(() => handleMessage(event));
});
async function handleMessage(event) {
  const message = event && event.data ? event.data : {};
  const id = String(message.id || '');
  try {
    const next = catalog.get(message.modelKey || catalog.defaultKey);
    if (next !== activeModel) {
      if (extractorPromise) { try { await (await extractorPromise).dispose(); } catch (e) {} }
      extractorPromise = null; activeModel = next;
    }
    if (message.type === 'info') {
      globalThis.postMessage({
        type: 'result',
        id,
        result: {
          model: activeModel.id,
          revision: activeModel.revision,
          dtype: MODEL_DTYPE,
          dimensions: activeModel.dimensions,
          fingerprint: activeModel.fingerprint,
          backend: backendUsed,
        },
      });
      return;
    }
    if (message.type === 'warmup') {
      await extractor();
      globalThis.postMessage({ type: 'result', id, result: { ready: true, backend: backendUsed } });
      return;
    }
    if (message.type !== 'embed') throw new Error('unknown-local-embedding-message');
    const result = await embed(message.role === 'query' ? 'query' : 'passage', message.values);
    globalThis.postMessage({ type: 'result', id, result });
  } catch (error) {
    globalThis.postMessage({
      type: 'error',
      id,
      error: String(error) + "\n" + String(error && error.stack || ""),
    });
  }
}
