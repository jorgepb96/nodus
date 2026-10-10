/* Nodus for Zotero — persistence. Small settings in Zotero prefs, provider
 * credentials in Zotero's encrypted Login Manager, and conversation/evidence
 * data in the Zotero profile. window.NodusStore.
 */
/* eslint-disable no-undef */
(function () {
  "use strict";
  const { Zotero } = ChromeUtils.importESModule("chrome://zotero/content/zotero.mjs");

  const P = (k, d) => { try { const v = Zotero.Prefs.get("nodus." + k); return v == null ? d : v; } catch (e) { return d; } };
  const S = (k, v) => { try { Zotero.Prefs.set("nodus." + k, v); } catch (e) {} };
  const PJSON = (k, d) => { try { return JSON.parse(P(k, "")) || d; } catch (e) { return d; } };
  const SJSON = (k, v) => S(k, JSON.stringify(v));

  // ---- settings ----
  function getMode() { return P("mode", "connected") === "standalone" ? "standalone" : "connected"; }
  function setMode(m) { S("mode", m === "standalone" ? "standalone" : "connected"); }
  function getLang() { return P("lang", "en") === "es" ? "es" : "en"; }
  function setLang(l) { S("lang", l); }
  function getModel(mode) { return PJSON("model." + mode, null); }
  function setModel(mode, ref) { SJSON("model." + mode, ref); }
  function getMaxTokens() { const n = Number(P("maxTokens", 0)); return Number.isFinite(n) && n > 0 ? n : 8192; }
  function setMaxTokens(v) { const n = Number(v); S("maxTokens", Number.isFinite(n) && n > 0 ? Math.floor(n) : 8192); }
  const REASONING = ["default", "off", "low", "medium", "high"];
  function getReasoning() { const v = P("reasoning", "default"); return REASONING.includes(v) ? v : "default"; }
  function setReasoning(v) { S("reasoning", REASONING.includes(v) ? v : "default"); }
  // Auto-highlight colors: high = MUY IMPORTANTE, medium = IMPORTANTE.
  function getHlColors() { const c = PJSON("hlColors", null); return { high: (c && c.high) || "#ff6666", medium: (c && c.medium) || "#ffd400" }; }
  function setHlColors(c) { SJSON("hlColors", { high: (c && c.high) || "#ff6666", medium: (c && c.medium) || "#ffd400" }); }
  function getContext() {
    const strategy = P("ctx.strategy", "auto");
    const ocr = P("ctx.ocr", "off");
    const repair = P("ctx.repair", "auto");
    const rounds = Number(P("ctx.agenticRounds", 1));
    const threshold = Number(P("ctx.fullTextThreshold", 48000));
    return {
      useIdeas: P("ctx.ideas", "1") !== "0",
      useCorpus: P("ctx.corpus", "1") !== "0",
      useFulltext: P("ctx.fulltext", "1") !== "0",
      strategy: ["auto", "retrieval", "full"].includes(strategy) ? strategy : "auto",
      ocr: ["off", "ondemand", "always"].includes(ocr) ? ocr : "off",
      repair: ["auto", "off", "always"].includes(repair) ? repair : "auto",
      agenticRounds: Number.isFinite(rounds) ? Math.max(0, Math.min(2, Math.floor(rounds))) : 1,
      fullTextThreshold: Number.isFinite(threshold) && threshold > 0 ? threshold : 48000,
    };
  }
  function setContext(c) {
    S("ctx.ideas", c.useIdeas ? "1" : "0"); S("ctx.corpus", c.useCorpus ? "1" : "0"); S("ctx.fulltext", c.useFulltext ? "1" : "0");
    S("ctx.strategy", ["auto", "retrieval", "full"].includes(c.strategy) ? c.strategy : "auto");
    S("ctx.ocr", ["off", "ondemand", "always"].includes(c.ocr) ? c.ocr : "off");
    S("ctx.repair", ["auto", "off", "always"].includes(c.repair) ? c.repair : "auto");
    const rounds = Number(c.agenticRounds);
    S("ctx.agenticRounds", String(Number.isFinite(rounds) ? Math.max(0, Math.min(2, Math.floor(rounds))) : 1));
    const threshold = Number(c.fullTextThreshold);
    S("ctx.fullTextThreshold", String(Number.isFinite(threshold) && threshold > 0 ? threshold : 48000));
  }
  const SOURCE_SCOPES = ["current", "selection", "collection", "library"];
  function getSourceScope() {
    const value = P("sourceScope", "current");
    return SOURCE_SCOPES.includes(value) ? value : "current";
  }
  function setSourceScope(value) { S("sourceScope", SOURCE_SCOPES.includes(value) ? value : "current"); }
  function getOnboarded() { return P("onboarded", "0") === "1"; }
  function setOnboarded(value) { S("onboarded", value ? "1" : "0"); }
  // ---- providers ----
  // Zotero's Login Manager encrypts passwords in logins.json/key4.db instead of
  // leaving provider keys readable in prefs.js. Existing plaintext values are
  // migrated lazily and then removed. New secrets fail closed if Login Manager
  // is unavailable; they are never written back to prefs.js.
  const SECRET_ORIGIN = "chrome://nodus";
  const SECRET_REALM = "Nodus Zotero provider credentials";
  let secretStorage = null;
  function loginManager() {
    if (secretStorage) return secretStorage;
    try {
      if (!Services || !Services.logins) throw new Error("login-manager-unavailable");
      secretStorage = { kind: "encrypted", manager: Services.logins };
    } catch (e) {
      secretStorage = { kind: "unavailable", manager: null };
    }
    return secretStorage;
  }
  function providerLogin(provider) {
    const storage = loginManager();
    if (!storage.manager) return null;
    try {
      return (storage.manager.findLogins(SECRET_ORIGIN, null, SECRET_REALM) || [])
        .find((login) => login.username === String(provider || "")) || null;
    } catch (e) { return null; }
  }
  function newProviderLogin(provider, password) {
    try {
      const login = Components.classes["@mozilla.org/login-manager/loginInfo;1"]
        .createInstance(Components.interfaces.nsILoginInfo);
      login.init(SECRET_ORIGIN, null, SECRET_REALM, String(provider || ""), String(password || ""), "", "");
      return login;
    } catch (e) { return null; }
  }
  async function writeSecureKey(provider, value) {
    const storage = loginManager();
    if (!storage.manager) return false;
    try {
      const existing = providerLogin(provider);
      if (!value) {
        if (existing) storage.manager.removeLogin(existing);
        return true;
      }
      const next = newProviderLogin(provider, value);
      if (!next) return false;
      if (existing) storage.manager.modifyLogin(existing, next);
      // Current Zotero exposes addLoginAsync; its obsolete addLogin stub throws.
      else if (typeof storage.manager.addLoginAsync === "function") await storage.manager.addLoginAsync(next);
      else storage.manager.addLogin(next);
      return true;
    } catch (e) { return false; }
  }
  async function getKey(provider) {
    const login = providerLogin(provider);
    if (login && login.password) return String(login.password);
    const legacy = P("key." + provider, "") || "";
    if (legacy && await writeSecureKey(provider, legacy)) { S("key." + provider, ""); return legacy; }
    return "";
  }
  async function setKey(provider, value) {
    const clean = String(value || "");
    if (await writeSecureKey(provider, clean)) { S("key." + provider, ""); return true; }
    return false;
  }
  function getSecretStorageStatus() { return loginManager().kind; }
  function getLocalBase(provider) { return P("localbase." + provider, "") || ""; }
  function setLocalBase(provider, v) { S("localbase." + provider, v || ""); }
  function getPinned() { const a = PJSON("pinned", []); return Array.isArray(a) ? a : []; }
  function setPinned(arr) { SJSON("pinned", arr); }
  function isPinned(ref) { return getPinned().some((m) => m.provider === ref.provider && m.model === ref.model); }
  function togglePinned(ref) {
    const arr = getPinned();
    const i = arr.findIndex((m) => m.provider === ref.provider && m.model === ref.model);
    if (i >= 0) arr.splice(i, 1); else arr.push(ref);
    setPinned(arr);
    return arr;
  }

  // ---- custom prompts (user-defined templates for the ✦ menu) ----
  function getCustomPrompts() { const a = PJSON("customPrompts", []); return Array.isArray(a) ? a : []; }
  function setCustomPrompts(arr) { SJSON("customPrompts", Array.isArray(arr) ? arr : []); }
  function addCustomPrompt(title, prompt) {
    const a = getCustomPrompts();
    a.push({ id: "up_" + Date.now() + "_" + Math.random().toString(36).slice(2, 6), title: String(title || "").trim(), prompt: String(prompt || "").trim() });
    setCustomPrompts(a); return a;
  }
  function removeCustomPrompt(id) { setCustomPrompts(getCustomPrompts().filter((p) => p.id !== id)); }

  // ---- self-update (explicit opt-in; privileged code never updates silently by default) ----
  function getAutoUpdate() { return P("autoUpdate", "0") === "1"; }
  function setAutoUpdate(v) { S("autoUpdate", v ? "1" : "0"); }

  // ---- agent mode ----
  function getAgent() { return P("agent", "0") === "1"; }
  function setAgent(v) { S("agent", v ? "1" : "0"); }
  function getAgentAuto() { return P("agentAuto", "0") === "1"; }
  function setAgentAuto(v) { S("agentAuto", v ? "1" : "0"); }

  // ---- local history privacy/retention ----
  // History is private-by-default. Users can explicitly opt in from Settings;
  // disabling it also removes the already persisted conversation file.
  function getHistoryEnabled() { return P("history.enabled", "0") === "1"; }
  function setHistoryEnabled(v) { S("history.enabled", v ? "1" : "0"); }
  function getHistoryRetention() {
    const value = Number(P("history.retentionDays", 365));
    return [30, 90, 365, 0].includes(value) ? value : 365;
  }
  function setHistoryRetention(value) {
    const days = Number(value);
    S("history.retentionDays", String([30, 90, 365, 0].includes(days) ? days : 365));
  }

  // ---- conversation manual (nodus) connection override (advanced) ----
  const MANUAL_TOKEN_LOGIN = "__nodus_bridge_manual__";
  async function getManual() {
    const login = providerLogin(MANUAL_TOKEN_LOGIN);
    if (login && login.password) return { port: Number(P("port", 0)) || 0, token: String(login.password) };
    const legacy = P("token", "") || "";
    if (legacy && await writeSecureKey(MANUAL_TOKEN_LOGIN, legacy)) { S("token", ""); return { port: Number(P("port", 0)) || 0, token: legacy }; }
    return { port: Number(P("port", 0)) || 0, token: "" };
  }
  async function setManual(port, token) {
    const clean = String(token || "");
    if (!(await writeSecureKey(MANUAL_TOKEN_LOGIN, clean))) return false;
    S("port", Number(port) || 0); S("token", "");
    return true;
  }

  // ---- conversations (file) ----
  function convPath() {
    const dir = Services.dirsvc.get("ProfD", Components.interfaces.nsIFile).path;
    return PathUtils.join(dir, "nodus-zotero-conversations.json");
  }
  function compactAudit(audit) {
    if (!audit || typeof audit !== "object") return audit || null;
    return {
      total: Number(audit.total) || 0,
      covered: Number(audit.covered) || 0,
      weak: Number(audit.weak) || 0,
      missing: Number(audit.missing) || 0,
      coverage: Number(audit.coverage) || 0,
      citationCoverage: Number(audit.citationCoverage == null ? audit.coverage : audit.citationCoverage) || 0,
      matchCoverage: Number(audit.matchCoverage == null ? audit.coverage : audit.matchCoverage) || 0,
      method: String(audit.method || "citation-presence+lexical-screen"),
      repairAttempted: !!audit.repairAttempted,
      invalidCitations: Array.isArray(audit.invalidCitations)
        ? audit.invalidCitations.map((citation) => ({
          id: String(citation && citation.id || ""),
          token: String(citation && citation.token || ""),
        }))
        : [],
      claims: Array.isArray(audit.claims)
        ? audit.claims.map((claim) => ({
          text: String(claim && claim.text || ""),
          citationIds: Array.isArray(claim && claim.citationIds) ? claim.citationIds.map(String) : [],
          status: ["covered", "weak", "missing"].includes(claim && claim.status) ? claim.status : "missing",
          support: Number(claim && claim.support) || 0,
        }))
        : [],
    };
  }
  function compactConversations(list) {
    if (!Array.isArray(list)) return [];
    const now = Date.now();
    const retention = getHistoryRetention();
    const earliest = retention ? now - retention * 86400000 : 0;
    const normalized = list
      .filter((conversation) => conversation && typeof conversation === "object")
      .map((conversation) => ({
        id: String(conversation.id || newId()).slice(0, 160),
        title: String(conversation.title || "").slice(0, 300),
        mode: conversation.mode === "standalone" ? "standalone" : "connected",
        sourceScope: SOURCE_SCOPES.includes(conversation.sourceScope) ? conversation.sourceScope : "current",
        sourceIdentity: String(conversation.sourceIdentity || "").slice(0, 20000),
        model: conversation.model && typeof conversation.model === "object" ? {
          provider: String(conversation.model.provider || "").slice(0, 80),
          model: String(conversation.model.model || "").slice(0, 240),
        } : null,
        createdAt: Number(conversation.createdAt) || now,
        updatedAt: Number(conversation.updatedAt) || now,
        messages: (Array.isArray(conversation.messages) ? conversation.messages : []).slice(-60).map((message) => ({
          role: message && message.role === "assistant" ? "assistant" : "user",
          content: String(message && message.content || "").slice(0, 50000),
          evidence: (Array.isArray(message && message.evidence) ? message.evidence : []).slice(0, 12).map((hit) => ({
            id: String(hit && hit.id || "").slice(0, 180),
            libraryID: Number(hit && hit.libraryID) || 0,
            groupID: hit && hit.groupID != null && Number.isFinite(Number(hit.groupID)) ? Number(hit.groupID) : null,
            itemKey: String(hit && hit.itemKey || "").slice(0, 80),
            attachmentKey: String(hit && hit.attachmentKey || "").slice(0, 80),
            title: String(hit && hit.title || "").slice(0, 500),
            contentType: String(hit && hit.contentType || "").slice(0, 120),
            pageIndex: Number(hit && hit.pageIndex) || 0,
            pageLabel: String(hit && hit.pageLabel || "").slice(0, 80),
            section: String(hit && hit.section || "").slice(0, 500),
            text: String(hit && hit.text || "").slice(0, 2000),
          })),
          audit: message && message.audit ? compactAudit(message.audit) : null,
        })),
      }))
      .filter((conversation) => !earliest || conversation.updatedAt >= earliest)
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, 100);
    const out = [];
    let bytes = 2;
    for (const conversation of normalized) {
      const serialized = JSON.stringify(conversation);
      if (bytes + serialized.length > 50 * 1024 * 1024) break;
      bytes += serialized.length + 1; out.push(conversation);
    }
    return out;
  }
  async function loadConversations() {
    try {
      const stat = await IOUtils.stat(convPath());
      if (Number(stat && stat.size) > 50 * 1024 * 1024) throw new Error("conversation-history-too-large");
      const raw = await IOUtils.readUTF8(convPath());
      const parsed = JSON.parse(raw);
      const compacted = compactConversations(parsed);
      if (JSON.stringify(parsed) !== JSON.stringify(compacted)) await saveConversations(compacted);
      return compacted;
    }
    catch (e) { return []; }
  }
  async function saveConversations(list) {
    try {
      const target = convPath();
      const temp = target + ".tmp";
      await IOUtils.writeUTF8(temp, JSON.stringify(compactConversations(list)));
      await IOUtils.move(temp, target, { noOverwrite: false });
      if (IOUtils.setPermissions) await IOUtils.setPermissions(target, 0o600);
    } catch (e) { try { Zotero.logError(e); } catch (x) {} }
  }
  async function deleteConversationHistory() {
    try {
      await IOUtils.remove(convPath(), { ignoreAbsent: true });
      await IOUtils.remove(convPath() + ".tmp", { ignoreAbsent: true });
      return true;
    } catch (e) { try { Zotero.logError(e); } catch (x) {} return false; }
  }
  const EVIDENCE_CACHE_VERSION = 1;
  let evidenceDbPromise = null;
  let evidenceDbClosed = false;
  let evidenceDbConnection = null;
  let evidenceDatabases = null;
  let evidenceDbClosePromise = null;

  function legacyIndexDir() {
    const dir = Services.dirsvc.get("ProfD", Components.interfaces.nsIFile).path;
    return PathUtils.join(dir, "nodus-zotero-indexes");
  }
  function legacyIndexPath(libraryID, attachmentKey) {
    const safe = String(libraryID) + "-" + String(attachmentKey || "").replace(/[^A-Za-z0-9_-]/g, "_");
    return PathUtils.join(legacyIndexDir(), safe + ".json");
  }
  function evidenceDir() {
    const dir = Services.dirsvc.get("ProfD", Components.interfaces.nsIFile).path;
    return PathUtils.join(dir, "nodus-zotero-evidence");
  }
  function evidenceDbPath() {
    return PathUtils.join(evidenceDir(), "nodus-evidence.sqlite");
  }
  function evidenceStem(libraryID, attachmentKey) {
    return String(libraryID) + "-" + String(attachmentKey || "").replace(/[^A-Za-z0-9_-]/g, "_");
  }
  function evidenceDataPath(libraryID, attachmentKey) {
    return PathUtils.join(evidenceDir(), evidenceStem(libraryID, attachmentKey) + ".json.gz");
  }
  function evidenceVectorPath(libraryID, attachmentKey) {
    return PathUtils.join(evidenceDir(), evidenceStem(libraryID, attachmentKey) + ".f32");
  }
  // Layout extraction used to persist the same coordinate map twice: once as
  // page spans and again as chunk positions. Nothing in retrieval, citation
  // navigation or highlighting consumes either persisted map; Zotero resolves
  // the live page when the user opens a citation. On large PDFs these millions
  // of tiny objects dominate both JSON size and JS heap usage.
  function compactEvidenceIndex(index) {
    let changed = false;
    for (const chunk of Array.isArray(index && index.chunks) ? index.chunks : []) {
      if (Object.prototype.hasOwnProperty.call(chunk, "positions")) {
        delete chunk.positions;
        changed = true;
      }
    }
    for (const page of Array.isArray(index && index.pages) ? index.pages : []) {
      if (Object.prototype.hasOwnProperty.call(page, "rawText")) {
        delete page.rawText;
        changed = true;
      }
      if (Object.prototype.hasOwnProperty.call(page, "spans")) {
        delete page.spans;
        changed = true;
      }
    }
    return changed;
  }
  async function gzipText(value) {
    const bytes = new TextEncoder().encode(String(value || ""));
    if (typeof CompressionStream === "undefined") throw new Error("gzip-unavailable");
    const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream("gzip"));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }
  async function gunzipText(bytes) {
    if (typeof DecompressionStream === "undefined") throw new Error("gunzip-unavailable");
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"));
    return new TextDecoder().decode(await new Response(stream).arrayBuffer());
  }
  function detachEmbeddings(index) {
    compactEvidenceIndex(index);
    const copy = { ...(index || {}) };
    const chunks = [];
    let totalFloats = 0;
    for (const source of Array.isArray(index && index.chunks) ? index.chunks : []) {
      const chunk = { ...source };
      const vector = Array.isArray(source.embedding) ? source.embedding : null;
      if (vector && vector.length) {
        chunk.embeddingOffset = totalFloats;
        chunk.embeddingLength = vector.length;
        totalFloats += vector.length;
      } else {
        delete chunk.embeddingOffset;
        delete chunk.embeddingLength;
      }
      chunk.embedding = null;
      chunks.push(chunk);
    }
    copy.chunks = chunks;
    const vectors = new Float32Array(totalFloats);
    let cursor = 0;
    for (const source of Array.isArray(index && index.chunks) ? index.chunks : []) {
      if (!Array.isArray(source.embedding) || !source.embedding.length) continue;
      vectors.set(source.embedding.map(Number), cursor);
      cursor += source.embedding.length;
    }
    copy.cache = {
      schema: EVIDENCE_CACHE_VERSION,
      vectorFormat: "float32-le",
      vectorCount: totalFloats,
    };
    return { index: copy, bytes: new Uint8Array(vectors.buffer) };
  }
  function attachEmbeddings(index, bytes) {
    const copy = index || {};
    const source = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes || 0);
    const raw = source.byteLength ? new Uint8Array(source).buffer : new ArrayBuffer(0);
    const vectors = new Float32Array(raw);
    for (const chunk of Array.isArray(copy.chunks) ? copy.chunks : []) {
      const offset = Number(chunk.embeddingOffset);
      const length = Number(chunk.embeddingLength);
      if (Number.isInteger(offset) && Number.isInteger(length) && offset >= 0 && length > 0 && offset + length <= vectors.length) {
        chunk.embedding = Array.from(vectors.subarray(offset, offset + length));
      } else {
        chunk.embedding = null;
      }
    }
    return copy;
  }
  async function evidenceDb() {
    if (evidenceDbClosed) throw new Error("evidence-db-closed");
    if (evidenceDbPromise) return evidenceDbPromise;
    evidenceDbPromise = (async () => {
      await IOUtils.makeDirectory(evidenceDir(), { ignoreExisting: true });
      if (evidenceDbClosed) throw new Error("evidence-db-closed");
      evidenceDatabases = ChromeUtils.importESModule("chrome://nodus/content/evidence-db.sys.mjs").EvidenceDatabases;
      const db = evidenceDatabases.open(evidenceDbPath());
      evidenceDbConnection = db;
      await db.queryAsync(
        "CREATE TABLE IF NOT EXISTS evidence_indexes (" +
        "library_id INTEGER NOT NULL, attachment_key TEXT NOT NULL, item_key TEXT NOT NULL, " +
        "signature TEXT NOT NULL, index_version INTEGER NOT NULL, embedding_model TEXT, " +
        "total_pages INTEGER NOT NULL, total_chars INTEGER NOT NULL, data_path TEXT NOT NULL, " +
        "vector_path TEXT NOT NULL, updated_at INTEGER NOT NULL, " +
        "PRIMARY KEY (library_id, attachment_key))"
      );
      await db.queryAsync("CREATE INDEX IF NOT EXISTS evidence_indexes_updated ON evidence_indexes(updated_at)");
      return db;
    })().catch(async (error) => {
      if (evidenceDbConnection) {
        await evidenceDatabases.close(evidenceDbConnection);
        evidenceDbConnection = null;
      }
      evidenceDbPromise = null;
      throw error;
    });
    return evidenceDbPromise;
  }
  function closeEvidenceDb() {
    evidenceDbClosed = true;
    if (!evidenceDbClosePromise) {
      // Transfer cleanup to the persistent module before yielding: this window
      // may be destroyed immediately after its unload handler returns.
      evidenceDbClosePromise = evidenceDbConnection
        ? evidenceDatabases.close(evidenceDbConnection)
        : Promise.resolve();
      evidenceDbPromise = null;
    }
    return evidenceDbClosePromise;
  }
  async function loadEvidenceIndex(libraryID, attachmentKey) {
    let dataPath = evidenceDataPath(libraryID, attachmentKey);
    let vectorPath = evidenceVectorPath(libraryID, attachmentKey);
    try {
      const db = await evidenceDb();
      const row = await db.rowQueryAsync(
        "SELECT data_path, vector_path FROM evidence_indexes WHERE library_id=? AND attachment_key=?",
        [Number(libraryID), String(attachmentKey || "")]
      );
      if (row) {
        dataPath = String(row.data_path);
        vectorPath = String(row.vector_path);
      }
    } catch (e) { try { Zotero.logError(e); } catch (x) {} }
    // The sidecars remain independently recoverable if SQLite metadata was
    // interrupted after the atomic file move.
    try {
      const packed = await IOUtils.read(dataPath);
      const vectors = await IOUtils.read(vectorPath);
      const index = attachEmbeddings(JSON.parse(await gunzipText(packed)), vectors);
      // One-time in-place migration of old, coordinate-heavy sidecars. The
      // first read releases the duplicate objects immediately and rewrites a
      // compact cache so subsequent Zotero sessions never parse them again.
      if (compactEvidenceIndex(index)) await saveEvidenceIndex(index);
      return index;
    } catch (e) {}
    // One-way lazy migration from the v0.1 JSON cache.  The old file is left in
    // place until the new cache has been written successfully.
    try {
      const legacy = JSON.parse(await IOUtils.readUTF8(legacyIndexPath(libraryID, attachmentKey)));
      if (legacy && await saveEvidenceIndex(legacy)) {
        await IOUtils.remove(legacyIndexPath(libraryID, attachmentKey), { ignoreAbsent: true });
      }
      return legacy;
    } catch (e) { return null; }
  }
  async function saveEvidenceIndex(index) {
    try {
      await IOUtils.makeDirectory(evidenceDir(), { ignoreExisting: true });
      const target = evidenceDataPath(index.libraryID, index.attachmentKey);
      const vectorsTarget = evidenceVectorPath(index.libraryID, index.attachmentKey);
      const packed = detachEmbeddings(index);
      const dataBytes = await gzipText(JSON.stringify(packed.index));
      const dataTmp = target + ".tmp";
      const vectorsTmp = vectorsTarget + ".tmp";
      await IOUtils.write(dataTmp, dataBytes);
      await IOUtils.write(vectorsTmp, packed.bytes);
      await IOUtils.move(dataTmp, target, { noOverwrite: false });
      await IOUtils.move(vectorsTmp, vectorsTarget, { noOverwrite: false });
      if (IOUtils.setPermissions) {
        await IOUtils.setPermissions(target, 0o600);
        await IOUtils.setPermissions(vectorsTarget, 0o600);
      }
      const db = await evidenceDb();
      await db.queryAsync(
        "INSERT INTO evidence_indexes " +
        "(library_id, attachment_key, item_key, signature, index_version, embedding_model, total_pages, total_chars, data_path, vector_path, updated_at) " +
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) " +
        "ON CONFLICT(library_id, attachment_key) DO UPDATE SET " +
        "item_key=excluded.item_key, signature=excluded.signature, index_version=excluded.index_version, " +
        "embedding_model=excluded.embedding_model, total_pages=excluded.total_pages, total_chars=excluded.total_chars, " +
        "data_path=excluded.data_path, vector_path=excluded.vector_path, updated_at=excluded.updated_at",
        [
          Number(index.libraryID), String(index.attachmentKey || ""), String(index.itemKey || ""),
          String(index.signature || ""), Number(index.version) || 0, String(index.embeddingModel || ""),
          Number(index.totalPages) || 0, Number(index.totalChars) || 0,
          target, vectorsTarget, Number(index.updatedAt) || Date.now(),
        ]
      );
      return target;
    } catch (e) { try { Zotero.logError(e); } catch (x) {} return null; }
  }
  async function deleteEvidenceIndex(libraryID, attachmentKey) {
    try {
      await IOUtils.remove(evidenceDataPath(libraryID, attachmentKey), { ignoreAbsent: true });
      await IOUtils.remove(evidenceVectorPath(libraryID, attachmentKey), { ignoreAbsent: true });
      const db = await evidenceDb();
      await db.queryAsync("DELETE FROM evidence_indexes WHERE library_id=? AND attachment_key=?", [Number(libraryID), String(attachmentKey || "")]);
      return true;
    } catch (e) { return false; }
  }
  async function listEvidenceRecords() {
    try {
      const db = await evidenceDb();
      const rows = await db.queryAsync(
        "SELECT library_id AS libraryID, attachment_key AS attachmentKey, item_key AS itemKey, " +
        "signature, index_version AS indexVersion, embedding_model AS embeddingModel, " +
        "total_pages AS totalPages, total_chars AS totalChars, data_path AS dataPath, " +
        "vector_path AS vectorPath, updated_at AS updatedAt FROM evidence_indexes ORDER BY updated_at DESC"
      );
      return (rows || []).map((row) => ({
        libraryID: Number(row.libraryID), attachmentKey: String(row.attachmentKey || ""),
        itemKey: String(row.itemKey || ""), signature: String(row.signature || ""),
        indexVersion: Number(row.indexVersion) || 0, embeddingModel: String(row.embeddingModel || ""),
        totalPages: Number(row.totalPages) || 0, totalChars: Number(row.totalChars) || 0,
        dataPath: String(row.dataPath || ""), vectorPath: String(row.vectorPath || ""),
        updatedAt: Number(row.updatedAt) || 0,
      }));
    } catch (e) { return []; }
  }
  async function loadEvidenceIndexes(filter) {
    const records = await listEvidenceRecords();
    const indexes = [];
    for (const record of records) {
      if (typeof filter === "function" && !filter(record)) continue;
      const index = await loadEvidenceIndex(record.libraryID, record.attachmentKey);
      if (index) indexes.push(index);
    }
    return indexes;
  }
  async function pruneEvidenceIndexes() {
    const records = await listEvidenceRecords();
    let removed = 0;
    for (const record of records) {
      let exists = false;
      try { exists = !!(Zotero.Items && Zotero.Items.getByLibraryAndKey && Zotero.Items.getByLibraryAndKey(record.libraryID, record.attachmentKey)); }
      catch (e) {}
      let sidecars = true;
      try { await IOUtils.stat(record.dataPath); await IOUtils.stat(record.vectorPath); } catch (e) { sidecars = false; }
      if ((!exists || !sidecars) && await deleteEvidenceIndex(record.libraryID, record.attachmentKey)) removed++;
    }
    const referenced = new Set((await listEvidenceRecords()).flatMap((record) => [record.dataPath, record.vectorPath]));
    try {
      for (const filePath of await IOUtils.getChildren(evidenceDir())) {
        if ((/\.(?:json\.gz|f32|tmp)$/.test(filePath)) && !referenced.has(filePath)) await IOUtils.remove(filePath, { ignoreAbsent: true });
      }
    } catch (e) {}
    // A v0.1 JSON that points to a deleted Zotero attachment must not be able
    // to reappear through the lazy migration path after pruning.
    try {
      for (const filePath of await IOUtils.getChildren(legacyIndexDir())) {
        if (/\.json$/.test(filePath)) await IOUtils.remove(filePath, { ignoreAbsent: true });
      }
    } catch (e) {}
    return removed;
  }
  async function clearEvidenceIndexes() {
    const records = await listEvidenceRecords();
    let removed = 0;
    for (const record of records) if (await deleteEvidenceIndex(record.libraryID, record.attachmentKey)) removed++;
    try {
      for (const filePath of await IOUtils.getChildren(evidenceDir())) {
        if (/\.(?:json\.gz|f32|tmp)$/.test(filePath)) await IOUtils.remove(filePath, { ignoreAbsent: true });
      }
      const db = await evidenceDb(); await db.queryAsync("DELETE FROM evidence_indexes");
    } catch (e) {}
    try {
      for (const filePath of await IOUtils.getChildren(legacyIndexDir())) {
        if (/\.json$/.test(filePath)) await IOUtils.remove(filePath, { ignoreAbsent: true });
      }
    } catch (e) {}
    return removed;
  }
  async function evidenceCacheStats() {
    try {
      const db = await evidenceDb();
      const row = await db.rowQueryAsync(
        "SELECT COUNT(*) AS documents, COALESCE(SUM(total_pages),0) AS pages, COALESCE(SUM(total_chars),0) AS chars FROM evidence_indexes"
      );
      const records = await listEvidenceRecords();
      let bytes = 0;
      for (const record of records) {
        for (const filePath of [record.dataPath, record.vectorPath]) {
          try { const stat = await IOUtils.stat(filePath); bytes += Number(stat && stat.size) || 0; } catch (e) {}
        }
      }
      return {
        path: evidenceDir(),
        database: evidenceDbPath(),
        documents: Number(row && row.documents) || 0,
        pages: Number(row && row.pages) || 0,
        chars: Number(row && row.chars) || 0,
        bytes,
      };
    } catch (e) {
      return { path: evidenceDir(), database: evidenceDbPath(), documents: 0, pages: 0, chars: 0, bytes: 0 };
    }
  }
  function newId() { return "c_" + Date.now() + "_" + Math.random().toString(36).slice(2, 8); }

  window.NodusStore = {
    getMode, setMode, getLang, setLang, getModel, setModel, getMaxTokens, setMaxTokens, getReasoning, setReasoning, getHlColors, setHlColors, getContext, setContext,
    SOURCE_SCOPES, getSourceScope, setSourceScope, getOnboarded, setOnboarded,
    getKey, setKey, getSecretStorageStatus, getLocalBase, setLocalBase, getPinned, setPinned, isPinned, togglePinned,
    getCustomPrompts, setCustomPrompts, addCustomPrompt, removeCustomPrompt,
    getAutoUpdate, setAutoUpdate,
    getAgent, setAgent, getAgentAuto, setAgentAuto,
    getHistoryEnabled, setHistoryEnabled, getHistoryRetention, setHistoryRetention,
    getManual, setManual, loadConversations, saveConversations, deleteConversationHistory, compactAudit, compactConversations,
    EVIDENCE_CACHE_VERSION, gzipText, gunzipText, compactEvidenceIndex, detachEmbeddings, attachEmbeddings,
    loadEvidenceIndex, saveEvidenceIndex, deleteEvidenceIndex, listEvidenceRecords, loadEvidenceIndexes,
    pruneEvidenceIndexes, clearEvidenceIndexes, evidenceCacheStats, closeEvidenceDb, newId,
  };
})();
