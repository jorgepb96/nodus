import { app } from 'electron';
import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type {
  RadarCadence,
  RadarCheckRequest,
  RadarCheckResult,
  RadarFollow,
  RadarFollowInput,
  RadarFollowPatch,
  RadarFollowType,
  RadarSnapshot,
  RadarSourceName,
  RadarSourceStatus,
  RadarUpdate,
} from '@shared/radar';
import { nodiText } from '@shared/nodiNotifications';
import { addNotification, listNotifications, updateNotification } from '../notifications';
import { fetchPublicResource } from '../network/publicDownload';

const STORE_VERSION = 1;
const MAX_UPDATES = 1_000;
const MAX_SEEN_KEYS = 8_000;
const DAILY_MS = 24 * 60 * 60 * 1_000;
const WEEKLY_MS = 7 * DAILY_MS;
const API_TIMEOUT_MS = 15_000;

const SOURCE_DESCRIPTIONS: Record<RadarSourceName, string> = {
  OpenAlex: 'Works, authors, topics, institutions, and citations',
  Crossref: 'DOI metadata, journals, references, and citations',
  ORCID: 'Researcher identities and newly listed works',
  'Semantic Scholar': 'Papers, authors, recommendations, and citations',
  RSS: 'Journal, blog, newsletter, and repository feeds',
  'Web monitor': 'Meaningful content changes on public web pages',
};

const ALL_SOURCES = Object.keys(SOURCE_DESCRIPTIONS) as RadarSourceName[];

interface StoredRadar {
  version: number;
  follows: RadarFollow[];
  updates: RadarUpdate[];
  sources: RadarSourceStatus[];
  seenKeys: string[];
  lastCheckedAt: number | null;
}

export interface RadarCandidate {
  source: RadarSourceName;
  externalId: string;
  title: string;
  authors?: string;
  summary?: string;
  url: string;
  doi?: string;
  publishedAt?: string;
  signal?: string;
}

interface CandidateBatch {
  candidates: RadarCandidate[];
  checkpoint?: Record<string, string | number | boolean | null>;
}

export interface RadarServiceOptions {
  storeFile?: string;
  fetcher?: typeof fetch;
  now?: () => number;
  fixtureProvider?: (follow: RadarFollow) => Promise<RadarCandidate[]>;
}

function clean(value: unknown, limit = 1_000): string {
  return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, limit);
}

function hash(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function sourceNames(type: RadarFollowType, value: string): RadarSourceName[] {
  if (type === 'topic' || type === 'search') return ['OpenAlex', 'Semantic Scholar'];
  if (type === 'author') return /\b\d{4}-\d{4}-\d{4}-\d{3}[\dX]\b/i.test(value)
    ? ['ORCID', 'Crossref']
    : ['OpenAlex', 'Crossref'];
  if (type === 'journal') return ['Crossref'];
  if (type === 'paper') return ['OpenAlex', 'Crossref'];
  if (type === 'rss') return ['RSS'];
  return ['Web monitor'];
}

function detailFor(type: RadarFollowType, value: string): string {
  const labels: Record<RadarFollowType, string> = {
    topic: 'Topic monitoring', search: 'Saved research query', author: 'Researcher activity',
    journal: 'New journal publications', paper: 'Paper and citation activity',
    rss: 'RSS/Atom feed', website: 'Meaningful page changes',
  };
  return `${labels[type]} · ${clean(value, 300)}`;
}

function nextCheck(now: number, cadence: RadarCadence): number {
  return now + (cadence === 'weekly' ? WEEKLY_MS : DAILY_MS);
}

function blankStore(): StoredRadar {
  return {
    version: STORE_VERSION,
    follows: [],
    updates: [],
    seenKeys: [],
    lastCheckedAt: null,
    sources: ALL_SOURCES.map((name) => ({
      name,
      description: SOURCE_DESCRIPTIONS[name],
      state: 'ready',
      followCount: 0,
      lastCheckedAt: null,
      lastSuccessAt: null,
    })),
  };
}

function parseDate(value: unknown): string | undefined {
  const text = clean(value, 80);
  if (!text) return undefined;
  const time = Date.parse(text);
  return Number.isFinite(time) ? new Date(time).toISOString() : undefined;
}

function decodeXml(value: string): string {
  return value
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_all, code) => String.fromCodePoint(Number(code)))
    .replace(/\s+/g, ' ').trim();
}

function xmlTag(block: string, names: string[]): string {
  for (const name of names) {
    const match = new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${name}>`, 'i').exec(block);
    if (match) return decodeXml(match[1]);
  }
  return '';
}

function xmlLink(block: string): string {
  const atom = /<link\b[^>]*href=["']([^"']+)["'][^>]*>/i.exec(block)?.[1];
  return clean(atom || xmlTag(block, ['link']), 2_000);
}

function abstractFromInvertedIndex(value: unknown): string {
  if (!value || typeof value !== 'object') return '';
  const words: Array<[number, string]> = [];
  for (const [word, positions] of Object.entries(value as Record<string, unknown>)) {
    if (!Array.isArray(positions)) continue;
    for (const position of positions) if (Number.isFinite(position)) words.push([Number(position), word]);
  }
  return words.sort((a, b) => a[0] - b[0]).slice(0, 90).map((entry) => entry[1]).join(' ');
}

function candidateKey(followId: string, candidate: RadarCandidate): string {
  const identity = candidate.doi?.toLowerCase().replace(/^https?:\/\/(?:dx\.)?doi\.org\//, '')
    || candidate.externalId || candidate.url || candidate.title;
  return `${followId}:${hash(clean(identity, 2_000).toLowerCase())}`;
}

function startOfWeek(now: number): number {
  const date = new Date(now);
  const day = (date.getDay() + 6) % 7;
  date.setHours(0, 0, 0, 0);
  date.setDate(date.getDate() - day);
  return date.getTime();
}

export class RadarService {
  private readonly file: string;
  private readonly fetcher: typeof fetch;
  private readonly now: () => number;
  private readonly fixtureProvider?: RadarServiceOptions['fixtureProvider'];
  private checking = false;
  private inFlight: Promise<RadarCheckResult> | null = null;
  private notify: ((snapshot: RadarSnapshot) => void) | null = null;

  constructor(options: RadarServiceOptions = {}) {
    this.file = options.storeFile ?? path.join(app.getPath('userData'), 'radar-store.json');
    this.fetcher = options.fetcher ?? fetch;
    this.now = options.now ?? Date.now;
    this.fixtureProvider = options.fixtureProvider;
  }

  setNotifier(notify: ((snapshot: RadarSnapshot) => void) | null): void {
    this.notify = notify;
  }

  snapshot(): RadarSnapshot {
    return this.toSnapshot(this.read());
  }

  createFollow(input: RadarFollowInput): RadarFollow {
    const value = clean(input.value, 2_000);
    if (!value) throw new Error('Choose something to follow.');
    if ((input.type === 'rss' || input.type === 'website') && !/^https?:\/\//i.test(value)) {
      throw new Error('Enter a complete HTTP(S) URL.');
    }
    const store = this.read();
    const duplicate = store.follows.find((follow) => follow.type === input.type && follow.value.toLowerCase() === value.toLowerCase());
    if (duplicate) throw new Error('You are already following this item.');
    const now = this.now();
    const cadence = input.cadence === 'weekly' ? 'weekly' : 'daily';
    const follow: RadarFollow = {
      id: `radar-follow-${randomUUID()}`,
      type: input.type,
      value,
      title: clean(input.title, 240) || value,
      detail: detailFor(input.type, value),
      sources: sourceNames(input.type, value),
      cadence,
      paused: false,
      createdAt: now,
      updatedAt: now,
      lastCheckedAt: null,
      nextCheckAt: now,
      updateCount: 0,
    };
    store.follows.unshift(follow);
    this.recountSources(store);
    this.write(store);
    this.emit(store);
    return follow;
  }

  updateFollow(id: string, patch: RadarFollowPatch): RadarFollow {
    const store = this.read();
    const follow = store.follows.find((candidate) => candidate.id === id);
    if (!follow) throw new Error('The Radar follow no longer exists.');
    if (patch.value !== undefined) {
      const value = clean(patch.value, 2_000);
      if (!value) throw new Error('The follow value cannot be empty.');
      follow.value = value;
      follow.detail = detailFor(follow.type, value);
      follow.sources = sourceNames(follow.type, value);
      follow.checkpoint = undefined;
      follow.nextCheckAt = this.now();
    }
    if (patch.title !== undefined) follow.title = clean(patch.title, 240) || follow.value;
    if (patch.cadence !== undefined) follow.cadence = patch.cadence === 'weekly' ? 'weekly' : 'daily';
    if (patch.paused !== undefined) {
      follow.paused = Boolean(patch.paused);
      follow.nextCheckAt = follow.paused ? null : this.now();
    }
    follow.updatedAt = this.now();
    this.recountSources(store);
    this.write(store);
    this.emit(store);
    return follow;
  }

  removeFollow(id: string): RadarSnapshot {
    const store = this.read();
    store.follows = store.follows.filter((follow) => follow.id !== id);
    store.updates = store.updates.filter((update) => update.followId !== id);
    store.seenKeys = store.seenKeys.filter((key) => !key.startsWith(`${id}:`));
    this.recountSources(store);
    this.write(store);
    return this.emit(store);
  }

  markUpdateRead(id: string, read = true): RadarSnapshot {
    const store = this.read();
    const update = store.updates.find((candidate) => candidate.id === id);
    if (update) update.read = read;
    this.write(store);
    return this.emit(store);
  }

  markAllRead(): RadarSnapshot {
    const store = this.read();
    for (const update of store.updates) update.read = true;
    this.write(store);
    return this.emit(store);
  }

  removeUpdate(id: string): RadarSnapshot {
    const store = this.read();
    store.updates = store.updates.filter((update) => update.id !== id);
    this.write(store);
    return this.emit(store);
  }

  check(request: RadarCheckRequest = {}): Promise<RadarCheckResult> {
    if (this.inFlight) return this.inFlight;
    this.inFlight = this.performCheck(request).finally(() => { this.inFlight = null; });
    return this.inFlight;
  }

  async checkDue(): Promise<RadarCheckResult | null> {
    const now = this.now();
    const due = this.read().follows.filter((follow) => !follow.paused && (follow.nextCheckAt ?? 0) <= now);
    if (!due.length) return null;
    return this.check({ followIds: due.map((follow) => follow.id), reason: 'scheduled' });
  }

  private async performCheck(request: RadarCheckRequest): Promise<RadarCheckResult> {
    const startedAt = this.now();
    this.checking = true;
    this.notify?.(this.snapshot());
    // The fetches below take seconds. Anything the user does meanwhile (a follow added,
    // removed or paused, an update read) writes the store, so this check must not write back
    // the copy it read at the start: it records what it learned and merges that into a fresh
    // read at the end.
    const store = this.read();
    const requested = request.followIds ? new Set(request.followIds) : null;
    const follows = store.follows.filter((follow) => !follow.paused && (!requested || requested.has(follow.id)));
    let errors = 0;
    let newUpdates: RadarUpdate[] = [];
    const seen = new Set(store.seenKeys);
    const newKeys: string[] = [];
    const followResults = new Map<string, { checkpoint?: RadarFollow['checkpoint']; added: number; checkedAt: number }>();
    const healthEvents: Array<{ sources: RadarSourceName[]; error: string | null }> = [];

    let snapshot: RadarSnapshot;
    try {
      for (const follow of follows) {
        let checkpoint: RadarFollow['checkpoint'] | undefined;
        let added = 0;
        try {
          const batch = await this.fetchCandidates(follow);
          if (batch.checkpoint) checkpoint = batch.checkpoint;
          for (const candidate of batch.candidates) {
            const key = candidateKey(follow.id, candidate);
            if (seen.has(key)) continue;
            seen.add(key);
            newKeys.push(key);
            const update: RadarUpdate = {
              id: `radar-update-${randomUUID()}`,
              followId: follow.id,
              followTitle: follow.title,
              followType: follow.type,
              source: candidate.source,
              externalId: clean(candidate.externalId, 1_000) || hash(candidate.url || candidate.title),
              title: clean(candidate.title, 500) || 'Research update',
              authors: clean(candidate.authors, 500),
              summary: clean(candidate.summary, 1_500),
              url: clean(candidate.url, 2_000),
              ...(candidate.doi ? { doi: clean(candidate.doi, 300) } : {}),
              ...(candidate.publishedAt ? { publishedAt: candidate.publishedAt } : {}),
              detectedAt: this.now(),
              read: false,
              ...(candidate.signal ? { signal: clean(candidate.signal, 80) } : {}),
            };
            newUpdates.push(update);
            added += 1;
          }
          healthEvents.push({ sources: follow.sources, error: null });
        } catch (error) {
          errors += 1;
          healthEvents.push({ sources: follow.sources, error: error instanceof Error ? error.message : String(error) });
        }
        followResults.set(follow.id, { checkpoint, added, checkedAt: this.now() });
      }

      const fresh = this.read();
      const live = new Set(fresh.follows.map((follow) => follow.id));
      // A follow removed during the check takes its new updates with it.
      newUpdates = newUpdates.filter((update) => live.has(update.followId));
      for (const follow of fresh.follows) {
        const result = followResults.get(follow.id);
        if (!result) continue;
        if (result.checkpoint) follow.checkpoint = result.checkpoint;
        follow.updateCount += newUpdates.filter((update) => update.followId === follow.id).length;
        follow.lastCheckedAt = result.checkedAt;
        follow.nextCheckAt = nextCheck(result.checkedAt, follow.cadence);
        follow.updatedAt = result.checkedAt;
      }
      for (const event of healthEvents) this.updateSourceHealth(fresh, event.sources, event.error);
      fresh.updates = [...newUpdates.slice().reverse(), ...fresh.updates]
        .sort((a, b) => b.detectedAt - a.detectedAt)
        .slice(0, MAX_UPDATES);
      fresh.seenKeys = [...new Set([...fresh.seenKeys, ...newKeys])].slice(-MAX_SEEN_KEYS);
      fresh.lastCheckedAt = this.now();
      this.recountSources(fresh);
      this.write(fresh);
      this.checking = false;
      snapshot = this.emit(fresh);
    } finally {
      // A failed write must not leave the interface saying "checking" until restart.
      this.checking = false;
    }

    if (newUpdates.length > 0) {
      const recent = listNotifications().find((notification) =>
        !notification.read && notification.action?.type === 'radar' && this.now() - notification.createdAt < 60_000
      );
      const previousCount = recent?.bodyText?.id === 'radarUpdatesBody'
        ? Number(recent.bodyText.params?.count ?? 0)
        : 0;
      const count = previousCount + newUpdates.length;
      const notificationInput = {
        title: nodiText('radarUpdatesTitle'),
        body: nodiText('radarUpdatesBody', { count }),
        kind: 'info' as const,
        action: { type: 'radar' as const, ...(count === 1 ? { updateId: newUpdates[0].id } : {}) },
      };
      if (recent) updateNotification(recent.id, notificationInput);
      else addNotification({
        ...notificationInput,
        dedupeKey: `radar:${newUpdates.map((update) => update.id).sort().join(',')}`,
        cooldownMs: 0,
      });
    }

    return {
      checked: follows.length,
      newItems: newUpdates.length,
      errors,
      startedAt,
      completedAt: this.now(),
      snapshot,
    };
  }

  private async fetchCandidates(follow: RadarFollow): Promise<CandidateBatch> {
    if (this.fixtureProvider) return { candidates: await this.fixtureProvider(follow) };
    const fixtureFile = process.env.NODUS_RADAR_FIXTURE_PATH;
    if (fixtureFile) {
      const fixture = JSON.parse(fs.readFileSync(fixtureFile, 'utf8')) as { candidates?: Record<string, RadarCandidate[]> };
      return { candidates: fixture.candidates?.[follow.type] ?? [] };
    }
    if (follow.type === 'rss') return { candidates: await this.fetchFeed(follow.value) };
    if (follow.type === 'website') return this.fetchWebsite(follow);
    if (follow.type === 'journal') return { candidates: await this.fetchCrossrefJournal(follow.value) };
    if (follow.type === 'paper') return this.fetchPaper(follow);
    if (follow.type === 'author') return { candidates: await this.fetchAuthor(follow.value) };
    return { candidates: await this.fetchResearchSearch(follow.value) };
  }

  private async fetchJson(url: string, accept = 'application/json'): Promise<any> {
    const response = await this.fetcher(url, {
      signal: AbortSignal.timeout(API_TIMEOUT_MS),
      headers: { Accept: accept, 'User-Agent': 'Nodus/4 Radar research monitor' },
    });
    if (!response.ok) throw new Error(`Source returned ${response.status}.`);
    return response.json();
  }

  private openAlexCandidates(payload: any): RadarCandidate[] {
    return (Array.isArray(payload?.results) ? payload.results : []).slice(0, 8).map((work: any) => {
      const doi = clean(work?.doi).replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, '');
      const authors = (Array.isArray(work?.authorships) ? work.authorships : [])
        .slice(0, 8).map((entry: any) => clean(entry?.author?.display_name, 120)).filter(Boolean).join(', ');
      const journal = clean(work?.primary_location?.source?.display_name, 180);
      return {
        source: 'OpenAlex' as const,
        externalId: doi || clean(work?.id, 300),
        title: clean(work?.display_name || work?.title, 500),
        authors: [authors, journal].filter(Boolean).join(' · '),
        summary: clean(abstractFromInvertedIndex(work?.abstract_inverted_index), 1_500),
        url: clean(work?.primary_location?.landing_page_url || work?.doi || work?.id, 2_000),
        ...(doi ? { doi } : {}),
        ...(parseDate(work?.publication_date) ? { publishedAt: parseDate(work.publication_date) } : {}),
      };
    }).filter((candidate: RadarCandidate) => candidate.title && candidate.url);
  }

  private semanticCandidates(payload: any): RadarCandidate[] {
    return (Array.isArray(payload?.data) ? payload.data : []).slice(0, 8).map((paper: any) => ({
      source: 'Semantic Scholar' as const,
      externalId: clean(paper?.externalIds?.DOI || paper?.paperId, 300),
      title: clean(paper?.title, 500),
      authors: (Array.isArray(paper?.authors) ? paper.authors : []).slice(0, 8).map((author: any) => clean(author?.name, 120)).filter(Boolean).join(', '),
      summary: clean(paper?.abstract, 1_500),
      url: clean(paper?.url || (paper?.externalIds?.DOI ? `https://doi.org/${paper.externalIds.DOI}` : ''), 2_000),
      ...(paper?.externalIds?.DOI ? { doi: clean(paper.externalIds.DOI, 300) } : {}),
      ...(paper?.year ? { publishedAt: `${paper.year}-01-01T00:00:00.000Z` } : {}),
    })).filter((candidate: RadarCandidate) => candidate.title && candidate.url);
  }

  private async fetchResearchSearch(value: string): Promise<RadarCandidate[]> {
    const encoded = encodeURIComponent(value);
    const [openAlex, semantic] = await Promise.allSettled([
      this.fetchJson(`https://api.openalex.org/works?search=${encoded}&sort=publication_date:desc&per-page=8`),
      this.fetchJson(`https://api.semanticscholar.org/graph/v1/paper/search?query=${encoded}&limit=8&fields=title,authors,abstract,url,year,externalIds`),
    ]);
    const candidates = [
      ...(openAlex.status === 'fulfilled' ? this.openAlexCandidates(openAlex.value) : []),
      ...(semantic.status === 'fulfilled' ? this.semanticCandidates(semantic.value) : []),
    ];
    if (!candidates.length && openAlex.status === 'rejected' && semantic.status === 'rejected') throw openAlex.reason;
    return candidates;
  }

  private crossrefCandidates(payload: any): RadarCandidate[] {
    return (Array.isArray(payload?.message?.items) ? payload.message.items : []).slice(0, 8).map((item: any) => {
      const doi = clean(item?.DOI, 300);
      const title = clean(Array.isArray(item?.title) ? item.title[0] : item?.title, 500);
      const authors = (Array.isArray(item?.author) ? item.author : []).slice(0, 8)
        .map((author: any) => clean([author?.given, author?.family].filter(Boolean).join(' '), 160)).filter(Boolean).join(', ');
      const journal = clean(Array.isArray(item?.['container-title']) ? item['container-title'][0] : item?.['container-title'], 180);
      const parts = item?.published?.['date-parts']?.[0] || item?.created?.['date-parts']?.[0];
      const date = Array.isArray(parts) && parts[0] ? `${parts[0]}-${String(parts[1] || 1).padStart(2, '0')}-${String(parts[2] || 1).padStart(2, '0')}` : undefined;
      return {
        source: 'Crossref' as const,
        externalId: doi || clean(item?.URL, 500),
        title,
        authors: [authors, journal].filter(Boolean).join(' · '),
        summary: clean(item?.abstract, 1_500).replace(/<[^>]+>/g, ' '),
        url: clean(item?.URL || (doi ? `https://doi.org/${doi}` : ''), 2_000),
        ...(doi ? { doi } : {}),
        ...(date ? { publishedAt: parseDate(date) } : {}),
      };
    }).filter((candidate: RadarCandidate) => candidate.title && candidate.url);
  }

  private async fetchCrossrefJournal(value: string): Promise<RadarCandidate[]> {
    const issn = /\b\d{4}-?\d{3}[\dX]\b/i.exec(value)?.[0];
    const url = issn
      ? `https://api.crossref.org/journals/${encodeURIComponent(issn)}/works?sort=published&order=desc&rows=8`
      : `https://api.crossref.org/works?query.container-title=${encodeURIComponent(value)}&sort=published&order=desc&rows=8`;
    return this.crossrefCandidates(await this.fetchJson(url));
  }

  private async fetchAuthor(value: string): Promise<RadarCandidate[]> {
    const orcid = /\b\d{4}-\d{4}-\d{4}-\d{3}[\dX]\b/i.exec(value)?.[0];
    if (orcid) {
      const payload = await this.fetchJson(`https://api.crossref.org/works?filter=orcid:${encodeURIComponent(orcid)}&sort=published&order=desc&rows=8`);
      return this.crossrefCandidates(payload).map((candidate) => ({ ...candidate, source: 'ORCID' as const }));
    }
    const payload = await this.fetchJson(`https://api.openalex.org/works?filter=author.search:${encodeURIComponent(value)}&sort=publication_date:desc&per-page=8`);
    return this.openAlexCandidates(payload);
  }

  private async fetchPaper(follow: RadarFollow): Promise<CandidateBatch> {
    const doi = clean(follow.value).replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, '').replace(/^doi:\s*/i, '');
    const filter = /^10\.\d{4,9}\//.test(doi) ? `filter=doi:${encodeURIComponent(doi)}` : `search=${encodeURIComponent(follow.value)}`;
    const payload = await this.fetchJson(`https://api.openalex.org/works?${filter}&per-page=1`);
    const work = payload?.results?.[0];
    if (!work) return { candidates: [] };
    const count = Number(work?.cited_by_count ?? 0);
    const previous = Number(follow.checkpoint?.citationCount ?? -1);
    const checkpoint = { citationCount: count };
    if (previous < 0 || count <= previous) return { candidates: [], checkpoint };
    return {
      checkpoint,
      candidates: [{
        source: 'OpenAlex',
        externalId: `${clean(work?.id, 300)}:citations:${count}`,
        title: `${clean(work?.display_name || work?.title, 440)} received ${count - previous} new citation${count - previous === 1 ? '' : 's'}`,
        authors: `${count} citations in OpenAlex`,
        summary: 'Radar detected a change in the citation count since the previous check.',
        url: clean(work?.doi || work?.id, 2_000),
        ...(doi ? { doi } : {}),
        signal: `${count - previous} new`,
      }],
    };
  }

  private async fetchFeed(url: string): Promise<RadarCandidate[]> {
    const { response, finalUrl } = await fetchPublicResource(url, {
      fetcher: this.fetcher,
      timeoutMs: API_TIMEOUT_MS,
      maxBytes: 2 * 1024 * 1024,
      accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml, */*;q=0.5',
    });
    const xml = (await response.text()).slice(0, 2 * 1024 * 1024);
    const blocks = [...xml.matchAll(/<(item|entry)\b[^>]*>([\s\S]*?)<\/\1>/gi)].slice(0, 12).map((match) => match[2]);
    return blocks.map((block) => {
      const title = xmlTag(block, ['title']);
      const link = xmlLink(block) || finalUrl;
      const id = xmlTag(block, ['guid', 'id']) || link || title;
      const author = xmlTag(block, ['author', 'dc:creator']);
      const summary = xmlTag(block, ['description', 'summary', 'content:encoded', 'content']);
      const publishedAt = parseDate(xmlTag(block, ['pubDate', 'published', 'updated', 'dc:date']));
      return { source: 'RSS' as const, externalId: id, title, authors: author, summary, url: link, ...(publishedAt ? { publishedAt } : {}) };
    }).filter((candidate) => candidate.title && candidate.url);
  }

  private async fetchWebsite(follow: RadarFollow): Promise<CandidateBatch> {
    const { response, finalUrl } = await fetchPublicResource(follow.value, {
      fetcher: this.fetcher,
      timeoutMs: API_TIMEOUT_MS,
      maxBytes: 3 * 1024 * 1024,
      accept: 'text/html, application/xhtml+xml, text/plain;q=0.8',
    });
    const html = (await response.text()).slice(0, 3 * 1024 * 1024);
    const meaningful = html
      .replace(/<script\b[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style\b[\s\S]*?<\/style>/gi, ' ')
      .replace(/<!--([\s\S]*?)-->/g, ' ')
      .replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    const contentHash = hash(meaningful);
    const checkpoint = { contentHash };
    const previous = clean(follow.checkpoint?.contentHash, 100);
    if (!previous || previous === contentHash) return { candidates: [], checkpoint };
    const title = decodeXml(/<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1] || follow.title);
    return {
      checkpoint,
      candidates: [{
        source: 'Web monitor',
        externalId: `${finalUrl}:${contentHash}`,
        title: `${title || follow.title} changed`,
        authors: new URL(finalUrl).hostname,
        summary: clean(meaningful, 400),
        url: finalUrl,
        signal: 'Page changed',
      }],
    };
  }

  private read(): StoredRadar {
    try {
      const raw = JSON.parse(fs.readFileSync(this.file, 'utf8')) as Partial<StoredRadar>;
      if (raw.version !== STORE_VERSION || !Array.isArray(raw.follows) || !Array.isArray(raw.updates)) return blankStore();
      const base = blankStore();
      return {
        ...base,
        ...raw,
        follows: raw.follows,
        updates: raw.updates,
        seenKeys: Array.isArray(raw.seenKeys) ? raw.seenKeys.filter((key): key is string => typeof key === 'string') : [],
        sources: ALL_SOURCES.map((name) => {
          const stored = raw.sources?.find((source) => source.name === name);
          return stored ? { ...stored, description: SOURCE_DESCRIPTIONS[name] } : base.sources.find((source) => source.name === name)!;
        }),
      };
    } catch {
      return blankStore();
    }
  }

  private write(store: StoredRadar): void {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const temp = `${this.file}.${process.pid}.tmp`;
    fs.writeFileSync(temp, JSON.stringify(store, null, 2), { mode: 0o600 });
    fs.renameSync(temp, this.file);
  }

  private recountSources(store: StoredRadar): void {
    for (const source of store.sources) {
      source.followCount = store.follows.filter((follow) => !follow.paused && follow.sources.includes(source.name)).length;
      if (!source.followCount && source.state === 'active') source.state = 'ready';
      if (source.followCount && source.state === 'ready') source.state = 'active';
    }
  }

  private updateSourceHealth(store: StoredRadar, names: RadarSourceName[], error: string | null): void {
    const now = this.now();
    for (const name of names) {
      const source = store.sources.find((candidate) => candidate.name === name);
      if (!source) continue;
      source.lastCheckedAt = now;
      if (error) {
        source.state = /429|limit|rate/i.test(error) ? 'limited' : 'error';
        source.error = clean(error, 300);
      } else {
        source.state = source.followCount > 0 ? 'active' : 'ready';
        source.lastSuccessAt = now;
        delete source.error;
      }
    }
  }

  private toSnapshot(store: StoredRadar): RadarSnapshot {
    const active = store.follows.filter((follow) => !follow.paused && follow.nextCheckAt != null);
    return {
      follows: [...store.follows].sort((a, b) => b.updatedAt - a.updatedAt),
      updates: [...store.updates].sort((a, b) => b.detectedAt - a.detectedAt),
      sources: store.sources,
      unreadCount: store.updates.reduce((count, update) => count + (update.read ? 0 : 1), 0),
      checking: this.checking,
      lastCheckedAt: store.lastCheckedAt,
      nextCheckAt: active.length ? Math.min(...active.map((follow) => follow.nextCheckAt!)) : null,
      detectedThisWeek: store.updates.filter((update) => update.detectedAt >= startOfWeek(this.now())).length,
    };
  }

  private emit(store: StoredRadar): RadarSnapshot {
    const snapshot = this.toSnapshot(store);
    this.notify?.(snapshot);
    return snapshot;
  }
}

let singleton: RadarService | null = null;

export function radarService(): RadarService {
  singleton ??= new RadarService();
  return singleton;
}
