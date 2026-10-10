import { notifyAuthoredResearchSourceChanged } from '../ai/researchCorpusEvents';
import { getDb } from './database';
import { expandCollectionKeys } from './collectionsRepo';
import { currentEmbeddingConfig } from './ideasRepo';
import type {
  Work,
  WorkView,
  WorkFilter,
  WorkPage,
  WorkPageRequest,
  DeepTrigger,
  ZoteroTag,
  SummaryStatus,
  WorkCreator,
  ResolvedTextState,
  WorkTextSource,
} from '@shared/types';
import { HEALTH_BUCKET_WHERE } from './corpusHealthBuckets';
import { readinessWhere } from './readinessFilters';

function normalizeZoteroTag(tag: string): string {
  return tag.trim().normalize('NFC').toLowerCase();
}

function toView(row: Work, themes: string[], zoteroTags: string[], ideaCount: number): WorkView {
  const { authors_json, ...rest } = row;
  let authors: string[] = [];
  try {
    authors = JSON.parse(authors_json || '[]');
  } catch {
    authors = [];
  }
  return { ...rest, authors, themes, zoteroTags, ideaCount };
}

/** Count extracted ideas (idea_occurrences) for a single work. */
function ideaCountFor(nodusId: string): number {
  const row = getDb()
    .prepare('SELECT COUNT(*) AS n FROM idea_occurrences WHERE nodus_id = ?')
    .get(nodusId) as { n: number } | undefined;
  return row?.n ?? 0;
}

/** Batch-count extracted ideas per work in one grouped query, keyed by nodus_id. */
function ideaCountsForWorks(nodusIds: string[]): Map<string, number> {
  const result = new Map<string, number>();
  if (nodusIds.length === 0) return result;
  const placeholders = nodusIds.map(() => '?').join(',');
  const rows = getDb()
    .prepare(
      `SELECT nodus_id, COUNT(*) AS n FROM idea_occurrences WHERE nodus_id IN (${placeholders}) GROUP BY nodus_id`
    )
    .all(...nodusIds) as { nodus_id: string; n: number }[];
  for (const row of rows) result.set(row.nodus_id, row.n);
  return result;
}

export function getWork(nodusId: string): WorkView | null {
  const db = getDb();
  const row = db.prepare('SELECT * FROM works WHERE nodus_id = ?').get(nodusId) as Work | undefined;
  if (!row) return null;
  return toView(row, themesFor(nodusId), zoteroTagsFor(nodusId), ideaCountFor(nodusId));
}

/**
 * Fetch many works by id in two queries (works + themes) instead of N+1.
 * Returns a Map keyed by nodus_id for O(1) lookup by callers.
 */
export function getWorksByIds(nodusIds: string[]): Map<string, WorkView> {
  const db = getDb();
  const result = new Map<string, WorkView>();
  if (nodusIds.length === 0) return result;
  const placeholders = nodusIds.map(() => '?').join(',');
  const rows = db.prepare(`SELECT * FROM works WHERE nodus_id IN (${placeholders})`).all(...nodusIds) as Work[];
  if (rows.length === 0) return result;
  // Batch-load themes for all works in one query.
  const themeRows = db
    .prepare(
      `SELECT wt.nodus_id, t.label
         FROM work_themes wt JOIN themes t ON t.theme_id = wt.theme_id
        WHERE wt.nodus_id IN (${placeholders})
        ORDER BY wt.nodus_id, t.label`
    )
    .all(...nodusIds) as { nodus_id: string; label: string }[];
  const themesByWork = groupLabels(themeRows);
  const zoteroTagsByWork = zoteroTagsForWorks(nodusIds);
  const ideaCountsByWork = ideaCountsForWorks(nodusIds);
  for (const row of rows) {
    result.set(
      row.nodus_id,
      toView(
        row,
        themesByWork.get(row.nodus_id) ?? [],
        zoteroTagsByWork.get(row.nodus_id) ?? [],
        ideaCountsByWork.get(row.nodus_id) ?? 0
      )
    );
  }
  return result;
}

export function getWorkByZoteroKey(zoteroKey: string): Work | null {
  const db = getDb();
  return (db.prepare('SELECT * FROM works WHERE zotero_key = ?').get(zoteroKey) as Work) ?? null;
}

export function getWorkByDoi(doi: string): Work | null {
  const db = getDb();
  if (!doi) return null;
  return (db.prepare('SELECT * FROM works WHERE doi = ? AND doi IS NOT NULL').get(doi) as Work) ?? null;
}

/**
 * Resolve a Zotero key that was previously merged into another work. Once a
 * duplicate is merged its key lives in work_aliases, so a later sync must route
 * the item back to the canonical work instead of re-creating the duplicate.
 */
export function getWorkByAliasKey(zoteroKey: string): Work | null {
  const db = getDb();
  if (!zoteroKey) return null;
  return (
    (db
      .prepare('SELECT w.* FROM work_aliases a JOIN works w ON w.nodus_id = a.nodus_id WHERE a.zotero_key = ?')
      .get(zoteroKey) as Work) ?? null
  );
}

function themesFor(nodusId: string): string[] {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT t.label FROM work_themes wt JOIN themes t ON t.theme_id = wt.theme_id WHERE wt.nodus_id = ? ORDER BY t.label`
    )
    .all(nodusId) as { label: string }[];
  return rows.map((r) => r.label);
}

function zoteroTagsFor(nodusId: string): string[] {
  return zoteroTagsForWorks([nodusId]).get(nodusId) ?? [];
}

function zoteroTagsForWorks(nodusIds: string[]): Map<string, string[]> {
  const tagsByWork = new Map<string, string[]>();
  if (nodusIds.length === 0) return tagsByWork;
  const placeholders = nodusIds.map(() => '?').join(',');
  const rows = getDb()
    .prepare(
      `SELECT wzt.nodus_id, zt.label
         FROM work_zotero_tags wzt JOIN zotero_tags zt ON zt.tag_id = wzt.tag_id
        WHERE wzt.nodus_id IN (${placeholders})
        ORDER BY wzt.nodus_id, zt.label COLLATE NOCASE`
    )
    .all(...nodusIds) as { nodus_id: string; label: string }[];
  return groupLabels(rows);
}

function groupLabels(rows: { nodus_id: string; label: string }[]): Map<string, string[]> {
  const labelsByWork = new Map<string, string[]>();
  for (const row of rows) {
    const labels = labelsByWork.get(row.nodus_id) ?? [];
    labels.push(row.label);
    labelsByWork.set(row.nodus_id, labels);
  }
  return labelsByWork;
}

export function listZoteroTags(): ZoteroTag[] {
  const rows = getDb()
    .prepare(
      `SELECT zt.label, COUNT(*) AS work_count
         FROM zotero_tags zt
         JOIN work_zotero_tags wzt ON wzt.tag_id = zt.tag_id
         JOIN works w ON w.nodus_id = wzt.nodus_id
        WHERE w.archived = 0
        GROUP BY zt.tag_id, zt.label
        ORDER BY work_count DESC, zt.label COLLATE NOCASE`
    )
    .all() as { label: string; work_count: number }[];
  return rows.map((row) => ({ label: row.label, workCount: row.work_count }));
}

export function listWorks(filter: WorkFilter = {}): WorkView[] {
  return queryWorks(filter).items;
}

export function listWorksPage(filter: WorkFilter = {}, request: WorkPageRequest): WorkPage {
  return queryWorks(filter, request);
}

function queryWorks(filter: WorkFilter, request?: WorkPageRequest): WorkPage {
  const db = getDb();
  const clauses: string[] = [];
  const params: Record<string, unknown> = {};

  if (!filter.includeArchived) clauses.push('archived = 0');
  if (filter.lightStatus && filter.lightStatus !== 'all') {
    clauses.push('light_status = @lightStatus');
    params.lightStatus = filter.lightStatus;
  }
  if (filter.deepStatus && filter.deepStatus !== 'all') {
    clauses.push('deep_status = @deepStatus');
    params.deepStatus = filter.deepStatus;
  }
  if (filter.summaryStatus && filter.summaryStatus !== 'all') {
    clauses.push('summary_status = @summaryStatus');
    params.summaryStatus = filter.summaryStatus;
  }
  const statusFlags = filter.statusFlags ?? [];
  if (statusFlags.length > 0) {
    for (const flag of statusFlags) {
      switch (flag) {
        case 'deep':
          clauses.push("w.deep_status = 'done'");
          break;
        case '!deep':
          clauses.push("w.deep_status != 'done'");
          break;
        case 'summary':
          clauses.push("w.summary_status = 'done'");
          break;
        case '!summary':
          clauses.push("w.summary_status != 'done'");
          break;
        case 'ideas':
          clauses.push('EXISTS (SELECT 1 FROM idea_occurrences io WHERE io.nodus_id = w.nodus_id)');
          break;
        case '!ideas':
          clauses.push('NOT EXISTS (SELECT 1 FROM idea_occurrences io WHERE io.nodus_id = w.nodus_id)');
          break;
        // "Every passage is current", phrased as "has passages, and none is
        // stale". The SUM(...) = COUNT(*) form these used to carry relied on a
        // bare HAVING with no GROUP BY, which SQLite rejects as a non-aggregate
        // query — so both of these filters threw instead of filtering.
        case 'passages': {
          const config = currentEmbeddingConfig();
          params.passProv = config.provider;
          params.passModel = config.model;
          clauses.push(
            `(
              EXISTS (SELECT 1 FROM passages p WHERE p.nodus_id = w.nodus_id)
              AND NOT EXISTS (
                SELECT 1 FROM passages p
                 WHERE p.nodus_id = w.nodus_id
                   AND NOT (p.embedding IS NOT NULL
                            AND p.embedding_provider = @passProv
                            AND p.embedding_model    = @passModel
                            AND p.embedding_dim > 0
                            AND ((w.resolved_text_hash IS NOT NULL AND p.content_hash = w.resolved_text_hash)
                              OR (w.resolved_text_hash IS NULL AND (w.deep_hash IS NULL OR p.content_hash = w.deep_hash))))
              )
            )`
          );
          break;
        }
        case '!passages': {
          const config = currentEmbeddingConfig();
          params.passNegProv = config.provider;
          params.passNegModel = config.model;
          clauses.push(
            `NOT (
              EXISTS (SELECT 1 FROM passages p WHERE p.nodus_id = w.nodus_id)
              AND NOT EXISTS (
                SELECT 1 FROM passages p
                 WHERE p.nodus_id = w.nodus_id
                   AND NOT (p.embedding IS NOT NULL
                            AND p.embedding_provider = @passNegProv
                            AND p.embedding_model    = @passNegModel
                            AND p.embedding_dim > 0
                            AND ((w.resolved_text_hash IS NOT NULL AND p.content_hash = w.resolved_text_hash)
                              OR (w.resolved_text_hash IS NULL AND (w.deep_hash IS NULL OR p.content_hash = w.deep_hash))))
              )
            )`
          );
          break;
        }
      }
    }
  }
  if (filter.healthBucket) {
    // Replay the exact predicate the corpus-health notice counted, so the list
    // matches the number the user clicked.
    clauses.push(`(${HEALTH_BUCKET_WHERE[filter.healthBucket]})`);
  }
  if (filter.readiness) {
    // Same contract as the health buckets: the preset must return exactly the
    // works whose status pill shows that word.
    const readiness = readinessWhere(filter.readiness);
    if (readiness) {
      clauses.push(`(${readiness.sql})`);
      Object.assign(params, readiness.params);
    }
  }
  if (filter.yearMin != null) {
    clauses.push('year >= @yearMin');
    params.yearMin = filter.yearMin;
  }
  if (filter.yearMax != null) {
    clauses.push('year <= @yearMax');
    params.yearMax = filter.yearMax;
  }
  if (filter.search) {
    clauses.push('(LOWER(title) LIKE @q OR LOWER(authors_json) LIKE @q)');
    params.q = `%${filter.search.toLowerCase()}%`;
  }
  if (filter.theme) {
    clauses.push(
      'nodus_id IN (SELECT wt.nodus_id FROM work_themes wt JOIN themes t ON t.theme_id = wt.theme_id WHERE t.label = @theme)'
    );
    params.theme = filter.theme;
  }
  const zoteroTags = Array.from(
    new Set((filter.zoteroTags ?? []).map(normalizeZoteroTag).filter(Boolean))
  );
  if (zoteroTags.length > 0) {
    const tagParams = zoteroTags.map((tag, index) => {
      const name = `zoteroTag${index}`;
      params[name] = tag;
      return `@${name}`;
    });
    const tagWhere = `zt.normalized_label IN (${tagParams.join(', ')})`;
    if (filter.zoteroTagMode === 'all') {
      clauses.push(
        `nodus_id IN (
          SELECT wzt.nodus_id
            FROM work_zotero_tags wzt JOIN zotero_tags zt ON zt.tag_id = wzt.tag_id
           WHERE ${tagWhere}
           GROUP BY wzt.nodus_id
          HAVING COUNT(DISTINCT zt.normalized_label) = ${zoteroTags.length}
        )`
      );
    } else {
      clauses.push(
        `nodus_id IN (
          SELECT wzt.nodus_id
            FROM work_zotero_tags wzt JOIN zotero_tags zt ON zt.tag_id = wzt.tag_id
           WHERE ${tagWhere}
        )`
      );
    }
  }

  const collections = Array.from(new Set((filter.collections ?? []).filter((k): k is string => !!k)));
  if (collections.length > 0) {
    let counter = 0;
    const inClause = (keys: string[]): string => {
      const names = keys.map((key) => {
        const name = `coll${counter++}`;
        params[name] = key;
        return `@${name}`;
      });
      return `nodus_id IN (SELECT nodus_id FROM work_collections WHERE collection_key IN (${names.join(', ')}))`;
    };
    if (filter.collectionMode === 'all') {
      // Every selected collection (each expanded to its own subtree) must match.
      for (const key of collections) clauses.push(inClause(expandCollectionKeys([key])));
    } else {
      // Any selected collection or its subcollections.
      clauses.push(inClause(expandCollectionKeys(collections)));
    }
  }

  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const total = Number((db.prepare(`SELECT COUNT(*) AS n FROM works w ${where}`).get(params) as { n: number }).n);
  const limit = request ? Math.min(250, Math.max(1, Math.trunc(request.limit))) : Math.max(1, total);
  const offset = request ? Math.min(total, Math.max(0, Math.trunc(request.offset))) : 0;
  const order = workOrderBy(request?.sort ?? null, params);
  params.pageLimit = limit;
  params.pageOffset = offset;
  const rows = db
    .prepare(`SELECT * FROM works w ${where} ORDER BY ${order} LIMIT @pageLimit OFFSET @pageOffset`)
    .all(params) as Work[];
  if (rows.length === 0) return { items: [], total, offset, limit };

  // Batch-load themes for all works in one query instead of N+1.
  const ids = rows.map((r) => r.nodus_id);
  const placeholders = ids.map(() => '?').join(',');
  const themeRows = db
    .prepare(
      `SELECT wt.nodus_id, t.label
         FROM work_themes wt JOIN themes t ON t.theme_id = wt.theme_id
        WHERE wt.nodus_id IN (${placeholders})
        ORDER BY wt.nodus_id, t.label`
    )
    .all(...ids) as { nodus_id: string; label: string }[];
  const themesByWork = groupLabels(themeRows);
  const zoteroTagsByWork = zoteroTagsForWorks(ids);
  const ideaCountsByWork = ideaCountsForWorks(ids);

  const items = rows.map((r) =>
    toView(
      r,
      themesByWork.get(r.nodus_id) ?? [],
      zoteroTagsByWork.get(r.nodus_id) ?? [],
      ideaCountsByWork.get(r.nodus_id) ?? 0
    )
  );
  return { items, total, offset, limit };
}

function workOrderBy(
  sort: WorkPageRequest['sort'],
  params: Record<string, unknown>
): string {
  if (!sort) return 'w.year DESC, w.title COLLATE NOCASE ASC';
  const dir = sort.dir === 'desc' ? 'DESC' : 'ASC';
  let expression: string;
  switch (sort.key) {
    case 'title':
      expression = 'w.title COLLATE NOCASE';
      break;
    case 'authors':
      expression = 'w.authors_json COLLATE NOCASE';
      break;
    case 'year':
      return `w.year IS NULL ASC, w.year ${dir}, w.title COLLATE NOCASE ASC`;
    case 'themes':
      expression = `(SELECT MIN(t.label) FROM work_themes wt JOIN themes t ON t.theme_id = wt.theme_id WHERE wt.nodus_id = w.nodus_id) COLLATE NOCASE`;
      break;
    case 'ideas':
      expression = '(SELECT COUNT(*) FROM idea_occurrences io WHERE io.nodus_id = w.nodus_id)';
      break;
    case 'light':
      expression = `CASE w.light_status WHEN 'done' THEN 3 WHEN 'pending' THEN 2 WHEN 'failed' THEN 1 ELSE 0 END`;
      break;
    case 'deep':
      expression = `CASE w.deep_status WHEN 'done' THEN 4 WHEN 'pending' THEN 3 WHEN 'skipped_no_text' THEN 2 WHEN 'failed' THEN 1 ELSE 0 END`;
      break;
    case 'summary':
      expression = `CASE w.summary_status WHEN 'done' THEN 4 WHEN 'pending' THEN 3 WHEN 'skipped_no_text' THEN 2 WHEN 'failed' THEN 1 ELSE 0 END`;
      break;
    case 'embeddings': {
      const config = currentEmbeddingConfig();
      params.sortEmbeddingProvider = config.provider;
      params.sortEmbeddingModel = config.model;
      expression = `(SELECT COUNT(*) FROM idea_occurrences io JOIN ideas i ON i.global_id = io.global_id WHERE io.nodus_id = w.nodus_id AND i.embedding IS NOT NULL AND i.embedding_provider = @sortEmbeddingProvider AND i.embedding_model = @sortEmbeddingModel)`;
      break;
    }
    case 'passages': {
      const config = currentEmbeddingConfig();
      params.sortPassageProvider = config.provider;
      params.sortPassageModel = config.model;
      expression = `(SELECT COUNT(*) FROM passages p WHERE p.nodus_id = w.nodus_id
        AND p.embedding IS NOT NULL AND p.embedding_provider = @sortPassageProvider AND p.embedding_model = @sortPassageModel
        AND ((w.resolved_text_hash IS NOT NULL AND p.content_hash = w.resolved_text_hash)
          OR (w.resolved_text_hash IS NULL AND (w.deep_hash IS NULL OR p.content_hash = w.deep_hash))))`;
      break;
    }
  }
  return `${expression} ${dir}, w.title COLLATE NOCASE ASC`;
}

export interface UpsertWorkInput {
  nodus_id: string;
  zotero_key: string;
  zotero_version: number | null;
  zotero_fingerprint?: string | null;
  title: string;
  zotero_title_markup?: string | null;
  authors: string[];
  creators?: WorkCreator[];
  year: number | null;
  item_type: string;
  doi: string | null;
  read_tag: boolean;
  zoteroTags: string[];
}

/** Insert a new work or update mutable Zotero-sourced fields of an existing one. */
export function upsertWork(input: UpsertWorkInput): void {
  const db = getDb();
  const existing = getWorkByZoteroKey(input.zotero_key);
  if (!existing) {
    db.prepare(
      `INSERT INTO works (nodus_id, zotero_key, zotero_version, zotero_fingerprint, title, zotero_title_markup, authors_json, creators_json, year, item_type, doi, read_tag, light_status)
       VALUES (@nodus_id, @zotero_key, @zotero_version, @zotero_fingerprint, @title, @zotero_title_markup, @authors_json, @creators_json, @year, @item_type, @doi, @read_tag, 'none')`
    ).run({
      ...input,
      zotero_fingerprint: input.zotero_fingerprint ?? null,
      zotero_title_markup: input.zotero_title_markup ?? null,
      authors_json: JSON.stringify(input.authors),
      creators_json: input.creators ? JSON.stringify(input.creators) : null,
      read_tag: input.read_tag ? 1 : 0,
    });
  } else {
    db.prepare(
      `UPDATE works SET zotero_version=@zotero_version, zotero_fingerprint=COALESCE(@zotero_fingerprint, zotero_fingerprint), title=@title, zotero_title_markup=@zotero_title_markup, authors_json=@authors_json,
       creators_json=COALESCE(@creators_json, creators_json),
       year=@year, item_type=@item_type, doi=@doi, read_tag=@read_tag, archived=0 WHERE zotero_key=@zotero_key`
    ).run({
      zotero_key: input.zotero_key,
      zotero_version: input.zotero_version,
      zotero_fingerprint: input.zotero_fingerprint ?? null,
      title: input.title,
      zotero_title_markup: input.zotero_title_markup ?? null,
      authors_json: JSON.stringify(input.authors),
      creators_json: input.creators ? JSON.stringify(input.creators) : null,
      year: input.year,
      item_type: input.item_type,
      doi: input.doi,
      read_tag: input.read_tag ? 1 : 0,
    });
  }
  const nodusId = getWorkByZoteroKey(input.zotero_key)!.nodus_id;
  replaceZoteroTags(nodusId, input.zoteroTags);
  recomputeDeepTrigger(nodusId);
  notifyAuthoredResearchSourceChanged();
}

/** Replace one work's Zotero-sourced tags without affecting user-managed themes. */
function replaceZoteroTags(nodusId: string, tags: string[]): void {
  const labels = Array.from(
    new Map(
      tags
        .filter((tag): tag is string => typeof tag === 'string')
        .map((tag) => tag.trim())
        .filter(Boolean)
        .map((tag) => [normalizeZoteroTag(tag), tag])
    ).values()
  );
  const db = getDb();
  const replace = db.transaction(() => {
    db.prepare('DELETE FROM work_zotero_tags WHERE nodus_id = ?').run(nodusId);
    const insertTag = db.prepare(
      'INSERT INTO zotero_tags (label, normalized_label) VALUES (?, ?) ON CONFLICT(normalized_label) DO NOTHING'
    );
    const findTag = db.prepare('SELECT tag_id FROM zotero_tags WHERE normalized_label = ?');
    const linkTag = db.prepare('INSERT INTO work_zotero_tags (nodus_id, tag_id) VALUES (?, ?)');
    for (const label of labels) {
      const normalizedLabel = normalizeZoteroTag(label);
      insertTag.run(label, normalizedLabel);
      const tag = findTag.get(normalizedLabel) as { tag_id: number };
      linkTag.run(nodusId, tag.tag_id);
    }
  });
  replace();
}

export function addAlias(nodusId: string, zoteroKey: string): void {
  getDb().prepare('INSERT OR IGNORE INTO work_aliases (nodus_id, zotero_key) VALUES (?, ?)').run(nodusId, zoteroKey);
}

export function setManualDeep(nodusId: string, value: boolean): void {
  getDb().prepare('UPDATE works SET manual_deep = ? WHERE nodus_id = ?').run(value ? 1 : 0, nodusId);
  recomputeDeepTrigger(nodusId);
}

export function setReadTag(nodusId: string, value: boolean): void {
  getDb().prepare('UPDATE works SET read_tag = ? WHERE nodus_id = ?').run(value ? 1 : 0, nodusId);
  recomputeDeepTrigger(nodusId);
}

/** Derive deep_trigger from the two triggers, and downgrade deep_status if no longer eligible. */
export function recomputeDeepTrigger(nodusId: string): DeepTrigger {
  const db = getDb();
  const w = db.prepare('SELECT read_tag, manual_deep, deep_status FROM works WHERE nodus_id = ?').get(nodusId) as
    | { read_tag: number; manual_deep: number; deep_status: string }
    | undefined;
  if (!w) return null;
  let trigger: DeepTrigger = null;
  if (w.read_tag && w.manual_deep) trigger = 'both';
  else if (w.read_tag) trigger = 'tag';
  else if (w.manual_deep) trigger = 'manual';
  db.prepare('UPDATE works SET deep_trigger = ? WHERE nodus_id = ?').run(trigger, nodusId);
  return trigger;
}

export function setLightPending(nodusId: string): void {
  getDb().prepare("UPDATE works SET light_status = 'pending' WHERE nodus_id = ?").run(nodusId);
}

export function setDeepPending(nodusId: string): void {
  // Once a deep result is committed, deep_status describes that readable result.
  // Live queue state describes its replacement attempt; do not hide the committed
  // graph or stale a valid profile merely because a retry was enqueued.
  //
  // deep_queued is what makes that separation survive a restart: the queue lives in
  // memory only, and resumePending() used to find abandoned work by deep_status alone.
  // Without this flag a rescan of an already-analysed work — every degraded work the
  // recovery pass enqueues — would be dropped silently when the app closes mid-run.
  // The queue clears it again from the job's outcome; see clearDeepQueued.
  getDb().prepare(`UPDATE works SET
    deep_status=CASE WHEN deep_hash IS NULL THEN 'pending' ELSE 'done' END,
    deep_error=NULL,
    deep_queued=1
    WHERE nodus_id=?`).run(nodusId);
}

/**
 * Drop the queued marker. The scan queue is its only caller and reaches it through
 * ScanQueue.syncDeepQueued, never from setDeepResult: an abandoned scan (stop button on
 * a running job) still writes its result long after a replacement job was queued for the
 * same work, and clearing on the write would strand that replacement — the very loss
 * this marker exists to prevent. Everything that ends a deep scan, including the upload
 * path that runs one without a queue item, goes through syncDeepQueued so the flag can
 * only ever mean "this queue has a live deep job for this work".
 */
export function clearDeepQueued(nodusId: string): void {
  getDb().prepare('UPDATE works SET deep_queued=0 WHERE nodus_id=?').run(nodusId);
}

export function setSummaryPending(nodusId: string): void {
  getDb().prepare("UPDATE works SET summary_status = 'pending', summary_error = NULL WHERE nodus_id = ?").run(nodusId);
}

export function setLightResult(nodusId: string, status: string, hash: string | null, notes?: string | null): void {
  const db = getDb();
  const previous = db.prepare('SELECT light_hash FROM works WHERE nodus_id = ?').get(nodusId) as { light_hash: string | null } | undefined;
  if (status === 'done' && previous?.light_hash !== hash) invalidateSummary(nodusId);
  db
    .prepare('UPDATE works SET light_status=?, light_at=?, light_hash=?, notes=COALESCE(?, notes) WHERE nodus_id=?')
    .run(status, new Date().toISOString(), hash, notes ?? null, nodusId);
  markLibraryAnalysisFreshness(db, nodusId, 'light', status === 'done' ? 'current' : status === 'failed' ? 'failed' : 'queued', hash);
}

export function setDeepResult(
  nodusId: string,
  status: string,
  hash: string | null,
  sourceType: string | null,
  notes?: string | null
): void {
  const db = getDb();
  const previous = db.prepare('SELECT deep_hash FROM works WHERE nodus_id = ?').get(nodusId) as { deep_hash: string | null } | undefined;
  if ((status === 'done' || status === 'skipped_no_text') && previous?.deep_hash !== hash) invalidateSummary(nodusId);
  const now = new Date().toISOString();
  if (status === 'failed') {
    // A failed replacement must not destroy or hide the last committed analysis.
    db.prepare(`UPDATE works SET
      deep_status=CASE WHEN deep_hash IS NULL THEN 'failed' ELSE 'done' END,
      deep_at=?, deep_error=? WHERE nodus_id=?`)
      .run(now, notes ?? 'El análisis profundo ha fallado.', nodusId);
  } else {
    // Assign nullable fields explicitly so a successful retry clears stale notes/errors.
    db.prepare(
      'UPDATE works SET deep_status=?, deep_at=?, deep_hash=?, source_type=?, notes=?, deep_error=NULL WHERE nodus_id=?'
    ).run(status, now, hash, sourceType, notes ?? null, nodusId);
  }
  markLibraryAnalysisFreshness(db, nodusId, 'deep', status === 'done' ? 'current' : status === 'failed' ? 'failed' : status === 'skipped_no_text' ? 'unavailable' : 'queued', hash);
}

/**
 * Clear a deep scan's Documentary Index failure once the Documentary Index has since
 * succeeded. A deep scan runs the Documentary Index step too; when that step fails, the
 * scan records `deep_error = 'documentary_…'` and freshness 'failed' while keeping the
 * committed analysis (deep_status stays 'done'). A later successful run goes through the
 * document-index queue, which never touched either, so the work stayed under "With
 * errors" with nothing wrong. Only a `documentary_` error on an intact analysis is
 * cleared, and only when a current profile was published after the failed attempt; any
 * other deep failure stays visible. Pass a work id after a job completes, or none to
 * sweep the vault. Returns how many works were cleared.
 */
export function clearResolvedDocumentaryDeepErrors(nodusId?: string): number {
  const db = getDb();
  const rows = db.prepare(`
    SELECT w.nodus_id, w.deep_hash FROM works w
     WHERE w.deep_status = 'done' AND w.deep_hash IS NOT NULL
       AND w.deep_error LIKE 'documentary\\_%' ESCAPE '\\'
       AND EXISTS (SELECT 1 FROM document_profile_state s
                    WHERE s.nodus_id = w.nodus_id AND s.status = 'current'
                      AND (w.deep_at IS NULL OR s.updated_at > w.deep_at))
       ${nodusId ? 'AND w.nodus_id = ?' : ''}
  `).all(...(nodusId ? [nodusId] : [])) as { nodus_id: string; deep_hash: string }[];
  const clear = db.prepare('UPDATE works SET deep_error = NULL WHERE nodus_id = ?');
  db.transaction(() => {
    for (const row of rows) {
      clear.run(row.nodus_id);
      markLibraryAnalysisFreshness(db, row.nodus_id, 'deep', 'current', row.deep_hash);
    }
  })();
  return rows.length;
}

/** Replace the locally-resolved text inventory without touching the last deep result. */
export function setResolvedTextState(nodusId: string, state: ResolvedTextState): void {
  const db = getDb();
  const insert = db.prepare(`
    INSERT INTO work_text_sources (
      nodus_id, source_ref, origin, source_type, zotero_library_id, attachment_key,
      display_name, content_hash, char_count, page_count, has_page_markers, ordinal, resolved_at
      , active
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(nodus_id, source_ref) DO UPDATE SET
      origin=excluded.origin, source_type=excluded.source_type,
      zotero_library_id=excluded.zotero_library_id, attachment_key=excluded.attachment_key,
      display_name=excluded.display_name, content_hash=excluded.content_hash,
      char_count=excluded.char_count, page_count=excluded.page_count,
      has_page_markers=excluded.has_page_markers, ordinal=excluded.ordinal,
      resolved_at=excluded.resolved_at, active=1
  `);
  db.transaction(() => {
    // Historical source refs stay addressable by old evidence while only the latest
    // inventory is marked active for readiness/hash calculations.
    db.prepare('UPDATE work_text_sources SET active=0 WHERE nodus_id=?').run(nodusId);
    for (const source of state.sources) {
      insert.run(
        nodusId,
        source.source_ref,
        source.origin,
        source.source_type,
        source.zotero_library_id,
        source.attachment_key,
        source.display_name,
        source.content_hash,
        source.char_count,
        source.page_count,
        source.has_page_markers,
        source.ordinal,
        state.resolvedAt,
        1,
      );
    }
    db.prepare(`
      UPDATE works SET
        resolved_source_type=?, resolved_text_hash=?, resolved_text_chars=?,
        resolved_text_source_count=?, resolved_has_page_markers=?, text_block_reason=?,
        text_resolved_at=?, resolved_text_notes=?
      WHERE nodus_id=?
    `).run(
      state.sourceType,
      state.textHash,
      state.textChars,
      state.sourceCount,
      state.hasPageMarkers ? 1 : 0,
      state.blockReason,
      state.resolvedAt,
      state.notes,
      nodusId,
    );
  })();
}

export function listWorkTextSources(nodusId: string): WorkTextSource[] {
  return getDb().prepare(
    'SELECT * FROM work_text_sources WHERE nodus_id=? AND active=1 ORDER BY ordinal, source_ref'
  ).all(nodusId) as WorkTextSource[];
}

export function setSummaryResult(
  nodusId: string,
  status: SummaryStatus,
  hash: string | null,
  error?: string | null,
): void {
  const db = getDb();
  db
    .prepare('UPDATE works SET summary_status = ?, summary_at = ?, summary_hash = ?, summary_error = ? WHERE nodus_id = ?')
    .run(status, new Date().toISOString(), hash, status === 'failed' ? error ?? 'La generación del resumen ha fallado.' : null, nodusId);
  markLibraryAnalysisFreshness(db, nodusId, 'summary', status === 'done' ? 'current' : status === 'failed' ? 'failed' : status === 'skipped_no_text' ? 'unavailable' : 'queued', hash);
}

function markLibraryAnalysisFreshness(
  db: ReturnType<typeof getDb>,
  nodusId: string,
  component: 'light' | 'deep' | 'summary',
  freshness: 'queued' | 'current' | 'failed' | 'unavailable',
  fingerprint: string | null,
): void {
  db.prepare(`
    INSERT INTO library_analysis_freshness (work_id, component, freshness, fingerprint, reason, updated_at)
    VALUES (?, ?, ?, ?, NULL, ?)
    ON CONFLICT(work_id, component) DO UPDATE SET
      freshness=excluded.freshness, fingerprint=excluded.fingerprint, reason=NULL, updated_at=excluded.updated_at
  `).run(nodusId, component, freshness, fingerprint, new Date().toISOString());
}

/** Underlying light/deep material changed, so its orientation summary is no longer current. */
export function invalidateSummary(nodusId: string): void {
  getDb()
    .prepare("UPDATE works SET summary_status = 'none', summary_at = NULL, summary_hash = NULL, summary_error = NULL WHERE nodus_id = ?")
    .run(nodusId);
}

export function setArchived(nodusId: string, value: boolean): void {
  // Archiving hides the work from every resume query, so a marker left behind would be
  // dormant until the work came back and then fire a scan nobody asked for.
  getDb().prepare('UPDATE works SET archived = ?, deep_queued = CASE WHEN ? THEN 0 ELSE deep_queued END WHERE nodus_id = ?')
    .run(value ? 1 : 0, value ? 1 : 0, nodusId);
}

/** Works eligible for deep scan: tag OR manual, not archived. */
export function deepEligible(): Work[] {
  return getDb()
    .prepare('SELECT * FROM works WHERE archived = 0 AND (read_tag = 1 OR manual_deep = 1)')
    .all() as Work[];
}

export function pendingLight(): Work[] {
  return getDb()
    .prepare("SELECT * FROM works WHERE archived = 0 AND light_status = 'pending'")
    .all() as Work[];
}
