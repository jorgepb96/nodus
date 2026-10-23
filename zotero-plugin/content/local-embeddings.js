/* Nodus for Zotero — managed local multilingual-E5 embeddings.
 *
 * The heavyweight Transformer runs in a dedicated chrome worker.  This small
 * bridge owns request lifecycle, progress reporting, cancellation and recovery.
 */
/* eslint-disable no-undef */
(function () {
  "use strict";

  const catalog = globalThis.NodusEmbeddingModels;
  let selected = catalog.get(catalog.defaultKey);
  const WORKER_URL = "chrome://nodus/content/runtime/local-embedding-worker.js";
  // Keeping the WASM model alive costs hundreds of MiB. A short grace period
  // avoids reloading it between related questions, while still returning that
  // memory to Zotero after the user stops using semantic retrieval.
  const IDLE_TERMINATE_MS = 5 * 60 * 1000;

  let worker = null;
  let idleTimer = null;
  let seq = 0;
  let lastBackend = null;
  const pending = new Map();
  const progressListeners = new Set();

  function clearIdleTermination() {
    if (idleTimer == null) return;
    clearTimeout(idleTimer);
    idleTimer = null;
  }

  function terminateWorker() {
    clearIdleTermination();
    const current = worker;
    worker = null;
    lastBackend = null;
    if (current) { try { current.terminate(); } catch (e) {} }
  }

  function scheduleIdleTermination() {
    clearIdleTermination();
    if (!worker || pending.size) return;
    idleTimer = setTimeout(() => {
      idleTimer = null;
      if (!pending.size) terminateWorker();
    }, IDLE_TERMINATE_MS);
  }

  function makeWorker() {
    if (worker) return worker;
    const WorkerImpl = typeof ChromeWorker !== "undefined" ? ChromeWorker : Worker;
    const instance = new WorkerImpl(WORKER_URL);
    worker = instance;
    instance.addEventListener("message", (event) => {
      const message = event && event.data ? event.data : {};
      if (message.type === "progress") {
        for (const listener of progressListeners) {
          try { listener(message.progress || {}); } catch (e) {}
        }
        return;
      }
      if (message.type === "backend") {
        lastBackend = String(message.backend || "") || null;
        return;
      }
      const job = pending.get(String(message.id || ""));
      if (!job) return;
      pending.delete(String(message.id || ""));
      if (job.cleanup) job.cleanup();
      if (message.type === "error") job.reject(new Error(String(message.error || "local-embedding-failed")));
      else job.resolve(message.result);
      scheduleIdleTermination();
    });
    instance.addEventListener("error", (event) => {
      const error = new Error(String(event && (event.message || event.error) || "local-embedding-worker-failed") + " @ " + String(event && event.filename || "") + ":" + String(event && event.lineno || ""));
      for (const job of pending.values()) {
        if (job.cleanup) job.cleanup();
        job.reject(error);
      }
      pending.clear();
      if (worker === instance) terminateWorker();
      else { try { instance.terminate(); } catch (e) {} }
    });
    return worker;
  }

  function request(type, payload, signal) {
    if (signal && signal.aborted) return Promise.reject(new DOMException("Aborted", "AbortError"));
    clearIdleTermination();
    const id = "le_" + Date.now() + "_" + (++seq);
    return new Promise((resolve, reject) => {
      const onAbort = () => {
        const job = pending.get(id);
        if (!job) return;
        pending.delete(id);
        if (job.cleanup) job.cleanup();
        reject(new DOMException("Aborted", "AbortError"));
        // The worker API cannot cancel an individual inference. If this was
        // the final request, terminate it so an aborted long document does not
        // keep consuming CPU and RAM in the background.
        if (!pending.size) terminateWorker();
      };
      const cleanup = signal ? () => signal.removeEventListener("abort", onAbort) : null;
      if (signal) signal.addEventListener("abort", onAbort, { once: true });
      pending.set(id, { resolve, reject, cleanup });
      try { makeWorker().postMessage({ id, type, modelKey: selected.key, ...(payload || {}) }); }
      catch (error) {
        pending.delete(id);
        if (cleanup) cleanup();
        reject(error);
        scheduleIdleTermination();
      }
    });
  }

  function onProgress(listener) {
    if (typeof listener !== "function") return () => {};
    progressListeners.add(listener);
    return () => progressListeners.delete(listener);
  }

  async function embedPassages(values, opts) {
    return request("embed", { role: "passage", modelKey: opts && opts.model ? opts.model.key : selected.key, values: Array.isArray(values) ? values : [] }, opts && opts.signal);
  }
  async function embedQueries(values, opts) {
    return request("embed", { role: "query", modelKey: opts && opts.model ? opts.model.key : selected.key, values: Array.isArray(values) ? values : [] }, opts && opts.signal);
  }
  async function embedQuery(value, opts) {
    const vectors = await embedQueries([String(value || "")], opts);
    return vectors && vectors[0] ? vectors[0] : [];
  }
  async function warmup(opts) {
    const result = await request("warmup", null, opts && opts.signal);
    if (result && result.backend) lastBackend = result.backend;
    return result;
  }
  function getBackend() {
    return lastBackend;
  }
  function reset() {
    terminateWorker();
    for (const job of pending.values()) {
      if (job.cleanup) job.cleanup();
      job.reject(new Error("local-embedding-reset"));
    }
    pending.clear();
  }

  window.addEventListener("unload", reset, { once: true });

  window.NodusLocalEmbeddings = {
    get MODEL() { return selected; },
    MODELS: catalog.models,
    select(key) { const next = catalog.get(key); reset(); selected = next; },
    useIndex(index) { return catalog.useIndex(index, selected); },
    embedPassages,
    embedQueries,
    embedQuery,
    warmup,
    onProgress,
    getBackend,
    reset,
  };
})();
