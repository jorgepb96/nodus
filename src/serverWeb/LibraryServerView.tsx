import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from "react";
import { Icon } from "../components/ui";
import { MarkdownReader } from "./readers";
import { api, ApiError } from "./api";
import type { AIJob, Annotation, JsonRecord, LibraryDocument } from "./types";
import { errorText, getActiveLang, t, tx } from "./i18nShim";
import { serverLabel, serverPrompt } from "./serverAiPrompts";

type LibraryProps = { spaceId: string; onOpen: (id: string) => void };

const PAGE_SIZE = 50;
const annotationResource = "library";
type ReaderOpeningFormat = "clean" | "original";
const READER_OPENING_FORMAT_KEY = "nodus.libraryReader.openingFormat";

function isUnpublishedLibrary(error: unknown): boolean {
  return (
    error instanceof ApiError &&
    error.status === 409 &&
    error.code === "library_not_published"
  );
}

function readOpeningFormatPreference(): ReaderOpeningFormat | null {
  try {
    const value = localStorage.getItem(READER_OPENING_FORMAT_KEY);
    return value === "clean" || value === "original" ? value : null;
  } catch {
    return null;
  }
}

function writeOpeningFormatPreference(value: ReaderOpeningFormat | null): void {
  try {
    if (value) localStorage.setItem(READER_OPENING_FORMAT_KEY, value);
    else localStorage.removeItem(READER_OPENING_FORMAT_KEY);
  } catch {
    // A blocked localStorage must never prevent opening a published document.
  }
}

function display(value: unknown, fallback = "—"): string {
  if (value == null || value === "") return t(fallback);
  if (Array.isArray(value))
    return (
      value
        .map((entry) => display(entry, ""))
        .filter(Boolean)
        .join(", ") || fallback
    );
  if (typeof value === "object") return fallback;
  return String(value);
}

function titleFor(document: LibraryDocument): string {
  return (
    document.title || document.originalFileName || t("Documento sin título")
  );
}

function extractJobText(result: unknown): string {
  const root = result as JsonRecord | null;
  if (!root) return "";
  if (typeof root.text === "string") return root.text;
  if (typeof root.answer === "string") return root.answer;
  const output = Array.isArray(root.output)
    ? (root.output as JsonRecord[])
    : [];
  const openAi = output
    .flatMap((entry) =>
      Array.isArray(entry.content) ? (entry.content as JsonRecord[]) : [],
    )
    .map((entry) => display(entry.text, ""))
    .filter(Boolean)
    .join("\n");
  if (openAi) return openAi;
  const choices = Array.isArray(root.choices)
    ? (root.choices as JsonRecord[])
    : [];
  const choiceText = choices
    .map((entry) =>
      display(
        (entry.message as JsonRecord | undefined)?.content ?? entry.text,
        "",
      ),
    )
    .filter(Boolean)
    .join("\n");
  if (choiceText) return choiceText;
  const content = Array.isArray(root.content)
    ? (root.content as JsonRecord[])
    : [];
  return content
    .map((entry) => display(entry.text, ""))
    .filter(Boolean)
    .join("\n");
}

async function waitForJob(id: string, signal: AbortSignal): Promise<AIJob> {
  for (let attempt = 0; attempt < 180; attempt += 1) {
    if (signal.aborted) throw new DOMException("Cancelled", "AbortError");
    const response = await api.aiJob(id);
    if (["completed", "failed", "cancelled"].includes(response.job.status))
      return response.job;
    await new Promise((resolve) => window.setTimeout(resolve, 500));
  }
  throw new Error(
    t("El trabajo sigue activo; puedes consultarlo desde el historial privado."),
  );
}

function LibraryEmpty({
  title,
  detail,
  settingsLink = false,
}: {
  title: string;
  detail?: string;
  settingsLink?: boolean;
}) {
  return (
    <div className="server-unavailable" data-testid="library-empty">
      <div>
        <Icon name="inbox" size={32} className="mx-auto text-neutral-500" />
        <h2 className="mt-3 text-lg font-semibold">{title}</h2>
        {detail && (
          <p className="mt-2 max-w-md text-sm leading-6 text-neutral-500">
            {detail}
          </p>
        )}
        {settingsLink && (
          <a
            className="btn btn-primary mt-4"
            href="/view/settings?tab=server&focus=connected-vault"
          >
            {t("Abrir Ajustes de Server")}
          </a>
        )}
      </div>
    </div>
  );
}

function ReaderOpeningFormatDialog({
  document,
  remember,
  onRememberChange,
  onChoose,
  onCancel,
}: {
  document: LibraryDocument;
  remember: boolean;
  onRememberChange: (value: boolean) => void;
  onChoose: (value: ReaderOpeningFormat) => void;
  onCancel: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-[150] grid place-items-center bg-black/60 p-4"
      role="presentation"
      onMouseDown={onCancel}
    >
      <section
        className="w-full max-w-xl overflow-hidden rounded-2xl border border-neutral-200 bg-white text-neutral-900 shadow-2xl dark:border-neutral-700 dark:bg-neutral-950 dark:text-neutral-100"
        role="dialog"
        aria-modal="true"
        aria-labelledby="library-reader-format-title"
        onMouseDown={(event) => event.stopPropagation()}
        data-testid="library-reader-format-dialog"
      >
        <header className="border-b border-neutral-200 px-5 py-4 dark:border-neutral-800">
          <h2
            id="library-reader-format-title"
            className="text-base font-semibold"
          >
            {t("¿Cómo quieres leer este documento?")}
          </h2>
          <p className="mt-1 text-xs leading-5 text-neutral-500">
            {t("Puedes cambiar de versión desde el selector del lector.")}
          </p>
        </header>
        <div className="grid gap-3 p-5 sm:grid-cols-2">
          <button
            data-testid="library-reader-format-clean"
            className="min-h-32 rounded-xl border border-neutral-200 bg-neutral-50 p-4 text-left hover:border-indigo-400 dark:border-neutral-800 dark:bg-neutral-900"
            disabled={!document.cleanAvailable}
            onClick={() => onChoose("clean")}
          >
            <strong className="block text-sm">{t("Markdown")}</strong>
            <span className="mt-1 block text-xs leading-5 text-neutral-500">
              {t("Lectura adaptable con índice e imágenes extraídas.")}
            </span>
          </button>
          <button
            data-testid="library-reader-format-original"
            className="min-h-32 rounded-xl border border-neutral-200 bg-neutral-50 p-4 text-left hover:border-indigo-400 dark:border-neutral-800 dark:bg-neutral-900"
            disabled={!document.originalAvailable}
            onClick={() => onChoose("original")}
          >
            <strong className="block text-sm">{t("Archivo original")}</strong>
            <span className="mt-1 block text-xs leading-5 text-neutral-500">
              {t(
                "Abre directamente el archivo conservado y su diseño original.",
              )}
            </span>
            {document.originalFileName && (
              <span className="mt-2 block truncate text-[10px] text-neutral-400">
                {document.originalFileName}
              </span>
            )}
          </button>
        </div>
        <footer className="border-t border-neutral-200 px-5 py-4 dark:border-neutral-800">
          <label className="flex cursor-pointer items-start gap-2.5 text-xs text-neutral-700 dark:text-neutral-300">
            <input
              data-testid="library-reader-format-remember"
              className="mt-0.5"
              type="checkbox"
              checked={remember}
              onChange={(event) => onRememberChange(event.target.checked)}
            />
            <span>
              <b className="font-medium">{t("No volver a preguntar")}</b>
              <small className="mt-0.5 block text-[10px] text-neutral-500">
                {t("La próxima vez se abrirá el formato elegido.")}
              </small>
            </span>
          </label>
        </footer>
      </section>
    </div>
  );
}

function ReaderFilesMenu({
  document,
  source,
  onSelect,
  onResetPreference,
}: {
  document: LibraryDocument;
  source: ReaderOpeningFormat;
  onSelect: (value: ReaderOpeningFormat) => void;
  onResetPreference: () => void;
}) {
  const [open, setOpen] = useState(false);
  const choose = (value: ReaderOpeningFormat) => {
    onSelect(value);
    setOpen(false);
  };
  return (
    <div className="mt-4 border-t border-neutral-800 pt-3">
      <button
        type="button"
        data-testid="library-reader-files-toggle"
        className="flex w-full items-center gap-2 rounded-xl border border-neutral-800 bg-neutral-950/35 px-2.5 py-2 text-left hover:border-neutral-700"
        aria-expanded={open}
        aria-controls="library-reader-files"
        onClick={() => setOpen((value) => !value)}
      >
        <Icon name="folder" size={13} className="text-neutral-400" />
        <span className="min-w-0 flex-1">
          <b className="block text-[11px] font-medium text-neutral-300">
            {t("Versiones y archivos")}
          </b>
          <small className="block truncate text-[9px] text-neutral-600">
            {document.originalFileName || t("Documento")} ·{" "}
            {Number(document.cleanAvailable) +
              Number(document.originalAvailable)}{" "}
            {t("disponibles")}
          </small>
        </span>
        <Icon
          name={open ? "chevronUp" : "chevronDown"}
          size={12}
          className="text-neutral-600"
        />
      </button>
      {open && (
        <div
          id="library-reader-files"
          data-testid="library-reader-files"
          className="mt-2 space-y-0.5"
        >
          <button
            type="button"
            data-testid="library-reader-file-clean"
            className={`flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-xs ${source === "clean" ? "bg-indigo-500/10 text-indigo-300" : "text-neutral-400"}`}
            disabled={!document.cleanAvailable}
            onClick={() => choose("clean")}
          >
            <Icon name="book" size={12} />
            <span className="truncate">{t("Markdown")}</span>
          </button>
          <button
            type="button"
            data-testid="library-reader-file-original"
            className={`flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-xs ${source === "original" ? "bg-indigo-500/10 text-indigo-300" : "text-neutral-400"}`}
            disabled={!document.originalAvailable}
            onClick={() => choose("original")}
          >
            <Icon name="file" size={12} />
            <span className="min-w-0 flex-1 truncate">
              {document.originalFileName || t("Archivo original")}
            </span>
            <span className="text-[9px] uppercase text-neutral-600">
              {document.originalMimeType || t("archivo")}
            </span>
          </button>
          {readOpeningFormatPreference() && (
            <button
              type="button"
              data-testid="library-reader-reset-format-preference"
              className="mt-1 flex w-full items-center gap-2 border-t border-neutral-800 px-2 py-2.5 text-left text-[10px] text-neutral-500 hover:text-indigo-300"
              onClick={() => {
                onResetPreference();
                setOpen(false);
              }}
            >
              <Icon name="refresh" size={11} /> {t("Preguntar de nuevo al abrir")}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/** Published catalogue: table, collection facets, server-side paging and a
 * reloadable route. The package contains only explicitly published documents. */
export function PublishedLibraryView({ spaceId, onOpen }: LibraryProps) {
  const [items, setItems] = useState<LibraryDocument[]>([]);
  const [collections, setCollections] = useState<JsonRecord[]>([]);
  const [query, setQuery] = useState("");
  const [collectionId, setCollectionId] = useState("");
  const [offset, setOffset] = useState(0);
  const [total, setTotal] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [published, setPublished] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>();
  const loadCollections = useCallback(async () => {
    try {
      setCollections((await api.libraryCollections(spaceId)).collections || []);
    } catch (cause) {
      // Collections are an optional facet. Older Server releases answer 409
      // before the first library publication; keep the document table usable
      // and render that state as an empty catalogue instead of a fatal error.
      setCollections([]);
      if (!isUnpublishedLibrary(cause)) {
        console.warn("[nodus-server] library collections unavailable", cause);
      }
    }
  }, [spaceId]);
  const load = useCallback(async () => {
    setLoading(true);
    setError(undefined);
    try {
      const page = await api.library(spaceId, {
        q: query.trim(),
        collectionId,
        limit: String(PAGE_SIZE),
        offset: String(offset),
      });
      setItems(page.items || []);
      setTotal(page.total || 0);
      setHasMore(Boolean(page.hasMore));
      setPublished(page.published !== false);
    } catch (cause) {
      if (isUnpublishedLibrary(cause)) {
        setItems([]);
        setTotal(0);
        setHasMore(false);
        setPublished(false);
      } else {
        setError(cause);
      }
    } finally {
      setLoading(false);
    }
  }, [collectionId, offset, query, spaceId]);
  useEffect(() => {
    void loadCollections();
  }, [loadCollections]);
  useEffect(() => {
    void load();
  }, [load]);
  const pageStart = total === 0 ? 0 : offset + 1;
  const pageEnd = Math.min(offset + items.length, total);
  return (
    <div
      className="flex h-full min-h-0 flex-col bg-white text-neutral-900 dark:bg-neutral-950 dark:text-neutral-100"
      data-testid="library-view"
    >
      <header className="shrink-0 border-b border-neutral-200 px-5 pt-4 dark:border-neutral-800">
        <div className="mb-3 flex items-center gap-3">
          <span className="grid h-9 w-9 place-items-center rounded-xl bg-indigo-100 text-indigo-600 dark:bg-indigo-500/15 dark:text-indigo-300">
            <Icon name="book" size={18} />
          </span>
          <div>
            <h1 className="text-base font-semibold">{t("Biblioteca")}</h1>
            <p className="text-[11px] text-neutral-500">
              {total} {t("documentos publicados")}
            </p>
          </div>
          <button
            className="btn btn-ghost ml-auto h-8 gap-1.5 text-xs"
            onClick={() => void load()}
            disabled={loading}
            data-testid="library-refresh"
          >
            <Icon
              name="sync"
              size={13}
              className={loading ? "animate-spin" : ""}
            />
            {t("Actualizar")}
          </button>
        </div>
        <div
          className="flex h-9 w-fit items-center gap-2 rounded-t-lg border border-b-0 border-neutral-300 bg-white px-3 text-xs dark:border-neutral-700 dark:bg-neutral-900"
          data-testid="library-tabs"
        >
          <Icon name="table" size={13} /> {t("Biblioteca")}
        </div>
      </header>
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-neutral-200 p-3 dark:border-neutral-800">
        <div className="relative min-w-[16rem] flex-1">
          <Icon
            name="search"
            size={15}
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-neutral-500"
          />
          <input
            className="input input-with-leading-icon w-full"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setOffset(0);
            }}
            placeholder={t("Buscar título, autor, etiqueta…")}
            data-testid="library-search"
          />
        </div>
        <select
          className="input text-xs"
          value={collectionId}
          onChange={(event) => {
            setCollectionId(event.target.value);
            setOffset(0);
          }}
          data-testid="library-collection-filter"
        >
          <option value="">{t("Todas las colecciones")}</option>
          {collections.map((collection) => (
            <option key={String(collection.id)} value={String(collection.id)}>
              {display(collection.name || collection.title || collection.id)}
            </option>
          ))}
        </select>
      </div>
      <div className="min-h-0 flex-1 overflow-auto" data-testid="library-list">
        <div className="min-w-[980px]">
          <div
            className="grid h-10 items-center border-b border-neutral-200 px-4 text-[10px] font-semibold uppercase tracking-wider text-neutral-500 dark:border-neutral-800 dark:text-neutral-600"
            style={{
              gridTemplateColumns:
                "minmax(320px,1.7fr) minmax(220px,1.2fr) 7rem 8rem 8rem 5.5rem",
            }}
          >
            <span>{t("Título")}</span>
            <span>{t("Autoría")}</span>
            <span>{t("Año")}</span>
            <span>{t("Tipo")}</span>
            <span>{t("Lectura")}</span>
            <span />
          </div>
          {error ? (
            <div className="p-4">
              <p className="text-sm text-red-400">
                {t("No se ha podido cargar la biblioteca.")}
              </p>
              <button
                className="btn btn-ghost mt-2"
                onClick={() => void load()}
              >
                {t("Reintentar")}
              </button>
            </div>
          ) : loading ? (
            <div className="p-6">
              <span className="text-sm text-neutral-500">{t("Cargando…")}</span>
            </div>
          ) : items.length === 0 ? (
            <LibraryEmpty
              title={
                total
                  ? t("No hay coincidencias")
                  : published === false
                    ? t("La biblioteca aún no se ha publicado")
                    : t("La biblioteca está vacía")
              }
              detail={
                published === false
                  ? t(
                      "Activa Biblioteca en Ajustes → Server y vuelve a publicar desde Desktop.",
                    )
                  : undefined
              }
              settingsLink={published === false}
            />
          ) : (
            items.map((item) => {
              const raw = item as JsonRecord;
              const href = `/library/${encodeURIComponent(item.id)}`;
              return (
                <div
                  key={item.id}
                  className="grid min-h-[68px] w-full items-center border-b border-neutral-100 px-4 py-2.5 text-left text-xs hover:bg-neutral-50 dark:border-neutral-900 dark:hover:bg-neutral-900/55"
                  style={{
                    gridTemplateColumns:
                      "minmax(320px,1.7fr) minmax(220px,1.2fr) 7rem 8rem 8rem 5.5rem",
                  }}
                  data-testid="library-document-row"
                >
                  <button
                    className="min-w-0 pr-4 text-left"
                    onClick={() => onOpen(item.id)}
                  >
                    <strong className="block truncate font-medium text-neutral-900 dark:text-neutral-200">
                      {titleFor(item)}
                    </strong>
                    <small className="mt-1 block truncate text-[11px] font-normal text-neutral-500">
                      {item.abstract ||
                        item.originalFileName ||
                        item.tags?.join(" · ") ||
                        t("Documento publicado")}
                    </small>
                  </button>
                  <span className="truncate pr-4 text-neutral-500">
                    {item.creators?.join(", ") || "—"}
                  </span>
                  <span className="text-neutral-500">
                    {display(raw.year || raw.date)}
                  </span>
                  <span className="text-neutral-500">
                    {display(
                      raw.itemType || raw.item_type || item.originalMimeType,
                    )}
                  </span>
                  <span className="text-neutral-500">
                    {item.cleanAvailable
                      ? t("Markdown")
                      : item.originalAvailable
                        ? t("Original")
                        : t("Metadatos")}
                  </span>
                  <a
                    className="btn btn-ghost h-7 justify-self-end px-2 text-[10px]"
                    href={href}
                    target="_blank"
                    rel="noreferrer"
                    aria-label={tx("Abrir {title} en otra pestaña", {
                      title: titleFor(item),
                    })}
                  >
                    <Icon name="external" size={12} />
                    {t("Abrir")}
                  </a>
                </div>
              );
            })
          )}
        </div>
      </div>
      <footer className="flex h-11 shrink-0 items-center justify-between border-t border-neutral-200 px-3 text-xs text-neutral-500 dark:border-neutral-800">
        <span>
          {pageStart}–{pageEnd} / {total}
        </span>
        <div className="flex gap-1">
          <button
            className="btn btn-ghost h-7 px-2 text-xs"
            onClick={() => setOffset((value) => Math.max(0, value - PAGE_SIZE))}
            disabled={offset === 0 || loading}
            aria-label={t("Página anterior")}
          >
            <Icon name="chevronLeft" size={13} />
            {t("Anterior")}
          </button>
          <button
            className="btn btn-ghost h-7 px-2 text-xs"
            onClick={() => setOffset((value) => value + PAGE_SIZE)}
            disabled={!hasMore || loading}
            aria-label={t("Página siguiente")}
          >
            {t("Siguiente")}
            <Icon name="chevronRight" size={13} />
          </button>
        </div>
      </footer>
    </div>
  );
}

function ReaderNotes({
  spaceId,
  id,
  notes,
  selectedQuote,
  onRefresh,
  onClose,
  csrfToken,
}: {
  spaceId: string;
  id: string;
  notes: Annotation[];
  selectedQuote: string;
  onRefresh: () => Promise<void>;
  onClose: () => void;
  csrfToken?: string;
}) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [saving, setSaving] = useState(false);
  const visibleNotes = notes.filter(
    (note) => !(note.kind === "note" && note.title === "Estado de lectura"),
  );
  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (!content.trim() && !selectedQuote) return;
    setSaving(true);
    try {
      const now = new Date().toISOString();
      await api.addAnnotation(
        spaceId,
        {
          id: crypto.randomUUID(),
          resource: annotationResource,
          documentId: id,
          kind: selectedQuote ? "highlight" : "comment",
          title:
            title.trim() ||
            (selectedQuote ? t("Subrayado") : t("Anotación")),
          content: content.trim(),
          quote: selectedQuote,
          createdAt: now,
          updatedAt: now,
          deletedAt: null,
        },
        csrfToken,
      );
      setTitle("");
      setContent("");
      setOpen(false);
      await onRefresh();
    } finally {
      setSaving(false);
    }
  };
  const remove = async (note: Annotation) => {
    await api.addAnnotation(
      spaceId,
      {
        ...note,
        id: note.id,
        resource: annotationResource,
        documentId: id,
        op: "delete",
      },
      csrfToken,
    );
    await onRefresh();
  };
  return (
    <aside
      className="library-reader-notes flex min-h-0 w-[21rem] shrink-0 flex-col overflow-hidden border-l border-neutral-800 bg-neutral-950/25"
      data-testid="library-reader-sidebar"
    >
      <div className="flex items-center justify-between border-b border-neutral-800 px-3 py-2">
        <h2 className="text-xs font-semibold text-neutral-200">{t("Documento")}</h2>
        <div className="flex items-center gap-1">
          <button
            className="btn btn-ghost h-7 px-2 text-[10px]"
            onClick={() => setOpen((value) => !value)}
            data-testid="library-reader-add-note"
          >
            {open ? t("Cerrar") : t("Añadir nota")}
          </button>
          <button
            type="button"
            className="btn btn-ghost h-7 w-7 p-0 text-[10px]"
            onClick={onClose}
            aria-label={t("Cerrar panel")}
            title={t("Cerrar panel")}
          >
            ×
          </button>
        </div>
      </div>
      {open && (
        <form
          className="grid gap-2 border-b border-neutral-800 p-3"
          onSubmit={(event) => void save(event)}
        >
          {selectedQuote && (
            <blockquote className="server-saved-highlight text-xs">
              {selectedQuote}
            </blockquote>
          )}
          <input
            className="input text-xs"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder={t("Título")}
          />
          <textarea
            className="input min-h-20 text-xs"
            value={content}
            onChange={(event) => setContent(event.target.value)}
            placeholder={
              selectedQuote
                ? `${t("Comentario sobre la selección")}…`
                : `${t("Comentario")}…`
            }
          />
          <button
            className="btn btn-primary justify-self-start text-xs"
            disabled={saving}
          >
            {saving ? t("Guardando…") : t("Guardar anotación")}
          </button>
        </form>
      )}
      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-3">
        {visibleNotes.length === 0 ? (
          <div className="rounded-xl border border-dashed border-neutral-800 px-4 py-8 text-center text-xs leading-5 text-neutral-600">
            {t("Selecciona texto para subrayarlo, anotarlo o preguntarle a Nodi.")}
          </div>
        ) : (
          visibleNotes.map((note) => (
            <article
              key={note.id}
              className="group rounded-xl border border-neutral-800 bg-neutral-950/35 p-3"
            >
              <div className="flex items-start justify-between gap-2">
                <strong className="text-xs text-neutral-300">
                  {note.title || (note.quote ? t("Subrayado") : t("Anotación"))}
                </strong>
                <button
                  className="rounded p-1 text-neutral-600 hover:text-red-400"
                  aria-label={t("Eliminar anotación")}
                  onClick={() => void remove(note)}
                >
                  <Icon name="trash" size={12} />
                </button>
              </div>
              {note.quote && (
                <blockquote className="server-saved-highlight mt-2 text-xs">
                  {note.quote}
                </blockquote>
              )}
              {note.content && (
                <MarkdownReader
                  value={note.content}
                  className="mt-2 text-xs text-neutral-500"
                />
              )}
            </article>
          ))
        )}
      </div>
    </aside>
  );
}

export function LibraryDetail({
  spaceId,
  id,
  csrfToken,
  onBack,
}: {
  spaceId: string;
  id: string;
  csrfToken?: string;
  onBack: () => void;
}) {
  const [document, setDocument] = useState<LibraryDocument>();
  const [readable, setReadable] = useState("");
  const [notes, setNotes] = useState<Annotation[]>([]);
  const [annotationVersion, setAnnotationVersion] = useState(0);
  const [selectedQuote, setSelectedQuote] = useState("");
  const [error, setError] = useState<unknown>();
  const [source, setSource] = useState<"clean" | "original">("clean");
  const [openingFormatPrompt, setOpeningFormatPrompt] = useState(false);
  const [rememberOpeningFormat, setRememberOpeningFormat] = useState(false);
  const [sidebarTab, setSidebarTab] = useState<
    "notes" | "metadata" | "chat" | null
  >("notes");
  const [progress, setProgress] = useState(0);
  const [chat, setChat] = useState<
    Array<{ role: "user" | "assistant"; content: string }>
  >([]);
  const [chatInput, setChatInput] = useState("");
  const [chatBusy, setChatBusy] = useState(false);
  const [chatError, setChatError] = useState("");
  const [chatJobId, setChatJobId] = useState<string | null>(null);
  const [isRead, setIsRead] = useState(false);
  const scrollRef = useRef<HTMLElement | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const refreshNotes = useCallback(async () => {
    const result = await api.annotations(spaceId, annotationResource, id);
    const nextNotes = result.annotations.filter((note) => !note.deletedAt);
    setAnnotationVersion(result.version);
    setNotes(nextNotes);
    const state = nextNotes
      .filter(
        (note) => note.kind === "note" && note.title === "Estado de lectura",
      )
      .sort((a, b) =>
        String(a.updatedAt || "").localeCompare(String(b.updatedAt || "")),
      )
      .at(-1);
    if (state) setIsRead(state.content === "read");
  }, [id, spaceId]);
  const loadReadable = useCallback(async () => {
    if (!document?.cleanAvailable) return;
    setReadable("");
    try {
      setReadable(await api.libraryContent(spaceId, id));
    } catch (cause) {
      setError(cause);
    }
  }, [document?.cleanAvailable, id, spaceId]);
  useEffect(() => {
    let alive = true;
    setDocument(undefined);
    setReadable("");
    setError(undefined);
    setOpeningFormatPrompt(false);
    const preference = readOpeningFormatPreference();
    Promise.all([
      api.libraryDocument(spaceId, id),
      api.annotations(spaceId, annotationResource, id),
    ])
      .then(async ([response, annotationResponse]) => {
        if (!alive || !response.document) return;
        const nextDocument = response.document;
        setDocument(nextDocument);
        const nextNotes = annotationResponse.annotations.filter(
          (note) => !note.deletedAt,
        );
        setAnnotationVersion(annotationResponse.version);
        setNotes(nextNotes);
        const state = nextNotes
          .filter(
            (note) =>
              note.kind === "note" && note.title === "Estado de lectura",
          )
          .sort((a, b) =>
            String(a.updatedAt || "").localeCompare(String(b.updatedAt || "")),
          )
          .at(-1);
        setIsRead(
          state
            ? state.content === "read"
            : localStorage.getItem(`nodus.server.library.read.${id}`) === "1",
        );
        const hasClean = Boolean(nextDocument.cleanAvailable);
        const hasOriginal = Boolean(nextDocument.originalAvailable);
        const preferred =
          preference === "original" && hasOriginal
            ? "original"
            : preference === "clean" && hasClean
              ? "clean"
              : hasOriginal
                ? "original"
                : "clean";
        setSource(preferred);
        // The catalogue row must open without an interstitial: Desktop opens the
        // preserved original immediately when one is available, while the clean
        // copy remains a reader option. Server cannot run Desktop's foreground
        // extraction queue, so a remembered clean preference is still honored;
        // otherwise the original iframe is the first rendered source.
        // Never leave a blocking format prompt over the reader on a deep link.
        setOpeningFormatPrompt(false);
        if (preferred === "clean" && hasClean)
          setReadable(await api.libraryContent(spaceId, id));
      })
      .catch((cause) => {
        if (alive) setError(cause);
      });
    return () => {
      alive = false;
      abortRef.current?.abort();
    };
  }, [id, spaceId]);
  useEffect(() => {
    const key = `nodus.server.library.progress.${id}`;
    const saved = Number(localStorage.getItem(key) || 0);
    const scroll = scrollRef.current;
    if (scroll) scroll.scrollTop = Number.isFinite(saved) ? saved : 0;
  }, [id, readable, source]);
  const chooseSource = (next: ReaderOpeningFormat) => {
    setSource(next);
    if (next === "clean") void loadReadable();
  };
  const chooseOpeningFormat = (next: ReaderOpeningFormat) => {
    if (rememberOpeningFormat) writeOpeningFormatPreference(next);
    chooseSource(next);
    setOpeningFormatPrompt(false);
  };
  const resetOpeningFormatPreference = () => {
    writeOpeningFormatPreference(null);
    setRememberOpeningFormat(false);
  };
  const headings = useMemo(
    () =>
      readable
        .split("\n")
        .map((line) => /^(#{1,4})\s+(.+)$/.exec(line))
        .filter(Boolean)
        .map((match) => ({
          level: match![1].length,
          title: match![2].replace(/[*_`]/g, ""),
        })),
    [readable],
  );
  const scrollToHeading = (heading: string) => {
    const root = scrollRef.current;
    const match = Array.from(
      root?.querySelectorAll<HTMLElement>("h1,h2,h3,h4") || [],
    ).find((node) => node.textContent?.trim() === heading.trim());
    match?.scrollIntoView({ behavior: "smooth", block: "start" });
  };
  const onScroll = () => {
    const scroll = scrollRef.current;
    if (!scroll) return;
    const max = Math.max(1, scroll.scrollHeight - scroll.clientHeight);
    setProgress(Math.round((scroll.scrollTop / max) * 100));
    localStorage.setItem(
      `nodus.server.library.progress.${id}`,
      String(Math.round(scroll.scrollTop)),
    );
  };
  const toggleRead = () => {
    const next = !isRead;
    setIsRead(next);
    localStorage.setItem(`nodus.server.library.read.${id}`, next ? "1" : "0");
    const now = new Date().toISOString();
    void api
      .addAnnotation(
        spaceId,
        {
          id: `reading-state-${id}`,
          resource: annotationResource,
          documentId: id,
          kind: "note",
          title: "Estado de lectura",
          content: next ? "read" : "unread",
          quote: "",
          baseVersion: annotationVersion,
          createdAt: now,
          updatedAt: now,
          deletedAt: null,
        },
        csrfToken,
      )
      .then((result) => {
        setAnnotationVersion(result.version);
        setNotes(result.annotations.filter((note) => !note.deletedAt));
      })
      .catch(() => {
        // A second tab/device may have advanced the private overlay. Re-read it
        // so an optimistic click cannot leave this reader showing stale state.
        void refreshNotes().catch(() => undefined);
      });
  };
  const markBookmark = async () => {
    const quote = selectedQuote || headings[0]?.title || titleFor(document!);
    const now = new Date().toISOString();
    await api.addAnnotation(
      spaceId,
      {
        id: crypto.randomUUID(),
        resource: annotationResource,
        documentId: id,
        kind: "bookmark",
        title: "Marcador de lectura",
        content: "",
        quote,
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
      },
      csrfToken,
    );
    await refreshNotes();
  };
  const hasBookmark = notes.some(
    (note) => note.kind === "bookmark" && !note.deletedAt,
  );
  const sendChat = async (event: FormEvent) => {
    event.preventDefault();
    const question = chatInput.trim();
    if (!question || chatBusy || !readable) return;
    const user = { role: "user" as const, content: question };
    const messages = [...chat, user];
    setChat(messages);
    setChatInput("");
    setChatBusy(true);
    setChatError("");
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const [preferences, profileResponse] = await Promise.all([
        api.aiPreferences(),
        api.profilePreferences(),
      ]);
      const promptLanguage =
        profileResponse.profile.values?.appearance?.promptLanguage ||
        profileResponse.profile.values?.appearance?.uiLanguage ||
        "en";
      const provider = preferences.preferences.defaultProvider;
      const model = provider
        ? preferences.preferences.chatModels?.[provider]
        : undefined;
      const response = await api.runAI(
        spaceId,
        "content-query",
        {
          provider,
          model,
          messages: [
            {
              role: "system",
              content: `${serverPrompt(promptLanguage, "contentQuery")}\n\n${serverLabel(promptLanguage, "title")}: ${titleFor(document!)}\n\n${serverLabel(promptLanguage, "context")}:\n${readable.slice(0, 120_000)}`,
            },
            ...messages,
          ],
          maxTokens: 2500,
        },
        csrfToken,
      );
      setChatJobId(response.job.id);
      const job = await waitForJob(response.job.id, controller.signal);
      if (job.status !== "completed")
        throw new Error(
          job.error?.message || t("No se pudo generar la respuesta."),
        );
      setChat((current) => [
        ...current,
        { role: "assistant", content: extractJobText(job.result) },
      ]);
    } catch (cause) {
      if (!(cause instanceof DOMException && cause.name === "AbortError"))
        setChatError(errorText(cause));
    } finally {
      setChatBusy(false);
      setChatJobId(null);
      abortRef.current = null;
    }
  };
  if (error)
    return (
      <div className="h-full p-6">
        <p className="text-sm text-red-400">
          {t("No se ha podido cargar este documento.")}
        </p>
        <button className="btn btn-ghost mt-3" onClick={onBack}>
          {t("Volver")}
        </button>
      </div>
    );
  if (!document)
    return (
      <div className="grid h-full place-items-center text-sm text-neutral-500">
        {t("Cargando lector…")}
      </div>
    );
  const originalUrl = document.originalAvailable
    ? api.libraryOriginalUrl(spaceId, id)
    : undefined;
  return (
    <div
      className="library-document-reader relative flex h-full min-h-0 flex-col overflow-hidden"
      data-testid="library-reader"
    >
      <header className="relative z-40 flex shrink-0 flex-wrap items-center gap-2 border-b border-neutral-800 bg-neutral-950/60 px-4 py-2.5 backdrop-blur">
        <button
          className="btn btn-ghost gap-1.5"
          onClick={onBack}
          data-testid="library-reader-back"
        >
          <Icon name="chevronLeft" />
          {t("Biblioteca")}
        </button>
        <button
          className="btn btn-ghost h-9 w-9 p-0"
          data-testid="library-reader-outline-toggle"
          onClick={() =>
            globalThis.document
              .getElementById("library-reader-outline")
              ?.classList.toggle("hidden")
          }
          aria-label={t("Índice")}
        >
          <Icon name="list" />
        </button>
        <div className="min-w-0 flex-[1_1_12rem]">
          <h1 className="truncate text-sm font-semibold text-neutral-100">
            {titleFor(document)}
          </h1>
          <p className="truncate text-[11px] text-neutral-500">
            {document.creators?.join(", ") || t("Documento publicado")} ·{" "}
            {progress}% {t("Leído").toLocaleLowerCase(getActiveLang())}
          </p>
        </div>
        <select
          className="input h-9 max-w-64 text-xs"
          value={source}
          onChange={(event) =>
            chooseSource(event.target.value as ReaderOpeningFormat)
          }
          aria-label={t("Versión o archivo")}
          data-testid="library-reader-source-picker"
        >
          <option value="clean" disabled={!document.cleanAvailable}>
            {t("Markdown")}
          </option>
          <option value="original" disabled={!document.originalAvailable}>
            {t("Archivo original")}
          </option>
        </select>
        <button
          className={`btn btn-ghost h-9 px-2 text-xs ${isRead ? "text-emerald-300" : ""}`}
          onClick={toggleRead}
          data-testid="library-reader-read-state"
          aria-pressed={isRead}
          title={isRead ? t("Marcar como no leído") : t("Marcar como leído")}
        >
          <Icon name={isRead ? "check" : "book"} size={13} />
          {isRead ? t("Leído") : t("No leído")}
        </button>
        {source === "clean" && (
          <button
            className="btn btn-ghost h-9 w-9 p-0"
            onClick={() => void markBookmark()}
            data-testid="library-reader-bookmark"
            aria-label={t("Marcar esta sección")}
            title={t("Marcar esta sección")}
          >
            <Icon name={hasBookmark ? "bookmarkFill" : "bookmark"} size={14} />
          </button>
        )}
        <button
          className={`btn btn-ghost h-9 px-2 text-xs ${sidebarTab === "notes" ? "text-indigo-300" : ""}`}
          onClick={() =>
            setSidebarTab((value) => (value === "notes" ? null : "notes"))
          }
          data-testid="library-reader-notes"
        >
          <Icon name="notebook" size={13} />
          {t("Notas")}
        </button>
        <button
          className="btn btn-ghost h-9 px-2 text-xs"
          onClick={() =>
            setSidebarTab((value) => (value === "metadata" ? null : "metadata"))
          }
          data-testid="library-reader-info"
        >
          <Icon name="info" size={13} />
          {t("Info")}
        </button>
        <button
          className="btn btn-primary h-9 px-2 text-xs"
          onClick={() =>
            setSidebarTab((value) => (value === "chat" ? null : "chat"))
          }
          data-testid="library-reader-open-chat"
        >
          <Icon name="chat" size={13} />
          {t("Chat")}
        </button>
        {originalUrl && (
          <a
            className="btn btn-ghost h-9 px-2 text-xs"
            href={originalUrl}
            target="_blank"
            rel="noreferrer"
            data-testid="library-reader-original"
          >
            <Icon name="external" size={13} />
            {t("Original")}
          </a>
        )}
        <a
          className="btn btn-ghost h-9 px-2 text-xs"
          href={api.libraryDownloadUrl(spaceId, id)}
          download
          data-testid="library-reader-download"
        >
          <Icon name="download" size={13} />
          {t("Descargar")}
        </a>
        <button
          className="btn btn-ghost h-9 w-9 p-0"
          onClick={() => window.print()}
          aria-label={t("Imprimir")}
          title={t("Imprimir")}
        >
          <Icon name="external" size={14} />
        </button>
        <div className="absolute inset-x-0 bottom-0 h-px bg-neutral-800">
          <div
            className="h-full bg-indigo-500 transition-[width]"
            style={{ width: `${progress}%` }}
          />
        </div>
      </header>
      <div className="relative flex min-h-0 flex-1 overflow-hidden">
        <aside
          id="library-reader-outline"
          className="library-reader-outline w-64 shrink-0 overflow-y-auto border-r border-neutral-800 bg-neutral-950/25 px-3 py-4"
        >
          <div className="mb-3 flex items-center justify-between px-2">
            <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-neutral-500">
              {t("En este documento")}
            </span>
            <span className="text-[10px] text-neutral-600">{progress}%</span>
          </div>
          <nav className="space-y-0.5">
            {headings.length ? (
              headings.map((heading, index) => (
                <button
                  key={`${heading.title}-${index}`}
                  className="library-reader-outline-section block w-full rounded-lg px-2 py-2 text-left text-xs text-neutral-400 hover:bg-neutral-900 hover:text-neutral-100"
                  style={{ paddingLeft: `${8 + (heading.level - 1) * 10}px` }}
                  onClick={() => scrollToHeading(heading.title)}
                >
                  {heading.title}
                </button>
              ))
            ) : (
              <p className="px-2 py-3 text-[10px] text-neutral-600">
                {t("Añade títulos para crear un índice navegable.")}
              </p>
            )}
            <div className="mt-4 border-t border-neutral-800 pt-3">
              <span className="text-[10px] uppercase tracking-wider text-neutral-600">
                {t("Versión")}
              </span>
              <p className="mt-1 text-xs text-neutral-400">
                {source === "clean"
                  ? t("Markdown")
                  : document.originalFileName || t("Archivo original")}
              </p>
            </div>
            <ReaderFilesMenu
              document={document}
              source={source}
              onSelect={chooseSource}
              onResetPreference={resetOpeningFormatPreference}
            />
          </nav>
        </aside>
        {source === "clean" ? (
          <main
            ref={scrollRef}
            onScroll={onScroll}
            className="library-reader-clean-surface min-w-0 flex-1 overflow-y-auto px-5 py-8 max-md:px-3"
          >
            <article className="library-reader-paper mx-auto max-w-[52rem] rounded-2xl border border-neutral-800/80 px-12 py-12 shadow-[0_24px_70px_-40px_rgba(0,0,0,.75)] max-md:rounded-none max-md:border-x-0 max-md:px-5">
              <div
                className="library-reader-document relative"
                data-testid="library-reader-document"
                onMouseUp={() => {
                  const value = window.getSelection()?.toString().trim();
                  if (value) setSelectedQuote(value.slice(0, 4000));
                }}
              >
                <MarkdownReader
                  value={readable || document.abstract || ""}
                  assetBaseUrl={api.libraryAssetBaseUrl(spaceId, id)}
                />
              </div>
            </article>
          </main>
        ) : (
          <main
            ref={scrollRef}
            onScroll={onScroll}
            className="min-w-0 flex-1 overflow-y-auto bg-neutral-100 dark:bg-neutral-900"
          >
            <iframe
              className="server-document-frame"
              title={t("Archivo original")}
              src={originalUrl}
              sandbox="allow-same-origin"
              data-testid="library-reader-original-frame"
            />
          </main>
        )}
        {sidebarTab === "notes" && (
          <ReaderNotes
            spaceId={spaceId}
            id={id}
            notes={notes}
            selectedQuote={selectedQuote}
            onRefresh={refreshNotes}
            onClose={() => setSidebarTab(null)}
            csrfToken={csrfToken}
          />
        )}
        {sidebarTab === "metadata" && (
          <aside
            className="library-reader-notes w-[21rem] shrink-0 overflow-y-auto border-l border-neutral-800 bg-neutral-950/25 p-4"
            data-testid="library-reader-metadata"
          >
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-sm font-semibold">{t("Información")}</h2>
              <button
                type="button"
                className="btn btn-ghost h-7 w-7 p-0 text-[10px]"
                onClick={() => setSidebarTab(null)}
                aria-label={t("Cerrar panel")}
                title={t("Cerrar panel")}
              >
                ×
              </button>
            </div>
            <dl className="mt-4 space-y-3 text-xs">
              {[
                ["Título", titleFor(document)],
                ["Autoría", document.creators?.join("; ")],
                ["Archivo", document.originalFileName],
                ["Tipo", document.originalMimeType],
                ["Etiquetas", document.tags?.join(", ")],
                ["Identificador", document.id],
              ].map(([label, value]) => (
                <div key={label}>
                  <dt className="text-[10px] uppercase tracking-wider text-neutral-600">
                    {t(String(label))}
                  </dt>
                  <dd className="mt-1 break-words text-neutral-300">
                    {display(value)}
                  </dd>
                </div>
              ))}
            </dl>
          </aside>
        )}
        {sidebarTab === "chat" && (
          <aside
            className="library-reader-notes flex w-[21rem] shrink-0 flex-col border-l border-neutral-800 bg-neutral-950/25"
            data-testid="library-reader-chat"
          >
            <div className="border-b border-neutral-800 px-3 py-3">
              <div className="flex items-center justify-between gap-2">
                <h2 className="text-sm font-semibold">
                  {t("Chat del documento")}
                </h2>
                <button
                  type="button"
                  className="btn btn-ghost h-7 w-7 p-0 text-[10px]"
                  onClick={() => setSidebarTab(null)}
                  aria-label={t("Cerrar panel")}
                  title={t("Cerrar panel")}
                >
                  ×
                </button>
              </div>
              <p className="mt-1 text-[10px] text-neutral-600">
                {t("La consulta y sus respuestas son privadas.")}
              </p>
            </div>
            <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-3">
              {chat.length === 0 && (
                <p className="rounded-xl border border-dashed border-neutral-800 p-4 text-center text-xs text-neutral-600">
                  {t("Pregunta por la tesis, un concepto o la relación entre tus subrayados.")}
                </p>
              )}
              {chat.map((message, index) => (
                <article
                  key={`${message.role}-${index}`}
                  className={`rounded-xl px-3 py-2 text-xs leading-5 ${message.role === "user" ? "bg-indigo-600/20 text-indigo-100" : "border border-neutral-800 text-neutral-300"}`}
                >
                  {message.role === "assistant" ? (
                    <MarkdownReader value={message.content} />
                  ) : (
                    message.content
                  )}
                </article>
              ))}
              {chatError && (
                <p className="text-[10px] text-red-400">{chatError}</p>
              )}
            </div>
            <form
              className="m-3 rounded-xl border border-neutral-800 p-2"
              onSubmit={(event) => void sendChat(event)}
            >
              <textarea
                className="block w-full resize-none bg-transparent text-xs outline-none"
                rows={2}
                value={chatInput}
                disabled={chatBusy}
                onChange={(event) => setChatInput(event.target.value)}
                placeholder={t("Pregunta sobre este documento…")}
              />
              <div className="mt-2 flex justify-end border-t border-neutral-800 pt-2">
                {chatBusy ? (
                  <button
                    type="button"
                    className="btn btn-secondary h-7 text-[10px]"
                    onClick={() => {
                      abortRef.current?.abort();
                      if (chatBusy && chatJobId)
                        void api
                          .cancelAIJob(chatJobId, csrfToken)
                          .catch(() => undefined);
                    }}
                  >
                    {t("Cancelar")}
                  </button>
                ) : (
                  <button
                    className="btn btn-primary h-7 text-[10px]"
                    disabled={!chatInput.trim()}
                  >
                    {t("Enviar")}
                  </button>
                )}
              </div>
            </form>
          </aside>
        )}
      </div>
      {openingFormatPrompt && (
        <ReaderOpeningFormatDialog
          document={document}
          remember={rememberOpeningFormat}
          onRememberChange={setRememberOpeningFormat}
          onChoose={chooseOpeningFormat}
          onCancel={() => chooseOpeningFormat("clean")}
        />
      )}
    </div>
  );
}
