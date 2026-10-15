import { PlacementControls, PageTargetControls } from "../sign/PlacementControls";
import { applyPlacementPages, resolveSignPages, type SignPageTarget } from "../sign/pages";
import { resizeSignBox } from '../sign/geometry';
import { useEffect, useRef, useState, type PointerEvent } from "react";
import type { PDFDocumentProxy } from "pdfjs-dist";
import {
  defaultSignAppearance,
  type SignAppearance,
  type SignCertificate,
  type SignDocument,
  type SignEngineStatus,
  type SignInspection,
  type SignInstallProgress,
  type SignLibrary,
  type SignPlacement,
  type SignSignature,
} from "@shared/signTypes";
import type { ProtectSourceSummary } from "@shared/protectTypes";
import { ToolkitAppHero } from "../components/ToolkitAppHero";
import { Icon } from "../components/ui";
import { confirm as showConfirm } from "../components/feedback";
import { t, getActiveLang } from "../i18n";
import { loadPdfBytes } from "../lib/presenter/pdf";
import { SignatureEditor } from "../sign/SignatureEditor";
import { SignPdfPage, SignThumbnails } from "../sign/PdfWorkspace";
import { signatureReview } from "../sign/validation";
import { signErrorText } from "../sign/errors";
import { appearanceImage, textImage } from "../sign/images";
import "./toolkitSign.css";
const confirm = (message: string) =>
  showConfirm({ title: "Nodus Sign", message });
const newAppearance = () => ({ ...defaultSignAppearance(), name: t("Perfil personal") });
const empty: SignLibrary = { signatures: [], profiles: [], history: [] };
export function ToolkitSignView({ onBack }: { onBack: () => void }) {
  const language = getActiveLang();
  const [library, setLibrary] = useState<SignLibrary>(empty);
  const [source, setSource] = useState<SignDocument | null>(null);
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null);
  const [page, setPage] = useState(1);
  const [zoom, setZoom] = useState(1);
  const [mode, setMode] = useState<"visual" | "certificate" | "history">(
    "visual",
  );
  const [placements, setPlacements] = useState<SignPlacement[]>([]);
  const placementRef = useRef(placements);
  placementRef.current = placements;
  const undo = useRef<SignPlacement[][]>([]);
  const redo = useRef<SignPlacement[][]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [editor, setEditor] = useState<SignSignature | "new" | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [result, setResult] = useState<SignDocument | null>(null);
  const [locked, setLocked] = useState(false);
  const [preview, setPreview] = useState(false);
  const [showPages, setShowPages] = useState(true);
  const [showPanel, setShowPanel] = useState(true);
  const [panelWidth, setPanelWidth] = useState(300);
  const [vaultSources, setVaultSources] = useState<
    ProtectSourceSummary[] | null
  >(null);
  const [sourceQuery, setSourceQuery] = useState("");
  const [text, setText] = useState("");
  const [engine, setEngine] = useState<SignEngineStatus | null>(null);
  const [installProgress, setInstallProgress] = useState<SignInstallProgress | null>(null);
  const installing = installProgress !== null;
  const installEngine = async () => {
    setError("");
    setNotice("");
    setInstallProgress({ phase: "checking", fraction: 0 });
    try {
      setEngine(await window.nodus.installSignEngine(setInstallProgress));
      setNotice(t("Motor de firma instalado y listo para usar."));
    } catch (error) {
      if (String(error).includes("SIGN_INSTALL_CANCELLED")) setNotice(signErrorText(error));
      else setError(signErrorText(error));
    }
    finally { setInstallProgress(null); }
  };
  const [certFile, setCertFile] = useState<{
    token: string;
    name: string;
  } | null>(null);
  const [password, setPassword] = useState("");
  const [certificate, setCertificate] = useState<SignCertificate | null>(null);
  const [profile, setProfile] = useState<SignAppearance>(newAppearance);
  const [appearance, setAppearance] = useState("");
  const [inspection, setInspection] = useState<SignInspection | null>(null);
  const [authorized, setAuthorized] = useState(false);
  const [showCrypto, setShowCrypto] = useState(true);
  const [visualTarget, setVisualTarget] = useState<SignPageTarget>({ mode: "current", range: "" });
  const [cryptoTarget, setCryptoTarget] = useState<SignPageTarget>({ mode: "current", range: "" });
  const cryptoPages = resolveSignPages(cryptoTarget, page, pdf?.numPages ?? 0);
  const [cryptoBox, setCryptoBox] = useState({
    x: 0.18,
    y: 0.8,
    w: 0.64,
    h: 0.13,
  });
  const changeCryptoBox = (box: typeof cryptoBox) => {
    setCryptoBox(box);
    setAuthorized(false);
  };
  const docRef = useRef<PDFDocumentProxy | null>(null);
  const generation = useRef(0);
  const mounted = useRef(true);
  const selectedPlacement = placements.find((p) => p.id === selected);
  const run = async <T,>(fn: () => Promise<T>): Promise<T | undefined> => {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      return await fn();
    } catch (e) {
      if (mounted.current) {
        if (String(e).includes("SIGN_CANCELLED")) setNotice(signErrorText(e));
        else setError(signErrorText(e));
      }
    } finally {
      if (mounted.current) setBusy(false);
    }
  };
  useEffect(() => {
    mounted.current = true;
    void run(async () => setLibrary(await window.nodus.getSignLibrary()));
    return () => {
      mounted.current = false;
      generation.current++;
      void docRef.current?.destroy();
    };
  }, []);
  useEffect(() => {
    if (mode === "certificate" && !engine)
      void run(async () => setEngine(await window.nodus.getSignEngineStatus()));
  }, [mode]);
  useEffect(() => {
    let live = true;
    void appearanceImage(profile, library.signatures, certificate).then(
      (png) => {
        if (live) setAppearance(png);
      },
    );
    return () => {
      live = false;
    };
  }, [profile, library.signatures, certificate, language]);
  useEffect(() => { setAuthorized(false); }, [profile, page, cryptoTarget, cryptoBox, language]);
  useEffect(() => {
    setSelected(current => {
      const old = placements.find(p => p.id === current);
      if (old?.page === page) return current;
      const group = old?.groupId ?? old?.id;
      return placements.find(p => p.page === page && group && (p.groupId ?? p.id) === group)?.id
        ?? placements.find(p => p.page === page)?.id ?? null;
    });
  }, [page, placements]);
  useEffect(() => {
    if (inspection)
      document
        .querySelector('[data-testid="sign-validation"]')
        ?.scrollIntoView({ block: "nearest" });
  }, [inspection]);
  const commit = (next: SignPlacement[]) => {
    undo.current.push(placementRef.current);
    if (undo.current.length > 100) undo.current.shift();
    redo.current = [];
    setPlacements(next);
    setResult(null);
    setAuthorized(false);
  };
  const load = async (doc: SignDocument) => {
    const gen = ++generation.current;
    const proxy = await loadPdfBytes(doc.bytes);
    if (gen !== generation.current) {
      await proxy.destroy();
      return;
    }
    const hasSignature = doc.visualLocked ?? /\/ByteRange\s*\[/.test(new TextDecoder("latin1").decode(doc.bytes));
    await docRef.current?.destroy();
    docRef.current = proxy;
    setPdf(proxy);
    setSource(doc);
    setPage(1);
    setVisualTarget({ mode: "current", range: "" });
    setCryptoTarget({ mode: "current", range: "" });
    setZoom(1);
    setPlacements([]);
    undo.current = [];
    redo.current = [];
    setSelected(null);
    setPreview(false);
    setInspection(null);
    setAuthorized(false);
    setShowCrypto(!hasSignature);
    setLocked(
      hasSignature ||
        /\/ByteRange\s*\[/.test(new TextDecoder("latin1").decode(doc.bytes)),
    );
    setResult(library.history.some((h) => h.id === doc.id) ? doc : null);
  };
  const ensureDiscard = async () =>
    !placements.length ||
    result !== null ||
    (await confirm(t("Hay firmas sin guardar. ¿Descartar los cambios?")));
  const pick = () =>
    void run(async () => {
      if (!(await ensureDiscard())) return;
      const files = await window.nodus.pickProtectFiles(false);
      if (files[0])
        await load(await window.nodus.openSignDocument(files[0].ref));
    });
  const openVault = () =>
    void run(async () =>
      setVaultSources(
        (await window.nodus.listProtectVaultSources({ limit: 200 })).filter(
          (s) => s.mimeType === "application/pdf",
        ),
      ),
    );
  const insert = (png: string, ratio: number, y = 0.68) => {
    const w = 0.32;
    const viewport = pdf?.getPage(page);
    void viewport?.then((p) => {
      const v = p.getViewport({ scale: 1 });
      const h = Math.min(0.35, (w * v.width) / v.height / ratio);
      const entry = {
        id: crypto.randomUUID(),
        page,
        x: 0.3,
        y,
        w,
        h,
        angle: 0,
        png,
      };
      commit([...placementRef.current, entry]);
      setSelected(entry.id);
      setVisualTarget({ mode: "current", range: "" });
    });
  };
  const update = (patch: Partial<SignPlacement>) => {
    if (selectedPlacement)
      commit(
        placements.map((p) => (p.id === selected ? { ...p, ...patch } : p)),
      );
  };
  const undoEdit = () => {
    const prior = undo.current.pop();
    if (prior) {
      redo.current.push(placementRef.current);
      setPlacements(prior);
      setResult(null);
    }
  };
  const redoEdit = () => {
    const next = redo.current.pop();
    if (next) {
      undo.current.push(placementRef.current);
      setPlacements(next);
      setResult(null);
    }
  };
  const drag = (
    e: PointerEvent<HTMLElement>,
    p: SignPlacement | "crypto",
    resize = false,
  ) => {
    if (preview || busy) return;
    setAuthorized(false);
    e.preventDefault();
    e.stopPropagation();
    const target = e.currentTarget;
    const paper = target.closest(".sign-paper")!.getBoundingClientRect();
    const start = p === "crypto" ? cryptoBox : p;
    const origin = { clientX: e.clientX, clientY: e.clientY };
    const before = placementRef.current;
    if (p !== "crypto") setSelected(p.id);
    target.setPointerCapture(e.pointerId);
    const move = (event: globalThis.PointerEvent) => {
      const dx = (event.clientX - origin.clientX) / paper.width,
        dy = (event.clientY - origin.clientY) / paper.height;
      const next = resize
        ? resizeSignBox(start, event.clientX-origin.clientX, event.clientY-origin.clientY, paper.width, paper.height, p === "crypto" ? 0 : p.angle)
        : {
            ...start,
            x: Math.max(0, Math.min(1 - start.w, start.x + dx)),
            y: Math.max(0, Math.min(1 - start.h, start.y + dy)),
          };
      if (p === "crypto") setCryptoBox(next);
      else {
        setPlacements(
          before.map((item) =>
            item.id === p.id ? { ...item, ...next } : item,
          ),
        );
        setResult(null);
      }
    };
    const end = () => {
      target.removeEventListener("pointermove", move);
      target.removeEventListener("pointerup", end);
      target.removeEventListener("pointercancel", end);
      if (p !== "crypto") {
        undo.current.push(before);
        redo.current = [];
      }
    };
    target.addEventListener("pointermove", move);
    target.addEventListener("pointerup", end);
    target.addEventListener("pointercancel", end);
  };
  const prepare = async () => {
    if (!source) throw new Error("No hay documento.");
    if (result) return result;
    if (!placements.length) {
      if (library.history.some((h) => h.id === source.id)) return source;
      throw new Error("Añade una firma antes de guardar.");
    }
    const copy = await window.nodus.saveSignVisual(source.id, placements);
    setResult(copy);
    setLibrary(await window.nodus.getSignLibrary());
    return copy;
  };
  const exportCopy = (vault = false) =>
    void run(async () => {
      const doc = await prepare();
      if (vault) {
        await window.nodus.saveSignToVault(doc.id);
        setNotice(t("Copia guardada en los archivos de Nodus."));
      } else {
        const saved = await window.nodus.exportSignDocument(doc.id);
        setNotice(
          t(saved ? "Copia firmada exportada." : "Operación cancelada."),
        );
      }
    });
  const sign = () =>
    void run(async () => {
      if (!source || !pdf || !certFile || !certificate?.usable || !authorized)
        throw new Error("Confirma la operación antes de firmar.");
      let doc = source;
      if (placements.length) doc = await prepare();
      if (!cryptoPages.length) throw new Error("Indica páginas válidas, por ejemplo: 1, 3-5.");
      const widgets = await Promise.all(cryptoPages.map(async (n) => {
        const p = await pdf.getPage(n);
        const viewport = p.getViewport({ scale: 1 });
        const a = viewport.convertToPdfPoint(cryptoBox.x * viewport.width, cryptoBox.y * viewport.height);
        const b = viewport.convertToPdfPoint((cryptoBox.x + cryptoBox.w) * viewport.width, (cryptoBox.y + cryptoBox.h) * viewport.height);
        return { page: n, box: [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[0], b[0]), Math.max(a[1], b[1])] as [number, number, number, number] };
      }));
      const secret = password;
      setPassword("");
      setAuthorized(false);
      const copy = await window.nodus.signWithCertificate({
        documentId: doc.id,
        certificateToken: certFile.token,
        password: secret,
        appearance: profile,
        page: widgets[0].page,
        box: widgets[0].box,
        widgets,
        appearancePng: appearance,
        confirmed: true,
      });
      await load(copy);
      setPage(page);
      setShowCrypto(false);
      setResult(copy);
      setLibrary(await window.nodus.getSignLibrary());
      setInspection(await window.nodus.inspectSignDocument(copy.id));
      setNotice(t("Firma criptográfica completada y comprobada."));
    });
  return (
    <section
      className="sign-workspace"
      data-testid="toolkit-sign-page"
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        const files = Array.from(e.dataTransfer.files);
        if (files.length)
          void run(async () => {
            if (!(await ensureDiscard())) return;
            const sources =
              await window.nodus.registerProtectDroppedFiles(files);
            if (sources[0])
              await load(await window.nodus.openSignDocument(sources[0].ref));
          });
      }}
    >
      <ToolkitAppHero
        compact
        badge="Nodus Tools"
        title="Nodus Sign"
        description={t(
          "Firma PDF con firmas manuscritas y certificados digitales, en tu equipo.",
        )}
        icon="signature"
        actionLabel={t("Abrir PDF")}
        actionIcon="upload"
        onAction={pick}
        onBack={onBack}
        heroTestId="toolkit-sign-hero"
        actionTestId="sign-open"
        backTestId="sign-back"
        actionDisabled={busy}
      />
      <div className="sign-actions">
        <button
          className="btn btn-secondary"
          disabled={busy}
          onClick={openVault}
        >
          <Icon name="folder" />
          {t("Desde Nodus")}
        </button>
        <span className="sign-local">
          <Icon name="lock" size={13} />
          {t("Local · Sin IA · Original intacto")}
        </span>
        <span className="sign-grow" />
        <button
          className="btn btn-secondary"
          data-testid="sign-save-vault"
          disabled={busy || !source || (!placements.length && !result)}
          onClick={() => exportCopy(true)}
        >
          {t("Guardar en Nodus")}
        </button>
        <button
          className="btn btn-primary"
          data-testid="sign-export"
          disabled={busy || !source || (!placements.length && !result)}
          onClick={() => exportCopy()}
        >
          <Icon name="download" />
          {t("Exportar copia")}
        </button>
      </div>
      {(notice || error || busy) && (
        <div
          className={`sign-message ${error ? "sign-error" : ""}`}
          role={error ? "alert" : "status"}
        >
          {busy ? t("Procesando…") : error || notice}
          {busy && mode === "certificate" && (
            <button
              className="btn btn-ghost"
              onClick={() => void window.nodus.cancelSignOperation()}
            >
              {t("Cancelar")}
            </button>
          )}
        </div>
      )}
      <div
        className="sign-toolbar"
        role="toolbar"
        aria-label={t("Herramientas del documento")}
      >
        <button
          className="btn btn-ghost"
          aria-pressed={showPages}
          aria-label={t("Mostrar páginas")}
          onClick={() => setShowPages(!showPages)}
        >
          <Icon name="grid" />
        </button>
        <button
          className="btn btn-ghost"
          aria-label={t("Página anterior")}
          disabled={!pdf || page <= 1 || busy}
          onClick={() => setPage(page - 1)}
        >
          <Icon name="chevronLeft" />
        </button>
        <label className="sign-page-number">
          {t("Página")}
          <input
            aria-label={t("Número de página")}
            type="number"
            min={1}
            max={pdf?.numPages ?? 1}
            value={page}
            disabled={!pdf || busy}
            onChange={(e) => {
              const n = Number(e.target.value);
              if (pdf && n >= 1 && n <= pdf.numPages) setPage(n);
            }}
          />{" "}
          / {pdf?.numPages ?? 0}
        </label>
        <button
          className="btn btn-ghost"
          aria-label={t("Página siguiente")}
          disabled={!pdf || page >= (pdf?.numPages ?? 0) || busy}
          onClick={() => setPage(page + 1)}
        >
          <Icon name="chevronRight" />
        </button>
        <select
          aria-label={t("Zoom")}
          value={zoom}
          onChange={(e) => setZoom(Number(e.target.value))}
        >
          {[0.5, 0.75, 1, 1.25, 1.5, 2].map((z) => (
            <option key={z} value={z}>
              {z === 1 ? t("Ajustar") : Math.round(z * 100) + "%"}
            </option>
          ))}
        </select>
        <button
          className="btn btn-ghost"
          disabled={!undo.current.length || busy}
          onClick={undoEdit}
          aria-label={t("Deshacer")}
        >
          <Icon name="undo" />
        </button>
        <button
          className="btn btn-ghost"
          disabled={!redo.current.length || busy}
          onClick={redoEdit}
          aria-label={t("Rehacer")}
        >
          <Icon name="redo" />
        </button>
        <button
          className={`btn ${preview ? "btn-secondary" : "btn-ghost"}`}
          aria-pressed={preview}
          onClick={() => setPreview(!preview)}
        >
          {t("Previsualizar")}
        </button>
        <span className="sign-grow" />
        <span className="sign-filename" title={source?.name}>
          {source?.name ?? t("Ningún PDF abierto")}
        </span>
        <button
          className="btn btn-ghost"
          aria-pressed={showPanel}
          aria-label={t("Mostrar biblioteca")}
          onClick={() => setShowPanel(!showPanel)}
        >
          <Icon name="columns" />
        </button>
      </div>
      <div
        className="sign-body"
        style={
          { "--sign-panel-width": panelWidth + "px" } as React.CSSProperties
        }
      >
        {showPages && pdf && (
          <SignThumbnails
            doc={pdf}
            page={page}
            onPage={(n) => {
              if (!busy) setPage(n);
            }}
          />
        )}
        <main className="sign-viewer">
          {pdf ? (
            <SignPdfPage doc={pdf} page={page} zoom={zoom}>
              <div className={`sign-overlays ${preview ? "sign-preview" : ""}`}>
                {placements
                  .filter((p) => p.page === page)
                  .map((p) => (
                    <div
                      key={p.id}
                      role="button"
                      tabIndex={preview ? -1 : 0}
                      aria-label={t("Firma colocada")}
                      data-testid="sign-placement"
                      className={`sign-placement ${selected === p.id ? "is-selected" : ""}`}
                      style={{
                        left: p.x * 100 + "%",
                        top: p.y * 100 + "%",
                        width: p.w * 100 + "%",
                        height: p.h * 100 + "%",
                        transform: `rotate(${p.angle}deg)`,
                      }}
                      onPointerDown={(e) => drag(e, p)}
                      onClick={() => setSelected(p.id)}
                      onKeyDown={(e) => {
                        if (preview || busy) return;
                        if (e.key === "Delete" || e.key === "Backspace") {
                          e.preventDefault();
                          commit(placements.filter((item) => item.id !== p.id));
                        } else if (
                          [
                            "ArrowLeft",
                            "ArrowRight",
                            "ArrowUp",
                            "ArrowDown",
                          ].includes(e.key)
                        ) {
                          e.preventDefault();
                          setSelected(p.id);
                          const d = e.shiftKey ? 0.02 : 0.005;
                          commit(
                            placements.map((item) =>
                              item.id === p.id
                                ? {
                                    ...item,
                                    x: Math.max(
                                      0,
                                      Math.min(
                                        1 - item.w,
                                        item.x +
                                          (e.key === "ArrowRight"
                                            ? d
                                            : e.key === "ArrowLeft"
                                              ? -d
                                              : 0),
                                      ),
                                    ),
                                    y: Math.max(
                                      0,
                                      Math.min(
                                        1 - item.h,
                                        item.y +
                                          (e.key === "ArrowDown"
                                            ? d
                                            : e.key === "ArrowUp"
                                              ? -d
                                              : 0),
                                      ),
                                    ),
                                  }
                                : item,
                            ),
                          );
                        }
                      }}
                    >
                      <img src={p.png} draggable={false} alt="" />
                      <span
                        className="sign-resize"
                        role="button"
                        tabIndex={-1}
                        aria-label={t("Redimensionar firma")}
                        onPointerDown={(e) => drag(e, p, true)}
                      />
                    </div>
                  ))}
                {mode === "certificate" && appearance && showCrypto && cryptoPages.includes(page) && (
                  <div
                    role="button"
                    tabIndex={0}
                    aria-label={t("Apariencia criptográfica")}
                    className="sign-placement sign-crypto"
                    data-testid="sign-crypto-placement"
                    style={{
                      left: cryptoBox.x * 100 + "%",
                      top: cryptoBox.y * 100 + "%",
                      width: cryptoBox.w * 100 + "%",
                      height: cryptoBox.h * 100 + "%",
                    }}
                    onPointerDown={(e) => drag(e, "crypto")}
                    onKeyDown={(e) => {
                      if (preview || busy || !["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(e.key)) return;
                      e.preventDefault();
                      const d = e.shiftKey ? 0.02 : 0.005;
                      changeCryptoBox({ ...cryptoBox,
                        x: Math.max(0, Math.min(1 - cryptoBox.w, cryptoBox.x + (e.key === "ArrowRight" ? d : e.key === "ArrowLeft" ? -d : 0))),
                        y: Math.max(0, Math.min(1 - cryptoBox.h, cryptoBox.y + (e.key === "ArrowDown" ? d : e.key === "ArrowUp" ? -d : 0))),
                      });
                    }}
                  >
                    <img
                      src={appearance}
                      draggable={false}
                      alt={t("Apariencia de la firma")}
                    />
                    <span
                      className="sign-resize"
                      role="button"
                      aria-label={t("Redimensionar firma")}
                      onPointerDown={(e) => drag(e, "crypto", true)}
                    />
                  </div>
                )}
              </div>
            </SignPdfPage>
          ) : (
            <div className="sign-empty">
              <span className="sign-empty-icon">
                <Icon name="signature" size={36} />
              </span>
              <h2>{t("Tu firma, en tus documentos")}</h2>
              <p>
                {t(
                  "Abre un PDF o arrástralo aquí para empezar. Crea firmas reutilizables y guarda siempre una copia.",
                )}
              </p>
              <button
                className="btn btn-primary"
                onClick={pick}
                disabled={busy}
              >
                {t("Abrir PDF")}
              </button>
              <button
                className="btn btn-ghost"
                onClick={openVault}
                disabled={busy}
              >
                {t("Elegir de los archivos de Nodus")}
              </button>
            </div>
          )}
        </main>
        {showPanel && (
          <>
            <div
              className="sign-divider"
              role="separator"
              aria-label={t("Ancho del panel")}
              aria-orientation="vertical"
              aria-valuemin={260}
              aria-valuemax={480}
              aria-valuenow={panelWidth}
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === "ArrowLeft")
                  setPanelWidth((w) => Math.min(480, w + 20));
                if (e.key === "ArrowRight")
                  setPanelWidth((w) => Math.max(260, w - 20));
              }}
              onPointerDown={(e) => {
                const start = e.clientX,
                  width = panelWidth;
                e.currentTarget.setPointerCapture(e.pointerId);
                const el = e.currentTarget;
                const move = (ev: globalThis.PointerEvent) =>
                  setPanelWidth(
                    Math.max(260, Math.min(480, width + start - ev.clientX)),
                  );
                const end = () => {
                  el.removeEventListener("pointermove", move);
                  el.removeEventListener("pointerup", end);
                };
                el.addEventListener("pointermove", move);
                el.addEventListener("pointerup", end);
              }}
            />
            <aside className="sign-panel">
              <div
                className="sign-tabs"
                role="tablist"
                aria-label={t("Biblioteca de firmas")}
              >
                {(["visual", "certificate", "history"] as const).map((tab) => (
                  <button
                    key={tab}
                    role="tab"
                    aria-selected={mode === tab}
                    disabled={busy}
                    onClick={() => {
                      setMode(tab);
                      if (tab === "certificate") setPreview(false);
                    }}
                  >
                    {t(
                      tab === "visual"
                        ? "Manuscritas"
                        : tab === "certificate"
                          ? "Certificados"
                          : "Historial",
                    )}
                  </button>
                ))}
              </div>
              {mode === "visual" ? (
                <div className="sign-panel-content">
                  <h2>{t("Tus firmas")}</h2>
                  <p>
                    {t(
                      "Las firmas manuscritas son marcas visuales. No contienen una firma criptográfica.",
                    )}
                  </p>
                  <button
                    className="btn btn-primary"
                    data-testid="sign-create"
                    disabled={busy}
                    onClick={() => setEditor("new")}
                  >
                    <Icon name="plus" />
                    {t("Crear firma")}
                  </button>
                  {!library.signatures.length && (
                    <div className="sign-library-empty">
                      {t(
                        "Aún no hay firmas guardadas. Tu biblioteca estará disponible en todas las bóvedas.",
                      )}
                    </div>
                  )}
                  {library.signatures.map((s) => (
                    <article key={s.id} className="sign-signature-card">
                      <button
                        className="sign-signature-preview"
                        title={t("Insertar firma")}
                        data-testid="sign-insert-signature"
                        disabled={!pdf || locked || busy}
                        onClick={() => insert(s.png, s.width / s.height)}
                      >
                        <img src={s.png} alt={s.name} />
                      </button>
                      <div className="sign-row">
                        <span className="sign-grow">{s.name}</span>
                        <button
                          className="btn btn-ghost"
                          aria-label={`${t("Editar firma")}: ${s.name}`}
                          disabled={busy}
                          onClick={() => setEditor(s)}
                        >
                          <Icon name="edit" size={14} />
                        </button>
                        <button
                          className="btn btn-ghost"
                          aria-label={`${t("Eliminar firma")}: ${s.name}`}
                          disabled={busy}
                          onClick={() =>
                            void run(async () => {
                              if (
                                await confirm(
                                  t("¿Eliminar esta firma de la biblioteca?"),
                                )
                              )
                                setLibrary(
                                  await window.nodus.deleteSignSignature(s.id),
                                );
                            })
                          }
                        >
                          <Icon name="trash" size={14} />
                        </button>
                      </div>
                    </article>
                  ))}
                  <h3>{t("Texto complementario")}</h3>
                  <textarea
                    aria-label={t("Nombre, fecha, institución o cargo")}
                    placeholder={t("Nombre, fecha, institución o cargo")}
                    value={text}
                    maxLength={300}
                    onChange={(e) => setText(e.target.value)}
                  />
                  <button
                    className="btn btn-secondary"
                    disabled={!pdf || locked || busy || !text.trim()}
                    onClick={() => insert(textImage(text), 1000 / 240, 0.83)}
                  >
                    {t("Insertar texto")}
                  </button>
                  {selectedPlacement && (
                    <div className="sign-selection">
                      <h3>{t("Firma seleccionada")}</h3>
                      <p>{t("Página")} {selectedPlacement.page}</p>
                      <PlacementControls box={selectedPlacement} onChange={update} disabled={busy || preview} />
                      <PageTargetControls target={visualTarget} onChange={setVisualTarget} page={page} count={pdf?.numPages ?? 0} disabled={busy || preview} />
                      <button className="btn btn-secondary" data-testid="sign-apply-pages"
                        disabled={busy || preview || !resolveSignPages(visualTarget, page, pdf?.numPages ?? 0).length}
                        onClick={() => {
                          const pages = resolveSignPages(visualTarget, page, pdf?.numPages ?? 0);
                          if (!pages.length) return;
                          commit(applyPlacementPages(placements, selectedPlacement, pages));
                          setPage(pages[0]);
                        }}>{t("Aplicar a páginas")}</button>
                      <label>
                        {t("Rotación")}
                        <input
                          aria-label={t("Rotación")}
                          type="range"
                          min={-180}
                          max={180}
                          step={1}
                          value={selectedPlacement.angle}
                          onChange={(e) =>
                            update({ angle: Number(e.target.value) })
                          }
                        />
                        <output>{selectedPlacement.angle}°</output>
                      </label>
                      <button
                        className="btn btn-secondary"
                        onClick={() =>
                          commit(placements.filter((p) => p.id !== selected))
                        }
                      >
                        {t("Eliminar selección")}
                      </button>
                      <p>
                        {t(
                          "Arrastra para mover. Usa la esquina para cambiar el tamaño o las flechas del teclado para ajustar la posición.",
                        )}
                      </p>
                    </div>
                  )}
                </div>
              ) : mode === "history" ? (
                <div className="sign-panel-content">
                  <h2>{t("Copias firmadas")}</h2>
                  <p>
                    {t(
                      "Solo se eliminan las copias locales del historial. Los originales y las exportaciones se conservan.",
                    )}
                  </p>
                  {!library.history.length && (
                    <p>{t("Aún no hay documentos firmados.")}</p>
                  )}
                  {library.history.map((h) => (
                    <article className="sign-history-card" key={h.id}>
                      <strong>{h.name}</strong>
                      <small>
                        {new Date(h.createdAt).toLocaleString(getActiveLang())} ·{" "}
                        {t(h.mode === "certificate" ? "Certificado" : "Visual")}
                      </small>
                      <div className="sign-row">
                        <button
                          className="btn btn-secondary"
                          disabled={busy}
                          onClick={() =>
                            void run(async () => {
                              if (await ensureDiscard())
                                await load(
                                  await window.nodus.readSignHistory(h.id),
                                );
                            })
                          }
                        >
                          {t("Abrir")}
                        </button>
                        <button
                          className="btn btn-ghost"
                          aria-label={t("Localizar copia")}
                          onClick={() =>
                            void run(() =>
                              window.nodus.revealSignDocument(h.id),
                            )
                          }
                        >
                          <Icon name="folder" />
                        </button>
                        <button
                          className="btn btn-ghost"
                          aria-label={t("Exportar copia")}
                          onClick={() =>
                            void run(() =>
                              window.nodus.exportSignDocument(h.id),
                            )
                          }
                        >
                          <Icon name="download" />
                        </button>
                        <button
                          className="btn btn-ghost"
                          aria-label={t("Eliminar copia")}
                          onClick={() =>
                            void run(async () => {
                              if (
                                await confirm(
                                  t("¿Eliminar esta copia del historial?"),
                                )
                              ) {
                                setLibrary(
                                  await window.nodus.deleteSignHistory(h.id),
                                );
                                if (result?.id === h.id) setResult(null);
                              }
                            })
                          }
                        >
                          <Icon name="trash" />
                        </button>
                      </div>
                    </article>
                  ))}
                </div>
              ) : (
                <div className="sign-panel-content">
                  <h2>{t("Firma con certificado")}</h2>
                  <p>
                    {t(
                      "PAdES B-B local con PKCS#12. No implica una firma cualificada ni garantiza aceptación administrativa.",
                    )}
                  </p>
                  <div
                    className={`sign-engine ${engine?.available ? "is-ready" : ""}`}
                    role="status"
                  >
                    {engine?.available
                      ? `pyHanko ${engine.version}`
                      : t("Motor de certificados no disponible")}
                    {!engine?.available && <button className="btn btn-primary" data-testid="sign-install-engine" disabled={installing || busy} onClick={() => void installEngine()}>
                      <Icon name="download" />{t("Instalar motor de firma")}
                    </button>}
                  </div>
                  {installProgress && <div className="sign-install-progress" role="status" data-testid="sign-install-progress">
                    <span>{t({ checking: "Comprobando componentes…", python: "Descargando Python…", environment: "Preparando entorno privado…", dependencies: "Instalando motor de firma…", verifying: "Comprobando instalación…", ready: "Motor listo" }[installProgress.phase])}</span>
                    <progress max={1} value={installProgress.fraction} aria-label={t("Progreso de instalación")} />
                    <button className="btn btn-secondary" onClick={() => void window.nodus.cancelSignEngineInstall()}>{t("Cancelar instalación")}</button>
                  </div>}
                  {!engine?.available && <p>{t("Nodus instalará los componentes necesarios automáticamente en un entorno privado. Solo la descarga necesita conexión; tus documentos y certificados permanecen en el equipo.")}</p>}
                  <details className="sign-advanced-engine">
                    <summary>{t("Configuración avanzada del motor")}</summary>
                    <button className="btn btn-ghost" disabled={busy || installing} onClick={() => void run(async () => setEngine(await window.nodus.configureSignPython()))}>
                      {t("Usar otro Python")}
                    </button>
                  </details>
                  <p>
                    {t(
                      "Los almacenes del sistema, AutoFirma y PKCS#11 no están conectados. Selecciona un archivo .p12 o .pfx.",
                    )}
                  </p>
                  <button
                    className="btn btn-secondary"
                    data-testid="sign-pick-certificate"
                    disabled={!engine?.available || busy || installing}
                    onClick={() =>
                      void run(async () => {
                        const file = await window.nodus.pickSignCertificate();
                        if (file) {
                          setCertFile(file);
                          setCertificate(null);
                          setPassword("");
                          setAuthorized(false);
                        }
                      })
                    }
                  >
                    {certFile?.name ?? t("Seleccionar certificado")}
                  </button>
                  {certFile && (
                    <>
                      <label>
                        {t("Contraseña del certificado")}
                        <input
                          type="password"
                          autoComplete="off"
                          value={password}
                          onChange={(e) => {
                            setPassword(e.target.value);
                            setAuthorized(false);
                          }}
                        />
                      </label>
                      <button
                        className="btn btn-secondary"
                        data-testid="sign-inspect-certificate"
                        disabled={busy}
                        onClick={() =>
                          void run(async () => {
                            const info =
                              await window.nodus.inspectSignCertificate(
                                certFile.token,
                                password,
                              );
                            setCertificate(info);
                            if (!profile.signer)
                              setProfile((p) => ({
                                ...p,
                                signer: info.subject,
                              }));
                          })
                        }
                      >
                        {t("Comprobar certificado")}
                      </button>
                    </>
                  )}
                  {certificate && (
                    <div className="sign-certificate">
                      <strong>{certificate.subject}</strong>
                      <small>{certificate.issuer}</small>
                      <small>
                        {t("Certificado válido hasta")}:{" "}
                        {new Date(certificate.notAfter).toLocaleDateString(getActiveLang())}
                      </small>
                      <small>SHA-256: {certificate.fingerprint}</small>
                      <p>
                        {t(
                          certificate.usable
                            ? "Certificado disponible para firmar."
                            : "El certificado está caducado, aún no es válido o no permite firmar.",
                        )}
                      </p>
                    </div>
                  )}
                  {locked && !showCrypto && (
                    <button
                      className="btn btn-secondary"
                      onClick={() => {
                        setShowCrypto(true);
                        setAuthorized(false);
                      }}
                    >
                      {t("Preparar otra firma")}
                    </button>
                  )}
                  <h3>{t("Apariencia y perfiles")}</h3>
                  <select
                    aria-label={t("Perfil de apariencia")}
                    value={profile.id}
                    onChange={(e) => {
                      setProfile(
                        library.profiles.find((p) => p.id === e.target.value) ??
                          newAppearance(),
                      );
                      setAuthorized(false);
                    }}
                  >
                    <option value="">{t("Personalizado")}</option>
                    {library.profiles.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                  <label>
                    {t("Nombre del perfil")}
                    <input
                      value={profile.name}
                      maxLength={120}
                      onChange={(e) =>
                        setProfile((p) => ({ ...p, name: e.target.value }))
                      }
                    />
                  </label>
                  {(["signer", "reason", "location", "text"] as const).map(
                    (key, i) => (
                      <label key={key}>
                        {t(
                          [
                            "Nombre visible",
                            "Motivo",
                            "Ubicación",
                            "Texto personalizado",
                          ][i],
                        )}
                        <input
                          value={profile[key]}
                          maxLength={300}
                          onChange={(e) => {
                            setProfile((p) => ({
                              ...p,
                              [key]: e.target.value,
                            }));
                            setAuthorized(false);
                          }}
                        />
                      </label>
                    ),
                  )}
                  <div className="sign-row">
                    <label>
                      {t("Familia tipográfica")}
                      <select
                        value={profile.font}
                        onChange={(e) =>
                          setProfile((p) => ({
                            ...p,
                            font: e.target.value as SignAppearance["font"],
                          }))
                        }
                      >
                        <option value="sans">{t("Sin remates")}</option>
                        <option value="serif">{t("Con remates")}</option>
                        <option value="mono">{t("Monoespaciada")}</option>
                      </select>
                    </label>
                    <label>
                      {t("Tamaño")}
                      <input
                        type="number"
                        min={6}
                        max={32}
                        value={profile.fontSize}
                        onChange={(e) =>
                          setProfile((p) => ({
                            ...p,
                            fontSize: Math.max(
                              6,
                              Math.min(32, Number(e.target.value)),
                            ),
                          }))
                        }
                      />
                    </label>
                  </div>
                  <label className="sign-check">
                    <input
                      type="checkbox"
                      checked={profile.showDate}
                      onChange={(e) =>
                        setProfile((p) => ({
                          ...p,
                          showDate: e.target.checked,
                        }))
                      }
                    />
                    {t("Mostrar fecha")}
                  </label>
                  <label className="sign-check">
                    <input
                      type="checkbox"
                      checked={profile.showCertificate}
                      onChange={(e) =>
                        setProfile((p) => ({
                          ...p,
                          showCertificate: e.target.checked,
                        }))
                      }
                    />
                    {t("Mostrar identificador del certificado")}
                  </label>
                  <label>
                    {t("Imagen manuscrita")}
                    <select
                      aria-label={t("Imagen manuscrita")}
                      value={profile.signatureId ?? ""}
                      onChange={(e) =>
                        setProfile((p) => ({
                          ...p,
                          signatureId: e.target.value || null,
                        }))
                      }
                    >
                      <option value="">{t("Sin imagen")}</option>
                      {library.signatures.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <div className="sign-row">
                    <button
                      className="btn btn-secondary"
                      disabled={busy || !profile.name.trim()}
                      onClick={() =>
                        void run(async () => {
                          const saved = {
                            ...profile,
                            id: profile.id || crypto.randomUUID(),
                          };
                          setLibrary(await window.nodus.saveSignProfile(saved));
                          setProfile(saved);
                        })
                      }
                    >
                      {t("Guardar perfil")}
                    </button>
                    {profile.id && (
                      <button
                        className="btn btn-ghost"
                        aria-label={t("Eliminar perfil")}
                        onClick={() =>
                          void run(async () => {
                            if (await confirm(t("¿Eliminar este perfil?"))) {
                              setLibrary(
                                await window.nodus.deleteSignProfile(
                                  profile.id,
                                ),
                              );
                              setProfile(newAppearance());
                            }
                          })
                        }
                      >
                        <Icon name="trash" />
                      </button>
                    )}
                  </div>
                  <PlacementControls box={cryptoBox} onChange={changeCryptoBox} disabled={busy || preview || !showCrypto} />
                  <PageTargetControls target={cryptoTarget} onChange={target => { setCryptoTarget(target); setAuthorized(false); }} page={page} count={pdf?.numPages ?? 0} disabled={busy || !showCrypto} />
                  {cryptoPages.length > 1 && <p className="sign-multipage-note">{t("Se aplicará una firma criptográfica por página seleccionada, conservando las anteriores mediante actualizaciones incrementales.")}</p>}
                  <label className="sign-check">
                    <input
                      type="checkbox"
                      checked={authorized}
                      disabled={!certificate?.usable || !source || busy}
                      onChange={(e) => setAuthorized(e.target.checked)}
                    />
                    {t(
                      "Autorizo firmar una copia de este documento con el certificado seleccionado.",
                    )}
                  </label>
                  <button
                    className="btn btn-primary"
                    data-testid="sign-crypto-submit"
                    disabled={
                      !authorized ||
                      !cryptoPages.length ||
                      !showCrypto ||
                      !certificate?.usable ||
                      !source ||
                      busy ||
                      !engine?.available ||
                      !!inspection?.restricted
                    }
                    onClick={sign}
                  >
                    <Icon name="lock" />
                    {t("Firmar con certificado")}
                  </button>
                  <button
                    className="btn btn-secondary"
                    data-testid="sign-validate"
                    disabled={!source || !engine?.available || busy}
                    onClick={() =>
                      void run(async () =>
                        setInspection(
                          await window.nodus.inspectSignDocument(source!.id),
                        ),
                      )
                    }
                  >
                    {t("Comprobar firmas del PDF")}
                  </button>
                  {inspection && (
                    <div
                      data-testid="sign-validation"
                      className="sign-validation"
                    >
                      <h3>{t("Validación local")}</h3>
                      {inspection.restricted && (
                        <p>{t("Este PDF tiene restricciones de firma.")}</p>
                      )}
                      {!inspection.signatures.length && (
                        <p>{t("No hay firmas criptográficas en este PDF.")}</p>
                      )}
                      {inspection.signatures.map((s) => {
                        const review = signatureReview(s);
                        return (
                        <article key={s.field}>
                          <strong>{s.signer}</strong>
                          <p>
                            {t(
                              s.intact && s.valid
                                ? "Integridad criptográfica correcta."
                                : "Firma dañada o no válida.",
                            )}
                          </p>
                          <p>
                            {t(
                              s.trusted
                                ? "Cadena de confianza verificada."
                                : "Confianza no acreditada localmente; revocación no comprobada en línea.",
                            )}
                          </p>
                          <small>{t(review.coverage)}</small>
                          <p role={review.warning ? "alert" : undefined} className={review.warning ? "sign-error" : undefined}>{t(review.changes)}</p>
                        </article>
                      ); })}
                    </div>
                  )}
                </div>
              )}
            </aside>
          </>
        )}
      </div>
      <footer className="sign-status">
        <span>
          {locked
            ? t(
                "PDF firmado: edición visual bloqueada para conservar su integridad.",
              )
            : t("Prepara las firmas visuales antes de aplicar un certificado.")}
        </span>
        <span>
          {placements.length} {t("elementos")}
        </span>
      </footer>
      {editor && (
        <SignatureEditor
          signature={editor === "new" ? undefined : editor}
          onClose={() => setEditor(null)}
          onSave={async (signature) =>
            setLibrary(await window.nodus.saveSignSignature(signature))
          }
        />
      )}
      {vaultSources && (
        <div className="sign-vault-picker">
          <header>
            <h2>{t("Archivos PDF de Nodus")}</h2>
            <button
              className="btn btn-ghost"
              onClick={() => setVaultSources(null)}
            >
              {t("Cerrar")}
            </button>
          </header>
          <input
            aria-label={t("Buscar archivos")}
            placeholder={t("Buscar archivos")}
            value={sourceQuery}
            onChange={(e) => setSourceQuery(e.target.value)}
          />
          {!vaultSources.length && (
            <p>{t("No hay PDF disponibles en esta bóveda.")}</p>
          )}
          {vaultSources
            .filter((s) =>
              (s.name + " " + s.title)
                .toLowerCase()
                .includes(sourceQuery.toLowerCase()),
            )
            .map((s) => (
              <button
                className="sign-vault-source"
                key={JSON.stringify(s.ref)}
                disabled={!s.available || busy}
                onClick={() =>
                  void run(async () => {
                    if (!(await ensureDiscard())) return;
                    await load(await window.nodus.openSignDocument(s.ref));
                    setVaultSources(null);
                  })
                }
              >
                <Icon name="fileText" />
                <span>
                  {s.title}
                  <small>
                    {s.name} · {s.originLabel}
                  </small>
                </span>
              </button>
            ))}
        </div>
      )}
    </section>
  );
}
