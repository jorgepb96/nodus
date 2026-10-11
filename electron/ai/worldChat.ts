import { prepareResearchAttachments, withResearchAttachmentFallback } from './researchAttachments';
import {generationSignal} from './generationSignal';
import { withResearchSystemPrompt } from './researchSystemPrompt';
import { researchGenerationOptions } from './researchGenerationOptions';
import { skillHasCapability } from '@shared/chatSkills';
import { enabledChatSkills } from '../chatSkills';
import { buildChatSkillsPrompt, chatProseForHistory, chatSkillsOutputContract, transformChatProse } from '@shared/chatSkills';
import { executeChatSkills } from './chatSkillExecution';
import { chatAssetOwner, chatAssetVersion } from '../chatAssets';
import { getWorldChatConversation } from '../db/worldChatRepo';
import { getActiveVault } from '../vaults/vaultRegistry';
// The world chat: Nodus calculates, the model writes.
//
// This is the last piece of "Analizar" and it is designed KNOWING the other five exist,
// which is what makes it different from a chat over a corpus. Every question a writer asks
// about their own world — could she have done that, where was he, what has to move in this
// scene, does this contradict anything, who knew — is already a pure function over the
// vault. So none of them is asked of the model: they are computed here and handed over as
// facts, and the system prompt says in one line that facts are not up for discussion.
//
// What the model does is read them, choose what matters, and write a paragraph with links.
// It never sees the whole vault: only the focus the question named and the facts about it,
// which is also the only way it fits in a local model's window.

import { completeTextStream } from './aiClient';
import { getSettings } from '../db/settingsRepo';
import { entryProse, listWorldEntries } from '../db/worldEncyclopediaRepo';
import { rulesReaching } from '../db/worldRulesRepo';
import { beatsForScene } from '../db/worldThreadsRepo';
import { runContinuity } from '../db/worldContinuityRepo';
import { listPresences } from '../db/worldPresenceRepo';
import { knowersAt, listSecrets, secretsForCharacter } from '../db/worldStoryRepo';
import { getDb } from '../db/database';
import {
  composeWorldChatContext,
  ensureWorldCitations,
  hasWorldChatMaterial,
  matchFocus,
  plainFindingText,
  readWorldDay,
  validateCitations,
  type WorldChatFacts,
  type WorldChatRef,
} from '@shared/worldChatContext';
import { worldOperationSystemPrompt } from '@shared/worldOperationPrompts';
import { findingsFor } from '@shared/worldFindings';
import { entryKey, parseEntryKey } from '@shared/worldEncyclopedia';
import { worldBeatMarkLabel, worldRuleScopeLabel } from '@shared/worldPromptLanguage';
import { buildStays, buildJourneys, positionAt, presenceKey } from '@shared/worldPresence';
import type { PromptLanguage, WorldChatRequest, WorldChatResult, WorldEntryKind } from '@shared/types';

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
function resolveFocus(request: WorldChatRequest): WorldChatRef[] {
  const entries = listWorldEntries();
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

export function buildWorldChatFacts(request: WorldChatRequest, language: PromptLanguage = 'es'): WorldChatFacts {
  const focus = resolveFocus(request);
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

  const db = getDb();

  const prose = focus.flatMap((ref) =>
    entryProse({ kind: ref.kind as WorldEntryKind, id: ref.id }).map((block) => ({
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
  const sceneRow = scenes.length
    ? (db.prepare('SELECT place_id, world_day FROM world_scenes WHERE scene_id = ?').get(scenes[0].id) as
        | { place_id: string | null; world_day: number | null }
        | undefined)
    : undefined;
  const at = worldDay ?? sceneRow?.world_day ?? null;
  const placeId = places[0]?.id ?? sceneRow?.place_id ?? null;
  const subjects = characters.length ? characters : [null];
  const rules: NonNullable<WorldChatFacts['computed']['effectiveRules']> = [];
  for (const subject of subjects) {
    for (const effective of rulesReaching({ personId: subject?.id ?? null, placeId }, at)) {
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
    const presences = listPresences();
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
      (
        db
          .prepare(
            `SELECT g.group_id, g.name, a.from_world_day, a.to_world_day
               FROM character_affiliations a JOIN world_groups g ON g.group_id = a.group_id
              WHERE a.person_id = ?`
          )
          .all(character.id) as { group_id: string; name: string; from_world_day: number | null; to_world_day: number | null }[]
      )
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
      const { owned, known } = secretsForCharacter(character.id);
      for (const secret of [...owned, ...known]) secretIds.add(secret.secretId);
    }
    const titles = new Map(listSecrets().map((secret) => [secret.secretId, secret.title] as const));
    const knowers = [...secretIds].map((secretId) => ({
      secretTitle: titles.get(secretId) ?? secretId,
      people: knowersAt(secretId, at).map((knower) => knower.personName),
      worldDay: at,
    }));
    if (knowers.length) computed.knowersAt = knowers;
  }

  // ── What has to move in the scene ──────────────────────────────────────────
  const beats = scenes.flatMap((scene) =>
    beatsForScene(scene.id).map((beat) => ({
      sceneTitle: scene.title,
      threadTitle: beat.threadTitle,
      mark: worldBeatMarkLabel(beat.mark, language),
      text: beat.text,
    }))
  );
  if (beats.length) computed.beatsAtScene = beats;

  // ── What already contradicts what, filtered to the focus ───────────────────
  if (focus.length) {
    const all = runContinuity();
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

export async function streamWorldChat(
  request: WorldChatRequest,
  onDelta: (delta: string) => void,
  signal?: AbortSignal
): Promise<WorldChatResult> {
  signal = generationSignal(signal);
  const settings = getSettings();
  const skills = enabledChatSkills('assistant');
  const vaultId = getActiveVault().id;
  const owner = request.conversationId ? chatAssetOwner('world-assistant', request.conversationId, vaultId) : undefined;
  const version = owner ? chatAssetVersion(owner) : 0;
  const language = settings.promptLanguage ?? 'es';
  const facts = buildWorldChatFacts(request, language);
  const attachments = await prepareResearchAttachments(request, 'world', request.model ?? settings.chatModel ?? settings.synthesisModel);
  // Skills change how grounded material is presented; they do not supply world facts.
  if (!hasWorldChatMaterial(facts) && !attachments.text) {
    return { text: '', focus: facts.focus, noMaterial: true };
  }

  const model = request.model ?? settings.chatModel ?? settings.synthesisModel ?? null;
  const raw = await withResearchAttachmentFallback(attachments,
    {
      system: withResearchSystemPrompt(`${worldOperationSystemPrompt('worldChat', settings.promptLanguage ?? 'es')}\n\n${buildChatSkillsPrompt(skills)}\nNew creative proposals are not established world canon. Label them accordingly.`, request.systemPromptId, { surface: 'world', conversationId: request.conversationId }) + attachments.system,
      images: attachments.images,
      user: `${composeWorldChatContext(facts, language)}\n\n${chatSkillsOutputContract(skills)}${attachments.text}`,
      plainContext: true,
      englishImagePrompts: skills.some(skill => skillHasCapability(skill, 'image')),
      // Keep factual answers grounded and creative proposals clearly identified.
      temperature: 0.3,
      ...(request.thinkingEffort === undefined ? { maxTokens: skills.length ? 10_000 : 1200 } : await researchGenerationOptions({ ...request, model }, skills.length ? 10_000 : 1200, false, signal)),
    },
    options => completeTextStream(options, (delta, kind) => {
      if (kind !== 'reasoning') onDelta(delta);
    }, model, signal)
  );

  // Only entries actually supplied in CÓMO SE CITA are allowed. A real but unrelated id
  // is still an unsupported citation: existence elsewhere in the vault does not make it
  // evidence for this answer.
  const allowed = new Set(
    facts.citable.map((ref) => `${ref.kind}:${ref.id}`)
  );
  const validated = transformChatProse(raw, prose => validateCitations(prose, allowed));
  const repaired = ensureWorldCitations(validated, facts.citable, language);
  // A user-triggered stop keeps the partial answer: running the skill tools now would
  // throw an AbortError and discard everything that already streamed.
  const aborted = Boolean(signal?.aborted);
  return {
    text: aborted ? repaired : await executeChatSkills(repaired, { skills, owner, version, model, question: request.question, isCurrent: () => getActiveVault().id === vaultId && (!request.conversationId || !!getWorldChatConversation(request.conversationId)) }, signal),
    focus: facts.focus,
    noMaterial: false,
    ...(aborted ? { aborted: true } : {}),
  };
}

/** Exported for the tests: the keys a reply is allowed to cite. */
export function citableKeys(): Set<string> {
  return new Set(listWorldEntries().map((entry) => entry.key));
}

export { parseEntryKey };
