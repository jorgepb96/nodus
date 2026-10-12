import { memo, useMemo } from 'react';
import type { ResearchWebSearchStats, ResearchWebSource } from '@shared/types';
import { t, tx } from '../i18n';
import { openWebSource } from '../researchWebSources';
import { Icon } from './ui';

const displayUrl = (url: string) => { try { const parsed = new URL(url); return `${parsed.hostname.replace(/^www\./, '')}${parsed.pathname.length > 1 ? parsed.pathname : ''}`; } catch { return url; } };

/** The web pages whose passages reached the answer, beside the library sources:
 * same row design, plus the address. A click opens the page in a new Browser tab.
 * Pages cited in the answer are marked; the rest informed the answer without a citation. */
// Memoised, and each source's citation is looked up once: the chat timeline re-renders on
// every streamed delta, and scanning every earlier answer (often 100k+ characters) for every
// passage id, several times per source inside a sort, cost milliseconds per delta.
export const ResearchWebSources = memo(function ResearchWebSources({ sources, search, answer }: { sources: ResearchWebSource[]; search?: ResearchWebSearchStats; answer: string }) {
  const citedSources = useMemo(() => new Set(sources.filter(source => source.passageIds.some(id => answer.includes(encodeURIComponent(id)) || answer.includes(id)))), [sources, answer]);
  if (!sources.length && !search?.searched) return null;
  const cited = (source: ResearchWebSource) => citedSources.has(source);
  const ordered = [...sources].sort((a, b) => Number(cited(b)) - Number(cited(a)));
  return <section className="research-web-sources" data-testid="research-web-sources" aria-label={t('Fuentes web')}>
    <header><Icon name="globe" size={13} /><strong>{t('Fuentes web')}</strong>
      {search && <span>{tx('{consulted} páginas consultadas de {found} resultados encontrados', { consulted: search.consulted.length, found: search.found })}</span>}
    </header>
    {ordered.length ? <ul>{ordered.map(source => <li key={source.url}>
      <button type="button" onClick={() => openWebSource(source.url)} title={t('Abrir en una pestaña nueva del navegador de Nodus')}>
        <span className="research-web-source-title">{source.title || source.domain}</span>
        <span className="research-web-source-meta">{source.siteName && source.siteName !== source.domain ? `${source.siteName} · ` : ''}{displayUrl(source.url)}</span>
      </button>
      <span className={`research-web-source-tag ${cited(source) ? 'cited' : ''}`}>{cited(source) ? t('Citada') : tx('{n} pasajes', { n: source.passageIds.length })}</span>
    </li>)}</ul> : <p>{t('Ninguna página aportó evidencia útil.')}</p>}
  </section>;
});
