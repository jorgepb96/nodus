import { app, BrowserWindow, dialog, shell } from "electron";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { signText } from "@shared/signI18n";
import type { IpcContext } from "./context";
import { assertTrustedNodusMainFrame } from "./trust";
import type {
  SignAppearance,
  SignCertificate,
  SignCryptoRequest,
  SignDocument,
  SignEngineStatus,
  SignInspection,
  SignPlacement,
  SignSignature,
} from "@shared/signTypes";
import type { ProtectSourceRef } from "@shared/protectTypes";
import { SignStore, validatePng } from "../toolkit/sign/library";
import { exportVisualPdf, inspectVisualPdf } from "../toolkit/sign/visual";
import { SignEngine } from "../toolkit/sign/engine";
import { SignInstaller } from "../toolkit/sign/install";
import { startTrackpad, stopTrackpad } from "../toolkit/sign/trackpad";
import { readProtectSource } from "../protect/protectService";
import * as archive from "../db/archiveRepo";
import { showImportOpenDialog } from "../privacy";
import { getSettings } from "../db/settingsRepo";
export function registerSignIpc({
  h,
  getWindow,
}: Pick<IpcContext, "h" | "getWindow">) {
  const dir = () => path.join(app.getPath("userData"), "toolkit", "sign");
  const store = () => new SignStore(dir());
  const config = () => path.join(dir(), "engine.json");
  const python = () => {
    try {
      const saved = JSON.parse(fs.readFileSync(config(), "utf8"));
      if (typeof saved.python === "string") return saved.python as string;
    } catch {
      /* default */
    }
    return (
      process.env.NODUS_SIGN_PYTHON ||
      (process.platform === "win32" ? "python" : "python3")
    );
  };
  let engine: SignEngine | null = null;
  const assets = () => app.isPackaged ? path.join(process.resourcesPath, 'sign') : path.join(app.getAppPath(), 'electron/assets/sign');
  let installer: SignInstaller | null = null;
  const getEngine = () => {
    const selected = python();
    if (!engine || engine.python !== selected)
      engine = new SignEngine(
        selected,
        app.isPackaged
          ? path.join(process.resourcesPath, "sign", "engine.py")
          : path.join(
              app.getAppPath(),
              "electron",
              "assets",
              "sign",
              "engine.py",
            ),
      );
    return engine;
  };
  const sources = new Map<string, SignDocument>();
  const originals = new Set<string>();
  const originalInodes = new Set<string>();
  const certificates = new Map<string, { path: string; expires: number }>();
  const certPath = (token: string) => {
    const cert = certificates.get(token);
    if (!cert || cert.expires < Date.now())
      throw new Error("CERTIFICATE_SELECTION_EXPIRED");
    return cert.path;
  };
  const document = (id: string) => sources.get(id) ?? store().document(id);
  const status = async (): Promise<SignEngineStatus> => {
    try {
      return {
        ...(await getEngine().run<{ available: boolean; version: string }>({
          op: "status",
        })),
        python: python(),
      };
    } catch (error) {
      return {
        available: false,
        python: python(),
        error: (error as Error).message,
      };
    }
  };
  const copy = (key: string) => signText(getSettings().uiLanguage, key);
  h("sign:library", async (e) => {
    assertTrustedNodusMainFrame(e, getWindow());
    return store().read();
  });
  h("sign:signature:save", async (e, signature: SignSignature) => {
    assertTrustedNodusMainFrame(e, getWindow());
    return store().signature(signature);
  });
  h("sign:signature:delete", async (e, id: string) => {
    assertTrustedNodusMainFrame(e, getWindow());
    return store().remove("signatures", id);
  });
  h("sign:profile:save", async (e, profile: SignAppearance) => {
    assertTrustedNodusMainFrame(e, getWindow());
    return store().profile(profile);
  });
  h("sign:profile:delete", async (e, id: string) => {
    assertTrustedNodusMainFrame(e, getWindow());
    return store().remove("profiles", id);
  });
  h("sign:document:open", async (e, ref: ProtectSourceRef) => {
    assertTrustedNodusMainFrame(e, getWindow());
    const source = await readProtectSource(ref);
    if (
      source.mimeType !== "application/pdf" ||
      source.bytes.length > 150 * 1024 * 1024
    )
      throw new Error("SIGN_PDF_REQUIRED");
    const inspection = await inspectVisualPdf(source.bytes);
    if (ref.kind === "disk") {
      originals.add(fs.realpathSync(ref.path));
      const stat = fs.statSync(ref.path);
      originalInodes.add(`${stat.dev}:${stat.ino}`);
    }
    const doc = {
      id: crypto.randomUUID(),
      name: source.name,
      bytes: source.bytes,
      visualLocked: inspection.signed || inspection.restricted,
    };
    sources.clear();
    sources.set(doc.id, doc);
    return doc;
  });
  h("sign:history:read", async (e, id: string) => {
    assertTrustedNodusMainFrame(e, getWindow());
    const stored = store().document(id);
    const inspection = await inspectVisualPdf(stored.bytes);
    const copy = { ...stored, visualLocked: inspection.signed || inspection.restricted };
    sources.clear();
    sources.set(id, copy);
    return copy;
  });
  h("sign:history:delete", async (e, id: string) => {
    assertTrustedNodusMainFrame(e, getWindow());
    return store().remove("history", id);
  });
  h("sign:visual:save", async (e, id: string, placements: SignPlacement[]) => {
    assertTrustedNodusMainFrame(e, getWindow());
    const source = document(id);
    const bytes = await exportVisualPdf(source.bytes, placements);
    return store().document(
      store().add(
        bytes,
        source.name.replace(/\.pdf$/i, "") + "-signed.pdf",
        "visual",
      ).id,
    );
  });
  h("sign:document:export", async (e, id: string) => {
    assertTrustedNodusMainFrame(e, getWindow());
    const doc = store().document(id);
    const result = await dialog.showSaveDialog(
      BrowserWindow.fromWebContents(e.sender)!,
      {
        title: copy("Exportar copia"),
        defaultPath: doc.name,
        filters: [{ name: "PDF", extensions: ["pdf"] }],
      },
    );
    if (result.canceled || !result.filePath) return false;
    const dest = path.resolve(result.filePath);
    if (
      originals.has(dest) ||
      (fs.existsSync(dest) && originals.has(fs.realpathSync(dest)))
    )
      throw new Error("SIGN_ORIGINAL_PROTECTED");
    if (fs.existsSync(dest)) {
      const stat = fs.statSync(dest);
      if (originalInodes.has(`${stat.dev}:${stat.ino}`))
        throw new Error("SIGN_ORIGINAL_PROTECTED");
    }
    fs.writeFileSync(dest, doc.bytes);
    return true;
  });
  h("sign:document:vault", async (e, id: string) => {
    assertTrustedNodusMainFrame(e, getWindow());
    const doc = store().document(id);
    const hash = crypto.createHash("sha256").update(doc.bytes).digest("hex");
    return (
      archive.findItemByHash(hash) ??
      archive.createItem({
        title: doc.name.replace(/\.pdf$/i, ""),
        kind: "pdf",
        fileName: doc.name,
        mimeType: "application/pdf",
        blob: doc.bytes,
        contentHash: hash,
        source: "Nodus Sign",
      }).itemId
    );
  });
  h("sign:document:reveal", async (e, id: string) => {
    assertTrustedNodusMainFrame(e, getWindow());
    store().document(id);
    shell.showItemInFolder(store().pdfPath(id));
  });
  h("sign:engine:status", async (e) => {
    assertTrustedNodusMainFrame(e, getWindow());
    return status();
  });
  h("sign:engine:configure", async (e) => {
    assertTrustedNodusMainFrame(e, getWindow());
    const result = await showImportOpenDialog(
      BrowserWindow.fromWebContents(e.sender)!,
      {
        properties: ["openFile"],
        title: copy("Seleccionar Python con pyHanko"),
      },
    );
    if (!result.canceled && result.filePaths[0]) {
      store();
      fs.writeFileSync(
        config(),
        JSON.stringify({ python: result.filePaths[0] }),
        { mode: 0o600 },
      );
    }
    return status();
  });
  h('sign:engine:install', async e => {
    assertTrustedNodusMainFrame(e, getWindow());
    installer ??= new SignInstaller(path.join(dir(), 'runtime'), assets(), app.isPackaged ? path.join(process.resourcesPath, 'zotero-mcp') : path.join(app.getAppPath(), 'build/zotero-mcp'));
    const selected = await installer.install(event => { if (!e.sender.isDestroyed()) e.sender.send('sign:engine:progress', event); });
    fs.writeFileSync(config(), JSON.stringify({ python: selected }), { mode: 0o600 });
    return status();
  });
  h('sign:engine:cancel', async e => {
    assertTrustedNodusMainFrame(e, getWindow());
    installer?.cancel();
  });
  let detachTrackpad = () => {};
  const endTrackpad = () => { detachTrackpad(); detachTrackpad = () => {}; stopTrackpad(); };
  h('sign:trackpad:start', async e => {
    assertTrustedNodusMainFrame(e, getWindow());
    endTrackpad();
    const sender = e.sender;
    const surface = startTrackpad(frame => { if (!sender.isDestroyed()) sender.send('sign:trackpad:frame', frame); });
    if (!surface) return null;
    // A closed or reloaded window must not leave the trackpad streaming.
    sender.once('destroyed', endTrackpad);
    sender.once('did-start-loading', endTrackpad);
    detachTrackpad = () => { sender.off('destroyed', endTrackpad); sender.off('did-start-loading', endTrackpad); };
    return surface;
  });
  h('sign:trackpad:stop', async e => {
    assertTrustedNodusMainFrame(e, getWindow());
    endTrackpad();
  });
  h("sign:certificate:pick", async (e) => {
    assertTrustedNodusMainFrame(e, getWindow());
    const result = await showImportOpenDialog(
      BrowserWindow.fromWebContents(e.sender)!,
      {
        properties: ["openFile"],
        title: copy("Seleccionar certificado"),
        filters: [{ name: "PKCS#12", extensions: ["p12", "pfx"] }],
      },
    );
    if (result.canceled || !result.filePaths[0]) return null;
    certificates.clear();
    const token = crypto.randomUUID();
    certificates.set(token, {
      path: result.filePaths[0],
      expires: Date.now() + 30 * 60 * 1000,
    });
    return { token, name: path.basename(result.filePaths[0]) };
  });
  h("sign:certificate:inspect", async (e, token: string, password: string) => {
    assertTrustedNodusMainFrame(e, getWindow());
    return getEngine().run<SignCertificate>({
      op: "certificate",
      certificate: certPath(token),
      password,
    });
  });
  h("sign:document:inspect", async (e, id: string) => {
    assertTrustedNodusMainFrame(e, getWindow());
    return getEngine().run<SignInspection>({
      op: "inspect",
      pdf: Buffer.from(document(id).bytes).toString("base64"),
    });
  });
  h("sign:crypto:sign", async (e, request: SignCryptoRequest) => {
    assertTrustedNodusMainFrame(e, getWindow());
    if (
      !request.confirmed ||
      typeof request.password !== "string" ||
      request.password.length > 4096
    )
      throw new Error("SIGN_CONFIRMATION_REQUIRED");
    // Without an appearance there is one signature and nothing drawn on any page.
    const visible = request.visible !== false;
    if (visible) validatePng(request.appearancePng);
    const widgets = visible ? request.widgets ?? [{ page: request.page, box: request.box }] : [];
    if (visible && (!Array.isArray(widgets) || !widgets.length || widgets.length > 1000 || widgets.some(w => !Number.isInteger(w.page) || w.page < 1 || !Array.isArray(w.box) || w.box.length !== 4 || !w.box.every(Number.isFinite)) || new Set(widgets.map(w => w.page)).size !== widgets.length))
      throw new Error("INVALID_SIGNATURE_PAGE");
    const source = document(request.documentId);
    const certificate = certPath(request.certificateToken);
    const summary = await getEngine().run<SignCertificate>({
      op: "certificate",
      certificate,
      password: request.password,
    });
    if (!summary.usable) throw new Error("CERTIFICATE_EXPIRED_OR_NOT_USABLE");
    const confirmation = await dialog.showMessageBox(
      BrowserWindow.fromWebContents(e.sender)!,
      {
        type: "question",
        title: "Nodus Sign",
        message: copy("¿Autorizar esta firma criptográfica?"),
        detail: `${source.name}\n${summary.subject}\nSHA-256: ${summary.fingerprint}\n${visible ? `${copy("Páginas seleccionadas")}: ${widgets.map(w => w.page).join(', ')}\n${copy("Firmas criptográficas")}: ${widgets.length}` : copy("Firma sin marca visible en las páginas")}\n\n${copy("Se creará una copia PAdES B-B. La confianza y la revocación no se verifican en línea.")}`,
        buttons: [
          copy("Cancelar"),
          copy("Autorizar y firmar"),
        ],
        defaultId: 0,
        cancelId: 0,
        noLink: true,
      },
    );
    if (confirmation.response !== 1) throw new Error("SIGN_CANCELLED");
    const result = await getEngine().run<{ pdf: string }>({
      ...request,
      widgets,
      visible,
      op: "sign",
      certificate,
      expectedFingerprint: summary.fingerprint,
      pdf: Buffer.from(source.bytes).toString("base64"),
    });
    const entry = store().add(
      Buffer.from(result.pdf, "base64"),
      source.name.replace(/\.pdf$/i, "") + "-signed.pdf",
      "certificate",
    );
    return store().document(entry.id);
  });
  h("sign:operation:cancel", async (e) => {
    assertTrustedNodusMainFrame(e, getWindow());
    engine?.cancel();
  });
}
