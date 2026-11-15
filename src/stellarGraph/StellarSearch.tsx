import { useEffect, useId, useRef, useState } from "react";
import type { GraphNode } from "@shared/types";
import type { StellarTheme } from "@shared/stellarGraph";
import { themeName, type StellarGraphSource } from "./source";
import { NODE_LABELS } from "./palette";
import { t } from "../i18n";
import { Icon } from "../components/ui";

export function StellarSearch({ source, author, initialQuery = "", onQueryChange, disabled, visibleIds, onRemove, onChoose, themes, onChooseTheme }: {
  source: StellarGraphSource;
  author?: string;
  initialQuery?: string;
  onQueryChange?(query: string): void;
  disabled: boolean;
  visibleIds: Set<string>;
  onRemove(id: string): void;
  onChoose(node: GraphNode): void;
  themes?: StellarTheme[];
  onChooseTheme?(theme: StellarTheme): void;
}) {
  const [query, setQuery] = useState(initialQuery);
  const [open, setOpen] = useState(!!initialQuery);
  const [results, setResults] = useState<GraphNode[]>([]);
  const [cursor, setCursor] = useState<number | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState("");
  const [active, setActive] = useState(-1);
  const host = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const request = useRef(0);
  const listId = useId();
  const searchesThemes = themes !== undefined && onChooseTheme !== undefined;
  const needle = query.trim().toLocaleLowerCase();
  const themeMatches = searchesThemes && needle
    ? themes.filter(theme => themeName(theme).toLocaleLowerCase().includes(needle)) : [];
  const resultCount = themeMatches.length + results.length;
  const searchLabel = t(searchesThemes ? "Buscar ideas y temas" : "Buscar una idea");
  useEffect(() => { onQueryChange?.(query); }, [query, onQueryChange]);

  useEffect(() => {
    const version = ++request.current;
    setBusy(true);
    setResults([]);
    setCursor(null);
    setActive(-1);
    setError("");
    const timer = setTimeout(() => {
      void source.page({ kind: "search", search: query, author, limit: 20 })
        .then(page => {
          if (version !== request.current) return;
          setResults(page.nodes);
          setCursor(page.next);
        })
        .catch(() => { if (version === request.current) setError(t("No se pudo buscar. Prueba a escribir de nuevo.")); })
        .finally(() => { if (version === request.current) setBusy(false); });
    }, 180);
    return () => { clearTimeout(timer); request.current++; };
  }, [query, source, author]);

  useEffect(() => {
    const closeOutside = (event: PointerEvent) => {
      if (!host.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", closeOutside);
    return () => document.removeEventListener("pointerdown", closeOutside);
  }, []);
  useEffect(() => {
    if (open && active >= 0) document.getElementById(`${listId}-${active}`)?.scrollIntoView({ block: "nearest" });
  }, [active, open, listId]);

  const choose = (node: GraphNode, keepOpen = false) => {
    if (disabled || busy) return;
    onChoose(node);
    if (!keepOpen) { setOpen(false); input.current?.blur(); }
  };
  const chooseTheme = (theme: StellarTheme) => {
    if (disabled) return;
    setOpen(false); input.current?.blur();
    onChooseTheme?.(theme);
  };
  const more = async () => {
    if (busy || cursor === null) return;
    const version = request.current;
    setBusy(true);
    try {
      const page = await source.page({ kind: "search", search: query, author, cursor, limit: 20 });
      if (version !== request.current) return;
      setResults(rows => [...rows, ...page.nodes]);
      setCursor(page.next);
    } catch {
      if (version === request.current) setError(t("No se pudieron cargar más resultados."));
    } finally {
      if (version === request.current) setBusy(false);
    }
  };
  return (
    <div className="stellar-search" ref={host} onBlur={event => {
      if (!event.currentTarget.contains(event.relatedTarget as Node)) setOpen(false);
    }}>
      <div className="stellar-search-field">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 4 4"/></svg>
        <input ref={input} type="search" role="combobox" aria-label={searchLabel}
          aria-autocomplete="list" aria-haspopup="grid" aria-expanded={open} aria-controls={open ? listId : undefined}
          aria-activedescendant={open && active >= 0 ? `${listId}-${active}` : undefined}
          placeholder={searchesThemes ? `${searchLabel}…` : t("Buscar una idea…")} value={query}
          onFocus={() => setOpen(true)}
          onChange={event => { setQuery(event.target.value); setOpen(true); setActive(-1); setBusy(true); }}
          onKeyDown={event => {
            if (event.key === "Escape") { setOpen(false); event.stopPropagation(); }
            if (event.key === "ArrowDown" || event.key === "ArrowUp") {
              event.preventDefault(); setOpen(true);
              setActive(index => !resultCount ? -1 : index < 0
                ? event.key === "ArrowDown" ? 0 : resultCount - 1
                : (index + (event.key === "ArrowDown" ? 1 : -1) + resultCount) % resultCount);
            }
            if (event.key === "Enter" && open && resultCount) {
              event.preventDefault();
              const index = Math.min(resultCount - 1, Math.max(0, active));
              if (index < themeMatches.length) chooseTheme(themeMatches[index]);
              else choose(results[index - themeMatches.length]);
            }
          }} />
        {query && <button className="stellar-search-clear" aria-label={t("Limpiar búsqueda")} onClick={() => {
          setQuery(""); setBusy(true); setActive(-1); input.current?.focus();
        }}>×</button>}
      </div>
      {open && <div className="stellar-search-popover">
        <div className="stellar-search-caption">{searchesThemes ? `${t("Temas")} / ${t("Ideas")}` : t("AÑADE IDEAS AL LIENZO")}<kbd>esc</kbd></div>
        <div id={listId} role="grid" aria-label={searchesThemes ? searchLabel : t("Ideas encontradas")} aria-busy={busy} className="stellar-search-results">
          {themeMatches.map((theme, index) => <div key={`theme:${theme.id}`} id={`${listId}-${index}`} role="row" aria-selected={index === active} className="stellar-search-result">
            <div role="gridcell"><button className="stellar-search-choice" tabIndex={-1} disabled={disabled}
              onMouseDown={event => event.preventDefault()} onClick={() => chooseTheme(theme)}>
              <small>{t("Tema")} · {theme.ideaCount.toLocaleString()} {t(theme.ideaCount === 1 ? "idea" : "ideas")}</small>
              <strong>{themeName(theme)}</strong>
            </button></div>
            <div role="gridcell" aria-hidden="true"><Icon name="layers" size={18} /></div>
          </div>)}
          {results.map((node, index) => <div key={node.id} id={`${listId}-${themeMatches.length + index}`} role="row" aria-selected={themeMatches.length + index === active}
            className={`stellar-search-result ${visibleIds.has(node.id) ? "included" : ""}`}>
            <div role="gridcell"><button className="stellar-search-choice" tabIndex={-1} disabled={disabled || busy}
              onMouseDown={event => event.preventDefault()} onClick={() => choose(node)}>
              <small>{t(NODE_LABELS[node.type] || node.type)} · {node.workCount} {t("fuentes")}</small>
              <strong>{node.label}</strong><span>{node.statement}</span>
            </button></div>
            <div role="gridcell"><button className="stellar-search-toggle" disabled={disabled || busy}
              aria-label={`${t(visibleIds.has(node.id) ? "Quitar idea del lienzo" : "Añadir idea al lienzo")}: ${node.label}`}
              title={t(visibleIds.has(node.id) ? "Quitar idea del lienzo" : "Añadir idea al lienzo")}
              onMouseDown={event => event.preventDefault()} onClick={() => visibleIds.has(node.id) ? onRemove(node.id) : choose(node, true)}>
              <Icon name={visibleIds.has(node.id) ? "minus" : "plus"} size={18} />
            </button></div>
          </div>)}
        </div>
        {busy && <p role="status">{t("Buscando…")}</p>}
        {error && <p role="alert">{error}</p>}
        {!busy && !error && !resultCount && <p role="status">{t(searchesThemes ? "No hay ideas ni temas que coincidan con la búsqueda." : "No hay ideas que coincidan con la búsqueda.")}</p>}
        {cursor !== null && <button className="stellar-search-more" disabled={busy} onClick={() => void more()}>{t("Más resultados")}</button>}
      </div>}
    </div>
  );
}
