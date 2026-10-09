/* Nodus for Zotero — bootstrap.
 *
 * Docks a full-height Nodus sidebar into the Zotero window (like Beaver): a
 * splitter + panel appended to #browser (outside the tab deck, so it persists
 * across the library and every reader tab). The panel is an iframe loading
 * chrome://nodus/content/sidebar.html. Toolbar buttons in the library AND the
 * reader toggle it; the PDF text-selection popup gets an "Ask Nodus" action.
 */
/* eslint-disable no-undef */

var chromeHandle;
var Nodus = { rootURI: null, readerToolbarListener: null, selectionListener: null };

const PLUGIN_ID = "nodus-zotero@nodus.app";
const BTN_ID = "nodus-tb-button";
const READER_BTN_ID = "nodus-reader-btn";
const SIDEBAR_ID = "nodus-sidebar";
const SPLITTER_ID = "nodus-splitter";
const LIB_TOOLBAR_ID = "zotero-toolbar-item-tree";
const LIB_INSERT_BEFORE = "zotero-tb-search-spinner";

const MARK_SVG =
  '<svg width="16" height="16" viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg">' +
  '<defs><linearGradient id="ng" x1="14" y1="10" x2="50" y2="54" gradientUnits="userSpaceOnUse">' +
  '<stop offset="0" stop-color="#ddd6fe"/><stop offset="0.45" stop-color="#a78bfa"/><stop offset="1" stop-color="#7c3aed"/>' +
  '</linearGradient></defs>' +
  '<path d="M18 48V16L46 48V16" fill="none" stroke="url(#ng)" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"/>' +
  '<circle cx="18" cy="16" r="6.5" fill="#ddd6fe"/><circle cx="18" cy="48" r="6.5" fill="#a78bfa"/>' +
  '<circle cx="46" cy="48" r="6.5" fill="#8b5cf6"/><circle cx="46" cy="16" r="6.5" fill="#7c3aed"/></svg>';

function log(m) { try { Zotero.debug("[Nodus] " + m); } catch (e) {} }

// ---------------------------------------------------------------- lifecycle

function install() {}
function uninstall() {}

async function disableBackgroundUpdates() {
  try {
    const { AddonManager } = ChromeUtils.importESModule("resource://gre/modules/AddonManager.sys.mjs");
    const addon = await AddonManager.getAddonByID(PLUGIN_ID);
    if (addon && addon.applyBackgroundUpdates !== AddonManager.AUTOUPDATE_DISABLE) {
      // Zotero 9 and 10 reject a plugin whose manifest omits update_url. Keep the
      // mandatory feed, but opt only Nodus out of background updates so the
      // documented manual install/update flow remains truthful.
      addon.applyBackgroundUpdates = AddonManager.AUTOUPDATE_DISABLE;
    }
  } catch (e) {
    log("could not disable background updates: " + e);
  }
}

async function startup({ id, version, rootURI, resourceURI }) {
  await Zotero.initializationPromise;
  if (!rootURI) rootURI = resourceURI.spec;
  Nodus.rootURI = rootURI;

  // Expose chrome://nodus/content/ so the sidebar iframe + its assets load with
  // chrome privileges (can import Zotero, read the bridge file, fetch localhost).
  const aomStartup = Components.classes["@mozilla.org/addons/addon-manager-startup;1"]
    .getService(Components.interfaces.amIAddonManagerStartup);
  const manifestURI = Services.io.newURI(rootURI + "manifest.json");
  chromeHandle = aomStartup.registerChrome(manifestURI, [["content", "nodus", rootURI + "content/"]]);
  Nodus.databases = ChromeUtils.importESModule("chrome://nodus/content/evidence-db.sys.mjs").EvidenceDatabases;
  Nodus.databases.start();

  await disableBackgroundUpdates();

  registerReaderToolbarButton();
  registerSelectionPopup();
  eachMainWindow((w) => { injectSidebar(w); addLibraryButton(w); });
  log("startup complete v" + version);
}

function onMainWindowLoad({ window }) {
  try { injectSidebar(window); addLibraryButton(window); } catch (e) { Zotero.logError(e); }
}
function onMainWindowUnload({ window }) {
  try { removeLibraryButton(window); removeSidebar(window); } catch (e) {}
}

async function shutdown() {
  // Main windows may already be gone. The module still owns their connections,
  // and Zotero awaits this promise before finishing application shutdown.
  if (Nodus.databases) await Nodus.databases.shutdown();
  try { eachMainWindow((w) => { removeLibraryButton(w); removeSidebar(w); }); } catch (e) {}
  if (Nodus.readerToolbarListener) {
    try { Zotero.Reader.unregisterEventListener("renderToolbar", Nodus.readerToolbarListener); } catch (e) {}
    Nodus.readerToolbarListener = null;
  }
  if (Nodus.selectionListener) {
    try { Zotero.Reader.unregisterEventListener("renderTextSelectionPopup", Nodus.selectionListener); } catch (e) {}
    Nodus.selectionListener = null;
  }
  try {
    if (_popupMods && _popupMods.NS && _popupMods.NS.closeEvidenceDb) await _popupMods.NS.closeEvidenceDb();
  } catch (e) {}
  _popupMods = null;
  if (chromeHandle) { try { chromeHandle.destruct(); } catch (e) {} chromeHandle = null; }
  Nodus.rootURI = null;
}

function eachMainWindow(fn) {
  const wins = Zotero.getMainWindows ? Zotero.getMainWindows() : [Zotero.getMainWindow()];
  for (const w of wins) if (w && w.document) fn(w);
}

// ---------------------------------------------------------------- sidebar

function injectSidebar(window) {
  const doc = window.document;
  if (doc.getElementById(SIDEBAR_ID)) return;
  const browser = doc.getElementById("browser");
  if (!browser) { log("#browser not found"); return; }

  // No `collapse` attribute: the splitter is a plain resizer. Collapsing is done
  // by our own toggle (toolbar/reader buttons + the panel's ✕), so there is no
  // separate XUL "collapsed" state that the toggle could get out of sync with.
  const splitter = doc.createXULElement("splitter");
  splitter.id = SPLITTER_ID;
  splitter.setAttribute("hidden", "true");
  splitter.style.cssText = "border:0;min-width:0;width:1px;background:rgba(124,58,237,0.35);";

  const sidebar = doc.createXULElement("vbox");
  sidebar.id = SIDEBAR_ID;
  sidebar.setAttribute("hidden", "true");
  sidebar.setAttribute("zotero-persist", "width");
  sidebar.style.cssText = "width:400px;min-width:320px;max-width:760px;";

  // A XUL <browser> with no type attribute loads the chrome:// page in-process
  // with chrome privileges (needed for ChromeUtils/Zotero/localhost fetch). A
  // type="content" browser would refuse the chrome:// URL.
  const iframe = doc.createXULElement("browser");
  iframe.setAttribute("id", "nodus-sidebar-frame");
  iframe.setAttribute("flex", "1");
  iframe.setAttribute("disableglobalhistory", "true");
  iframe.setAttribute("src", "chrome://nodus/content/sidebar.html");
  sidebar.appendChild(iframe);

  browser.appendChild(splitter);
  browser.appendChild(sidebar);
  log("sidebar injected");
}

function removeSidebar(window) {
  const doc = window.document;
  const s = doc.getElementById(SIDEBAR_ID);
  const sp = doc.getElementById(SPLITTER_ID);
  if (s) s.remove();
  if (sp) sp.remove();
}

function toggleSidebar(window, forceOpen) {
  const doc = window.document;
  const sidebar = doc.getElementById(SIDEBAR_ID);
  const splitter = doc.getElementById(SPLITTER_ID);
  if (!sidebar) { injectSidebar(window); return toggleSidebar(window, true); }
  // Robust "is it closed?": hidden, XUL-collapsed, or resized to ~0 width.
  let width = 0;
  try { width = sidebar.getBoundingClientRect().width; } catch (e) {}
  const isClosed = sidebar.hidden || sidebar.getAttribute("collapsed") === "true" || width < 5;
  const willShow = forceOpen === true ? true : forceOpen === false ? false : isClosed;
  sidebar.hidden = !willShow;
  if (splitter) splitter.hidden = !willShow;
  if (willShow) {
    sidebar.removeAttribute("collapsed");
    const w = parseInt(sidebar.style.width || "0", 10);
    if (!w || w < 120) sidebar.style.width = "400px";
  }
  return willShow;
}

function sidebarFrameWindow(window) {
  const f = window.document.getElementById("nodus-sidebar-frame");
  return f && f.contentWindow ? f.contentWindow : null;
}

function sendToSidebar(window, message) {
  try {
    const win = sidebarFrameWindow(window);
    if (win) win.postMessage(message, "*");
  } catch (e) { Zotero.logError(e); }
}

// ---------------------------------------------------------- library toolbar

function addLibraryButton(window) {
  const doc = window.document;
  if (doc.getElementById(BTN_ID)) return;
  const toolbar = doc.getElementById(LIB_TOOLBAR_ID);
  if (!toolbar) { log("library toolbar not found"); return; }
  const btn = doc.createXULElement("toolbarbutton");
  btn.id = BTN_ID;
  btn.setAttribute("tooltiptext", "Nodus");
  btn.setAttribute("aria-label", "Nodus");
  btn.classList.add("zotero-tb-button");
  btn.style.setProperty("list-style-image", 'url("' + Nodus.rootURI + 'icons/nodus.svg")');
  // Only WIDEN the button so it isn't a tall/narrow vertical rectangle. Do NOT
  // set height — the native class already sizes it to the toolbar row and
  // centres it vertically; forcing a height overflowed the items bar.
  btn.style.minWidth = "24px";
  // Breathing room so it doesn't sit flush against the search bar.
  btn.style.marginInlineStart = "6px";
  btn.addEventListener("command", () => toggleSidebar(window));
  const ref = doc.getElementById(LIB_INSERT_BEFORE);
  if (ref && ref.parentNode === toolbar) toolbar.insertBefore(btn, ref);
  else toolbar.appendChild(btn);
}

function removeLibraryButton(window) {
  const b = window.document.getElementById(BTN_ID);
  if (b) b.remove();
}

// ----------------------------------------------------------- reader toolbar

function registerReaderToolbarButton() {
  Nodus.readerToolbarListener = (event) => {
    try {
      const doc = event.doc;
      if (!doc || doc.getElementById(READER_BTN_ID)) return;
      const btn = doc.createElement("button");
      btn.id = READER_BTN_ID;
      btn.title = "Nodus";
      btn.setAttribute("aria-label", "Nodus");
      btn.style.cssText =
        "display:inline-flex;align-items:center;justify-content:center;" +
        "height:100%;min-width:28px;padding:0 6px;margin:0;background:transparent;border:none;border-radius:5px;cursor:pointer;";
      btn.innerHTML = MARK_SVG;
      btn.addEventListener("click", () => toggleSidebar(Zotero.getMainWindow(), true));
      event.append(btn);
    } catch (e) { Zotero.logError(e); }
  };
  Zotero.Reader.registerEventListener("renderToolbar", Nodus.readerToolbarListener, PLUGIN_ID);
}

// -------------------------------------------------- reader selection → chat

// Reader text-selection popup i18n + the small inline icons it uses.
const POPUP_I18N = {
  en: { cite: "Cite", explain: "Explain", translate: "Translate", searchLang: "Search language…", pickModel: "Pick a model in Nodus first.", noResp: "(no response)" },
  es: { cite: "Citar", explain: "Explicar", translate: "Traducir", searchLang: "Buscar idioma…", pickModel: "Elige un modelo en Nodus primero.", noResp: "(sin respuesta)" },
};
const POPUP_ICO = {
  quote: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 3a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h3a1 1 0 0 1 1 1v1a2 2 0 0 1-2 2h-1a1 1 0 0 0-1 1v1a1 1 0 0 0 1 1h1a4 4 0 0 0 4-4V5a2 2 0 0 0-2-2z"/><path d="M5 3a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h3a1 1 0 0 1 1 1v1a2 2 0 0 1-2 2H6a1 1 0 0 0-1 1v1a1 1 0 0 0 1 1h1a4 4 0 0 0 4-4V5a2 2 0 0 0-2-2z"/></svg>',
  book: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 7v14"/><path d="M3 18a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h5a4 4 0 0 1 4 4 4 4 0 0 1 4-4h5a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1h-6a3 3 0 0 0-3 3 3 3 0 0 0-3-3z"/></svg>',
  lang: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m5 8 6 6"/><path d="m4 14 6-6 2-3"/><path d="M2 5h12"/><path d="M7 2h1"/><path d="m22 22-5-10-5 10"/><path d="M14 18h6"/></svg>',
};
const POPUP_LANGS = ["English", "Spanish", "French", "German", "Italian", "Portuguese", "Dutch", "Catalan", "Galician", "Basque", "Russian", "Ukrainian", "Polish", "Czech", "Greek", "Turkish", "Arabic", "Hebrew", "Persian", "Hindi", "Bengali", "Urdu", "Chinese (Simplified)", "Chinese (Traditional)", "Japanese", "Korean", "Vietnamese", "Thai", "Indonesian", "Malay", "Filipino", "Swedish", "Norwegian", "Danish", "Finnish", "Icelandic", "Romanian", "Hungarian", "Bulgarian", "Croatian", "Serbian", "Slovak", "Slovenian", "Latin", "Swahili"];

var _popupMods = null;
function popupModules() {
  if (_popupMods) return _popupMods;
  const mw = Zotero.getMainWindow();
  const scope = { window: {}, ChromeUtils: ChromeUtils, Components: Components, Services: Services, fetch: mw.fetch.bind(mw), TextDecoder: mw.TextDecoder, AbortController: mw.AbortController };
  Services.scriptloader.loadSubScript("chrome://nodus/content/providers.js", scope);
  Services.scriptloader.loadSubScript("chrome://nodus/content/store.js", scope);
  _popupMods = { NP: scope.window.NodusProviders, NS: scope.window.NodusStore };
  return _popupMods;
}

async function translateInPopup(text, langName, resultEl, L) {
  try {
    const { NS, NP } = popupModules();
    const mode = NS.getMode();
    const model = NS.getModel(mode);
    if (!model) { resultEl.textContent = L.pickModel; return; }
    const system = "Translate the text the user provides into " + langName + ". Output ONLY the translation — no explanations, no notes, no quotation marks. Preserve meaning and tone.";
    resultEl.textContent = "";
    let acc = "";
    const onDelta = (d) => { acc += d; resultEl.textContent = acc; resultEl.scrollTop = resultEl.scrollHeight; };
    if (mode === "standalone") {
      const key = await NS.getKey(model.provider);
      const localBase = NS.getLocalBase(model.provider);
      await NP.chatStream(model, { system, key, localBase, messages: [{ role: "user", content: text }] }, onDelta, undefined);
    } else {
      await translateViaServer(model, langName, text, onDelta);
    }
    if (!acc) resultEl.textContent = L.noResp;
  } catch (e) { resultEl.textContent = "⚠ " + (e && e.message ? e.message : e); }
}

// Connected mode: stream a translation from the Nodus local server.
async function translateViaServer(model, langName, text, onDelta) {
  const mw = Zotero.getMainWindow();
  const dir = Services.dirsvc.get("Home", Components.interfaces.nsIFile);
  const f = dir.clone(); f.append(".nodus"); f.append("zotero-bridge.json");
  const cfg = JSON.parse(await Zotero.File.getContentsAsync(f.path));
  const res = await mw.fetch("http://127.0.0.1:" + cfg.port + "/api/z/translate", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer " + cfg.token },
    body: JSON.stringify({ model, text, language: langName }),
  });
  if (!res.ok || !res.body) throw new Error("HTTP " + res.status);
  const reader = res.body.getReader(); const dec = new mw.TextDecoder(); let buf = "";
  for (;;) {
    const r = await reader.read(); if (r.done) break;
    buf += dec.decode(r.value, { stream: true }); let idx;
    while ((idx = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, idx).trim(); buf = buf.slice(idx + 1); if (!line) continue;
      let o; try { o = JSON.parse(line); } catch (e) { continue; }
      if (o.type === "delta") onDelta(o.text);
    }
  }
}

function buildTranslateUI(doc, area, text, L) {
  area.style.display = "flex"; area.textContent = "";
  const input = doc.createElement("input");
  input.placeholder = L.searchLang;
  input.style.cssText = "width:100%;box-sizing:border-box;padding:5px 7px;border:1px solid rgba(124,58,237,.3);border-radius:6px;font-size:11px;outline:none;";
  const list = doc.createElement("div");
  list.setAttribute("role", "listbox");
  list.style.cssText = "width:100%;box-sizing:border-box;max-height:132px;overflow-y:auto;border:1px solid rgba(0,0,0,.12);border-radius:6px;";
  const result = doc.createElement("div");
  result.style.cssText = "display:none;box-sizing:border-box;width:100%;font-size:12px;line-height:1.45;white-space:pre-wrap;overflow-wrap:anywhere;word-break:break-word;max-height:190px;overflow-y:auto;padding:6px 8px;border-radius:6px;background:rgba(124,58,237,.07);color:#1f2430;";
  const render = (filter) => {
    list.textContent = "";
    const q = (filter || "").toLowerCase();
    for (const name of POPUP_LANGS) {
      if (q && name.toLowerCase().indexOf(q) < 0) continue;
      const it = doc.createElement("button");
      it.type = "button"; it.setAttribute("role", "option");
      it.textContent = name;
      it.style.cssText = "box-sizing:border-box;width:100%;padding:5px 9px;cursor:pointer;font-size:11px;color:#1f2430;background:transparent;border:0;text-align:left;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;";
      it.addEventListener("mouseenter", () => { it.style.background = "rgba(124,58,237,.1)"; });
      it.addEventListener("mouseleave", () => { it.style.background = ""; });
      it.addEventListener("click", () => {
        input.style.display = "none"; list.style.display = "none";
        result.style.display = "block"; result.textContent = "…";
        translateInPopup(text, name, result, L);
      });
      list.appendChild(it);
    }
  };
  input.addEventListener("input", () => render(input.value));
  render("");
  area.appendChild(input); area.appendChild(list); area.appendChild(result);
  try { input.focus(); } catch (e) {}
}

function registerSelectionPopup() {
  Nodus.selectionListener = (event) => {
    try {
      const doc = event.doc;
      const params = event.params || {};
      const text = (params.annotation && params.annotation.text) || params.text || "";
      let draft = null;
      try { draft = params.annotation ? JSON.parse(JSON.stringify(params.annotation)) : null; } catch (e) {}
      let lang = "en";
      try { lang = Zotero.Prefs.get("nodus.lang") === "es" ? "es" : "en"; } catch (e) {}
      const L = POPUP_I18N[lang];

      const wrap = doc.createElement("div");
      wrap.style.cssText = "display:flex;flex-direction:column;gap:6px;padding:5px 4px;width:238px;max-width:100%;min-width:0;box-sizing:border-box;overflow:hidden;";
      const head = doc.createElement("div");
      head.style.cssText = "display:flex;align-items:center;gap:5px;font-size:11px;font-weight:700;color:#7c3aed;";
      head.innerHTML = MARK_SVG + "<span>Nodus</span>";
      wrap.appendChild(head);

      const row = doc.createElement("div");
      // Zotero owns the popup and may make it narrower than our preferred
      // width. Let actions shrink (and, if more are added, wrap) inside that
      // available width instead of allowing their intrinsic content to escape.
      row.style.cssText = "display:flex;flex-wrap:wrap;gap:5px;width:100%;max-width:100%;min-width:0;box-sizing:border-box;overflow:hidden;";
      const mkBtn = (label, iconSvg) => {
        const b = doc.createElement("button");
        b.type = "button";
        b.title = label;
        b.setAttribute("aria-label", label);
        b.style.cssText = "flex:1 1 44px;min-width:0;max-width:100%;height:32px;box-sizing:border-box;overflow:hidden;display:inline-flex;align-items:center;justify-content:center;padding:5px;border:1px solid rgba(124,58,237,.35);border-radius:6px;background:#fff;color:#7c3aed;cursor:pointer;";
        b.innerHTML = iconSvg;
        return b;
      };
      const citeBtn = mkBtn(L.cite, POPUP_ICO.quote);
      const explainBtn = mkBtn(L.explain, POPUP_ICO.book);
      const translateBtn = mkBtn(L.translate, POPUP_ICO.lang);
      row.appendChild(citeBtn); row.appendChild(explainBtn); row.appendChild(translateBtn);
      wrap.appendChild(row);

      const trArea = doc.createElement("div");
      trArea.style.cssText = "display:none;flex-direction:column;gap:4px;";
      wrap.appendChild(trArea);

      citeBtn.addEventListener("click", () => {
        const win = Zotero.getMainWindow(); toggleSidebar(win, true);
        sendToSidebar(win, { type: "nodus-selection", text: String(text || ""), draft: draft });
      });
      explainBtn.addEventListener("click", () => {
        const win = Zotero.getMainWindow(); toggleSidebar(win, true);
        sendToSidebar(win, { type: "nodus-selection", text: String(text || ""), draft: draft, action: "explain" });
      });
      translateBtn.addEventListener("click", () => { buildTranslateUI(doc, trArea, String(text || ""), L); });

      event.append(wrap);
    } catch (e) { Zotero.logError(e); }
  };
  Zotero.Reader.registerEventListener("renderTextSelectionPopup", Nodus.selectionListener, PLUGIN_ID);
}
