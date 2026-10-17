import { useEffect, useRef, useState, type ReactNode } from "react";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { FittedSlideRenderer } from "../lib/presenter/renderSlide";
import { createThumbSession } from "../lib/presenter/thumbSession";
import { t } from "../i18n";
// Repaint PDF bitmaps after a mode switch, including Chromium canvas layers.
function usePdfThemeRevision() {
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    let dark = document.documentElement.classList.contains('dark');
    const observer = new MutationObserver(() => {
      const next = document.documentElement.classList.contains('dark');
      if (next !== dark) { dark = next; setRevision(n => n + 1); }
    });
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    return () => observer.disconnect();
  }, []);
  return revision;
}
export function SignThumbnails({
  doc,
  page,
  onPage,
}: {
  doc: PDFDocumentProxy;
  page: number;
  onPage: (n: number) => void;
}) {
  const root = useRef<HTMLDivElement>(null);
  const themeRevision = usePdfThemeRevision();
  useEffect(() => {
    if (!root.current) return;
    const session = createThumbSession({
      container: root.current,
      scrollRoot: root.current,
      doc,
      pageCount: doc.numPages,
      scale: 0.2,
      buildItem: (n) => {
        const element = document.createElement("button");
        element.type = "button";
        element.className = "sign-thumb";
        element.setAttribute("aria-label", `${t("Página")} ${n}`);
        element.dataset.signPage = String(n);
        element.onclick = () => onPage(n);
        const canvas = document.createElement("canvas");
        const label = document.createElement("span");
        label.textContent = String(n);
        element.append(canvas, label);
        return { element, canvas };
      },
    });
    return () => session.destroy();
  }, [doc, themeRevision]);
  useEffect(() => {
    root.current
      ?.querySelectorAll<HTMLElement>("[data-sign-page]")
      .forEach((el) =>
        el.setAttribute(
          "aria-current",
          String(Number(el.dataset.signPage) === page),
        ),
      );
  }, [page, doc, themeRevision]);
  return (
    <nav
      ref={root}
      aria-label={t("Páginas del documento")}
      className="sign-thumbs"
    />
  );
}
export function SignPdfPage({
  doc,
  page,
  zoom,
  children,
  onReady,
}: {
  doc: PDFDocumentProxy;
  page: number;
  zoom: number;
  children: ReactNode;
  onReady?: () => void;
}) {
  const host = useRef<HTMLDivElement>(null);
  const themeRevision = usePdfThemeRevision();
  const canvas = useRef<HTMLCanvasElement>(null);
  const [rendered, setRendered] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    if (!host.current || !canvas.current) return;
    let live = true;
    const renderer = new FittedSlideRenderer(canvas.current, host.current, 2);
    const render = async () => {
      setRendered(false);
      try {
        await renderer.render(doc, page, zoom);
        if (live) {
          setRendered(true);
          onReady?.();
        }
      } catch (e) {
        if (live) setError((e as Error).message);
      }
    };
    void render();
    const observer = new ResizeObserver(() => void render());
    observer.observe(host.current);
    return () => {
      live = false;
      observer.disconnect();
    };
  }, [doc, page, zoom, themeRevision]);
  return (
    <div className="sign-stage" ref={host} data-testid="sign-stage">
      <div
        className="sign-paper"
        style={{ visibility: rendered ? "visible" : "hidden" }}
      >
        <canvas ref={canvas} aria-label={`${t("Página")} ${page}`} />
        {children}
      </div>
      {!rendered && (
        <span role="status" className="sign-loading">
          {t("Cargando…")}
        </span>
      )}
      {error && <p role="alert">{error}</p>}
    </div>
  );
}
