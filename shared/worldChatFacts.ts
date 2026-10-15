import {chatProseForHistory} from './chatSkills';
import {entryKey} from './worldEncyclopedia';
import {buildStays,buildJourneys,positionAt,presenceKey,type Presence} from './worldPresence';
import {worldBeatMarkLabel,worldRuleScopeLabel} from './worldPromptLanguage';
import {findingsFor} from './worldFindings';
import {matchFocus,plainFindingText,readWorldDay,type WorldChatFacts,type WorldChatRef} from './worldChatContext';
import type {EffectiveRule} from './worldRules';
import type {PromptLanguage,WorldChatRequest,WorldEntryKind,WorldEntry,WorldSecret,SecretKnower,WorldBeat,WorldFinding} from './types';

/** Repository-free world calculations. Desktop supplies live scoped readers;
 * companion supplies the complete selected snapshot captured by those readers. */
export interface WorldChatSource {
  entries:WorldEntry[];
  prose(ref:{kind:string;id:string}):Array<{field:string;heading:string|null;text:string}>;
  scene(id:string):{placeId:string|null;worldDay:number|null}|undefined;
  rulesReaching(subject:{personId:string|null;placeId:string|null},day:number|null):EffectiveRule[];
  presences():Presence[];
  memberships(id:string):Array<{group_id:string;name:string;from_world_day:number|null;to_world_day:number|null}>;
  secretsForCharacter(id:string):{owned:WorldSecret[];known:WorldSecret[]};
  secrets():WorldSecret[];
  knowersAt(id:string,day:number|null):SecretKnower[];
  beatsForScene(id:string):WorldBeat[];
  findings():WorldFinding[];
}

/** Enough of a sheet to answer from; past this the focus stops fitting a local window. */
const MAX_PROSE_CHARS = 1200;
const MAX_FOCUS = 6;
const MAX_HISTORY_TURNS = 6;
const MAX_HISTORY_TURN_CHARS = 900;

function clip(text: string): string {
  return text.length > MAX_PROSE_CHARS ? `${text.slice(0, MAX_PROSE_CHARS).trimEnd()}…` : text;
}

/**
 * What the question is about.
 *
 * The author's explicit choice wins; otherwise the names in the question are matched
 * against every entry the world has. Resolving here rather than in the renderer is what
 * lets the chat be asked a plain question — «¿podía Kaelen invocar la Marca?» — without
 * first picking two chips from a dropdown.
 */
export function resolveWorldChatFocus(request: WorldChatRequest,source: WorldChatSource): WorldChatRef[] {
  const entries = source.entries;
  const byKey = new Map(entries.map((entry) => [entry.key, entry] as const));
  const keys = request.focusKeys?.length
    ? request.focusKeys
    : matchFocus(
        request.question,
        entries.map((entry) => ({ key: entry.key, names: [entry.title, ...entry.aliases] })),
        MAX_FOCUS
      );
  return keys
    .map((key) => byKey.get(key))
    .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry))
    .slice(0, MAX_FOCUS)
    .map((entry) => ({ kind: entry.kind, id: entry.id, title: entry.title }));
}

export function calculateWorldChatFacts(request: WorldChatRequest,source: WorldChatSource,language: PromptLanguage = 'es'): WorldChatFacts {
  const focus = resolveWorldChatFocus(request,source);
  const worldDay = readWorldDay(request.question, language);
  const history = (request.history ?? [])
    .filter((turn) => (turn.role === 'user' || turn.role === 'assistant') && turn.content.trim())
    .slice(-MAX_HISTORY_TURNS)
    .map((turn) => ({
      role: turn.role,
      content: clip((turn.role === 'assistant' ? chatProseForHistory(turn.content) : turn.content).trim()).slice(0, MAX_HISTORY_TURN_CHARS),
    }));

  // Nothing anchored, nothing computed — and that is the design, not an optimisation.
  // Everything below would happily answer without a focus: the laws of the world reach
  // everybody by definition, so a question that names nothing would come back with the
  // world's legal code attached and an answer built on it. A chat that cannot say what it
  // is talking about should say exactly that.
  if (focus.length === 0) {
    return { question: request.question, history, focus, prose: [], computed: {}, citable: [], worldDay };
  }

  const prose = focus.flatMap((ref) =>
    source.prose({ kind: ref.kind, id: ref.id }).map((block) => ({
      ref,
      field: block.heading ?? block.field,
      text: clip(block.text),
    }))
  );

  const characters = focus.filter((ref) => ref.kind === 'character');
  const scenes = focus.filter((ref) => ref.kind === 'scene');
  const places = focus.filter((ref) => ref.kind === 'place');
  const computed: WorldChatFacts['computed'] = {};
  const cited = new Map<string, WorldChatRef>(focus.map((ref) => [entryKey({ kind: ref.kind as WorldEntryKind, id: ref.id }), ref]));
  const cite = (ref: WorldChatRef) => {
    cited.set(entryKey({ kind: ref.kind as WorldEntryKind, id: ref.id }), ref);
  };

  // ── Which laws reach them, and which exception bites each ──────────────────
  // The scene in focus decides the place and the day when the question named neither: it
  // is the situation the writer is actually asking about.
  const sceneRow = scenes.length ? source.scene(scenes[0].id) : undefined;
  const at = worldDay ?? sceneRow?.worldDay ?? null;
  const placeId = places[0]?.id ?? sceneRow?.placeId ?? null;
  const subjects = characters.length ? characters : [null];
  const rules: NonNullable<WorldChatFacts['computed']['effectiveRules']> = [];
  for (const subject of subjects) {
    for (const effective of source.rulesReaching({ personId: subject?.id ?? null, placeId }, at)) {
      if (rules.some((entry) => entry.ruleId === effective.rule.ruleId)) continue;
      rules.push({
        rule: effective.rule.title,
        ruleId: effective.rule.ruleId,
        scope: worldRuleScopeLabel(effective.rule.scopeKind, language),
        overriddenBy: effective.overriddenBy.map((child) => child.title),
      });
      cite({ kind: 'rule', id: effective.rule.ruleId, title: effective.rule.title });
      for (const child of effective.overriddenBy) cite({ kind: 'rule', id: child.ruleId, title: child.title });
    }
  }
  if (rules.length) computed.effectiveRules = rules;

  // ── Where they were, and what they belonged to, ON THAT DAY ────────────────
  if (characters.length) {
    const presences = source.presences();
    const positions: NonNullable<WorldChatFacts['computed']['presenceAt']> = [];
    for (const character of characters) {
      const own = presences.filter((presence) => presence.personId === character.id);
      if (own.length === 0) continue;
      const stays = buildStays(own);
      const position = positionAt(stays, buildJourneys(stays), at ?? presenceKey(own[own.length - 1]));
      if (!position) continue;
      // In transit and before-the-first-record are said out loud rather than flattened to
      // a place name: «estaba en Vael» about somebody three days down the road, or about a
      // day before they appear at all, is exactly the confident wrong answer this whole
      // design exists to prevent.
      const where = position.towardsPlaceName
        ? `de camino de ${position.placeName ?? '—'} a ${position.towardsPlaceName}`
        : position.beforeFirst
          ? `${position.placeName ?? '—'} (aún no hay nada suyo anotado tan pronto)`
          : (position.placeName ?? '—');
      positions.push({ personName: character.title, placeName: where, worldDay: at });
      if (position.placeId) cite({ kind: 'place', id: position.placeId, title: position.placeName ?? '' });
    }
    if (positions.length) computed.presenceAt = positions;

    const memberships = characters.flatMap((character) =>
      source.memberships(character.id)
        .filter((row) => {
          // The membership OF THAT DAY, never today's: reading the current one turns a
          // correct scene into a warning every time somebody changes sides.
          if (at == null) return true;
          if (row.from_world_day != null && at < row.from_world_day) return false;
          if (row.to_world_day != null && at > row.to_world_day) return false;
          return true;
        })
        .map((row) => {
          cite({ kind: 'group', id: row.group_id, title: row.name });
          return {
            personName: character.title,
            groupName: row.name,
            fromWorldDay: row.from_world_day,
            toWorldDay: row.to_world_day,
          };
        })
    );
    if (memberships.length) computed.memberships = memberships;

    // ── Who knew what, on that day ──────────────────────────────────────────
    const secretIds = new Set<string>();
    for (const character of characters) {
      const { owned, known } = source.secretsForCharacter(character.id);
      for (const secret of [...owned, ...known]) secretIds.add(secret.secretId);
    }
    const titles = new Map(source.secrets().map((secret) => [secret.secretId, secret.title] as const));
    const knowers = [...secretIds].map((secretId) => ({
      secretTitle: titles.get(secretId) ?? secretId,
      people: source.knowersAt(secretId, at).map((knower) => knower.personName),
      worldDay: at,
    }));
    if (knowers.length) computed.knowersAt = knowers;
  }

  // ── What has to move in the scene ──────────────────────────────────────────
  const beats = scenes.flatMap((scene) =>
    source.beatsForScene(scene.id).map((beat) => ({
      sceneTitle: scene.title,
      threadTitle: beat.threadTitle,
      mark: worldBeatMarkLabel(beat.mark, language),
      text: beat.text,
    }))
  );
  if (beats.length) computed.beatsAtScene = beats;

  // ── What already contradicts what, filtered to the focus ───────────────────
  if (focus.length) {
    const all = source.findings();
    const seen = new Set<string>();
    const findings = focus
      .flatMap((ref) => findingsFor({ kind: ref.kind, id: ref.id }, all))
      .filter((finding) => (seen.has(finding.fingerprint) ? false : seen.add(finding.fingerprint)))
      .map((finding) => ({
        headline: plainFindingText(finding.headline),
        severity: finding.severity,
        subjects: finding.subjects.map((subject) => subject.title),
      }));
    if (findings.length) computed.findings = findings;
  }

  return {
    question: request.question,
    history,
    focus,
    prose,
    computed,
    citable: [...cited.values()].filter((ref) => ref.title.trim()),
    worldDay: at,
  };
}

