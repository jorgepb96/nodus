import { deepResearchReportInput, renderProfessionalReportHtml } from '../core/generated/deepResearchReport.mjs';
import { securityHeaders } from '../http.mjs';
// The read surface: everything a mobile client or a desktop replica asks the server for.
//
// Shape rule: every list answers with the same envelope the desktop MCP `page()` helper
// produces (electron/mcp/tools.ts:554) — same keys, same `hasMore` arithmetic — so the two
// surfaces cannot answer the same question differently. scripts/test-nodus-server-api.mjs
// asserts that equivalence tool by tool.
//
// Caching rule: a published snapshot is immutable until the next publication, so every
// response carries a weak ETag derived from the space revision and the request. On a phone
// that turns most list refreshes into a 304 with no body at all.

import { counts, page, readLimit, readOffset, rows, visibleEdges, worksById } from '../core/snapshot.mjs';
import { getDebate, listDebates } from '../core/debates.mjs';
import { lexicalSearch, matchesRow } from '../core/search.mjs';
import { editorReferenceCatalog } from '../core/generated/editorReferences.mjs';
import {
  workspaceArgumentRoutes,
  workspaceAuthorDossier,
  workspaceAuthorPage,
  workspaceIdeaPage,
  workspaceSynthesisMatrix,
} from '../core/academicWorkspace.mjs';

const SNIPPET_CHARS = 240;
/** How far a subgraph walk may reach, and how many ideas it may carry back. */
const MAX_GRAPH_DEPTH = 3;
const MAX_GRAPH_IDEAS = 200;
const MAX_FULL_GRAPH_IDEAS = 2_000;
const ACADEMIC_WORKSPACE_TABLES = [
  'works', 'authors', 'work_authors', 'zotero_tags', 'work_zotero_tags', 'themes',
  'ideas', 'idea_occurrences', 'idea_theme_links', 'evidence', 'edges', 'edge_feedback',
  'author_relations', 'author_dossier_synthesis', 'synthesis_matrix_cell',
];

/**
 * Map images travel through the content-addressed asset channel rather than in the
 * snapshot row. Keep the reference next to the map in the Web response, just as the
 * Desktop map list keeps `imageId` next to its canvas. The key is the image_id (the
 * only key column declared by ASSET_SOURCES for world_map_image).
 */
function worldMapAssetRefs(snapshot) {
  return new Map(
    (Array.isArray(snapshot?.assets) ? snapshot.assets : [])
      .filter((asset) => asset?.kind === 'world_map_image' && Array.isArray(asset.key))
      .map((asset) => [String(asset.key[0] ?? ''), asset])
      .filter(([key]) => key),
  );
}

function publishedWorldMaps(snapshot) {
  const assets = worldMapAssetRefs(snapshot);
  return rows(snapshot, 'world_maps').map((map) => ({
    ...map,
    image: map.image_id ? assets.get(String(map.image_id)) ?? null : null,
  }));
}

function worldImageAssetRefs(snapshot) {
  return new Map(
    (Array.isArray(snapshot?.assets) ? snapshot.assets : [])
      .filter((asset) => asset?.kind === 'world_image' && Array.isArray(asset.key))
      .map((asset) => [String(asset.key[0] ?? ''), asset])
      .filter(([key]) => key),
  );
}

function publishedWorldImages(snapshot, entityKind, entityId) {
  const assets = worldImageAssetRefs(snapshot);
  return rows(snapshot, 'world_images')
    .filter((image) => String(image.entity_kind) === String(entityKind) && String(image.entity_id) === String(entityId))
    .sort((a, b) => (Number(a.sort_order) || 0) - (Number(b.sort_order) || 0))
    .map((image) => ({ ...image, asset: assets.get(String(image.image_id)) ?? null }));
}

function publishedPersons(snapshot) {
  const portraits = new Map(
    (Array.isArray(snapshot?.assets) ? snapshot.assets : [])
      .filter((asset) => asset?.kind === 'person_portrait' && Array.isArray(asset.key))
      .map((asset) => [String(asset.key[0] ?? ''), asset])
      .filter(([key]) => key),
  );
  const profiles = new Map(rows(snapshot, 'character_profiles').map((profile) => [String(profile.person_id), profile]));
  return rows(snapshot, 'persons').map((person) => ({
    ...person,
    ...(profiles.get(String(person.person_id)) ?? {}),
    portrait: portraits.get(String(person.person_id)) ?? null,
  }));
}

/** Timeline rows keep the same public event fields as the snapshot and add only the
 * participant/place labels Desktop needs to render its filters and chips. */
function publishedEvents(snapshot) {
  const people = new Map(publishedPersons(snapshot).map((person) => [String(person.person_id), person]));
  const places = new Map(rows(snapshot, 'places').map((place) => [String(place.place_id), place]));
  const participants = rows(snapshot, 'event_participants');
  const worldDates = new Map(rows(snapshot, 'event_world_dates').map((date) => [String(date.event_id), date]));
  return rows(snapshot, 'events').map((event) => {
    const eventId = String(event.event_id);
    const place = event.place_id == null ? null : places.get(String(event.place_id));
    const worldDate = worldDates.get(eventId);
    return {
      ...event,
      // Worldbuilding events are ordered by the invented calendar. Keep the native
      // fields as well as the joined date so the shared timeline never falls back to
      // insertion order when `date_sort` is intentionally empty.
      world_year: worldDate?.world_year ?? event.world_year ?? null,
      world_order: worldDate?.world_order ?? event.world_order ?? 0,
      worldYear: worldDate?.world_year ?? event.worldYear ?? event.world_year ?? null,
      worldOrder: worldDate?.world_order ?? event.worldOrder ?? event.world_order ?? 0,
      // Keep a sortable synthetic key for the browser while retaining the native
      // integer fields above. `world_order` is the canonical tie-break in the Desktop
      // calendar; it is not a date string and must not be dropped into `date_sort`.
      world_year_sort: worldDate?.world_year ?? event.world_year ?? null,
      date_sort: event.date_sort ?? event.start_date ?? event.date ?? null,
      place_name: place?.name ?? null,
      participants: participants.filter((entry) => String(entry.event_id) === eventId).map((entry) => ({
        personId: String(entry.person_id),
        displayName: String(people.get(String(entry.person_id))?.display_name ?? entry.person_id),
        role: String(entry.role ?? 'other'),
      })),
    };
  });
}

function publishedWorldThreads(snapshot) {
  const people = new Map(publishedPersons(snapshot).map((person) => [String(person.person_id), person]));
  const groups = new Map(rows(snapshot, 'world_groups').map((group) => [String(group.group_id), group]));
  const scenes = new Map(rows(snapshot, 'world_scenes').map((scene) => [String(scene.scene_id), scene]));
  const parties = rows(snapshot, 'thread_parties');
  const beats = rows(snapshot, 'world_beats');
  const partyName = (party) => party.party_kind === 'character'
    ? people.get(String(party.party_id))?.display_name ?? '—'
    : groups.get(String(party.party_id))?.name ?? '—';
  return rows(snapshot, 'world_threads').map((thread) => ({
    ...thread,
    type: thread.kind ?? thread.type ?? 'arc',
    description: thread.pitch ?? thread.description ?? null,
    parties: parties.filter((party) => String(party.thread_id) === String(thread.thread_id)).map((party) => ({
      threadId: String(thread.thread_id), partyKind: party.party_kind, partyId: String(party.party_id),
      partyName: partyName(party), side: party.side ?? 'caught',
    })),
    beats: beats.filter((beat) => String(beat.thread_id) === String(thread.thread_id)).map((beat) => ({
      ...beat, sceneTitle: scenes.get(String(beat.scene_id))?.title ?? '—',
      narrativeOrder: scenes.get(String(beat.scene_id))?.narrative_order ?? beat.narrative_order ?? 0,
    })),
  }));
}

function ruleHealthFor(beats, childBeats) {
  const tests = beats.filter((beat) => ['obeys', 'bends', 'breaks', 'establishes'].includes(String(beat.mark))).length;
  if (beats.some((beat) => beat.mark === 'breaks' && (beat.paid === 0 || beat.paid === false))) return 'unpaid';
  if (tests === 0) return 'untested';
  if (childBeats.length > tests) return 'overrun';
  return 'working';
}

function publishedWorldRules(snapshot) {
  const beats = rows(snapshot, 'world_beats').filter((beat) => beat.thread_kind === 'rule');
  return rows(snapshot, 'world_rules').map((rule) => {
    const own = beats.filter((beat) => String(beat.thread_id) === String(rule.rule_id));
    const childIds = new Set(rows(snapshot, 'world_rules').filter((child) => String(child.parent_rule_id ?? '') === String(rule.rule_id)).map((child) => String(child.rule_id)));
    const childBeats = beats.filter((beat) => childIds.has(String(beat.thread_id)));
    const health = ruleHealthFor(own, childBeats);
    return { ...rule, description: rule.statement ?? rule.description ?? null, category: rule.hardness ?? rule.category ?? null, health, rule_health: health };
  });
}

function publishedWorldQuestions(snapshot) {
  const people = new Map(publishedPersons(snapshot).map((person) => [String(person.person_id), person]));
  const groups = new Map(rows(snapshot, 'world_groups').map((group) => [String(group.group_id), group]));
  const places = new Map(rows(snapshot, 'places').map((place) => [String(place.place_id), place]));
  const scenes = rows(snapshot, 'world_scenes');
  const rules = new Map(rows(snapshot, 'world_rules').map((rule) => [String(rule.rule_id), rule]));
  const threads = new Map(rows(snapshot, 'world_threads').map((thread) => [String(thread.thread_id), thread]));
  const maps = new Map(rows(snapshot, 'world_maps').map((map) => [String(map.map_id), map]));
  const articles = new Map(rows(snapshot, 'world_articles').map((article) => [String(article.article_id), article]));
  const cast = rows(snapshot, 'scene_characters');
  const links = rows(snapshot, 'world_links');
  const options = rows(snapshot, 'world_question_options');
  const titleFor = (kind, id) => kind === 'character' ? people.get(String(id))?.display_name
    : kind === 'group' ? groups.get(String(id))?.name
      : kind === 'place' ? places.get(String(id))?.name
        : kind === 'scene' ? scenes.find((scene) => String(scene.scene_id) === String(id))?.title
          : kind === 'rule' ? rules.get(String(id))?.title
            : kind === 'conflict' || kind === 'arc' ? threads.get(String(id))?.title
              : kind === 'map' ? maps.get(String(id))?.name
                : articles.get(String(id))?.title;
  const sceneLeansOn = (scene, key) => [
    `scene:${scene.scene_id}`,
    scene.place_id == null ? null : `place:${scene.place_id}`,
    ...cast.filter((entry) => String(entry.scene_id) === String(scene.scene_id)).map((entry) => `character:${entry.person_id}`),
    ...links.filter((entry) => String(entry.source_kind) === 'scene' && String(entry.source_id) === String(scene.scene_id)).map((entry) => entry.target_key),
  ].filter(Boolean).includes(key);
  const leverage = new Map();
  for (const link of links) leverage.set(String(link.target_key), (leverage.get(String(link.target_key)) ?? 0) + 1);
  return rows(snapshot, 'world_questions').map((question) => {
    const anchor = question.anchor_kind && question.anchor_id && titleFor(question.anchor_kind, question.anchor_id)
      ? { kind: question.anchor_kind, id: String(question.anchor_id), title: titleFor(question.anchor_kind, question.anchor_id) } : null;
    const anchorKey = anchor ? `${anchor.kind}:${anchor.id}` : null;
    const blockedScene = anchor ? scenes.filter((scene) => scene.status !== 'written' && sceneLeansOn(scene, anchorKey)).sort((a, b) => (Number(a.narrative_order) || 0) - (Number(b.narrative_order) || 0))[0] : null;
    const urgency = question.blocking === 1 || question.blocking === true ? 'blocking' : blockedScene ? 'soon' : 'later';
    return {
      ...question,
      title: question.question ?? question.title ?? 'Pregunta',
      description: question.evidence ?? question.description ?? null,
      priority: urgency,
      origin: question.origin === 'placeholder' ? 'placeholder' : 'author',
      blocking: Boolean(question.blocking), leverage: anchorKey ? (leverage.get(anchorKey) ?? 0) : 0,
      anchor, anchorField: question.anchor_field ?? question.anchorField ?? null,
      blockedScene: blockedScene ? { sceneId: String(blockedScene.scene_id), title: blockedScene.title, narrativeOrder: blockedScene.narrative_order } : null,
      urgency,
      options: options.filter((option) => String(option.question_id) === String(question.question_id)).map((option) => ({
        ...option, optionId: String(option.option_id), questionId: String(option.question_id), text: option.text ?? '', applyMode: option.apply_mode ?? 'none', appliedAt: option.applied_at ?? null,
      })),
    };
  }).sort((a, b) => ({ blocking: 0, soon: 1, later: 2 }[a.urgency] - ({ blocking: 0, soon: 1, later: 2 }[b.urgency]) || String(a.question).localeCompare(String(b.question))));
}

function publishedConflictBoard(snapshot, threads = publishedWorldThreads(snapshot)) {
  const people = publishedPersons(snapshot);
  const sceneCounts = new Map();
  for (const appearance of rows(snapshot, 'scene_characters')) sceneCounts.set(String(appearance.person_id), (sceneCounts.get(String(appearance.person_id)) ?? 0) + 1);
  const cast = people.map((person) => {
    const profile = rows(snapshot, 'character_profiles').find((entry) => String(entry.person_id) === String(person.person_id));
    return { personId: String(person.person_id), displayName: String(person.display_name ?? person.person_id), narrativeRole: profile?.narrative_role ?? person.narrative_role ?? null, arcWant: profile?.arc_want ?? null, arcNeed: profile?.arc_need ?? null, accent: profile?.accent ?? null, sceneCount: sceneCounts.get(String(person.person_id)) ?? 0 };
  });
  const columns = threads.filter((thread) => thread.kind === 'conflict' && thread.status !== 'archived').sort((a, b) => String(a.status).localeCompare(String(b.status)) || String(a.title).localeCompare(String(b.title)));
  const boardRows = cast.map((person) => {
    const cells = columns.map((thread) => thread.parties.find((party) => party.partyKind === 'character' && party.partyId === person.personId)?.side ?? null);
    return { person, cells, stakes: cells.filter(Boolean).length };
  }).sort((a, b) => a.stakes - b.stakes || b.person.sceneCount - a.person.sceneCount || a.person.displayName.localeCompare(b.person.displayName));
  const affiliations = rows(snapshot, 'character_affiliations').map((affiliation) => ({
    personId: String(affiliation.person_id), personName: people.find((person) => String(person.person_id) === String(affiliation.person_id))?.display_name ?? '—',
    groupId: String(affiliation.group_id), groupName: rows(snapshot, 'world_groups').find((group) => String(group.group_id) === String(affiliation.group_id))?.name ?? '—',
  }));
  return { cast, threads: columns, columns, rows: boardRows, affiliations };
}

function publishedContinuityFindings(snapshot) {
  const threads = publishedWorldThreads(snapshot);
  const findings = [];
  const add = (checkId, severity, headline, subjects, detail) => findings.push({
    fingerprint: `${checkId}:${subjects.map((subject) => `${subject.kind}:${subject.id}`).join('|')}`,
    checkId,
    family: checkId.startsWith('rule.') ? 'rule' : 'thread',
    severity,
    // Keep the legacy prose fields for older clients, but expose a stable key and
    // user-content parameters so newer clients can translate only the chrome.
    headline,
    headlineKey: `continuity.${checkId}.headline`,
    headlineParams: { count: subjects.length, subjects: subjects.map((subject) => String(subject.title ?? subject.id)) },
    detail: detail ?? null,
    detailKey: detail ? `continuity.${checkId}.detail` : null,
    detailParams: { count: subjects.length, subjects: subjects.map((subject) => String(subject.title ?? subject.id)) },
    subjects,
  });
  const beats = rows(snapshot, 'world_beats');
  for (const thread of threads) {
    if (thread.status === 'open' && !beats.some((beat) => String(beat.thread_id) === String(thread.thread_id))) add('thread.noScenes', 'warning', `«${thread.title}» no se mueve en ninguna escena`, [{ kind: 'thread', id: String(thread.thread_id), title: thread.title }], 'Está declarado, pero ninguna escena lo hace avanzar.');
    if (thread.kind === 'conflict' && thread.status === 'resolved') {
      const mine = beats.filter((beat) => String(beat.thread_id) === String(thread.thread_id));
      if (!mine.some((beat) => ['raise', 'breaks'].includes(String(beat.mark)))) add('thread.resolvedFlat', 'warning', `«${thread.title}» se cierra sin haber subido nunca`, [{ kind: 'thread', id: String(thread.thread_id), title: thread.title }], 'O la resolución no está ganada, o los latidos no se registraron.');
    }
  }

  // These checks use only canonical snapshot fields. Unknown dates stay silent (or are
  // reported as a gap) so a reader never receives a contradiction manufactured from a
  // missing calendar value.
  const scenes = rows(snapshot, 'world_scenes');
  const undated = scenes.filter((scene) => scene.world_day == null);
  if (undated.length) add('coverage.undatedScenes', 'gap', `${undated.length} escenas no tienen día del mundo`, undated.slice(0, 8).map((scene) => ({ kind: 'scene', id: String(scene.scene_id), title: String(scene.title ?? scene.scene_id) })), 'Sin día, las comprobaciones de presencia, viajes y secretos no pueden decir nada sobre ellas.');

  const people = new Map(publishedPersons(snapshot).map((person) => [String(person.person_id), person]));
  const worldDates = new Map(rows(snapshot, 'event_world_dates').map((date) => [String(date.event_id), date]));
  const eventByPerson = rows(snapshot, 'event_participants');
  const sceneCast = rows(snapshot, 'scene_characters');
  for (const person of people.values()) {
    const profile = rows(snapshot, 'character_profiles').find((entry) => String(entry.person_id) === String(person.person_id)) ?? person;
    const birth = Number(profile.birth_year_sort);
    const death = Number(profile.death_year_sort);
    const moments = [
      ...scenes.filter((scene) => scene.world_year != null && sceneCast.some((entry) => String(entry.scene_id) === String(scene.scene_id) && String(entry.person_id) === String(person.person_id))).map((scene) => ({ year: Number(scene.world_year), kind: 'scene', id: String(scene.scene_id), title: String(scene.title ?? scene.scene_id) })),
      ...eventByPerson.filter((entry) => String(entry.person_id) === String(person.person_id) && worldDates.get(String(entry.event_id))?.world_year != null).map((entry) => ({ year: Number(worldDates.get(String(entry.event_id)).world_year), kind: 'event', id: String(entry.event_id), title: String(entry.event_id) })),
    ];
    for (const moment of moments) {
      const checkId = Number.isFinite(death) && moment.year > death ? 'lifespan.afterDeath' : Number.isFinite(birth) && moment.year < birth ? 'lifespan.beforeBirth' : null;
      if (!checkId) continue;
      add(checkId, 'contradiction', checkId === 'lifespan.afterDeath' ? `${person.display_name} actúa después de morir` : `${person.display_name} aparece antes de nacer`, [{ kind: 'character', id: String(person.person_id), title: String(person.display_name ?? person.person_id) }, { kind: moment.kind, id: moment.id, title: moment.title }], `La fecha del mundo es ${moment.year}; la ficha sitúa el límite vital en ${checkId === 'lifespan.afterDeath' ? death : birth}.`);
    }
  }

  for (const affiliation of rows(snapshot, 'character_affiliations')) {
    if (affiliation.from_world_day == null || affiliation.to_world_day == null || Number(affiliation.to_world_day) >= Number(affiliation.from_world_day)) continue;
    const person = people.get(String(affiliation.person_id));
    const group = rows(snapshot, 'world_groups').find((entry) => String(entry.group_id) === String(affiliation.group_id));
    add('affiliation.inverted', 'contradiction', `${person?.display_name ?? affiliation.person_id} deja ${group?.name ?? affiliation.group_id} antes de entrar`, [{ kind: 'character', id: String(affiliation.person_id), title: String(person?.display_name ?? affiliation.person_id) }, { kind: 'group', id: String(affiliation.group_id), title: String(group?.name ?? affiliation.group_id) }], 'La pertenencia termina antes de empezar.');
  }

  const places = rows(snapshot, 'places');
  const placeById = new Map(places.map((place) => [String(place.place_id), place]));
  const reportedCycles = new Set();
  for (const place of places) {
    const path = []; const seen = new Set(); let current = String(place.place_id);
    while (current && placeById.has(current) && !seen.has(current)) { seen.add(current); path.push(current); current = String(placeById.get(current).parent_id ?? ''); }
    if (!current || !seen.has(current)) continue;
    const cycle = path.slice(path.indexOf(current)).sort(); const key = cycle.join('|');
    if (reportedCycles.has(key)) continue;
    reportedCycles.add(key);
    add('containment.cycle', 'contradiction', `${placeById.get(current)?.name ?? current} acaba conteniéndose a sí mismo`, cycle.map((id) => ({ kind: 'place', id, title: String(placeById.get(id)?.name ?? id) })), 'La jerarquía de lugares forma un bucle.');
  }
  return findings;
}

/**
 * The Desktop review surface is fed by two public authoring tables: questions and
 * flashcards.  The scheduling tables (`study_srs_state` and `study_reviews`) are
 * deliberately private, so this projection carries the card/question content only and
 * never manufactures a due date or mastery value for a reader.
 */
function publishedStudyReviewItems(snapshot) {
  const decode = (value, fallback) => {
    const parsed = parsedJson(value, fallback);
    return parsed == null ? fallback : parsed;
  };
  const questions = rows(snapshot, 'study_questions')
    .filter((row) => row.deleted_at == null)
    .map((row) => ({
      ...row,
      item_kind: 'question',
      review_key: `question:${row.id}`,
      answer: decode(row.answer_json, row.answer ? { text: row.answer } : { text: '' }),
      options: decode(row.options_json, []),
      tags: decode(row.tags_json, []),
      source: decode(row.source_json, row.source_title ? { title: row.source_title, excerpt: row.source_excerpt ?? '' } : { title: '', excerpt: '' }),
    }));
  const flashcards = rows(snapshot, 'study_flashcards')
    .filter((row) => row.deleted_at == null && row.archived_at == null)
    .map((row) => ({
      ...row,
      item_kind: 'flashcard',
      review_key: `flashcard:${row.id}`,
      tags: decode(row.tags_json, []),
      // Explicitly tell the client why the Desktop's SRS pills are not shown here.
      review_state: 'private',
    }));
  return [...questions, ...flashcards];
}

function firstLine(value) {
  const clean = String(value ?? '').replace(/\s+/g, ' ').trim();
  return clean ? clean.split(/\n|(?<=[.!?])\s+/)[0] : null;
}

/** The Desktop encyclopedia is one read-time index over the public world tables.
 * Keep it derived: publishing must never duplicate an editable article or expose a
 * private proposal table. The key is kind:id, because ids are only unique per table. */
function publishedWorldEntries(snapshot) {
  const names = new Map();
  for (const row of rows(snapshot, 'person_names')) {
    const id = String(row.person_id ?? '');
    if (id) names.set(id, [...(names.get(id) ?? []), String(row.name ?? '')].filter(Boolean));
  }
  const entries = [];
  const push = (kind, id, title, extra = {}) => {
    const safeId = String(id ?? '');
    if (!safeId || !String(title ?? '').trim()) return;
    entries.push({ kind, id: safeId, key: `${kind}:${safeId}`, title: String(title), title_key: String(title).toLocaleLowerCase(), aliases: [], editable: kind === 'article', spoiler: false, ...extra });
  };
  for (const row of rows(snapshot, 'world_articles')) push('article', row.article_id, row.title, {
    aliases: String(row.aka ?? '').split(',').map((name) => name.trim()).filter(Boolean),
    summary: firstLine(row.summary ?? row.body), category: row.category ?? null,
    stub: !String(row.body ?? '').trim() && !String(row.summary ?? '').trim(), spoiler: row.spoiler === 1, updatedAt: row.updated_at,
  });
  for (const row of rows(snapshot, 'persons')) {
    const prose = rows(snapshot, 'character_profiles').find((profile) => String(profile.person_id) === String(row.person_id));
    const body = prose?.backstory || prose?.appearance || prose?.personality || row.biography || row.notes;
    push('character', row.person_id, row.display_name, { aliases: (names.get(String(row.person_id)) ?? []).filter((name) => name !== row.display_name), summary: firstLine(body) || prose?.species || null, category: prose?.species || prose?.narrative_role || null, stub: !String(body ?? '').trim(), updatedAt: row.updated_at });
  }
  for (const row of rows(snapshot, 'places')) {
    const profile = rows(snapshot, 'place_profiles').find((entry) => String(entry.place_id) === String(row.place_id));
    const body = profile?.appearance || profile?.atmosphere || profile?.history || row.notes;
    push('place', row.place_id, row.name, { summary: firstLine(body), category: row.kind ?? null, stub: !String(body ?? '').trim(), updatedAt: row.updated_at });
  }
  for (const row of rows(snapshot, 'world_groups')) push('group', row.group_id, row.name, { summary: firstLine(row.summary || row.description), category: row.kind ?? null, stub: !String(row.summary || row.description || '').trim(), updatedAt: row.updated_at });
  for (const row of rows(snapshot, 'world_scenes')) push('scene', row.scene_id, row.title, { summary: firstLine(row.summary), category: row.status ?? null, stub: !String(row.summary ?? '').trim(), updatedAt: row.updated_at });
  for (const row of rows(snapshot, 'world_rules')) push('rule', row.rule_id, row.title, { summary: firstLine(row.statement), category: row.hardness ?? null, stub: !String(row.statement ?? '').trim(), updatedAt: row.updated_at });
  for (const row of rows(snapshot, 'world_threads').filter((entry) => entry.kind === 'conflict')) push('conflict', row.thread_id, row.title, { summary: firstLine(row.pitch || row.stakes), category: row.status ?? null, stub: !String(row.pitch || row.stakes || '').trim(), updatedAt: row.updated_at });
  for (const row of rows(snapshot, 'world_maps')) push('map', row.map_id, row.name, { summary: firstLine(row.notes), category: row.kind ?? null, stub: !String(row.notes ?? '').trim(), updatedAt: row.updated_at });
  return entries.sort((a, b) => String(a.updatedAt ?? '').localeCompare(String(b.updatedAt ?? '')));
}

function academicWorkspace(snapshot) {
  return Object.fromEntries(ACADEMIC_WORKSPACE_TABLES.map((table) => [table, rows(snapshot, table)]));
}

/**
 * The Desktop study library is one catalogue: authored notes (`study_docs`) and
 * imported study materials (`study_materials`) appear beside each other.  The
 * first Server implementation exposed only the latter because it mirrored the
 * SQLite table name instead of the user-facing workspace.  Keep the two source
 * kinds explicit so a detail deep-link can still choose the right published
 * record without leaking private/audio tables.
 */
function publishedStudyLibraryRows(snapshot) {
  const materials = rows(snapshot, 'study_materials').map((row) => ({
    ...row,
    source_kind: 'material',
  }));
  const documents = rows(snapshot, 'study_docs').map((row) => ({
    ...row,
    source_kind: 'document',
    // The list uses the same vocabulary as StudyMaterialsView.  These are
    // projections, not invented content; the values come from the published
    // document row itself.
    extension: row.extension ?? 'document',
  }));
  return [...materials, ...documents];
}

/** Transcript rows can carry the local media foreign key.  It is useful only
 * while joining the Desktop database and must not be sent to a reader; the
 * public interview id is added by the snapshot builder when that join is safe.
 */
function publishedTestimonyTranscripts(snapshot) {
  return rows(snapshot, 'testimony_transcripts').map(({ media_id: _mediaId, ...transcript }) => testimonySafeRow(transcript));
}

/** Defense in depth for snapshots produced before the testimony projection was
 * added. Relation ids needed for grouping remain, while participant/speaker
 * identity columns are removed even if a legacy publisher copied them. */
function testimonySafeRow(row) {
  return Object.fromEntries(Object.entries(row).filter(([key]) => {
    if (key === 'interview_id' || key === 'transcript_id' || key === 'annotation_id' || key === 'contrast_id' || key === 'code_id') return true;
    return !/(?:participant|speaker|narrator|informant|respondent|person|identity|contact)/i.test(key);
  }));
}
function publishedTestimonyInterviews(snapshot) {
  return rows(snapshot, 'testimony_interviews').map(testimonySafeRow);
}
function publishedTestimonyAnnotations(snapshot) {
  // annotations: rows(snapshot, 'testimony_annotations') are always reduced to the
  // published textual contract before a dossier or search response is built.
  const annotations = rows(snapshot, 'testimony_annotations').map(testimonySafeRow);
  return annotations;
}
function publishedTestimonyFacets(snapshot) {
  const interviews = publishedTestimonyInterviews(snapshot);
  const unique = (key) => [...new Set(interviews.map((row) => String(row[key] ?? '').trim()).filter(Boolean))].sort();
  return {
    collections: unique('collection_label'),
    languages: unique('language'),
    workflowStatuses: unique('workflow_status'),
    savedViews: ['all', 'transcribe', 'review', 'published'],
  };
}

// Primary Sources derived views are deliberately rebuilt from the published
// snapshot instead of shipping a second, mutable index. This keeps Web and
// Desktop on the same evidence-first hierarchy while the snapshot remains the
// only publication boundary.
function primarySourceEvidence(snapshot) {
  const excerpts = new Map(rows(snapshot, 'archive_excerpts').map((row) => [String(row.excerpt_id), row]));
  const units = new Map(rows(snapshot, 'archive_description_units').map((row) => [String(row.unit_id), row]));
  const repositories = new Map(rows(snapshot, 'archive_repositories').map((row) => [String(row.repository_id), row]));
  const items = new Map(rows(snapshot, 'archive_items').map((row) => [String(row.item_id), row]));
  const itemRepository = new Map();
  for (const link of rows(snapshot, 'archive_item_units')) {
    const unit = units.get(String(link.unit_id));
    if (unit?.repository_id != null) itemRepository.set(String(link.item_id), repositories.get(String(unit.repository_id)));
  }
  return rows(snapshot, 'record_evidence').filter((row) => String(row.source_kind ?? '') === 'archive').flatMap((row) => {
    const itemId = String(row.nodus_id ?? '');
    const item = items.get(itemId);
    const excerpt = row.excerpt_id == null ? null : excerpts.get(String(row.excerpt_id));
    const quote = String(excerpt?.quoted_text ?? row.quote ?? '').trim();
    if (!item || !excerpt || !quote) return [];
    const repository = itemRepository.get(itemId);
    return [{
      evidenceId: String(row.id ?? row.evidence_id ?? `${itemId}:${excerpt.excerpt_id}`),
      targetKind: String(row.target_kind ?? 'other'), targetId: String(row.target_id ?? ''),
      itemId, sourceTitle: String(item.title ?? itemId),
      referenceCode: units.get(String(rows(snapshot, 'archive_item_units').find((link) => String(link.item_id) === itemId)?.unit_id ?? ''))?.reference_code ?? null,
      repositoryName: repository?.name ?? null, excerptId: String(excerpt.excerpt_id),
      locator: String(excerpt.locator_display ?? ''), quote,
      role: String(row.evidence_role ?? 'supports'), certainty: row.certainty == null ? null : Number(row.certainty),
      reviewStatus: String(row.review_status ?? excerpt.review_status ?? 'unreviewed'),
    }];
  });
}

function primarySourceOptions(values) {
  return [...new Map(values.filter(Boolean).map((value) => [String(value), String(value)])).entries()]
    .map(([id, label]) => ({ id, label })).sort((a, b) => a.label.localeCompare(b.label));
}

function primarySourceSourceOptions(evidence) {
  return [...new Map(evidence.map((entry) => [String(entry.itemId), String(entry.sourceTitle)])).entries()]
    .map(([id, label]) => ({ id, label })).sort((a, b) => a.label.localeCompare(b.label));
}

function primarySourceTimeline(snapshot) {
  const evidence = primarySourceEvidence(snapshot);
  const people = new Map(publishedPersons(snapshot).map((row) => [String(row.person_id), row]));
  const places = new Map(rows(snapshot, 'places').map((row) => [String(row.place_id), row]));
  const participants = rows(snapshot, 'event_participants');
  const events = rows(snapshot, 'events').map((event) => {
    const id = String(event.event_id);
    const traces = evidence.filter((entry) => entry.targetKind === 'event' && entry.targetId === id);
    const eventPeople = participants.filter((entry) => String(entry.event_id) === id).map((entry) => ({ personId: String(entry.person_id), displayName: String(people.get(String(entry.person_id))?.display_name ?? entry.person_id), role: String(entry.role ?? 'other') }));
    const place = event.place_id == null ? null : places.get(String(event.place_id));
    return {
      eventId: id, type: String(event.type ?? 'other'), label: String(event.label ?? event.type ?? id),
      dateDisplay: event.date ?? null, dateStartSort: event.date_sort ?? event.date ?? null, dateEndSort: event.date_end_sort ?? null,
      dateCertainty: String(event.date_certainty ?? 'unknown'), reviewStatus: String(event.review_status ?? 'unreviewed'),
      placeId: place ? String(place.place_id) : null, placeName: place?.name ?? null, notes: event.notes ?? null,
      participants: eventPeople, evidence: traces, sourceIds: [...new Set(traces.map((entry) => entry.itemId))],
      repositoryNames: [...new Set(traces.map((entry) => entry.repositoryName).filter(Boolean))],
      hypothesis: traces.length === 0, hasContradiction: traces.some((entry) => entry.role === 'contradicts'), dateAlternatives: [],
    };
  });
  const documented = events.filter((event) => !event.hypothesis);
  return { events, sources: primarySourceSourceOptions(evidence.filter((entry) => entry.targetKind === 'event')), repositories: primarySourceOptions(documented.flatMap((event) => event.repositoryNames)), persons: primarySourceOptions(documented.flatMap((event) => event.participants.map((person) => person.personId))), places: primarySourceOptions(documented.map((event) => event.placeName)), eventTypes: [...new Set(documented.map((event) => event.type))].sort() };
}

function primarySourceMap(snapshot) {
  const evidence = primarySourceEvidence(snapshot);
  const places = new Map(rows(snapshot, 'places').map((row) => [String(row.place_id), row]));
  const profiles = new Map(rows(snapshot, 'archive_item_profiles').map((row) => [String(row.item_id), row]));
  const links = rows(snapshot, 'archive_item_units');
  const units = new Map(rows(snapshot, 'archive_description_units').map((row) => [String(row.unit_id), row]));
  const repositories = new Map(rows(snapshot, 'archive_repositories').map((row) => [String(row.repository_id), row]));
  const folders = new Map(rows(snapshot, 'archive_folders').map((row) => [String(row.folder_id), row]));
  const points = rows(snapshot, 'archive_items').flatMap((item) => {
    const profile = profiles.get(String(item.item_id));
    const placeId = profile?.provenance_place_id;
    const place = placeId == null ? null : places.get(String(placeId));
    if (!place) return [];
    const itemLinks = links.filter((link) => String(link.item_id) === String(item.item_id));
    const itemUnits = itemLinks.map((link) => units.get(String(link.unit_id))).filter(Boolean);
    const repositoryNames = itemUnits.map((unit) => repositories.get(String(unit.repository_id))?.name).filter(Boolean);
    const sensitivity = String(profile?.sensitivity ?? 'normal');
    const lat = place.latitude == null || sensitivity === 'highly_sensitive' ? null : sensitivity === 'normal' ? Number(place.latitude) : Math.round(Number(place.latitude) * 100) / 100;
    const lon = place.longitude == null || sensitivity === 'highly_sensitive' ? null : sensitivity === 'normal' ? Number(place.longitude) : Math.round(Number(place.longitude) * 100) / 100;
    return [{ pointId: `provenance:${item.item_id}`, sourceTitle: String(item.title ?? item.item_id), placeId: String(place.place_id), mentionId: null, eventId: null, originalLabel: String(place.name ?? place.place_id), normalizedName: String(place.name ?? place.place_id), role: 'provenance', layer: 'provenance', latitude: Number.isFinite(lat) ? lat : null, longitude: Number.isFinite(lon) ? lon : null, coordinatePrecision: place.coordinate_precision ?? null, authority: null, historicalContext: place.historical_context ?? null, validFromDisplay: place.valid_from_display ?? null, validToDisplay: place.valid_to_display ?? null, dateDisplay: item.date_display ?? null, dateStartSort: item.date_start_sort ?? null, dateEndSort: item.date_end_sort ?? null, certainty: 1, resolutionStatus: lat == null || lon == null ? 'unresolved' : 'resolved', sensitivity, hypothesis: false, evidence: evidence.filter((entry) => entry.itemId === String(item.item_id)), sourceIds: [String(item.item_id)], personIds: [], eventType: null, sourceTypes: [String(item.doc_type ?? item.kind ?? 'other')], repositoryNames: [...new Set(repositoryNames)], collectionIds: rows(snapshot, 'archive_item_folders').filter((link) => String(link.item_id) === String(item.item_id)).map((link) => String(link.folder_id)), resolution: null }];
  });
  const sourceRows = rows(snapshot, 'archive_items');
  return { points, sources: sourceRows.map((row) => ({ id: String(row.item_id), label: String(row.title ?? row.item_id) })).sort((a, b) => a.label.localeCompare(b.label)), unassignedSources: sourceRows.filter((row) => !profiles.get(String(row.item_id))?.provenance_place_id).map((row) => ({ id: String(row.item_id), label: String(row.title ?? row.item_id) })), persons: [], events: [], sourceTypes: [...new Set(points.flatMap((point) => point.sourceTypes))].sort(), repositories: primarySourceOptions(points.flatMap((point) => point.repositoryNames)), collections: [...new Map(rows(snapshot, 'archive_item_folders').map((link) => [String(link.folder_id), String(folders.get(String(link.folder_id))?.name ?? link.folder_id)])).entries()].map(([id, label]) => ({ id, label })).sort((a, b) => a.label.localeCompare(b.label)), roles: ['provenance'], layers: ['provenance'] };
}

function primarySourceRelations(snapshot) {
  const evidence = primarySourceEvidence(snapshot);
  const people = new Map(publishedPersons(snapshot).map((row) => [String(row.person_id), row]));
  const edges = rows(snapshot, 'relationships').map((row) => {
    const id = String(row.rel_id ?? row.relationship_id ?? `${row.from_person}:${row.to_person}:${row.type}`);
    const fromId = String(row.from_person ?? ''); const toId = String(row.to_person ?? '');
    const traces = evidence.filter((entry) => entry.targetKind === 'relationship' && entry.targetId === id);
    return { edgeId: id, edgeKind: 'kinship', fromId, toId, fromName: String(people.get(fromId)?.display_name ?? fromId), toName: String(people.get(toId)?.display_name ?? toId), relationType: String(row.type ?? 'relation'), historicalLabel: String(row.label ?? row.type ?? 'Relación'), direction: row.direction === 'directed' ? 'directed' : 'undirected', dateDisplay: row.date ?? null, dateStartSort: row.date_sort ?? row.date ?? null, dateEndSort: row.date_end_sort ?? null, certainty: row.certainty == null ? null : Number(row.certainty), status: traces.length ? 'confirmed' : 'proposal', notes: row.notes ?? null, hypothesis: traces.length === 0, hasContradiction: traces.some((entry) => entry.role === 'contradicts'), evidence: traces, sourceIds: [...new Set(traces.map((entry) => entry.itemId))] };
  });
  const nodes = [...new Set(edges.flatMap((edge) => [edge.fromId, edge.toId]))].map((nodeId) => ({ nodeId, displayName: String(people.get(nodeId)?.display_name ?? nodeId), status: 'confirmed' }));
  return { nodes, edges, sources: primarySourceSourceOptions(evidence.filter((entry) => entry.targetKind === 'relationship')), relationTypes: [...new Set(edges.map((edge) => edge.relationType))].sort() };
}

function primarySourcePersons(snapshot, query = '', filter = 'all') {
  const people = new Map(publishedPersons(snapshot).map((row) => [String(row.person_id), row]));
  const mentions = rows(snapshot, 'archive_person_mentions');
  const evidence = primarySourceEvidence(snapshot);
  const summaries = [...new Set(mentions.map((row) => String(row.person_id ?? '')).filter(Boolean))].map((personId) => {
    const personMentions = mentions.filter((row) => String(row.person_id) === personId); const person = people.get(personId); const personEvidence = evidence.filter((entry) => entry.targetKind === 'person' && entry.targetId === personId);
    const variants = [...new Set(personMentions.map((row) => String(row.original_label ?? '')).filter(Boolean))].map((value) => ({ value, kind: value === String(person?.display_name ?? '') ? 'preferred' : 'documentary_mention', mentionCount: personMentions.filter((row) => String(row.original_label) === value).length }));
    const discrepancyCount = new Set(personMentions.map((row) => String(row.original_label ?? '').toLocaleLowerCase())).size > 1 ? 1 : 0;
    return { personId, displayName: String(person?.display_name ?? personId), identityStatus: personMentions.some((row) => row.identity_status === 'provisional') ? 'provisional' : 'confirmed', variants, mentionCount: personMentions.length, sourceCount: new Set(personMentions.map((row) => row.item_id)).size, evidenceCount: personEvidence.length, discrepancyCount, identityMemberCount: 1, updatedAt: String(person?.updated_at ?? '') };
  }).filter((person) => !query || `${person.displayName} ${person.variants.map((variant) => variant.value).join(' ')}`.toLocaleLowerCase().includes(query.toLocaleLowerCase())).filter((person) => filter === 'all' || (filter === 'discrepant' ? person.discrepancyCount > 0 : person.identityStatus === filter));
  return summaries.sort((a, b) => a.displayName.localeCompare(b.displayName));
}

function snippet(value) {
  const clean = String(value ?? '').replace(/\s+/g, ' ').trim();
  return clean.length <= SNIPPET_CHARS ? clean : `${clean.slice(0, SNIPPET_CHARS - 1)}…`;
}

function folderSubtree(folders, rootId) {
  if (!rootId) return null;
  const found = new Set([String(rootId)]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const folder of folders) {
      const id = String(folder.id ?? '');
      const parent = String(folder.parent_id ?? '');
      if (id && found.has(parent) && !found.has(id)) { found.add(id); changed = true; }
    }
  }
  return found;
}

function isDeepResearchDraft(row) {
  const brief = JSON.parse(row.brief_json || '{}');
  if (!brief || typeof brief !== 'object' || Array.isArray(brief)) throw new Error('invalid_saved_report');
  return brief.kind === 'deep_research';
}

function readResearchDraft(row) {
  const draft = JSON.parse(row.draft_json || 'null');
  if (!draft || typeof draft !== 'object' || Array.isArray(draft)) throw new Error('invalid_saved_report');
  return draft;
}

function draftSummary(row) {
  let brief = {};
  try { brief = JSON.parse(row.brief_json || '{}'); } catch { brief = {}; }
  return {
    id: row.id,
    title: row.title,
    kind: brief.kind ?? 'draft',
    objective: brief.objective ?? null,
    language: brief.language ?? null,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function writingDraftSummary(row) {
  let brief = {};
  try { brief = JSON.parse(row.brief_json || '{}'); } catch { brief = {}; }
  return {
    id: row.id, title: row.title, kind: brief.kind ?? 'writing', objective: brief.objective ?? null,
    language: brief.language ?? null, created_at: row.created_at, updated_at: row.updated_at,
  };
}

function parsedJson(value, fallback = null) {
  if (value && typeof value === 'object') return value;
  try { return JSON.parse(String(value ?? '')); } catch { return fallback; }
}

function stateOfArt(snapshot) {
  const subQuestions = rows(snapshot, 'research_subquestions');
  const links = rows(snapshot, 'research_coverage_links');
  const currentIdeas = rows(snapshot, 'ideas').length;
  const currentWorks = rows(snapshot, 'works').length;
  const questions = rows(snapshot, 'research_questions').map((question) => {
    const children = subQuestions
      .filter((entry) => String(entry.rq_id) === String(question.id))
      .sort((left, right) => (Number(left.order_idx) || 0) - (Number(right.order_idx) || 0))
      .map((entry) => ({
        id: entry.id,
        text: entry.text,
        rationale: entry.rationale ?? null,
        orderIdx: Number(entry.order_idx) || 0,
        coverageStatus: entry.coverage_status ?? null,
        justification: entry.justification ?? null,
        links: links.filter((link) => String(link.subq_id) === String(entry.id))
          .sort((left, right) => (Number(right.score) || 0) - (Number(left.score) || 0))
          .map((link) => ({
            id: link.id, kind: link.kind, refId: link.ref_id, label: link.label,
            score: Number(link.score) || 0, readState: link.read_state ?? null,
          })),
      }));
    const summary = { covered: 0, partial: 0, uncovered: 0, disputed: 0, unmapped: 0 };
    for (const child of children) {
      if (Object.hasOwn(summary, child.coverageStatus)) summary[child.coverageStatus] += 1;
      else summary.unmapped += 1;
    }
    return {
      id: question.id,
      question: question.question,
      notes: question.notes ?? null,
      model: parsedJson(question.model_json, null),
      status: question.status ?? 'draft',
      corpusIdeas: Number(question.corpus_ideas) || 0,
      corpusWorks: Number(question.corpus_works) || 0,
      createdAt: question.created_at,
      updatedAt: question.updated_at,
      mappedAt: question.mapped_at ?? null,
      subQuestions: children,
      summary,
      stale: question.status === 'mapped'
        && (currentIdeas > (Number(question.corpus_ideas) || 0) || currentWorks > (Number(question.corpus_works) || 0)),
    };
  });
  const works = new Map([...worksById(snapshot)].filter(([, work]) => !(work.archived === true || work.archived === 1 || work.archived === '1')));
  const ideas = new Map(rows(snapshot, 'ideas').map((idea) => [String(idea.global_id), idea]));
  const evidence = new Map(rows(snapshot, 'evidence').map((entry) => [String(entry.id), entry]));
  const gaps = rows(snapshot, 'gaps').map((gap) => ({
    ...gap,
    work: works.get(String(gap.nodus_id ?? '')) ?? null,
    idea: ideas.get(String(gap.related_idea ?? '')) ?? null,
    evidence: evidence.get(String(gap.evidence_id ?? '')) ?? null,
  }));
  return { questions, debates: listDebates(snapshot), gaps };
}

// The desktop reading path is calculated locally from the same published academic graph.
// Server cannot run the desktop graph worker, but it can preserve the important contract:
// stable ordering, the six phases and enough provenance for a reader to decide what to open.
function readingPath(snapshot, strategy = 'research_relevance', researchBrief = '', limit = 72, includeRead = true) {
  const works = new Map([...worksById(snapshot)].filter(([, work]) => !(work.archived === true || work.archived === 1 || work.archived === '1')));
  const occurrences = rows(snapshot, 'idea_occurrences');
  const ideas = new Map(rows(snapshot, 'ideas').map((row) => [String(row.global_id), row]));
  const themes = new Map(rows(snapshot, 'themes').map((row) => [String(row.theme_id), row.label ?? row.name ?? row.theme_id]));
  const links = rows(snapshot, 'idea_theme_links');
  const gaps = rows(snapshot, 'gaps');
  const edges = visibleEdges(snapshot);
  const authorsByWork = new Map();
  for (const credit of rows(snapshot, 'work_authors')) {
    const workId = String(credit.nodus_id ?? '');
    const authorId = String(credit.author_id ?? '');
    if (!workId || !authorId) continue;
    const authors = authorsByWork.get(workId) ?? [];
    authors.push(authorId);
    authorsByWork.set(workId, authors);
  }
  const authorRelations = rows(snapshot, 'author_relations');
  const connectedAuthors = new Map();
  for (const relation of authorRelations) {
    const from = String(relation.from_author ?? relation.from_author_id ?? '');
    const to = String(relation.to_author ?? relation.to_author_id ?? '');
    if (!from || !to) continue;
    for (const author of [from, to]) connectedAuthors.set(author, (connectedAuthors.get(author) ?? 0) + 1);
  }
  const occurrencesByIdea = new Map();
  for (const occurrence of occurrences) {
    const ideaId = String(occurrence.global_id ?? '');
    const list = occurrencesByIdea.get(ideaId) ?? [];
    list.push(occurrence);
    occurrencesByIdea.set(ideaId, list);
  }
  const byWork = new Map();
  for (const occurrence of occurrences) {
    const id = String(occurrence.nodus_id ?? '');
    if (!id) continue;
    if (!byWork.has(id)) byWork.set(id, { ideas: [], themes: new Set(), confidence: 0 });
    const entry = byWork.get(id);
    const ideaId = String(occurrence.global_id ?? '');
    if (ideaId && ideas.has(ideaId)) entry.ideas.push(ideaId);
    entry.confidence = Math.max(entry.confidence, Number(occurrence.confidence) || 0);
  }
  for (const link of links) {
    const work = (occurrencesByIdea.get(String(link.global_id)) ?? [])[0];
    const target = work && byWork.get(String(work.nodus_id));
    if (target && themes.has(String(link.theme_id))) target.themes.add(String(themes.get(String(link.theme_id))));
  }
  const now = new Date().getFullYear();
  const brief = String(researchBrief ?? '').toLowerCase();
  const entries = [...works.values()].map((work) => {
    const id = String(work.nodus_id);
    const data = byWork.get(id) ?? { ideas: [], themes: new Set(), confidence: 0 };
    const year = Number(work.year ?? (typeof work.date === 'string' ? work.date.slice(0, 4) : '')) || null;
    const recencyScore = year ? Math.max(0, Math.min(1, (year - 1900) / Math.max(1, now - 1900))) : 0;
    const relevance = brief ? [...data.themes].filter((theme) => brief.includes(String(theme).toLowerCase())).length : 0;
    const gapScore = data.ideas.filter((ideaId) => gaps.some((gap) => String(gap.related_idea ?? '') === ideaId)).length;
    const authorIds = authorsByWork.get(id) ?? [];
    const authorConnectivityScore = authorIds.length ? Math.min(1, authorIds.reduce((sum, author) => sum + (connectedAuthors.get(author) ?? 0), 0) / authorIds.length / 4) : 0;
    const contradictionCount = data.ideas.reduce((total, ideaId) => total + edges.filter((edge) => (edge.type === 'contradicts' || edge.type === 'refutes') && (String(edge.from_id) === ideaId || String(edge.to_id) === ideaId)).length, 0);
    const score = strategy === 'recent' ? recencyScore : strategy === 'gaps' ? gapScore + data.confidence : strategy === 'foundational' ? (1 - recencyScore) + data.confidence : strategy === 'connected_authors' ? authorConnectivityScore + data.confidence : strategy === 'bridges' ? (data.themes.size > 1 ? 1 : 0) + data.confidence : relevance + data.confidence + data.ideas.length * 0.05;
    const read = work.read === true || work.read === 1 || work.read === '1' || work.read_tag === true || work.read_tag === 1 || work.read_tag === '1';
    const lightStatus = work.light_status ?? (data.themes.size > 0 ? 'done' : 'missing');
    const deepStatus = work.deep_status ?? (data.ideas.length > 0 ? 'done' : 'missing');
    const summaryStatus = work.summary_status ?? 'missing';
    return {
      nodus_id: id, title: work.title ?? id, authors: Array.isArray(work.authors) ? work.authors : parsedJson(work.authors_json, []), year,
      themes: [...data.themes], orientationSummary: work.abstract ?? null, readTag: read, read,
      analysis: { lightStatus, deepStatus, summaryStatus, hasThemes: data.themes.size > 0, hasIdeas: data.ideas.length > 0, hasContradictions: contradictionCount > 0, hasGaps: gapScore > 0, hasExternalRefs: false, themeCount: data.themes.size, ideaCount: data.ideas.length, relationCount: 0, contradictionCount, gapCount: gapScore, externalRefCount: 0 },
      score, priority: score, phase: 'core', strategyScore: score, gapScore, foundationalScore: 1 - recencyScore, recencyScore, authorConnectivityScore, bridgeScore: data.themes.size > 1 ? 1 : 0, interestScore: data.ideas.length, diversityKey: [...data.themes][0] ?? null,
      relatedGaps: gaps.filter((gap) => data.ideas.includes(String(gap.related_idea ?? ''))).map((gap) => String(gap.text ?? gap.description ?? gap.id)), relatedIdeas: data.ideas, connectedAuthors: authorIds, citedBy: 0,
      reason: data.ideas.length ? 'Conecta ideas del corpus publicado.' : 'Obra pendiente de análisis.',
      reasonKey: data.ideas.length ? 'reading.reason.connectedIdeas' : 'reading.reason.pendingAnalysis',
      reasonParams: {},
    };
  }).filter((entry) => includeRead || !entry.read).sort((left, right) => right.score - left.score || left.title.localeCompare(right.title)).slice(0, Math.max(1, Math.min(200, Number(limit) || 72)));
  const phaseDefs = [
    ['foundations', 'Textos de base', 'Construye el terreno común.', (entry) => entry.foundationalScore >= 0.45],
    ['core', 'Núcleo de la investigación', 'Lee las obras más relevantes para tu pregunta.', (entry) => entry.themes.length > 0 || entry.relatedIdeas.length > 0],
    ['bridges', 'Puentes entre temas', 'Conecta líneas temáticas del corpus.', (entry) => entry.bridgeScore > 0],
    ['debates', 'Debates y tensiones', 'Contrasta posiciones y relaciones visibles.', (entry) => entry.analysis.hasContradictions || entry.analysis.relationCount > 0],
    ['gaps', 'Huecos abiertos', 'Acércate a lo que todavía no está cubierto.', (entry) => entry.gapScore > 0],
    ['pending', 'Pendientes de analizar', 'Obras que aún necesitan una lectura inicial.', (entry) => entry.analysis.ideaCount === 0],
  ];
  const used = new Set();
  const phases = phaseDefs.map(([id, title, objective, predicate]) => {
    const candidates = entries.filter((entry) => predicate(entry));
    const selected = candidates.filter((entry) => !used.has(entry.nodus_id)).slice(0, Math.max(1, Math.ceil(limit / phaseDefs.length)));
    selected.forEach((entry) => used.add(entry.nodus_id));
    return {
      id,
      title,
      objective,
      titleKey: `reading.phase.${id}.title`,
      objectiveKey: `reading.phase.${id}.objective`,
      entries: selected.map((entry) => ({ ...entry, phase: id })),
      totalCandidates: candidates.length,
      omitted: Math.max(0, candidates.length - selected.length),
    };
  }).filter((phase) => phase.entries.length > 0);
  const allEntries = [...works.values()].map((work) => work.read === true || work.read === 1 || work.read === '1' || work.read_tag === true || work.read_tag === 1 || work.read_tag === '1');
  return {
    strategy,
    researchBrief: String(researchBrief ?? ''),
    generatedAt: new Date().toISOString(),
    totalWorks: works.size,
    shownWorks: entries.length,
    readCount: allEntries.filter(Boolean).length,
    unreadCount: allEntries.filter((entry) => !entry).length,
    analyzedCount: entries.filter((entry) => entry.analysis.ideaCount > 0).length,
    pendingAnalysisCount: entries.filter((entry) => entry.analysis.ideaCount === 0).length,
    summary: `Ruta de lectura con ${entries.length} obras priorizadas.`,
    summaryKey: 'reading.summary',
    summaryParams: { count: entries.length },
    phases,
  };
}

/**
 * Bounded breadth-first walk around one idea.
 *
 * The desktop builds a far richer structural map (electron/graph — budgets, ranking, leaf
 * detection); this returns the raw neighbourhood a client needs to draw one, with
 * src/argumentMapTree.ts doing the tree layout on the device since it imports only types.
 * Walking from `visibleEdges` rather than `edges` means a dismissed relation is absent here
 * exactly as it is absent on the owner's screen.
 */
function graphIdeaRows(snapshot, includedIds = null, limit = MAX_FULL_GRAPH_IDEAS) {
  const themeLabels = new Map(rows(snapshot, 'themes').map((theme) => [String(theme.theme_id), String(theme.label ?? theme.name ?? theme.theme_id)]));
  const themesByIdea = new Map();
  for (const link of rows(snapshot, 'idea_theme_links')) {
    const ideaId = String(link.global_id ?? '');
    const label = themeLabels.get(String(link.theme_id ?? ''));
    if (!ideaId || !label) continue;
    if (!themesByIdea.has(ideaId)) themesByIdea.set(ideaId, []);
    themesByIdea.get(ideaId).push(label);
  }
  const occurrencesByIdea = new Map();
  for (const occurrence of rows(snapshot, 'idea_occurrences')) {
    const ideaId = String(occurrence.global_id ?? '');
    if (!occurrencesByIdea.has(ideaId)) occurrencesByIdea.set(ideaId, []);
    occurrencesByIdea.get(ideaId).push(occurrence);
  }
  return rows(snapshot, 'ideas')
    .filter((idea) => !includedIds || includedIds.has(String(idea.global_id)))
    .slice(0, limit)
    .map((idea) => {
      const id = String(idea.global_id);
      const occurrences = occurrencesByIdea.get(id) ?? [];
      return {
        ...idea,
        themes: [...new Set(themesByIdea.get(id) ?? [])],
        workIds: [...new Set(occurrences.map((entry) => String(entry.nodus_id ?? '')).filter(Boolean))],
        workCount: new Set(occurrences.map((entry) => String(entry.nodus_id ?? '')).filter(Boolean)).size,
        maxConfidence: Math.max(0, ...occurrences.map((entry) => Number(entry.confidence) || 0)),
      };
    });
}

function ideaGraph(snapshot, seedId, depth, limit) {
  const edges = visibleEdges(snapshot);
  const adjacency = new Map();
  for (const edge of edges) {
    const from = String(edge.from_id);
    const to = String(edge.to_id);
    if (!adjacency.has(from)) adjacency.set(from, []);
    if (!adjacency.has(to)) adjacency.set(to, []);
    adjacency.get(from).push(edge);
    adjacency.get(to).push(edge);
  }
  const seen = new Set([String(seedId)]);
  let frontier = [String(seedId)];
  for (let level = 0; level < depth && seen.size < limit; level += 1) {
    const next = [];
    for (const node of frontier) {
      for (const edge of adjacency.get(node) ?? []) {
        for (const candidate of [String(edge.from_id), String(edge.to_id)]) {
          if (seen.has(candidate) || seen.size >= limit) continue;
          seen.add(candidate);
          next.push(candidate);
        }
      }
    }
    frontier = next;
    if (frontier.length === 0) break;
  }
  const ideas = graphIdeaRows(snapshot, seen, limit);
  const included = edges.filter((edge) => seen.has(String(edge.from_id)) && seen.has(String(edge.to_id)));
  return { seedId: String(seedId), depth, ideas, edges: included, truncated: seen.size >= limit };
}

function fullIdeaGraph(snapshot, limit) {
  const ideas = graphIdeaRows(snapshot, null, limit);
  const included = new Set(ideas.map((idea) => String(idea.global_id)));
  return {
    seedId: '', depth: 0, ideas,
    edges: visibleEdges(snapshot).filter((edge) => included.has(String(edge.from_id)) && included.has(String(edge.to_id))),
    truncated: rows(snapshot, 'ideas').length > ideas.length,
  };
}

/**
 * Resource collections that are a plain filtered projection of one table.
 *
 * Grouped by the vault type they belong to, but the dispatcher does not gate on type: a
 * table a space never published simply is not in its snapshot, and the endpoint answers an
 * empty page. Gating instead would mean a client had to know the type before it could ask,
 * and would turn "this vault has no people" into a 404 that reads like a broken route.
 */
const COLLECTIONS = {
  // Academic
  works: { table: 'works', key: 'works', id: 'nodus_id' },
  ideas: { table: 'ideas', key: 'ideas', id: 'global_id' },
  themes: { table: 'themes', key: 'themes', id: 'theme_id' },
  gaps: { table: 'gaps', key: 'gaps', id: 'id' },
  authors: { table: 'authors', key: 'authors', id: 'author_id' },
  passages: { table: 'passages', key: 'passages', id: 'passage_id' },
  // Dictionary is its own authored corpus. Exposing themes here made the Web label a
  // thematic index as "Dictionary", which was visually plausible but semantically false.
  dictionary: { table: 'dictionary_entries', key: 'entries', id: 'id' },
  // Genealogy and prosopography
  persons: { table: 'persons', key: 'persons', id: 'person_id' },
  places: { table: 'places', key: 'places', id: 'place_id' },
  events: { table: 'events', key: 'events', id: 'event_id' },
  // The kinship table's primary key is `rel_id`; using `id` silently made every
  // relationship detail resolve by an undefined fallback and broke deep links.
  relationships: { table: 'relationships', key: 'relationships', id: 'rel_id' },
  // Worldbuilding
  'world-groups': { table: 'world_groups', key: 'groups', id: 'group_id' },
  'world-scenes': { table: 'world_scenes', key: 'scenes', id: 'scene_id' },
  'world-articles': { table: 'world_articles', key: 'articles', id: 'article_id' },
  'world-maps': { table: 'world_maps', key: 'maps', id: 'map_id' },
  'world-threads': { table: 'world_threads', key: 'threads', id: 'thread_id' },
  'world-rules': { table: 'world_rules', key: 'rules', id: 'rule_id' },
  'world-questions': { table: 'world_questions', key: 'questions', id: 'question_id' },
  'world-secrets': { table: 'world_secrets', key: 'secrets', id: 'secret_id' },
  // Study.
  //
  // Every one of these is keyed on `id`, not on `<thing>_id`. The study and teaching
  // migrations name their primary key `id` throughout (migrations.ts:1573 onwards), and
  // declaring `subject_id`, `card_id` or `exam_id` here named a column none of these tables
  // has. On this side the detail lookup fell through to `candidate.id` and worked by
  // accident; on the client, where the same table is the contract, it meant an exam had no id
  // to enrich by and no study row listed inside another dossier could be opened at all.
  'study-subjects': { table: 'study_subjects', key: 'subjects', id: 'id' },
  'study-courses': { table: 'study_courses', key: 'courses', id: 'id' },
  'study-topics': { table: 'study_topics', key: 'topics', id: 'id' },
  'study-docs': { table: 'study_docs', key: 'docs', id: 'id' },
  'study-materials': { table: 'study_materials', key: 'materials', id: 'id' },
  'study-flashcards': { table: 'study_flashcards', key: 'flashcards', id: 'id' },
  'study-questions': { table: 'study_questions', key: 'questions', id: 'id' },
  'study-ideas': { table: 'study_ideas', key: 'ideas', id: 'id' },
  // What the week actually holds. `study_plan_blocks` has no collection of its own: a block
  // outside its plan is a title and a timestamp, so it arrives inside the plan and inside the
  // agenda instead of as a list nobody would browse.
  'study-plans': { table: 'study_plans', key: 'plans', id: 'id' },
  'study-schedule': { table: 'study_schedule_periods', key: 'periods', id: 'id' },
  'study-goals': { table: 'study_goals', key: 'goals', id: 'id' },
  'study-calendar': { table: 'study_calendar_events', key: 'events', id: 'id' },
  // Teaching materials. Rosters, groups and grades are not published at all, so there is
  // deliberately no collection that could ever serve them.
  'teaching-exams': { table: 'teaching_exams', key: 'exams', id: 'id' },
  'teaching-rubrics': { table: 'teaching_rubrics', key: 'rubrics', id: 'id' },
  // Primary sources (binary originals and local paths are stripped by publication).
  // Archival tables retain their domain-specific primary-key names. Using a generic `id`
  // here made the catalogue render but made every source/repository/unit/excerpt detail URL
  // resolve to 404 against a real Desktop snapshot.
  'archive-items': { table: 'archive_items', key: 'items', id: 'item_id' },
  'archive-repositories': { table: 'archive_repositories', key: 'repositories', id: 'repository_id' },
  'archive-units': { table: 'archive_description_units', key: 'units', id: 'unit_id' },
  'archive-excerpts': { table: 'archive_excerpts', key: 'excerpts', id: 'excerpt_id' },
  'source-analyses': { table: 'archive_source_analyses', key: 'analyses', id: 'analysis_id' },
  // Testimonies: textual research material only; agreements, contacts and media never publish.
  'testimony-interviews': { table: 'testimony_interviews', key: 'interviews', id: 'id' },
  'testimony-transcripts': { table: 'testimony_transcripts', key: 'transcripts', id: 'id' },
  'testimony-codes': { table: 'testimony_codes', key: 'codes', id: 'id' },
  'testimony-contrasts': { table: 'testimony_contrasts', key: 'contrasts', id: 'id' },
  // Prosopography publishes only generated aggregates. These collections never
  // contain person ids, names, literals, quotations or identity decisions.
  'prosopography-public-population': { table: 'prosopography_public_population', key: 'population', id: 'id' },
  'prosopography-public-variables': { table: 'prosopography_public_variables', key: 'variables', id: 'id' },
  'prosopography-public-sources': { table: 'prosopography_public_sources', key: 'sources', id: 'id' },
  'prosopography-public-analysis': { table: 'prosopography_public_analysis', key: 'analyses', id: 'id' },
  'prosopography-public-networks': { table: 'prosopography_public_networks', key: 'networks', id: 'id' },
  // Databases
  databases: { table: 'db_databases', key: 'databases', id: 'id' },
  'database-pages': { table: 'pages', key: 'pages', id: 'id' },
};

/**
 * One saved draft, rendered as the styled document.
 *
 * The cover image is inlined as a `data:` URL: the document has to be printable by a client
 * that may not be able to fetch anything else, and a page whose cover is a broken link is
 * worse than one with no cover.
 *
 * The snapshot's asset entry carries a hash and no bytes — that is the whole point of the
 * asset channel — so the bytes are read from the store here. Reading `image.dataUrl`, a field
 * a snapshot asset has never had, is why every report the phone printed came out with the
 * fallback motif where the desktop puts the illustration.
 */
function renderReportDocument(draft, image, readAssetBytes) {
  return renderProfessionalReportHtml(deepResearchReportInput(draft, coverImage(image, readAssetBytes)));
}

function coverImage(image, readAssetBytes) {
  const empty = { dataUrl: null, credit: null };
  if (!image?.hash || typeof readAssetBytes !== 'function') return empty;
  const asset = readAssetBytes(image.hash);
  if (!asset?.bytes) return empty;
  return { dataUrl: `data:${asset.mime};base64,${asset.bytes.toString('base64')}`, credit: null };
}

export function createCorpusRoutes({ readSnapshot, readAssetBytes, renderPdf }) {
  function requireSnapshot(res, json, spaceId) {
    const snapshot = readSnapshot(spaceId);
    if (!snapshot) {
      json(res, 409, { error: 'not_published', error_description: 'This space has not received a publication yet.' });
      return null;
    }
    return snapshot;
  }

  /**
   * Weak ETag over the space revision plus the exact request. Returns true when the client
   * already holds this answer and the caller should stop.
   */
  function notModified(req, res, json, space, url, payloadKey) {
    const tag = `W/"${space.revision || space.updatedAt || 'none'}|${payloadKey}"`;
    if (req.headers['if-none-match'] === tag) {
      res.writeHead(304, securityHeaders({ etag: tag, 'cache-control': 'private, max-age=0, must-revalidate' }));
      res.end();
      return true;
    }
    res.__etag = tag;
    return false;
  }

  function send(res, json, value) {
    json(res, 200, value, res.__etag ? { etag: res.__etag, 'cache-control': 'private, max-age=0, must-revalidate' } : {});
    return true;
  }

  function missing(res, json) {
    json(res, 404, { error: 'not_found' });
    return true;
  }

  /**
   * `handle` returns true when it answered. Every route here has already been through
   * `authorize(need:'read')` in the caller, so membership is settled by the time we arrive.
   */
  async function handle(req, res, { json, url, space, segments }) {
    const [head, ...rest] = segments;
    const key = `${url.pathname}?${url.searchParams.toString()}`;

    if (head === 'editor-references' && !rest.length) {
      const snapshot = requireSnapshot(res, json, space.id);
      if (!snapshot) return true;
      // Membership has already been checked. Private notes are supplied only by
      // the authenticated user's artifact API, never by the publication snapshot.
      const tables = Object.fromEntries(['ideas', 'authors', 'works', 'study_docs', 'study_materials'].map(table => [table, rows(snapshot, table)]));
      if(url.searchParams.get('passages')==='1'){const query=(url.searchParams.get('q')??'').slice(0,200).toLowerCase();tables.passages=rows(snapshot,'passages').filter(row=>String(row.text??'').toLowerCase().includes(query)).slice(0,50).map(row=>({...row,text:String(row.text??'').slice(0,160)}));}
      return send(res, json, { items: editorReferenceCatalog(tables), revision: space.revision });
    }

    if (head === undefined) {
      const snapshot = readSnapshot(space.id);
      if (notModified(req, res, json, space, url, key)) return true;
      return send(res, json, {
        space: { id: space.id, name: space.name, description: space.description, updatedAt: space.updatedAt, revision: space.revision },
        vault: snapshot?.vault ?? space.vault ?? null,
        schemaVersion: snapshot?.schemaVersion ?? space.schemaVersion ?? 0,
        snapshotFormatVersion: snapshot ? Number(snapshot.formatVersion) || 1 : null,
        generatedAt: snapshot?.generatedAt ?? null,
        capabilities: snapshot?.capabilities ?? null,
        assets: Array.isArray(snapshot?.assets) ? snapshot.assets.length : 0,
        counts: snapshot ? counts(snapshot) : {},
      });
    }

    if (head === 'stellar-edge' && rest.length === 0) {
      const snapshot = requireSnapshot(res,json,space.id);
      if (!snapshot) return true;
      const edge = visibleEdges(snapshot).find(e=>String(e.id)===url.searchParams.get('id'));
      if (!edge) { json(res,404,{error:'not_found'});return true; }
      const ideas = new Map(rows(snapshot,'ideas').map(i=>[i.global_id,i]));
      const trace = rows(snapshot,'edge_traces').find(t=>t.edge_id===edge.id);
      return send(res,json,{edge,fromLabel:ideas.get(edge.from_id)?.label||edge.from_id,toLabel:ideas.get(edge.to_id)?.label||edge.to_id,explanation:trace?.rationale||null,evidence:edge.source_work ? rows(snapshot,'evidence').filter(e=>e.nodus_id===edge.source_work && [edge.from_id,edge.to_id].includes(e.global_id)) : []});
    }

    if (head === 'stellar' && rest.length === 0) {
      const snapshot = requireSnapshot(res, json, space.id);
      if (!snapshot) return true;
      const request = JSON.parse(url.searchParams.get('request') || '{}');
      const cursor = Math.max(0, Math.floor(Number(request.cursor) || 0));
      const limit = Math.min(200, Math.max(1, Math.floor(Number(request.limit) || 200)));
      let ideas = graphIdeaRows(snapshot, null, Number.MAX_SAFE_INTEGER).filter(i => !i.orphaned_at);
      const valid = new Set(ideas.map(i => String(i.global_id)));
      let edges = visibleEdges(snapshot).filter(e => valid.has(String(e.from_id)) && valid.has(String(e.to_id)));
      if (request.kind === 'search') {
        const q = String(request.search || '').toLocaleLowerCase();
        ideas = ideas.filter(i => `${i.label} ${i.statement}`.toLocaleLowerCase().includes(q)).sort((a,b)=>String(a.label).localeCompare(String(b.label)) || String(a.global_id).localeCompare(String(b.global_id)));
        edges = [];
      } else if (request.kind === 'corpus') {
        ideas.sort((a,b)=>String(a.global_id).localeCompare(String(b.global_id)));
        edges.sort((a,b)=>String(a.id).localeCompare(String(b.id)));
      } else if (request.kind === 'neighbors') {
        ideas = [];
        edges = edges.filter(e=>e.from_id===request.id || e.to_id===request.id).sort((a,b)=>(a.basis==='explicit'?0:1)-(b.basis==='explicit'?0:1) || Number(b.confidence)-Number(a.confidence) || String(a.id).localeCompare(String(b.id)));
      } else if (request.kind === 'work') {
        ideas = ideas.filter(i=>i.workIds.includes(request.id));
        const ids = new Set(ideas.map(i=>i.global_id));
        edges = edges.filter(e=>ids.has(e.from_id)&&ids.has(e.to_id));
      } else if (request.kind === 'elements') {
        ideas = ideas.filter(i=>Array.isArray(request.nodeIds)&&request.nodeIds.slice(0,200).includes(i.global_id));
        edges = edges.filter(e=>Array.isArray(request.edgeIds)&&request.edgeIds.slice(0,200).includes(e.id));
      } else { json(res,400,{error:'Invalid graph page'});return true; }
      const total = Math.max(ideas.length, edges.length);
      ideas = ideas.slice(cursor,cursor+limit); edges = edges.slice(cursor,cursor+limit);
      const ids = new Set([...ideas.map(i=>i.global_id),...edges.flatMap(e=>[e.from_id,e.to_id])]);
      const nodes = graphIdeaRows(snapshot,ids,Number.MAX_SAFE_INTEGER).map(i=>({id:i.global_id,label:i.label || i.statement,type:i.type,statement:i.statement,workCount:i.workCount,workIds:i.workIds,read:false,themes:i.themes,years:[],authors:[],maxConfidence:i.maxConfidence}));
      return send(res,json,{nodes,edges:edges.map(e=>({id:e.id,source:e.from_id,target:e.to_id,type:e.type,basis:e.basis,confidence:e.confidence})),total,next:cursor+limit<total?cursor+limit:null,revision:space.revision});
    }

    if (head === 'graph' && rest.length === 0) {
      const snapshot = requireSnapshot(res, json, space.id);
      if (!snapshot) return true;
      const limit = readLimit(url.searchParams.get('limit'), MAX_FULL_GRAPH_IDEAS, MAX_FULL_GRAPH_IDEAS);
      if (notModified(req, res, json, space, url, key)) return true;
      return send(res, json, { ...fullIdeaGraph(snapshot, limit), revision: space.revision });
    }

    if (head === 'state-of-art' && rest.length === 0) {
      const snapshot = requireSnapshot(res, json, space.id);
      if (!snapshot) return true;
      if (notModified(req, res, json, space, url, key)) return true;
      return send(res, json, { ...stateOfArt(snapshot), revision: space.revision });
    }

    if (head === 'reading-path' && rest.length === 0) {
      const snapshot = requireSnapshot(res, json, space.id);
      if (!snapshot) return true;
      if (notModified(req, res, json, space, url, key)) return true;
      return send(res, json, { ...readingPath(snapshot, url.searchParams.get('strategy') || 'research_relevance', url.searchParams.get('researchBrief') || '', readLimit(url.searchParams.get('limit'), 72, 200), url.searchParams.get('includeRead') !== '0'), revision: space.revision });
    }

    if (head === 'writing' || head === 'projects') {
      const snapshot = requireSnapshot(res, json, space.id);
      if (!snapshot) return true;
      const source = head === 'projects' ? rows(snapshot, 'projects') : rows(snapshot, 'writing_saved_drafts').filter((row) => !isDeepResearchDraft(row));
      if (rest.length === 0) {
        const query = url.searchParams.get('q');
        const filtered = query ? source.filter((row) => matchesRow(row, query)) : source;
        if (notModified(req, res, json, space, url, key)) return true;
        const keyName = head === 'projects' ? 'projects' : 'drafts';
        const listed = head === 'writing' ? filtered.map(writingDraftSummary) : filtered;
        return send(res, json, { ...page(keyName, listed, readLimit(url.searchParams.get('limit')), readOffset(url.searchParams.get('offset'))), revision: space.revision });
      }
      const wanted = decodeURIComponent(rest[0]);
      const row = source.find((candidate) => String(candidate.id) === wanted);
      if (!row) return missing(res, json);
      if (notModified(req, res, json, space, url, key)) return true;
      if (head === 'projects') return send(res, json, {
        project: row,
        sections: rows(snapshot, 'project_sections').filter((entry) => String(entry.project_id) === wanted).sort((a, b) => (Number(a.order_idx) || 0) - (Number(b.order_idx) || 0)),
        links: rows(snapshot, 'project_links').filter((entry) => String(entry.project_id) === wanted),
        chapters: rows(snapshot, 'project_chapters').filter((entry) => String(entry.project_id) === wanted).map((entry) => ({ ...entry, original_text: undefined })),
        stats: { sections: rows(snapshot, 'project_sections').filter((entry) => String(entry.project_id) === wanted).length, links: rows(snapshot, 'project_links').filter((entry) => String(entry.project_id) === wanted).length, chapters: rows(snapshot, 'project_chapters').filter((entry) => String(entry.project_id) === wanted).length },
        revision: space.revision,
      });
      let draft = null; try { draft = JSON.parse(row.draft_json || 'null'); } catch { draft = null; }
      return send(res, json, { draft: { ...row, draft_json: undefined, draft }, revision: space.revision });
    }

    // Encyclopedia is a read-time projection, not a SQLite table. It mirrors the
    // Desktop listWorldEntries() index across every publishable world entity.
    if (head === 'world-entries') {
      const snapshot = requireSnapshot(res, json, space.id);
      if (!snapshot) return true;
      const entries = publishedWorldEntries(snapshot);
      if (rest.length === 0) {
        const query = url.searchParams.get('q');
        const filtered = query ? entries.filter((entry) => matchesRow(entry, query)) : entries;
        if (notModified(req, res, json, space, url, key)) return true;
        return send(res, json, { ...page('entries', filtered, readLimit(url.searchParams.get('limit')), readOffset(url.searchParams.get('offset'))), revision: space.revision });
      }
      const wanted = decodeURIComponent(rest[0]);
      const entry = entries.find((candidate) => candidate.key === wanted) ?? null;
      if (!entry) return missing(res, json);
      if (notModified(req, res, json, space, url, key)) return true;
      const source = rows(snapshot, entry.kind === 'article' ? 'world_articles' : entry.kind === 'character' ? 'persons' : entry.kind === 'place' ? 'places' : entry.kind === 'group' ? 'world_groups' : entry.kind === 'scene' ? 'world_scenes' : entry.kind === 'rule' ? 'world_rules' : entry.kind === 'conflict' ? 'world_threads' : 'world_maps').find((row) => String(row.article_id ?? row.person_id ?? row.place_id ?? row.group_id ?? row.scene_id ?? row.rule_id ?? row.thread_id ?? row.map_id) === entry.id) ?? null;
      const profile = entry.kind === 'character' ? rows(snapshot, 'character_profiles').find((row) => String(row.person_id) === entry.id) : entry.kind === 'place' ? rows(snapshot, 'place_profiles').find((row) => String(row.place_id) === entry.id) : null;
      const body = entry.kind === 'article' ? source?.body ?? '' : entry.kind === 'character' ? [source?.biography, profile?.backstory, profile?.appearance, profile?.personality, source?.notes].filter(Boolean).join('\n\n') : entry.kind === 'place' ? [profile?.history, profile?.appearance, profile?.atmosphere, source?.notes].filter(Boolean).join('\n\n') : entry.kind === 'group' ? source?.description ?? source?.summary ?? '' : entry.kind === 'scene' ? (rows(snapshot, 'world_scene_text').find((row) => String(row.scene_id) === entry.id)?.content_markdown ?? source?.summary ?? '') : entry.kind === 'rule' ? source?.statement ?? '' : entry.kind === 'conflict' ? [source?.pitch, source?.stakes].filter(Boolean).join('\n\n') : source?.notes ?? '';
      return send(res, json, { entry, body, facts: source ? Object.entries(source).filter(([, value]) => value != null && typeof value !== 'object').slice(0, 12).map(([label, value]) => ({ label, value: String(value) })) : [], links: rows(snapshot, 'world_links').filter((link) => String(link.source_id) === entry.id), backlinks: [], related: [], proposedBody: null, proposedAt: null, revision: space.revision });
    }

    // Review is a virtual Desktop surface: its content comes from the public question
    // and flashcard authoring tables, while the learner's SRS history is intentionally
    // absent from a publication. Keep the two item kinds together so the Web can offer
    // the same review chooser without exposing private attempts or due dates.
    if (head === 'study-review') {
      const snapshot = requireSnapshot(res, json, space.id);
      if (!snapshot) return true;
      const all = publishedStudyReviewItems(snapshot);
      if (rest.length === 0) {
        const query = url.searchParams.get('q');
        const filtered = query ? all.filter((row) => matchesRow(row, query)) : all;
        if (notModified(req, res, json, space, url, key)) return true;
        return send(res, json, { ...page('items', filtered, readLimit(url.searchParams.get('limit')), readOffset(url.searchParams.get('offset'))), revision: space.revision, progress: { published: false, notice: 'El progreso SRS se mantiene privado en Desktop.' } });
      }
      const wanted = decodeURIComponent(rest[0]);
      const item = all.find((candidate) => String(candidate.review_key) === wanted) ?? null;
      if (!item) return missing(res, json);
      if (notModified(req, res, json, space, url, key)) return true;
      if (item.item_kind === 'flashcard') return send(res, json, { card: item, progress: { published: false, notice: 'El progreso SRS se mantiene privado en Desktop.' }, revision: space.revision });
      return send(res, json, { question: item, versions: rows(snapshot, 'study_question_versions').filter((entry) => String(entry.question_id) === String(item.id)).sort((a, b) => (Number(b.version_no) || 0) - (Number(a.version_no) || 0)), progress: { published: false, notice: 'Los intentos y calificaciones se mantienen privados en Desktop.' }, revision: space.revision });
    }

    if (head === 'primary-sources') {
      const snapshot = requireSnapshot(res, json, space.id);
      if (!snapshot) return true;
      // Never reinterpret a different vault's rows as a primary-source
      // workspace. The publication opt-in is scoped to this vault type.
      if (String(snapshot.vault?.type ?? space.vault?.type ?? '') !== 'primary_sources') return missing(res, json);
      if (rest[0] === 'timeline' && rest.length === 1) return send(res, json, { ...primarySourceTimeline(snapshot), revision: space.revision });
      if (rest[0] === 'map' && rest.length === 1) return send(res, json, { ...primarySourceMap(snapshot), revision: space.revision });
      if (rest[0] === 'relations' && rest.length === 1) return send(res, json, { ...primarySourceRelations(snapshot), revision: space.revision });
      if (rest[0] === 'persons') {
        const people = primarySourcePersons(snapshot, url.searchParams.get('q') ?? '', url.searchParams.get('filter') ?? 'all');
        if (rest.length === 1) return send(res, json, { people, revision: space.revision });
        const personId = decodeURIComponent(rest[1]); const summary = people.find((person) => person.personId === personId);
        if (!summary) return missing(res, json);
        const mentions = rows(snapshot, 'archive_person_mentions').filter((row) => String(row.person_id) === personId).map((mention) => {
          const item = rows(snapshot, 'archive_items').find((row) => String(row.item_id) === String(mention.item_id));
          const excerpt = rows(snapshot, 'archive_excerpts').find((row) => String(row.excerpt_id) === String(mention.excerpt_id));
          return { mentionId: String(mention.mention_id), itemId: String(mention.item_id), excerptId: mention.excerpt_id ?? null, personId, originalLabel: String(mention.original_label ?? ''), role: mention.role ?? null, certainty: mention.certainty == null ? null : Number(mention.certainty), identityStatus: String(mention.identity_status ?? 'unresolved_mention'), createdAt: String(mention.created_at ?? ''), updatedAt: String(mention.updated_at ?? ''), sourceTitle: String(item?.title ?? mention.item_id), referenceCode: null, repositoryName: null, excerptLocator: excerpt?.locator_display ?? null, quotedText: excerpt?.quoted_text ?? null, evidenceRole: null, evidenceId: null };
        });
        return send(res, json, { summary, identityMembers: [summary], mentions, assertions: [], discrepancies: [], candidates: [], resolutions: [], revision: space.revision });
      }
      if (rest[0] === 'search' && rest.length === 1) {
        const query = String(url.searchParams.get('q') ?? '').trim().toLocaleLowerCase();
        const evidence = primarySourceEvidence(snapshot); const items = rows(snapshot, 'archive_items'); const excerpts = rows(snapshot, 'archive_excerpts');
        const matches = [];
        const push = (layer, targetKind, id, title, text, extra = {}) => { const clean = String(text ?? '').replace(/\s+/g, ' ').trim(); if (!query || `${title} ${clean}`.toLocaleLowerCase().includes(query)) matches.push({ resultId: `${layer}:${id}`, layer, targetKind, itemId: targetKind === 'archive_item' ? id : extra.itemId ?? null, title: String(title), matchText: clean.slice(0, 240), matchStart: query ? Math.max(0, clean.toLocaleLowerCase().indexOf(query)) : 0, matchLength: query ? query.length : 0, hierarchy: [], repositoryName: null, referenceCode: null, dateDisplay: null, locator: extra.locator ?? null, excerptId: extra.excerptId ?? null, textVersionId: null, noteId: null, interpretation: false, unreviewedText: false }); };
        for (const item of items) push('metadata', 'archive_item', String(item.item_id), item.title, `${item.title ?? ''} ${item.description ?? ''} ${item.date_display ?? ''}`);
        for (const excerpt of excerpts) { const item = items.find((row) => String(row.item_id) === String(excerpt.item_id)); push('excerpt', 'archive_item', String(excerpt.item_id), item?.title ?? excerpt.item_id, excerpt.quoted_text, { excerptId: excerpt.excerpt_id, itemId: excerpt.item_id, locator: excerpt.locator_display }); }
        for (const trace of evidence) push(trace.targetKind === 'person' ? 'person' : trace.targetKind === 'event' ? 'event' : trace.targetKind === 'relationship' ? 'relation' : 'metadata', trace.targetKind, trace.targetId, trace.sourceTitle, trace.quote, { itemId: trace.itemId, excerptId: trace.excerptId, locator: trace.locator });
        return send(res, json, { queryText: query, parsedTerms: [], results: matches, total: matches.length, elapsedMs: 0, indexStrategy: 'snapshot', ftsRecommended: false, facets: { layers: primarySourceOptions(matches.map((row) => row.layer)).map((entry) => ({ ...entry, count: matches.filter((row) => row.layer === entry.id).length })), repositories: [], levels: [], formats: [], persons: [], places: [], reviewStatuses: [], accessStatuses: [] }, revision: space.revision });
      }
    }
    const collection = COLLECTIONS[head];
    if (collection) {
      const snapshot = requireSnapshot(res, json, space.id);
      if (!snapshot) return true;
      // A map's image bytes are content-addressed assets, so enrich only that list with
      // its published reference. This preserves the native canvas metadata while keeping
      // binary data out of JSON.
      const all = head === 'world-maps'
        ? publishedWorldMaps(snapshot)
        : head === 'persons'
          ? publishedPersons(snapshot)
          : head === 'events'
            ? publishedEvents(snapshot)
            : head === 'world-threads'
            ? publishedWorldThreads(snapshot)
            : head === 'world-rules'
              ? publishedWorldRules(snapshot)
              : head === 'world-questions'
                ? publishedWorldQuestions(snapshot)
            : head === 'world-scenes'
              ? (() => {
                // ManuscriptView's spine is metadata-only until a scene is opened. Keep
                // the same chapter/book boundaries and word counts on the catalogue row so
                // the Web navigator can mirror Desktop without shipping every scene's prose.
                const texts = new Map(rows(snapshot, 'world_scene_text').map((entry) => [String(entry.scene_id), entry]));
                const chapters = new Map(rows(snapshot, 'world_chapter_breaks').map((entry) => [String(entry.scene_id), entry]));
                const books = new Map(rows(snapshot, 'world_manuscript_starts').map((entry) => [String(entry.scene_id), entry]));
                return rows(snapshot, 'world_scenes').map((scene) => ({
                  ...scene,
                  manuscript_word_count: texts.get(String(scene.scene_id))?.word_count ?? 0,
                  manuscript_updated_at: texts.get(String(scene.scene_id))?.updated_at ?? null,
                  chapter: chapters.get(String(scene.scene_id)) ?? null,
                  book: books.get(String(scene.scene_id)) ?? null,
                })).sort((a, b) => (Number(a.narrative_order) || 0) - (Number(b.narrative_order) || 0));
              })()
            : head === 'study-materials'
            ? publishedStudyLibraryRows(snapshot)
            : head === 'testimony-interviews'
              ? publishedTestimonyInterviews(snapshot)
            : head === 'testimony-transcripts'
              ? publishedTestimonyTranscripts(snapshot)
            : head === 'study-schedule'
            ? rows(snapshot, 'study_schedule_periods').map((period) => ({
              ...period,
              academic_year_label: rows(snapshot, 'study_academic_years').find((year) => String(year.id) === String(period.academic_year_id))?.label ?? (period.academic_year_id ? String(period.academic_year_id) : 'Sin curso académico'),
              cells: rows(snapshot, 'study_schedule_cells')
                .filter((cell) => String(cell.period_id) === String(period.id))
                .map((cell) => ({ ...cell, subject_name: rows(snapshot, 'study_subjects').find((subject) => String(subject.id) === String(cell.subject_id))?.name ?? null })),
              day_colors: Object.fromEntries(rows(snapshot, 'study_schedule_day_styles')
                .filter((style) => String(style.academic_year_id ?? '') === String(period.academic_year_id ?? ''))
                .map((style) => [String(style.day), style.color ?? null])),
            }))
            : head === 'study-ideas'
              ? rows(snapshot, 'study_ideas').map((idea) => ({
                ...idea,
                edges: rows(snapshot, 'study_idea_edges').filter((edge) => String(edge.from_id) === String(idea.id) || String(edge.to_id) === String(idea.id)),
              }))
            : head === 'archive-items'
              ? rows(snapshot, 'archive_items').map((item) => ({
                ...item,
                folder_name: rows(snapshot, 'archive_folders').find((folder) => String(folder.folder_id) === String(item.folder_id))?.name ?? null,
              }))
              : head === 'teaching-exams'
                ? rows(snapshot, 'teaching_exams').map((exam) => {
                  let header = {};
                  try { header = JSON.parse(exam.header_json || '{}'); } catch { header = {}; }
                  return {
                    ...exam,
                    // The Web card mirrors Desktop's subject line without exposing the
                    // implementation JSON that backs the printable header.
                    subject_name: rows(snapshot, 'study_subjects').find((subject) => String(subject.id) === String(exam.subject_id))?.name ?? header.subjectName ?? null,
                    short_id: exam.short_id ?? exam.shortId ?? null,
                  };
                })
                : head === 'teaching-rubrics'
                  ? rows(snapshot, 'teaching_rubrics').map((rubric) => {
                    let criteriaValue = []; let levelsValue = []; let definition = {};
                    try { criteriaValue = JSON.parse(rubric.criteria_json || '[]'); } catch { criteriaValue = []; }
                    try { levelsValue = JSON.parse(rubric.levels_json || '[]'); } catch { levelsValue = []; }
                    if (criteriaValue && !Array.isArray(criteriaValue) && typeof criteriaValue === 'object') { definition = criteriaValue; criteriaValue = Array.isArray(definition.criteria) ? definition.criteria : []; }
                    if (!Array.isArray(criteriaValue)) criteriaValue = [];
                    if (!Array.isArray(levelsValue)) levelsValue = Array.isArray(definition.levels) ? definition.levels : [];
                    return {
                      ...rubric,
                      subject_name: rows(snapshot, 'study_subjects').find((subject) => String(subject.id) === String(rubric.subject_id))?.name ?? null,
                      criteria_count: criteriaValue.length,
                      levels_count: levelsValue.length,
                    };
                  })
              : rows(snapshot, collection.table);
      if (rest.length === 0) {
        if (url.searchParams.get('surface') === 'workspace' && head === 'ideas') {
          const result = workspaceIdeaPage(academicWorkspace(snapshot), {
            offset: readOffset(url.searchParams.get('offset')),
            limit: readLimit(url.searchParams.get('limit')),
            search: url.searchParams.get('q') ?? '',
            type: url.searchParams.get('type') ?? '',
            sort: url.searchParams.get('sort') ?? 'label',
          });
          if (notModified(req, res, json, space, url, key)) return true;
          const { items, ...pageResult } = result;
          return send(res, json, { ideas: items, ...pageResult, revision: space.revision });
        }
        if (url.searchParams.get('surface') === 'workspace' && head === 'authors') {
          const result = workspaceAuthorPage(academicWorkspace(snapshot), {
            offset: readOffset(url.searchParams.get('offset')),
            limit: readLimit(url.searchParams.get('limit')),
            query: url.searchParams.get('q') ?? '',
            synthesis: url.searchParams.get('synthesis') ?? 'all',
            sort: url.searchParams.get('sort') ?? 'surname',
          });
          if (notModified(req, res, json, space, url, key)) return true;
          const { items, ...pageResult } = result;
          return send(res, json, { authors: items, ...pageResult, revision: space.revision });
        }
        const query = url.searchParams.get('q');
        const requestedKind = url.searchParams.get('kind');
        const surface = url.searchParams.get('surface');
        const sourceRows = surface === 'continuity'
          ? publishedContinuityFindings(snapshot)
          : requestedKind && head === 'world-threads' ? all.filter((row) => String(row.kind) === requestedKind) : all;
        const filtered = query ? sourceRows.filter((row) => matchesRow(row, query)) : sourceRows;
        if (notModified(req, res, json, space, url, key)) return true;
        const limit = readLimit(url.searchParams.get('limit'));
        const offset = readOffset(url.searchParams.get('offset'));
        return send(res, json, {
          ...page(collection.key, filtered, limit, offset),
          ...(head === 'world-threads' && surface === 'conflicts' ? { board: publishedConflictBoard(snapshot, all) } : {}),
          ...(head === 'testimony-interviews' ? { facets: publishedTestimonyFacets(snapshot) } : {}),
          revision: space.revision,
        });
      }

      if (head === 'ideas' && rest[0] === 'routes') {
        if (notModified(req, res, json, space, url, key)) return true;
        return send(res, json, { routes: workspaceArgumentRoutes(academicWorkspace(snapshot)), revision: space.revision });
      }
      if (head === 'authors' && rest[0] === 'matrix') {
        if (notModified(req, res, json, space, url, key)) return true;
        return send(res, json, { matrix: workspaceSynthesisMatrix(academicWorkspace(snapshot)), revision: space.revision });
      }
      const wanted = decodeURIComponent(rest[0]);
      const row = all.find((candidate) => String(candidate[collection.id] ?? candidate.id) === wanted);
      if (!row) return missing(res, json);

      if (head.startsWith('prosopography-public-')) {
        if (notModified(req, res, json, space, url, key)) return true;
        // The aggregate row is already the complete public dossier. Returning it
        // under a named key keeps the Web reader's tab/detail contract without
        // inventing links back to private identity records.
        const detailKey = collection.key === 'analyses' ? 'analysis' : collection.key.replace(/s$/, '');
        return send(res, json, { [detailKey]: row, revision: space.revision, publication: { mode: 'aggregate-only', identityResolution: false } });
      }

      // The Desktop Analysis workbench reads the complete published database, not the
      // paginated grid page.  Keep this projection read-only and self-contained: the Web
      // adapter can run the same deterministic profile/analysis engine over the exact
      // values that travelled in the snapshot, without asking Desktop to recalculate or
      // mutating the snapshot on the server.  Attachment bytes are deliberately not part
      // of this payload; only the already-published metadata is retained.
      if (head === 'databases' && rest[1] === 'analysis') {
        if (notModified(req, res, json, space, url, key)) return true;
        const databaseId = String(row.id);
        const columns = rows(snapshot, 'db_columns')
          .filter((entry) => String(entry.database_id) === databaseId)
          .sort((a, b) => (Number(a.position) || 0) - (Number(b.position) || 0))
          .map((column) => {
            let config = {};
            try { config = parsedJson(column.config_json, {}); } catch { config = {}; }
            return {
              id: column.id,
              databaseId,
              name: column.name,
              type: column.type,
              position: column.position,
              config,
              options: rows(snapshot, 'db_select_options')
                .filter((option) => String(option.column_id) === String(column.id))
                .sort((a, b) => (Number(a.position) || 0) - (Number(b.position) || 0))
                .map((option) => ({ id: option.id, label: option.label, color: option.color ?? null, position: option.position, group: option.group_key ?? null })),
            };
          });
        const databaseRows = rows(snapshot, 'db_rows')
          .filter((entry) => String(entry.database_id) === databaseId)
          .sort((a, b) => (Number(a.position) || 0) - (Number(b.position) || 0));
        const rowIds = new Set(databaseRows.map((entry) => String(entry.id)));
        const cells = rows(snapshot, 'db_cells').filter((entry) => rowIds.has(String(entry.row_id)));
        const computed = rows(snapshot, 'db_computed_cells').filter((entry) => rowIds.has(String(entry.row_id)));
        const attachments = rows(snapshot, 'db_attachments').filter((entry) => rowIds.has(String(entry.row_id))).sort((a, b) => (Number(a.position) || 0) - (Number(b.position) || 0));
        const relations = rows(snapshot, 'db_relations').filter((entry) => rowIds.has(String(entry.row_id))).sort((a, b) => (Number(a.position) || 0) - (Number(b.position) || 0));
        const cellValue = (entry) => {
          // value_text is the canonical storage projection. The typed fallbacks cover
          // older snapshots where a number/date was only retained in its typed slot.
          if (entry.value_text != null) return String(entry.value_text);
          if (entry.value_json != null) return String(entry.value_json);
          if (entry.value_reference != null) return String(entry.value_reference);
          if (entry.value_date != null) return String(entry.value_date);
          if (entry.value_number != null) return String(entry.value_number);
          if (entry.value_integer != null) return String(entry.value_integer);
          return null;
        };
        const cellsByRow = new Map();
        for (const entry of [...cells, ...computed]) {
          const id = String(entry.row_id);
          const target = cellsByRow.get(id) ?? {};
          target[String(entry.column_id)] = cellValue(entry);
          cellsByRow.set(id, target);
        }
        const attachmentsByRow = new Map();
        for (const entry of attachments) {
          const id = String(entry.row_id);
          const target = attachmentsByRow.get(id) ?? {};
          const columnId = String(entry.column_id);
          (target[columnId] ??= []).push({
            id: entry.id, rowId: entry.row_id, columnId: entry.column_id,
            fileName: entry.file_name ?? null, mimeType: entry.mime_type ?? null,
            bytes: Number(entry.bytes) || 0, hasBlob: Boolean(entry.blob_hash || entry.has_blob),
            contentHash: entry.content_hash ?? null, description: entry.description ?? null,
            aiGenerated: Boolean(entry.ai_generated), position: Number(entry.position) || 0,
            createdAt: entry.created_at ?? null,
          });
          attachmentsByRow.set(id, target);
        }
        const relationCountsByRow = new Map();
        for (const entry of relations) {
          const id = String(entry.row_id);
          const target = relationCountsByRow.get(id) ?? {};
          const columnId = String(entry.column_id);
          target[columnId] = (target[columnId] || 0) + 1;
          relationCountsByRow.set(id, target);
        }
        const projectedRows = databaseRows.map((entry) => ({
          id: entry.id, databaseId, position: Number(entry.position) || 0,
          cells: cellsByRow.get(String(entry.id)) ?? {},
          attachments: attachmentsByRow.get(String(entry.id)) ?? {},
          relationCounts: relationCountsByRow.get(String(entry.id)) ?? {},
          createdAt: entry.created_at ?? null, updatedAt: entry.updated_at ?? null,
          revision: entry.revision ?? null, createdBy: entry.created_by ?? null,
          updatedBy: entry.updated_by ?? null, uniqueSequence: entry.unique_sequence ?? null,
        }));
        const views = rows(snapshot, 'db_views')
          .filter((entry) => String(entry.database_id) === databaseId)
          .sort((a, b) => (Number(a.position) || 0) - (Number(b.position) || 0))
          .map((view) => ({
            id: view.id, databaseId, name: view.name, layout: view.layout,
            filter: parsedJson(view.filter_json, null), sort: parsedJson(view.sort_json, null),
            config: parsedJson(view.config_json, null), scope: view.scope ?? null,
            revision: view.revision ?? null,
          }));
        return send(res, json, { database: row, columns, rows: projectedRows, views, total: projectedRows.length, revision: space.revision });
      }

      if (head === 'ideas') {
        if (rest[1] === 'graph') {
          const depth = Math.max(1, Math.min(MAX_GRAPH_DEPTH, Number(url.searchParams.get('depth')) || 1));
          const limit = readLimit(url.searchParams.get('limit'), MAX_GRAPH_IDEAS, MAX_GRAPH_IDEAS);
          if (notModified(req, res, json, space, url, key)) return true;
          return send(res, json, { ...ideaGraph(snapshot, wanted, depth, limit), revision: space.revision });
        }
        if (notModified(req, res, json, space, url, key)) return true;
        const ideaLabels = new Map(rows(snapshot, 'ideas').map((idea) => [String(idea.global_id), idea.label ?? idea.global_id]));
        const workMap = worksById(snapshot);
        const relations = visibleEdges(snapshot)
          .filter((edge) => String(edge.from_id) === wanted || String(edge.to_id) === wanted)
          .map((edge) => {
            const otherId = String(edge.from_id) === wanted ? String(edge.to_id) : String(edge.from_id);
            return {
              ...edge,
              other_id: otherId,
              other_label: ideaLabels.get(otherId) ?? otherId,
              from_label: ideaLabels.get(String(edge.from_id)) ?? String(edge.from_id),
              to_label: ideaLabels.get(String(edge.to_id)) ?? String(edge.to_id),
            };
          });
        const occurrences = rows(snapshot, 'idea_occurrences')
          .filter((entry) => String(entry.global_id) === wanted)
          .map((entry) => {
            const work = workMap.get(String(entry.nodus_id ?? '')) ?? null;
            return { ...entry, work, workTitle: work?.title ?? String(entry.nodus_id ?? '') };
          });
        const evidence = rows(snapshot, 'evidence')
          .filter((entry) => String(entry.global_id) === wanted)
          .map((entry) => {
            const work = workMap.get(String(entry.nodus_id ?? '')) ?? null;
            return { ...entry, work, workTitle: work?.title ?? String(entry.nodus_id ?? '') };
          });
        const themeLabels = new Map(rows(snapshot, 'themes').map((theme) => [String(theme.theme_id), theme.label]));
        const themes = rows(snapshot, 'idea_theme_links')
          .filter((link) => String(link.global_id) === wanted)
          .map((link) => themeLabels.get(String(link.theme_id)))
          .filter(Boolean);
        return send(res, json, { idea: row, relations, occurrences, evidence, themes: [...new Set(themes)], revision: space.revision });
      }

      if (head === 'works') {
        if (notModified(req, res, json, space, url, key)) return true;
        const nodusId = String(row.nodus_id);
        const ideaIds = new Set(rows(snapshot, 'idea_occurrences').filter((entry) => String(entry.nodus_id) === nodusId).map((entry) => String(entry.global_id)));
        const profileState = rows(snapshot, 'document_profile_state').find((entry) => String(entry.nodus_id) === nodusId) ?? null;
        const profileVersionId = profileState?.current_version_id == null ? null : String(profileState.current_version_id);
        const profileVersion = profileVersionId
          ? rows(snapshot, 'document_profile_versions').find((entry) => String(entry.version_id) === profileVersionId) ?? null
          : null;
        const documentProfile = profileVersion ? {
          state: profileState,
          version: profileVersion,
          fields: rows(snapshot, 'document_profile_fields').filter((entry) => String(entry.version_id) === profileVersionId),
          sections: rows(snapshot, 'document_sections').filter((entry) => String(entry.version_id) === profileVersionId),
          supports: rows(snapshot, 'document_profile_support').filter((entry) => String(entry.version_id) === profileVersionId),
          ideaLinks: rows(snapshot, 'document_idea_links').filter((entry) => String(entry.version_id) === profileVersionId),
          citationPolicy: 'orientation_only',
        } : null;
        const ideaRows = rows(snapshot, 'ideas').filter((idea) => ideaIds.has(String(idea.global_id)));
        const ideaLabels = new Map(ideaRows.map((idea) => [String(idea.global_id), idea.label ?? idea.global_id]));
        const occurrences = rows(snapshot, 'idea_occurrences')
          .filter((entry) => String(entry.nodus_id) === nodusId)
          .map((entry) => ({ ...entry, idea: ideaRows.find((idea) => String(idea.global_id) === String(entry.global_id)) ?? null }));
        const evidence = rows(snapshot, 'evidence').filter((entry) => String(entry.nodus_id) === nodusId);
        const relations = visibleEdges(snapshot).filter((edge) => ideaIds.has(String(edge.from_id)) || ideaIds.has(String(edge.to_id))).map((edge) => ({
          ...edge,
          from_label: ideaLabels.get(String(edge.from_id)) ?? String(edge.from_id),
          to_label: ideaLabels.get(String(edge.to_id)) ?? String(edge.to_id),
        }));
        return send(res, json, {
          work: worksById(snapshot).get(nodusId) ?? row,
          ideas: ideaRows,
          occurrences,
          evidence,
          relations,
          summary: rows(snapshot, 'work_summaries').find((entry) => String(entry.nodus_id) === nodusId) ?? null,
          passages: rows(snapshot, 'passages').filter((entry) => String(entry.nodus_id) === nodusId).length,
          documentProfile,
          revision: space.revision,
        });
      }

      // Academic search results for passages, themes and gaps need a real detail response as
      // well. Returning only the catalogue row made the Server Web fall through to its generic
      // metadata card, so a click lost the same evidence context Desktop shows.
      if (head === 'passages') {
        if (notModified(req, res, json, space, url, key)) return true;
        const nodusId = String(row.nodus_id ?? '');
        return send(res, json, {
          passage: row,
          work: rows(snapshot, 'works').find((entry) => String(entry.nodus_id) === nodusId) ?? null,
          ideas: rows(snapshot, 'idea_occurrences')
            .filter((entry) => String(entry.nodus_id) === nodusId && String(entry.passage_id ?? '') === wanted)
            .map((entry) => rows(snapshot, 'ideas').find((idea) => String(idea.global_id) === String(entry.global_id)) ?? null)
            .filter(Boolean),
          revision: space.revision,
        });
      }

      if (head === 'themes') {
        if (notModified(req, res, json, space, url, key)) return true;
        const ideaIds = new Set(rows(snapshot, 'idea_theme_links').filter((entry) => String(entry.theme_id) === wanted).map((entry) => String(entry.global_id)));
        return send(res, json, {
          theme: row,
          ideas: rows(snapshot, 'ideas').filter((entry) => ideaIds.has(String(entry.global_id))),
          revision: space.revision,
        });
      }

      if (head === 'gaps') {
        if (notModified(req, res, json, space, url, key)) return true;
        const work = rows(snapshot, 'works').find((entry) => String(entry.nodus_id) === String(row.nodus_id ?? '')) ?? null;
        const idea = rows(snapshot, 'ideas').find((entry) => String(entry.global_id) === String(row.related_idea ?? '')) ?? null;
        const evidence = rows(snapshot, 'evidence').find((entry) => String(entry.id) === String(row.evidence_id ?? '')) ?? null;
        return send(res, json, { gap: row, work, idea, evidence, revision: space.revision });
      }

      // Dictionary entries are authored corpus objects.  Opening one in Desktop
      // exposes its evidence, linked concepts and version history; returning the
      // bare row here made the Web reader fall back to an unrelated metadata card.
      if (head === 'dictionary') {
        if (notModified(req, res, json, space, url, key)) return true;
        const entryId = String(row.id);
        const parseJson = (value, fallback = []) => {
          try { const parsed = JSON.parse(value || ''); return parsed ?? fallback; } catch { return fallback; }
        };
        const evidence = rows(snapshot, 'dictionary_evidence').filter((item) => String(item.entry_id) === entryId);
        const relations = rows(snapshot, 'dictionary_relations')
          .filter((item) => String(item.from_entry_id) === entryId || String(item.to_entry_id) === entryId)
          .map((item) => {
            const otherId = String(item.from_entry_id) === entryId ? item.to_entry_id : item.from_entry_id;
            return { ...item, other_entry_id: otherId, other_entry: rows(snapshot, 'dictionary_entries').find((candidate) => String(candidate.id) === String(otherId)) ?? null };
          });
        const versions = rows(snapshot, 'dictionary_versions')
          .filter((item) => String(item.entry_id) === entryId)
          .sort((a, b) => String(b.generated_at ?? b.created_at ?? '').localeCompare(String(a.generated_at ?? a.created_at ?? '')))
          .map((item) => ({ ...item, evidence: parseJson(item.evidence_json), citations: parseJson(item.citations_json) }));
        return send(res, json, { entry: { ...row, aliases: parseJson(row.aliases_json), tags: parseJson(row.tags_json) }, evidence, relations, versions, revision: space.revision });
      }

      if (head === 'persons') {
        if (notModified(req, res, json, space, url, key)) return true;
        const personId = String(row.person_id);
        const involved = (table, column) => rows(snapshot, table).filter((entry) => String(entry[column]) === personId);
        const eventIds = new Set(involved('event_participants', 'person_id').map((entry) => String(entry.event_id)));
        const relationships = rows(snapshot, 'relationships').filter((entry) => String(entry.from_person) === personId || String(entry.to_person) === personId);
        const relatedPersonIds = new Set(relationships.flatMap((entry) => [String(entry.from_person ?? ''), String(entry.to_person ?? '')]).filter((id) => id && id !== personId));
        const placeLinks = involved('person_places', 'person_id');
        const placeIds = new Set(placeLinks.map((entry) => String(entry.place_id ?? '')).filter(Boolean));
        const affiliations = involved('character_affiliations', 'person_id');
        const appearances = involved('scene_characters', 'person_id');
        const sceneIds = new Set(appearances.map((entry) => String(entry.scene_id)));
        const knowledge = involved('secret_knowers', 'person_id');
        const secretIds = new Set(knowledge.map((entry) => String(entry.secret_id)));
        return send(res, json, {
          person: row,
          names: involved('person_names', 'person_id'),
          places: rows(snapshot, 'places').filter((entry) => placeIds.has(String(entry.place_id))),
          placeLinks,
          // `from_person`/`to_person`, which is what migration 1154 actually creates. Filtering
          // on `*_person_id` matched nothing, so every person in every genealogy and
          // prosopography vault came back with an empty relationships list.
          relationships,
          relatedPersons: publishedPersons(snapshot).filter((entry) => relatedPersonIds.has(String(entry.person_id))),
          events: rows(snapshot, 'events').filter((entry) => eventIds.has(String(entry.event_id))),
          abilities: involved('character_abilities', 'person_id'),
          affiliations: affiliations.map((entry) => ({ ...entry, group: rows(snapshot, 'world_groups').find((group) => String(group.group_id) === String(entry.group_id)) ?? null })),
          scenes: rows(snapshot, 'world_scenes').filter((entry) => sceneIds.has(String(entry.scene_id))).map((entry) => ({ ...entry, appearance: appearances.find((appearance) => String(appearance.scene_id) === String(entry.scene_id)) ?? null })),
          secrets: rows(snapshot, 'world_secrets').filter((entry) => String(entry.owner_person_id) === personId || secretIds.has(String(entry.secret_id))).map((entry) => ({ ...entry, knowledge: knowledge.find((known) => String(known.secret_id) === String(entry.secret_id)) ?? null })),
          images: publishedWorldImages(snapshot, 'character', personId),
          // Metadata only: the portrait's bytes live on the asset channel.
          portrait: rows(snapshot, 'person_portraits').find((entry) => String(entry.person_id) === personId) ?? null,
          revision: space.revision,
        });
      }

      if (head === 'places') {
        if (notModified(req, res, json, space, url, key)) return true;
        const placeId = String(row.place_id);
        const personLinks = rows(snapshot, 'person_places').filter((entry) => String(entry.place_id) === placeId);
        const personIds = new Set(personLinks.map((entry) => String(entry.person_id)));
        return send(res, json, {
          place: row,
          profile: rows(snapshot, 'place_profiles').find((entry) => String(entry.place_id) === placeId) ?? null,
          parent: rows(snapshot, 'places').find((entry) => String(entry.place_id) === String(row.parent_id ?? '')) ?? null,
          children: rows(snapshot, 'places').filter((entry) => String(entry.parent_id ?? '') === placeId),
          persons: publishedPersons(snapshot).filter((entry) => personIds.has(String(entry.person_id))),
          personLinks,
          events: rows(snapshot, 'events').filter((entry) => String(entry.place_id) === placeId),
          images: publishedWorldImages(snapshot, 'place', placeId),
          revision: space.revision,
        });
      }

      if (head === 'events') {
        if (notModified(req, res, json, space, url, key)) return true;
        const eventId = String(row.event_id);
        const participantRows = rows(snapshot, 'event_participants').filter((entry) => String(entry.event_id) === eventId);
        const personIds = new Set(participantRows.map((entry) => String(entry.person_id)));
        return send(res, json, {
          event: row,
          participants: rows(snapshot, 'persons').filter((entry) => personIds.has(String(entry.person_id))),
          participantRows,
          place: rows(snapshot, 'places').find((entry) => String(entry.place_id) === String(row.place_id)) ?? null,
          revision: space.revision,
        });
      }

      if (head === 'relationships') {
        if (notModified(req, res, json, space, url, key)) return true;
        return send(res, json, {
          relationship: row,
          from: rows(snapshot, 'persons').find((entry) => String(entry.person_id) === String(row.from_person)) ?? null,
          to: rows(snapshot, 'persons').find((entry) => String(entry.person_id) === String(row.to_person)) ?? null,
          revision: space.revision,
        });
      }

      // Primary-source dossiers are more than the archive_items row. Keep the
      // Desktop source sheet useful by resolving its published excerpts,
      // descriptive units, repository and source analysis in one request. The
      // binary/blob columns have already been removed while building the snapshot.
      if (head === 'archive-items') {
        if (notModified(req, res, json, space, url, key)) return true;
        const itemId = String(row.item_id);
        const itemUnits = rows(snapshot, 'archive_item_units').filter((entry) => String(entry.item_id) === itemId);
        const unitIds = new Set(itemUnits.map((entry) => String(entry.unit_id)));
        const units = rows(snapshot, 'archive_description_units').filter((entry) => unitIds.has(String(entry.unit_id)));
        const repositoryId = units.find((entry) => entry.repository_id != null)?.repository_id;
        // The Desktop dossier's Text/Evidences tabs are backed by these normalized
        // projections, not by archive_item_files (whose bytes and paths must stay local).
        // Keep the text itself, but never include a file/blob/path column in this response.
        const textVersions = rows(snapshot, 'archive_text_versions')
          .filter((entry) => String(entry.item_id) === itemId)
          .sort((a, b) => String(b.created_at ?? '').localeCompare(String(a.created_at ?? '')))
          .map(({ file_id: _fileId, created_by: _createdBy, ...version }) => ({
            ...version,
            segments: rows(snapshot, 'archive_text_segments')
              .filter((segment) => String(segment.text_version_id) === String(version.text_version_id))
              .sort((a, b) => (Number(a.sequence_no) || 0) - (Number(b.sequence_no) || 0))
              .map(({ file_id: _segmentFileId, bbox_json: _bbox, ...segment }) => segment),
          }));
        const evidence = rows(snapshot, 'record_evidence')
          .filter((entry) => String(entry.target_id) === itemId
            || (String(entry.source_kind) === 'archive' && String(entry.nodus_id) === itemId))
          .map(({ created_by: _createdBy, ...entry }) => entry);
        return send(res, json, {
          item: row,
          profile: rows(snapshot, 'archive_item_profiles').find((entry) => String(entry.item_id) === itemId) ?? null,
          tags: rows(snapshot, 'archive_item_tags').filter((entry) => String(entry.item_id) === itemId),
          folders: rows(snapshot, 'archive_item_folders').filter((entry) => String(entry.item_id) === itemId),
          persons: rows(snapshot, 'archive_item_persons').filter((entry) => String(entry.item_id) === itemId),
          excerpts: rows(snapshot, 'archive_excerpts').filter((entry) => String(entry.item_id) === itemId),
          textVersions,
          evidence,
          personMentions: rows(snapshot, 'archive_person_mentions').filter((entry) => String(entry.item_id) === itemId),
          placeMentions: rows(snapshot, 'archive_place_mentions').filter((entry) => String(entry.item_id) === itemId),
          analysis: rows(snapshot, 'archive_source_analyses').find((entry) => String(entry.item_id) === itemId) ?? null,
          itemUnits,
          units,
          repository: repositoryId == null ? null : rows(snapshot, 'archive_repositories').find((entry) => String(entry.repository_id) === String(repositoryId)) ?? null,
          revision: space.revision,
        });
      }

      // The archive navigator opens these records from the source dossier.  Keep
      // their linked context in the response so a nested tab does not degrade to
      // the raw five-column fallback (and never include local paths or file bytes).
      if (head === 'archive-repositories') {
        if (notModified(req, res, json, space, url, key)) return true;
        const repositoryId = String(row.repository_id);
        const units = rows(snapshot, 'archive_description_units').filter((entry) => String(entry.repository_id) === repositoryId);
        const unitIds = new Set(units.map((entry) => String(entry.unit_id)));
        const itemIds = new Set(rows(snapshot, 'archive_item_units').filter((entry) => unitIds.has(String(entry.unit_id))).map((entry) => String(entry.item_id)));
        return send(res, json, {
          repository: row,
          units,
          items: rows(snapshot, 'archive_items').filter((entry) => itemIds.has(String(entry.item_id))),
          revision: space.revision,
        });
      }

      if (head === 'archive-units') {
        if (notModified(req, res, json, space, url, key)) return true;
        const unitId = String(row.unit_id);
        const links = rows(snapshot, 'archive_item_units').filter((entry) => String(entry.unit_id) === unitId);
        const itemIds = new Set(links.map((entry) => String(entry.item_id)));
        return send(res, json, {
          unit: row,
          repository: row.repository_id == null ? null : rows(snapshot, 'archive_repositories').find((entry) => String(entry.repository_id) === String(row.repository_id)) ?? null,
          links,
          items: rows(snapshot, 'archive_items').filter((entry) => itemIds.has(String(entry.item_id))),
          revision: space.revision,
        });
      }

      if (head === 'archive-excerpts') {
        if (notModified(req, res, json, space, url, key)) return true;
        const itemId = String(row.item_id ?? '');
        return send(res, json, {
          excerpt: row,
          item: itemId ? rows(snapshot, 'archive_items').find((entry) => String(entry.item_id) === itemId) ?? null : null,
          revision: space.revision,
        });
      }

      if (head === 'source-analyses') {
        if (notModified(req, res, json, space, url, key)) return true;
        const itemId = String(row.item_id ?? '');
        return send(res, json, {
          analysis: row,
          item: itemId ? rows(snapshot, 'archive_items').find((entry) => String(entry.item_id) === itemId) ?? null : null,
          revision: space.revision,
        });
      }

      // Testimony media and session rows are intentionally not published. The
      // snapshot builder annotates each published transcript with its interview id
      // from those private joins, allowing this read-only dossier without exposing
      // recording paths, media metadata or participant identities.
      if (head === 'testimony-interviews') {
        if (notModified(req, res, json, space, url, key)) return true;
        const annotations = publishedTestimonyAnnotations(snapshot).filter((entry) => String(entry.interview_id) === wanted);
        const annotationIds = new Set(annotations.map((entry) => String(entry.id)));
        const codeLinks = rows(snapshot, 'testimony_annotation_codes').filter((entry) => annotationIds.has(String(entry.annotation_id)));
        const codeIds = new Set(codeLinks.map((entry) => String(entry.code_id)));
        return send(res, json, {
          interview: row,
          transcripts: publishedTestimonyTranscripts(snapshot).filter((entry) => String(entry.interview_id ?? '') === wanted),
          annotations,
          annotationCodes: codeLinks,
          codes: rows(snapshot, 'testimony_codes').filter((entry) => codeIds.has(String(entry.id))),
          revision: space.revision,
        });
      }
      if (head === 'testimony-contrasts') {
        if (notModified(req, res, json, space, url, key)) return true;
        const items = rows(snapshot, 'testimony_contrast_items').map(testimonySafeRow)
          .filter((entry) => String(entry.contrast_id) === wanted)
          .sort((a, b) => (Number(a.position) || 0) - (Number(b.position) || 0));
        const annotationIds = new Set(items.map((entry) => String(entry.annotation_id)));
        return send(res, json, {
          contrast: row,
          items,
          annotations: publishedTestimonyAnnotations(snapshot).filter((entry) => annotationIds.has(String(entry.id))).map(({ interview_id: _interviewId, transcript_id: _transcriptId, ...annotation }) => annotation),
          revision: space.revision,
        });
      }

      if (head === 'testimony-transcripts') {
        if (notModified(req, res, json, space, url, key)) return true;
        return send(res, json, {
          transcript: row,
          segments: rows(snapshot, 'testimony_transcript_segments')
            .filter((entry) => String(entry.transcript_id) === wanted)
            .sort((a, b) => (Number(a.position) || 0) - (Number(b.position) || 0))
            .map(({ speaker_person_id: _speakerPersonId, ...segment }) => testimonySafeRow(segment)),
          annotations: publishedTestimonyAnnotations(snapshot).filter((entry) => String(entry.transcript_id) === wanted),
          revision: space.revision,
        });
      }

      if (head === 'testimony-codes') {
        if (notModified(req, res, json, space, url, key)) return true;
        const codeId = String(row.id);
        const links = rows(snapshot, 'testimony_annotation_codes').filter((entry) => String(entry.code_id) === codeId);
        const annotationIds = new Set(links.map((entry) => String(entry.annotation_id)));
        return send(res, json, {
          code: row,
          links,
          annotations: publishedTestimonyAnnotations(snapshot).filter((entry) => annotationIds.has(String(entry.id))).map(({ interview_id: _interviewId, transcript_id: _transcriptId, ...annotation }) => annotation),
          revision: space.revision,
        });
      }

      if (head === 'databases') {
        if (notModified(req, res, json, space, url, key)) return true;
        const databaseId = String(row.id);
        const byPosition = (a, b) => (Number(a.position) || 0) - (Number(b.position) || 0);
        // The user's own order, not the snapshot's. It matters twice over for rows: the page
        // is cut *after* this sort, so serving snapshot order would make page two a different
        // set of rows from the one the desktop shows.
        const columns = rows(snapshot, 'db_columns').filter((entry) => String(entry.database_id) === databaseId).sort(byPosition);
        const dbRows = rows(snapshot, 'db_rows').filter((entry) => String(entry.database_id) === databaseId).sort(byPosition);
        const limit = readLimit(url.searchParams.get('limit'));
        const offset = readOffset(url.searchParams.get('offset'));
        const page = dbRows.slice(offset, offset + limit);
        const pageIds = new Set(page.map((entry) => String(entry.id)));

        // Which attachment's bytes actually travelled, by hash. An `attachment` column takes
        // whatever the user dropped on it, and only images ride the asset channel
        // (`ASSET_SOURCES` in electron/serverSync/serverSnapshot.ts) — so a row with a PDF
        // still says it has a PDF, and says it has no image to show.
        const images = new Map(
          (Array.isArray(snapshot.assets) ? snapshot.assets : [])
            .filter((asset) => asset.kind === 'db_attachment')
            .map((asset) => [String(asset.key?.[0] ?? ''), asset])
        );
        const attachments = rows(snapshot, 'db_attachments')
          .filter((entry) => pageIds.has(String(entry.row_id)))
          .sort(byPosition)
          .map((entry) => {
            const asset = images.get(String(entry.id)) ?? null;
            // `extracted_text` is the whole of a scanned document's text and nothing here
            // renders it, so it stays in the snapshot — where the offline copy still has it —
            // rather than riding along with every page of a gallery.
            const { extracted_text: _text, ...rest } = entry;
            return {
              ...rest,
              hash: asset?.hash ?? null,
              // The grid draws the thumbnail and the row draws the full image; sending both
              // hashes means a page of forty photographs costs forty thumbnails, not forty
              // originals.
              thumbHash: asset?.thumbHash ?? null,
              imageMime: asset?.mime ?? null,
            };
          });

        return send(res, json, {
          database: row,
          columns,
          views: rows(snapshot, 'db_views').filter((entry) => String(entry.database_id) === databaseId).sort(byPosition),
          options: rows(snapshot, 'db_select_options').filter((entry) => columns.some((column) => String(column.id) === String(entry.column_id))).sort(byPosition),
          rows: page,
          // Only the cells of the page being served: a database with fifty thousand rows
          // would otherwise ship every value it has to render twenty of them.
          // Formula and rollup values are persisted in the derived table on Desktop;
          // publish them beside ordinary cells so a read-only grid does not lose a
          // computed column at the publication boundary.
          cells: [
            ...rows(snapshot, 'db_cells').filter((entry) => pageIds.has(String(entry.row_id))),
            ...rows(snapshot, 'db_computed_cells').filter((entry) => pageIds.has(String(entry.row_id))),
          ],
          // Same rule, same reason. A relation cell is a list of rows in `db_relations`, and
          // without them a relation column renders as nothing at all.
          relations: rows(snapshot, 'db_relations').filter((entry) => pageIds.has(String(entry.row_id))).sort(byPosition),
          attachments,
          total: dbRows.length,
          limit,
          offset,
          hasMore: offset + page.length < dbRows.length,
          revision: space.revision,
        });
      }

      // Database pages are the Notion-like reader in Desktop, not a flat row
      // record.  Keep the published page blocks and inbound/outbound links in
      // the same response so opening a page does not collapse it into raw
      // implementation columns (content_json is intentionally stripped by the
      // snapshot sanitizer; normalized_text is the safe textual projection).
      if (head === 'database-pages') {
        if (notModified(req, res, json, space, url, key)) return true;
        const pageId = String(row.id);
        return send(res, json, {
          page: row,
          blocks: rows(snapshot, 'page_blocks')
            .filter((entry) => String(entry.page_id) === pageId && entry.trashed_at == null)
            .sort((a, b) => (Number(a.sort_order) || 0) - (Number(b.sort_order) || 0)),
          links: rows(snapshot, 'page_links').filter((entry) => String(entry.source_page_id ?? '') === pageId || String(entry.target_page_id ?? '') === pageId),
          comments: rows(snapshot, 'page_comments').filter((entry) => String(entry.page_id) === pageId).map((entry) => ({ id: entry.id, body: entry.body, created_at: entry.created_at })),
          revision: space.revision,
        });
      }

      // An exam is its questions. Without them the detail is a title, a language and a
      // target count — which is what a teacher opening an exam on a phone got.
      if (head === 'teaching-exams') {
        if (notModified(req, res, json, space, url, key)) return true;
        const examId = String(row.id);
        const questions = rows(snapshot, 'teaching_exam_questions')
          .filter((entry) => String(entry.exam_id) === examId)
          .sort((a, b) => (Number(a.position) || 0) - (Number(b.position) || 0));
        return send(res, json, {
          exam: row,
          questions,
          // The two names the header prints. Sending the ids alone would make the client
          // fetch two more rows to render one line.
          subject: rows(snapshot, 'study_subjects').find((entry) => String(entry.id) === String(row.subject_id)) ?? null,
          course: rows(snapshot, 'study_courses').find((entry) => String(entry.id) === String(row.course_id)) ?? null,
          // `examTotalPoints` (shared/teachingExams.ts:290) to the letter: a `section` is a
          // shared statement, not a question, and its mark is the sum of the sub-questions
          // hanging from it. Counting its own points would print an exam worth more than it is.
          points: questions.reduce(
            (total, question) => (question.type === 'section' ? total : total + (Number(question.points) || 0)),
            0
          ),
          revision: space.revision,
        });
      }

      // A plan is its blocks, in the order they happen — not in snapshot order, which for a
      // calendar is no order at all.
      if (head === 'study-plans') {
        if (notModified(req, res, json, space, url, key)) return true;
        const planId = String(row.id);
        return send(res, json, {
          plan: row,
          blocks: rows(snapshot, 'study_plan_blocks')
            .filter((entry) => String(entry.plan_id) === planId)
            .sort((a, b) => String(a.starts_at ?? '').localeCompare(String(b.starts_at ?? ''))),
          revision: space.revision,
        });
      }
      if (head === 'study-schedule') {
        if (notModified(req, res, json, space, url, key)) return true;
        return send(res, json, {
          period: row,
          cells: Array.isArray(row.cells) ? row.cells : [],
          subjects: rows(snapshot, 'study_subjects'),
          revision: space.revision,
        });
      }

      // Worldbuilding dossiers are composed from the same linked records as Desktop. A
      // bare row made every tab look populated in the catalogue and empty after opening it.
      if (head.startsWith('world-')) {
        if (notModified(req, res, json, space, url, key)) return true;
        const id = wanted;
        if (head === 'world-maps') {
          const maps = publishedWorldMaps(snapshot);
          const map = maps.find((entry) => String(entry.map_id) === id);
          if (!map) return missing(res, json);
          const ancestry = [];
          const seen = new Set();
          let cursor = map;
          while (cursor && !seen.has(String(cursor.map_id))) {
            seen.add(String(cursor.map_id));
            ancestry.push(cursor);
            cursor = maps.find((entry) => String(entry.map_id) === String(cursor.parent_map_id)) ?? null;
          }
          const places = rows(snapshot, 'places');
          const childMaps = maps.filter((entry) => String(entry.parent_map_id) === id);
          const layers = rows(snapshot, 'map_layers')
            .filter((entry) => String(entry.map_id) === id)
            .sort((a, b) => (Number(a.sort_order) || 0) - (Number(b.sort_order) || 0));
          const layerIds = new Set(layers.map((entry) => String(entry.layer_id)));
          const markers = rows(snapshot, 'map_markers')
            .filter((entry) => String(entry.map_id) === id)
            .sort((a, b) => (Number(a.sort_order) || 0) - (Number(b.sort_order) || 0))
            .map((entry) => ({
              ...entry,
              // The native marker DTO resolves these names before rendering its sheet.
              place_name: places.find((place) => String(place.place_id) === String(entry.place_id))?.name ?? null,
              child_map_name: maps.find((child) => String(child.map_id) === String(entry.child_map_id))?.name ?? null,
              layer_name: layerIds.has(String(entry.layer_id)) ? layers.find((layer) => String(layer.layer_id) === String(entry.layer_id))?.name ?? null : null,
            }));
          return send(res, json, {
            map,
            image: map.image ?? null,
            ancestry: ancestry.reverse(),
            children: childMaps,
            layers,
            markers,
            travelModes: rows(snapshot, 'map_travel_modes'),
            calendar: rows(snapshot, 'world_calendar'),
            calendarEras: rows(snapshot, 'world_calendar_eras'),
            calendarMonths: rows(snapshot, 'world_calendar_months'),
            scenes: rows(snapshot, 'world_scenes'),
            sceneDays: rows(snapshot, 'world_scene_days'),
            revision: space.revision,
          });
        }
        const links = rows(snapshot, 'world_links').filter((entry) => String(entry.source_id) === id);
        if (head === 'world-groups') {
          const affiliations = rows(snapshot, 'character_affiliations').filter((entry) => String(entry.group_id) === id);
          const personIds = new Set(affiliations.map((entry) => String(entry.person_id)));
          return send(res, json, {
            group: row,
            children: rows(snapshot, 'world_groups').filter((entry) => String(entry.parent_id) === id),
            affiliations,
            members: publishedPersons(snapshot).filter((entry) => personIds.has(String(entry.person_id))),
            images: publishedWorldImages(snapshot, 'group', id),
            links,
            seat: rows(snapshot, 'places').find((entry) => String(entry.place_id) === String(row.seat_place_id)) ?? null,
            revision: space.revision,
          });
        }
        if (head === 'world-scenes') return send(res, json, {
          scene: row,
          text: (() => {
            const manuscript = rows(snapshot, 'world_scene_text').find((entry) => String(entry.scene_id) === id) ?? null;
            return manuscript ? { ...manuscript, content_markdown: manuscript.content_markdown ?? manuscript.text ?? manuscript.body ?? null } : null;
          })(),
          beats: rows(snapshot, 'world_beats').filter((entry) => String(entry.scene_id) === id).sort((a, b) => String(a.mark ?? '').localeCompare(String(b.mark ?? ''))),
          snapshots: rows(snapshot, 'world_scene_snapshots').filter((entry) => String(entry.scene_id) === id),
          place: rows(snapshot, 'places').find((entry) => String(entry.place_id) === String(row.place_id)) ?? null,
          cast: rows(snapshot, 'scene_characters').filter((entry) => String(entry.scene_id) === id).map((entry) => ({ ...entry, person: publishedPersons(snapshot).find((person) => String(person.person_id) === String(entry.person_id)) ?? null })),
          images: publishedWorldImages(snapshot, 'scene', id),
          links,
          revision: space.revision,
        });
        if (head === 'world-articles') return send(res, json, {
          article: row,
          rules: rows(snapshot, 'world_rules').filter((entry) => String(entry.article_id) === id),
          links,
          revision: space.revision,
        });
        if (head === 'world-threads') return send(res, json, {
          thread: row,
          beats: (Array.isArray(row.beats) ? row.beats : rows(snapshot, 'world_beats').filter((entry) => String(entry.thread_id) === id)).sort((a, b) => (Number(a.narrativeOrder ?? a.narrative_order) || 0) - (Number(b.narrativeOrder ?? b.narrative_order) || 0)),
          links,
          revision: space.revision,
        });
        if (head === 'world-rules') return send(res, json, {
          rule: row,
          children: rows(snapshot, 'world_rules').filter((entry) => String(entry.parent_rule_id) === id),
          article: rows(snapshot, 'world_articles').find((entry) => String(entry.article_id) === String(row.article_id)) ?? null,
          links,
          revision: space.revision,
        });
        if (head === 'world-questions') return send(res, json, {
          question: row,
          options: Array.isArray(row.options) ? row.options : rows(snapshot, 'world_question_options').filter((entry) => String(entry.question_id) === id),
          links,
          revision: space.revision,
        });
        return send(res, json, { [head.replace(/^world-/, '').replace(/s$/, '')]: row, links, revision: space.revision });
      }

      // Study details preserve the hierarchy and the contextual tables visible in Desktop.
      // File blobs, local paths, students and grades are absent from the publication contract.
      if (head === 'study-courses') {
        if (notModified(req, res, json, space, url, key)) return true;
        return send(res, json, {
          course: row,
          subjects: rows(snapshot, 'study_subjects').filter((entry) => String(entry.course_id) === wanted),
          calendar: rows(snapshot, 'study_calendar_events').filter((entry) => String(entry.course_id) === wanted).sort((a, b) => String(a.starts_at ?? '').localeCompare(String(b.starts_at ?? ''))),
          plans: rows(snapshot, 'study_plans').filter((entry) => String(entry.course_id) === wanted),
          revision: space.revision,
        });
      }
      if (head === 'study-materials') {
        if (notModified(req, res, json, space, url, key)) return true;
        if (row.source_kind === 'document') {
          return send(res, json, {
            document: row,
            links: rows(snapshot, 'study_doc_links').filter((entry) => String(entry.source_document_id ?? entry.document_id) === wanted || String(entry.target_document_id) === wanted),
            tags: rows(snapshot, 'study_doc_tags').filter((entry) => String(entry.document_id) === wanted),
            revision: space.revision,
          });
        }
        return send(res, json, {
          material: row,
          placements: rows(snapshot, 'study_material_placements').filter((entry) => String(entry.material_id) === wanted),
          versions: rows(snapshot, 'study_material_versions').filter((entry) => String(entry.material_id) === wanted),
          annotations: rows(snapshot, 'study_material_annotations').filter((entry) => String(entry.material_id) === wanted),
          revision: space.revision,
        });
      }
      if (head === 'study-questions') {
        if (notModified(req, res, json, space, url, key)) return true;
        return send(res, json, {
          question: row,
          versions: rows(snapshot, 'study_question_versions').filter((entry) => String(entry.question_id) === wanted).sort((a, b) => (Number(b.version_no) || 0) - (Number(a.version_no) || 0)),
          revision: space.revision,
        });
      }
      if (head === 'study-ideas') {
        if (notModified(req, res, json, space, url, key)) return true;
        return send(res, json, {
          idea: row,
          edges: rows(snapshot, 'study_idea_edges').filter((entry) => String(entry.from_id) === wanted || String(entry.to_id) === wanted),
          occurrences: rows(snapshot, 'study_idea_occurrences').filter((entry) => String(entry.idea_id) === wanted),
          revision: space.revision,
        });
      }

      if (head === 'teaching-rubrics') {
        if (notModified(req, res, json, space, url, key)) return true;
        return send(res, json, { rubric: row, revision: space.revision });
      }

      if (head === 'authors') {
        if (notModified(req, res, json, space, url, key)) return true;
        const authorId = String(row.author_id);
        if (rest[1] === 'dossier') {
          const dossier = workspaceAuthorDossier(academicWorkspace(snapshot), authorId);
          return dossier ? send(res, json, { dossier, revision: space.revision }) : missing(res, json);
        }
        const workIds = new Set(rows(snapshot, 'work_authors').filter((entry) => String(entry.author_id) === authorId).map((entry) => String(entry.nodus_id)));
        return send(res, json, {
          author: row,
          works: rows(snapshot, 'works').filter((work) => workIds.has(String(work.nodus_id))),
          relations: rows(snapshot, 'author_relations').filter((entry) => String(entry.from_author) === authorId || String(entry.to_author) === authorId),
          synthesis: rows(snapshot, 'author_dossier_synthesis').find((entry) => String(entry.author_id) === authorId) ?? null,
          revision: space.revision,
        });
      }

      if (notModified(req, res, json, space, url, key)) return true;
      return send(res, json, { [head.replace(/s$/, '')]: row, revision: space.revision });
    }

    if (head === 'debates') {
      const snapshot = requireSnapshot(res, json, space.id);
      if (!snapshot) return true;
      if (rest.length === 0) {
        if (notModified(req, res, json, space, url, key)) return true;
        const limit = readLimit(url.searchParams.get('limit'));
        const offset = readOffset(url.searchParams.get('offset'));
        // Assembling every debate on a large corpus produces tens of megabytes, which is
        // the whole reason the desktop has a lean mode. Slice the edge list first and only
        // build the sides that survive the cut.
        const all = listDebates(snapshot);
        return send(res, json, { ...page('debates', all, limit, offset), revision: space.revision });
      }
      if (notModified(req, res, json, space, url, key)) return true;
      const debate = getDebate(snapshot, decodeURIComponent(rest[0]));
      return debate ? send(res, json, { debate, revision: space.revision }) : missing(res, json);
    }

    if (head === 'notes') {
      const snapshot = requireSnapshot(res, json, space.id);
      if (!snapshot) return true;
      const all = rows(snapshot, 'notes');
      const live = all.filter((note) => !note.trashed_at);
      if (rest.length === 0) {
        const query = url.searchParams.get('q');
        const folder = url.searchParams.get('folderId');
        const kind = url.searchParams.get('kind');
        const folders = rows(snapshot, 'note_folders');
        const folderIds = url.searchParams.get('recursive') === '1' ? folderSubtree(folders, folder) : null;
        const filtered = live
          .filter((note) => !folder || (folderIds
            ? folderIds.has(String(note.folder_id ?? ''))
            : String(note.folder_id ?? '') === folder))
          .filter((note) => !kind || String(note.kind ?? 'markdown') === kind)
          .filter((note) => !query || matchesRow(note, query))
          .map((note) => ({ id: note.id, title: note.title, folder_id: note.folder_id, kind: note.kind, tags: (() => { try { const tags = JSON.parse(note.tags_json || '[]'); return Array.isArray(tags) ? tags : []; } catch { return []; } })(), order_idx: note.order_idx, created_at: note.created_at, updated_at: note.updated_at, snippet: snippet(note.content) }));
        if (notModified(req, res, json, space, url, key)) return true;
        return send(res, json, {
          ...page('notes', filtered, readLimit(url.searchParams.get('limit')), readOffset(url.searchParams.get('offset'))),
          folders,
          counts: {
            notes: live.filter((note) => String(note.kind ?? 'markdown') !== 'idea').length,
            ideas: live.filter((note) => String(note.kind ?? '') === 'idea').length,
          },
          revision: space.revision,
        });
      }
      const note = live.find((candidate) => String(candidate.id) === decodeURIComponent(rest[0]));
      if (!note) return missing(res, json);
      if (notModified(req, res, json, space, url, key)) return true;
      return send(res, json, { note, revision: space.revision });
    }

    if (head === 'deep-research') {
      const snapshot = requireSnapshot(res, json, space.id);
      if (!snapshot) return true;
      let drafts;
      try {
        drafts = rows(snapshot, 'writing_saved_drafts').filter(isDeepResearchDraft);
        // Validate before pagination or ETag handling: an unreadable row must never
        // disappear from a supposedly complete catalogue, including later pages.
        for (const row of drafts) readResearchDraft(row);
      } catch {
        json(res, 422, {
          error: 'invalid_saved_reports',
          error_description: 'Some saved reports have an invalid format. Their original contents are preserved; the catalogue could not be loaded completely.',
        });
        return true;
      }
      const readAt = new Map(rows(snapshot, 'writing_draft_reads')
        .map((entry) => [String(entry.draft_id), entry.updated_at ?? null]));
      const assets = new Map(
        (Array.isArray(snapshot.assets) ? snapshot.assets : [])
          .filter((asset) => asset.kind === 'deep_research_image')
          .map((asset) => [String(asset.key?.[1] ?? ''), asset])
      );
      if (rest.length === 0) {
        if (notModified(req, res, json, space, url, key)) return true;
        const listed = drafts.map((row) => ({ ...draftSummary(row), read_at: readAt.get(String(row.id)) ?? null, image: assets.get(String(row.id)) ?? null }));
        return send(res, json, { ...page('reports', listed, readLimit(url.searchParams.get('limit')), readOffset(url.searchParams.get('offset'))), revision: space.revision });
      }
      const wanted = decodeURIComponent(rest[0]);
      const row = drafts.find((candidate) => String(candidate.id) === wanted);
      if (!row) return missing(res, json);
      const draft = readResearchDraft(row);

      // ── The styled document ───────────────────────────────────────────────
      //
      // `.../deep-research/<id>/document.html` is the report laid out the way the desktop
      // lays it out for print: cover, contents, section rules, traceability matrix, `@page`
      // box. The design is `shared/professionalReport.ts`, compiled into
      // `lib/core/generated/` so this process needs no dependency and no build to serve it.
      //
      // HTML rather than PDF because printing needs a browser, and this server is a hundred
      // and fifty megabytes of Alpine and Node with nothing else in it. The client that asks
      // for this has a browser engine already; it prints the page it is given.
      if (rest[1] === 'document.html') {
        if (!draft) return missing(res, json);
        const image = assets.get(wanted) ?? null;
        let html;
        try {
          html = renderReportDocument(draft, image, (hash) => readAssetBytes?.(space.id, hash));
        } catch (error) {
          // A draft written by an older Nodus, or by something that is not Nodus, can be
          // missing a field the layout reads. That is a document this server cannot lay out,
          // not a broken server — and saying so is what stops the client showing "could not
          // build the PDF" with a stack trace inside it.
          json(res, 422, {
            error: 'unrenderable_draft',
            error_description: `This report cannot be laid out for printing: ${error.message}`,
          });
          return true;
        }
        const bytes = Buffer.from(html, 'utf8');
        res.writeHead(200, securityHeaders({
          'content-type': 'text/html; charset=utf-8',
          'content-length': bytes.length,
          'cache-control': 'private, max-age=0, must-revalidate',
          etag: `W/"${space.revision}|${wanted}|document"`,
          // The Server reader embeds this exact same-origin printable document.
          // Keep every active capability sandboxed while allowing that one
          // first-party frame; the global DENY policy made the reader render a
          // browser error instead of the report.
          'x-frame-options': 'SAMEORIGIN',
          'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; img-src data:; frame-ancestors 'self'; base-uri 'none'; object-src 'none'; sandbox",
        }));
        if (req.method === 'HEAD') res.end();
        else res.end(bytes);
        return true;
      }

      // A binary export is kept separate from the browser-printable document. The server has
      // no browser dependency, so renderPdf is a small, text-searchable pdf-lib export that
      // never evaluates report HTML or fetches remote resources.
      if (rest[1] === 'document.pdf') {
        if (!draft || typeof renderPdf !== 'function') return missing(res, json);
        let bytes;
        try {
          bytes = await renderPdf(draft, {
            language: draft?.brief?.language ?? draft?.language,
            subject: 'Deep Research · published',
          });
        }
        catch (error) {
          json(res, 422, { error: 'unrenderable_draft', error_description: `This report cannot be exported as PDF: ${error.message}` });
          return true;
        }
        res.writeHead(200, securityHeaders({
          'content-type': 'application/pdf', 'content-length': bytes.length,
          'content-disposition': `inline; filename="${String(draft.title || 'deep-research').replace(/[^A-Za-z0-9._-]+/g, '-').slice(0, 80)}.pdf"`,
          'cache-control': 'private, max-age=0, must-revalidate',
          etag: `W/"${space.revision}|${wanted}|pdf"`,
          'x-content-type-options': 'nosniff',
        }));
        if (req.method === 'HEAD') res.end(); else res.end(bytes);
        return true;
      }

      if (notModified(req, res, json, space, url, key)) return true;
      return send(res, json, {
        report: { ...draftSummary(row), draft, read_at: readAt.get(wanted) ?? null },
        image: assets.get(wanted) ?? null,
        translations: rows(snapshot, 'content_translations').filter((entry) => entry.entity_kind === 'deep_research' && String(entry.entity_id) === wanted),
        // Small anchored rows, included with the document they decorate. A phone
        // should not need a full snapshot merely to draw a comment in this report.
        annotations: rows(snapshot, 'writing_draft_annotations').filter((entry) => String(entry.draft_id) === wanted),
        revision: space.revision,
      });
    }

    // ── The agenda ────────────────────────────────────────────────────────────
    //
    // `GET .../study-agenda?from=&to=` — what a study or teaching vault actually has on,
    // from the two tables that carry a moment in time: the calendar and the blocks of a
    // study plan.
    //
    // A resource rather than two collections, for two reasons. A collection answers in
    // snapshot order, which for a calendar is no order at all; and a phone asking "what have
    // I got this fortnight" should not download every block ever planned to find out. Both
    // lists come back sorted by `starts_at` and cut to the window.
    //
    // The subjects ride along because every row here names one by id and nothing else, and
    // one small table beside the answer is cheaper than a request per row — the same reason
    // an author's works travel inside the author.
    if (head === 'study-agenda' && rest.length === 0) {
      const snapshot = requireSnapshot(res, json, space.id);
      if (!snapshot) return true;
      if (notModified(req, res, json, space, url, key)) return true;

      // ISO-8601 sorts and compares lexicographically, which is the whole reason these
      // columns are stored as text.
      const from = url.searchParams.get('from') || '';
      const to = url.searchParams.get('to') || '';
      const inWindow = (value) => {
        const at = String(value ?? '');
        if (!at) return false;
        return (!from || at >= from) && (!to || at <= to);
      };
      const byStart = (a, b) => String(a.starts_at ?? '').localeCompare(String(b.starts_at ?? ''));
      const limit = readLimit(url.searchParams.get('limit'));

      const events = rows(snapshot, 'study_calendar_events').filter((row) => inWindow(row.starts_at)).sort(byStart);
      const blocks = rows(snapshot, 'study_plan_blocks').filter((row) => inWindow(row.starts_at)).sort(byStart);
      return send(res, json, {
        events: events.slice(0, limit),
        blocks: blocks.slice(0, limit),
        subjects: rows(snapshot, 'study_subjects').map((row) => ({ id: row.id, name: row.name, color: row.color ?? null })),
        total: events.length + blocks.length,
        hasMore: events.length > limit || blocks.length > limit,
        revision: space.revision,
      });
    }

    if (head === 'immersion') {
      const snapshot = requireSnapshot(res, json, space.id);
      if (!snapshot) return true;
      const sessions = rows(snapshot, 'immersion_sessions');
      if (rest.length === 0) {
        if (notModified(req, res, json, space, url, key)) return true;
        const listed = sessions.map((row) => {
          let stats = null;
          try { stats = JSON.parse(row.stats_json || 'null'); } catch { stats = null; }
          return { id: row.id, topic: row.topic, title: row.title, language: row.language, minutes: row.minutes, stats, created_at: row.created_at, updated_at: row.updated_at };
        });
        return send(res, json, { ...page('sessions', listed, readLimit(url.searchParams.get('limit')), readOffset(url.searchParams.get('offset'))), revision: space.revision });
      }
      const row = sessions.find((candidate) => String(candidate.id) === decodeURIComponent(rest[0]));
      if (!row) return missing(res, json);
      if (notModified(req, res, json, space, url, key)) return true;
      let plan = null;
      try { plan = JSON.parse(row.plan_json || 'null'); } catch { plan = null; }
      // `progress_json` is the reader's own position in their own copy; it is never
      // meaningful across devices, so the server does not pretend to serve it.
      return send(res, json, { session: { id: row.id, topic: row.topic, title: row.title, language: row.language, minutes: row.minutes, plan }, revision: space.revision });
    }

    if (head === 'search' && rest.length === 0) {
      const snapshot = requireSnapshot(res, json, space.id);
      if (!snapshot) return true;
      if (notModified(req, res, json, space, url, key)) return true;
      const limit = readLimit(url.searchParams.get('limit'), 20, 50);
      return send(res, json, { results: lexicalSearch(snapshot, url.searchParams.get('q'), limit), mode: 'lexical', revision: space.revision });
    }

    return false;
  }

  return { handle, ideaGraph, isDeepResearchDraft };
}
