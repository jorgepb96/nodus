// The worldbuilding slice of the window.nodus contract. NodusApi extends it, so the
// renderer surface stays flat and every call site is unchanged.
import type { InterviewTurn } from '../characterInterview';
import type { WorldCalendar, WorldDate } from '../worldCalendar';
import type { BoardCastMember } from '../worldThreads';
import type { DbChatTurn } from '../databaseChat';
// Declared in shared/types.ts itself; the resulting cycle is types-only and erased at build time.
import type {
  BeatThreadKind,
  Character,
  CharacterAbility,
  CharacterAbilityInput,
  CharacterAffiliation,
  CharacterAffiliationInput,
  CharacterBiographyMode,
  CharacterChatConversation,
  CharacterChatConversationSummary,
  CharacterChatSendResult,
  CharacterCounts,
  CharacterEvent,
  CharacterFilter,
  CharacterImage,
  CharacterImageKind,
  CharacterInput,
  DecorativeImageStyle,
  ManuscriptProgress,
  ManuscriptSpine,
  MapGenerationRequestPayload,
  MapGenerationResultPayload,
  MapLayer,
  MapLayerInput,
  MapMarker,
  MapMarkerInput,
  MapTravelMode,
  MapTravelModeInput,
  ModelRef,
  MuteReasonCode,
  PlaceMapAppearance,
  ProseReviewResult,
  SceneAppearance,
  SceneDayLink,
  SceneQuestionLoad,
  SceneSnapshot,
  SceneText,
  SecretKnower,
  SuggestedMapMarker,
  ThreadPartySide,
  WorldArticle,
  WorldArticleDraftMode,
  WorldArticleDraftResult,
  WorldArticleInput,
  WorldBeat,
  WorldBeatInput,
  WorldBibleOptions,
  WorldBodyHit,
  WorldChatConversation,
  WorldChatConversationSummary,
  WorldChatRequest,
  WorldChatResult,
  WorldChatSelection,
  WorldEntry,
  WorldEntryDetail,
  WorldEntryLink,
  WorldEntryProposal,
  WorldEntryRef,
  WorldFinding,
  WorldGroup,
  WorldGroupInput,
  WorldGroupKind,
  WorldImageEntityKind,
  WorldMap,
  WorldMapInput,
  WorldNoticeMute,
  WorldPlace,
  WorldPlaceInput,
  WorldQuestion,
  WorldQuestionFeedItem,
  WorldQuestionInput,
  WorldQuestionOption,
  WorldQuestionOptionInput,
  WorldQuestionOptionsResult,
  WorldQuestionOrigin,
  WorldRule,
  WorldRuleDraftResult,
  WorldRuleInput,
  WorldScene,
  WorldSceneInput,
  WorldSecret,
  WorldSecretInput,
  WorldThread,
  WorldThreadInput,
  WorldThreadKind,
} from '../types';

export interface WorldbuildingApi {
  // Worldbuilding characters. Everything a character shares with a person — portrait,
  // aliases, events, kinship, social relations — goes through the bridges above; only
  // the overlay and the in-world calendar have their own calls.
  listCharacters(filter?: CharacterFilter): Promise<Character[]>;
  getCharacter(personId: string): Promise<Character | null>;
  createCharacter(input: CharacterInput): Promise<Character>;
  updateCharacter(personId: string, patch: Partial<CharacterInput>): Promise<Character | null>;
  deleteCharacter(personId: string): Promise<void>;
  listCharacterEvents(personId: string): Promise<CharacterEvent[]>;
  setCharacterEventWorldDate(eventId: string, worldYear: number | null, worldOrder?: number): Promise<void>;
  characterCounts(): Promise<CharacterCounts>;
  /** Every event in the vault ordered by the in-world year — the worldbuilding timeline. */
  listWorldEvents(): Promise<CharacterEvent[]>;
  listWorldPlaces(): Promise<WorldPlace[]>;
  getWorldPlace(placeId: string): Promise<WorldPlace | null>;
  createWorldPlace(input: WorldPlaceInput): Promise<WorldPlace>;
  /** A reparent that would close a loop is refused; the parent stays as it was. */
  updateWorldPlace(placeId: string, patch: Partial<WorldPlaceInput>): Promise<WorldPlace | null>;
  deleteWorldPlace(placeId: string): Promise<void>;
  /** Characters recorded at this place, from `person_places`. */
  placeInhabitants(placeId: string): Promise<{ personId: string; displayName: string; role: string | null }[]>;
  /** Factions, cultures and the rest: one collection, filtered by kind. */
  listWorldGroups(kind?: WorldGroupKind): Promise<WorldGroup[]>;
  getWorldGroup(groupId: string): Promise<WorldGroup | null>;
  createWorldGroup(input: WorldGroupInput): Promise<WorldGroup>;
  updateWorldGroup(groupId: string, patch: Partial<WorldGroupInput>): Promise<WorldGroup | null>;
  deleteWorldGroup(groupId: string): Promise<void>;
  listAffiliationsForCharacter(personId: string): Promise<CharacterAffiliation[]>;
  listAffiliationsForGroup(groupId: string): Promise<CharacterAffiliation[]>;
  addAffiliation(input: CharacterAffiliationInput): Promise<CharacterAffiliation>;
  updateAffiliation(id: string, patch: Partial<CharacterAffiliationInput>): Promise<CharacterAffiliation | null>;
  deleteAffiliation(id: string): Promise<void>;
  listSecrets(): Promise<WorldSecret[]>;
  secretsForCharacter(personId: string): Promise<{ owned: WorldSecret[]; known: WorldSecret[] }>;
  createSecret(input: WorldSecretInput): Promise<WorldSecret>;
  updateSecret(secretId: string, patch: Partial<WorldSecretInput>): Promise<WorldSecret | null>;
  deleteSecret(secretId: string): Promise<void>;
  listKnowers(secretId: string): Promise<SecretKnower[]>;
  addKnower(input: { secretId: string; personId: string; sinceWorldDay?: number | null; how?: string | null }): Promise<SecretKnower[]>;
  removeKnower(id: string): Promise<void>;
  /** Scenes in narrative order (the manuscript's) or chronological (the world's). */
  listScenes(order?: 'narrative' | 'chronological'): Promise<WorldScene[]>;
  createScene(input: WorldSceneInput): Promise<WorldScene>;
  updateScene(sceneId: string, patch: Partial<WorldSceneInput>): Promise<WorldScene | null>;
  deleteScene(sceneId: string): Promise<void>;
  listSceneCharacters(sceneId: string): Promise<SceneAppearance[]>;
  /** The scenes a character appears in, in narrative order. */
  appearancesOfCharacter(personId: string): Promise<SceneAppearance[]>;
  addSceneCharacter(sceneId: string, personId: string, role?: string | null): Promise<SceneAppearance[]>;
  removeSceneCharacter(id: string): Promise<void>;
  /** The generic gallery, shared by characters, places, groups and scenes. */
  listWorldImages(entityKind: WorldImageEntityKind, entityId: string): Promise<CharacterImage[]>;
  getWorldImageBlob(imageId: string): Promise<{ blob: Uint8Array; mime: string } | null>;
  deleteWorldImage(imageId: string): Promise<void>;
  addWorldImageFromFile(
    entityKind: WorldImageEntityKind,
    entityId: string,
    kind?: CharacterImageKind
  ): Promise<CharacterImage[]>;
  generateWorldImage(
    entityKind: WorldImageEntityKind,
    entityId: string,
    kind: CharacterImageKind,
    style?: DecorativeImageStyle
  ): Promise<CharacterImage>;
  /**
   * Write the sheet to a Markdown file the author chooses. Secret aliases and private
   * notes are OMITTED unless explicitly asked for: exporting means sharing. Returns the
   * saved path, or null if the dialog was cancelled.
   */
  exportCharacterSheet(
    personId: string,
    options?: { includeSecrets?: boolean; includeNotes?: boolean }
  ): Promise<string | null>;
  // ── The encyclopedia ──────────────────────────────────────────────────────
  // The index is loaded WHOLE and searched in the renderer, like every other world
  // collection: it keeps the facet counts honest and the `[[` autocomplete free of an
  // IPC round-trip per keystroke. Bodies are never in it — those come one at a time.
  listWorldEntries(): Promise<WorldEntry[]>;
  getWorldEntry(ref: WorldEntryRef): Promise<WorldEntryDetail | null>;
  searchWorldBodies(query: string): Promise<WorldBodyHit[]>;
  createWorldArticle(input: WorldArticleInput): Promise<WorldArticle>;
  updateWorldArticle(articleId: string, patch: WorldArticleInput): Promise<WorldArticle>;
  deleteWorldArticle(articleId: string): Promise<void>;
  worldBacklinks(ref: WorldEntryRef): Promise<WorldEntryLink[]>;
  worldUnresolvedLinks(): Promise<WorldEntryLink[]>;
  /** Point every pending `[[text]]` at a real entry; resolves to how many were repaired. */
  resolveWorldLink(text: string, target: WorldEntryRef): Promise<number>;
  rebuildWorldLinks(): Promise<number>;
  indexWorldEntry(ref: WorldEntryRef): Promise<number>;
  /** Writes to `body_proposed`, NEVER to the body: accepting is a separate, explicit act. */
  draftWorldArticle(articleId: string, mode: WorldArticleDraftMode): Promise<WorldArticleDraftResult>;
  acceptWorldArticleDraft(articleId: string): Promise<WorldArticle>;
  rejectWorldArticleDraft(articleId: string): Promise<void>;
  /** Half deterministic: works, and is worth running, with no AI provider configured. */
  analyzeMissingEntries(): Promise<WorldEntryProposal[]>;
  listEntryProposals(status?: 'pending' | 'accepted' | 'dismissed'): Promise<WorldEntryProposal[]>;
  acceptEntryProposal(proposalId: string): Promise<WorldArticle>;
  dismissEntryProposal(proposalId: string): Promise<void>;
  exportWorldBible(options: WorldBibleOptions): Promise<{ path: string } | null>;
  // ── The chain of days ─────────────────────────────────────────────────────
  // Every one of these recomputes `world_scenes.world_day` for the WHOLE manuscript and
  // resolves to how many scenes were dated: a chain edited without recomputing leaves the
  // world ordered and wrong, in silence.
  listSceneDayLinks(): Promise<SceneDayLink[]>;
  setSceneDayLink(sceneId: string, link: Omit<SceneDayLink, 'sceneId'>): Promise<number>;
  clearSceneDayLink(sceneId: string): Promise<number>;
  reorderScene(sceneId: string, toIndex: number): Promise<number>;
  // ── Threads and beats ─────────────────────────────────────────────────────
  // The beats are loaded WHOLE: every diagnostic they feed ("these nine scenes move
  // nothing", "this thread was declared and forgotten") is a whole-manuscript question,
  // and paying for them one scene at a time is how a structural view becomes unopenable.
  listWorldThreads(kind?: WorldThreadKind): Promise<WorldThread[]>;
  getWorldThread(threadId: string): Promise<WorldThread | null>;
  createWorldThread(input: WorldThreadInput): Promise<WorldThread>;
  updateWorldThread(threadId: string, patch: WorldThreadInput): Promise<WorldThread>;
  deleteWorldThread(threadId: string): Promise<void>;
  setThreadParties(
    threadId: string,
    parties: { partyKind: 'character' | 'group'; partyId: string; side: ThreadPartySide }[]
  ): Promise<WorldThread>;
  threadsForParty(partyKind: 'character' | 'group', partyId: string): Promise<WorldThread[]>;
  listWorldBeats(): Promise<WorldBeat[]>;
  /** The cast × conflicts board, in four queries. The arc fields travel READ-ONLY. */
  threadBoardData(): Promise<{
    cast: BoardCastMember[];
    threads: WorldThread[];
    affiliations: { personId: string; personName: string; groupId: string; groupName: string }[];
  }>;
  threadSceneContext(): Promise<{
    scenes: { sceneId: string; title: string; narrativeOrder: number }[];
    sceneCast: { sceneId: string; personId: string; personName: string }[];
    membership: { groupId: string; personId: string }[];
  }>;
  beatsForScene(sceneId: string): Promise<WorldBeat[]>;
  setWorldBeat(input: WorldBeatInput): Promise<void>;
  deleteWorldBeat(threadKind: BeatThreadKind, threadId: string, sceneId: string): Promise<void>;
  // ── Continuity ────────────────────────────────────────────────────────────
  // Recomputed WHOLE on every call; there is no findings table. The badge on a sheet and
  // the section list are the same array, filtered with `findingsFor()` in the renderer.
  runWorldContinuity(): Promise<WorldFinding[]>;
  /** Including what has been silenced — for the exceptions screen. */
  runWorldContinuityUnfiltered(): Promise<WorldFinding[]>;
  listNoticeMutes(): Promise<WorldNoticeMute[]>;
  muteNotice(input: {
    fingerprint: string;
    checkId: string;
    scope?: 'finding' | 'check';
    subjects: WorldNoticeMute['subjects'];
    headline: string | null;
    reasonCode: MuteReasonCode;
    reason?: string | null;
  }): Promise<WorldNoticeMute[]>;
  unmuteNotice(fingerprint: string): Promise<WorldNoticeMute[]>;
  /** Real counts from the same snapshot the checks ran over — for the empty state. */
  continuitySummary(): Promise<{ families: number; facts: number; checks: number }>;
  recomputeSceneDays(): Promise<number>;
  // ── The hard laws ─────────────────────────────────────────────────────────
  listWorldRules(): Promise<WorldRule[]>;
  getWorldRule(ruleId: string): Promise<WorldRule | null>;
  createWorldRule(input: WorldRuleInput): Promise<WorldRule>;
  updateWorldRule(ruleId: string, patch: WorldRuleInput): Promise<WorldRule>;
  deleteWorldRule(ruleId: string): Promise<void>;
  /** The laws a scene puts in play, prepopulated from its links, its place and its cast. */
  rulesInPlay(sceneId: string): Promise<WorldRule[]>;
  /** A first sentence to disagree with, quarantined in `proposed_text`. */
  draftWorldRule(ruleId: string): Promise<WorldRuleDraftResult>;
  acceptRuleDraft(ruleId: string): Promise<WorldRule>;
  rejectRuleDraft(ruleId: string): Promise<void>;
  // ── The decisions not taken yet ───────────────────────────────────────────
  // One read for the whole screen: the stored rows and the holes still sitting in the
  // author's prose arrive already merged and ranked, so nothing in the renderer has to
  // know which half a row came from.
  questionFeed(includeSettled?: boolean): Promise<WorldQuestionFeedItem[]>;
  listWorldQuestions(): Promise<WorldQuestion[]>;
  getWorldQuestion(questionId: string): Promise<WorldQuestion | null>;
  /** Store a derived hole so it can be parked, answered or edited. Idempotent by origin key. */
  ensureQuestion(input: {
    question: string;
    originKey?: string | null;
    origin?: WorldQuestionOrigin;
    anchorKind?: string | null;
    anchorId?: string | null;
    anchorField?: string | null;
  }): Promise<WorldQuestion>;
  updateWorldQuestion(questionId: string, patch: WorldQuestionInput): Promise<WorldQuestion>;
  deleteWorldQuestion(questionId: string): Promise<void>;
  setQuestionOption(input: WorldQuestionOptionInput): Promise<WorldQuestionOption>;
  deleteQuestionOption(optionId: string): Promise<void>;
  /** Answer, performing the option's pending write. */
  applyQuestionOption(optionId: string): Promise<WorldQuestion>;
  undoQuestionOption(optionId: string): Promise<WorldQuestion>;
  /** Whether the field still contains what was written, which is the only safe undo. */
  canUndoQuestionOption(optionId: string): Promise<boolean>;
  /** The same mark still sitting in other sheets, after one hole has been filled. */
  questionRemainingHoles(
    optionId: string
  ): Promise<{ kind: string; id: string; title: string; field: string; evidence: string }[]>;
  questionAnchorText(kind: string, id: string, field: string): Promise<string | null>;
  questionsForScene(sceneId: string): Promise<SceneQuestionLoad>;
  /** Three answers, stored as options. They are not canon until one is chosen and applied. */
  proposeQuestionOptions(questionId: string): Promise<WorldQuestionOptionsResult>;
  // ── The world chat ────────────────────────────────────────────────────────
  // Nodus calculates and the model writes: the answer is composed from facts this app
  // computed, and every citation is validated against the entries that really exist.
  worldChatStream(
    request: WorldChatRequest,
    handlers: { onDelta: (delta: string) => void }
  ): Promise<WorldChatResult>;
  /** Without a conversation, aborts the stream started last. */
  cancelWorldChat(conversationId?: string): Promise<void>;
  /** Archived chats only when asked for. */
  listWorldChatConversations(includeArchived?: boolean): Promise<WorldChatConversationSummary[]>;
  getWorldChatConversation(id: string): Promise<WorldChatConversation | null>;
  /** A chat may start in a project (and a folder of it) or in a notebook. */
  createWorldChatConversation(input: {
    title: string;
    selection: WorldChatSelection;
    model: ModelRef | null;
    projectId?: string | null;
    folderId?: string | null;
    notebookId?: string | null;
  }): Promise<WorldChatConversation>;
  saveWorldChatConversation(
    id: string,
    messages: DbChatTurn[],
    selection: WorldChatSelection,
    focus: WorldChatResult['focus'],
    model: ModelRef | null
  ): Promise<WorldChatConversation | null>;
  deleteWorldChatConversation(id: string): Promise<void>;
  // ── The manuscript ────────────────────────────────────────────────────────
  // The spine carries not one word of prose: a novel is megabytes, and every screen that
  // shows a chapter title would otherwise load the whole book.
  manuscriptSpine(): Promise<ManuscriptSpine>;
  getSceneText(sceneId: string): Promise<SceneText>;
  saveSceneText(sceneId: string, text: string | null): Promise<SceneText>;
  setChapterBreak(sceneId: string, input: { title?: string | null; epigraph?: string | null } | null): Promise<void>;
  setBookStart(
    sceneId: string,
    input: { title?: string | null; subtitle?: string | null; targetWords?: number | null } | null
  ): Promise<void>;
  manuscriptProgress(): Promise<ManuscriptProgress>;
  listSceneSnapshots(sceneId: string): Promise<SceneSnapshot[]>;
  takeSceneSnapshot(sceneId: string): Promise<SceneSnapshot[]>;
  /** Puts it back — after keeping what is there now, because an undo you cannot undo is a trap. */
  restoreSceneSnapshot(snapshotId: string): Promise<SceneText>;
  getSnapshotText(snapshotId: string): Promise<string | null>;
  /** Reads the scene against the beats the author declared for it. Never rewrites. */
  reviewWorldProse(sceneId: string): Promise<ProseReviewResult>;
  /** One file you can send. The internal `nodus://` links are degraded to their label. */
  exportManuscript(
    options: import('../worldManuscript').ManuscriptCompileOptions & { format: 'md' | 'pdf' }
  ): Promise<{ path: string } | null>;
  // ── Maps of an invented world ─────────────────────────────────────────────
  // The image bytes are NEVER inlined with a map: a base map is megabytes, and listing
  // them would push every byte of every map through the bridge to draw a row of cards.
  listWorldMaps(): Promise<WorldMap[]>;
  getWorldMap(mapId: string): Promise<WorldMap | null>;
  createWorldMap(input: WorldMapInput): Promise<WorldMap>;
  updateWorldMap(mapId: string, patch: Partial<WorldMapInput>): Promise<WorldMap | null>;
  deleteWorldMap(mapId: string): Promise<void>;
  childMaps(mapId: string): Promise<WorldMap[]>;
  /** The chain up to the root, nearest first — the breadcrumb. */
  mapAncestry(mapId: string): Promise<WorldMap[]>;
  /** Every map a place is drawn on, for the place sheet. */
  placeMapAppearances(placeId: string): Promise<PlaceMapAppearance[]>;
  /**
   * What every map can show, in one call. Map-following asks "which map draws this
   * place?" on every tick of the playhead; loading it per map would be a query per map
   * per tick.
   */
  mapCoverage(): Promise<import('../worldPresence').MapFocusCandidate[]>;
  getMapImageBlob(imageId: string): Promise<{ blob: Uint8Array; mime: string } | null>;
  getMapThumbnail(mapId: string): Promise<{ blob: Uint8Array; mime: string } | null>;
  /** Pick a file and make it the map's base image. Null when cancelled. */
  importMapImage(mapId: string): Promise<WorldMap | null>;
  /**
   * Grow the canvas and move EVERY coordinate the map holds. The only correct way to
   * resize a map — see growMapCanvas in worldMapsRepo.
   */
  growMapCanvas(mapId: string, growth: { x0: number; y0: number; x1: number; y1: number }): Promise<WorldMap | null>;

  /**
   * Generate or regenerate a map's image. `degraded` is true when the provider could not
   * take a reference image and prose was used instead — the interface MUST say so rather
   * than quietly producing something that does not match.
   */
  generateMapImage(request: MapGenerationRequestPayload): Promise<MapGenerationResultPayload>;
  /** Enlarge a region into a new child map, reprojecting the markers inside it. */
  zoomMapRegion(request: MapGenerationRequestPayload): Promise<MapGenerationResultPayload>;
  /** Grow the canvas by one edge, moving every coordinate with it. */
  expandMapCanvas(request: MapGenerationRequestPayload): Promise<MapGenerationResultPayload>;
  /** Look at the map and propose pins. Every suggestion is accepted one at a time. */
  suggestMapMarkers(mapId: string): Promise<SuggestedMapMarker[]>;

  listMapMarkers(mapId: string): Promise<MapMarker[]>;
  createMapMarker(input: MapMarkerInput): Promise<MapMarker>;
  updateMapMarker(markerId: string, patch: Partial<MapMarkerInput>): Promise<MapMarker | null>;
  deleteMapMarker(markerId: string): Promise<void>;
  /** Seed an editable outline around an existing circle. `aspect` is widthPx/heightPx. */
  circleToPolygon(markerId: string, aspect: number, vertices?: number): Promise<MapMarker | null>;

  listMapLayers(mapId: string): Promise<MapLayer[]>;
  createMapLayer(mapId: string, input: MapLayerInput): Promise<MapLayer>;
  updateMapLayer(layerId: string, patch: Partial<MapLayerInput>): Promise<MapLayer | null>;
  deleteMapLayer(layerId: string): Promise<void>;

  /**
   * Every recorded presence: scenes, events and residences, unioned. The renderer builds
   * the tracks with the pure engine in shared/worldPresence.ts, so scrubbing the playhead
   * never touches the database.
   */
  listWorldPresences(): Promise<import('../worldPresence').Presence[]>;
  listTravelModes(): Promise<MapTravelMode[]>;
  /** Seeds the four default paces the first time the travel panel is opened. */
  ensureTravelModes(): Promise<MapTravelMode[]>;
  createTravelMode(input: MapTravelModeInput): Promise<MapTravelMode>;
  updateTravelMode(modeId: string, patch: Partial<MapTravelModeInput>): Promise<MapTravelMode | null>;
  deleteTravelMode(modeId: string): Promise<void>;

  /** The world's calendar. Empty eras+months means the author has not defined one. */
  getWorldCalendar(): Promise<WorldCalendar>;
  /** Replaces the whole calendar and recomputes every derived absolute day. */
  saveWorldCalendar(input: {
    name?: string | null;
    notes?: string | null;
    eras?: { eraId?: string; name: string; abbreviation?: string | null; startYear: number; countsBackwards?: boolean }[];
    months?: { monthId?: string; name: string; days: number }[];
  }): Promise<WorldCalendar>;
  getEventWorldDate(eventId: string): Promise<(WorldDate & { worldDay: number | null }) | null>;
  setEventWorldDate(eventId: string, date: WorldDate, worldOrder?: number): Promise<void>;
  generateCharacterBiography(
    personId: string,
    mode?: CharacterBiographyMode
  ): Promise<{ biography: string | null; noMaterial: boolean; proposal: boolean }>;
  /** Low-level in-voice completion retained for internal and compatibility callers. */
  interviewCharacter(personId: string, question: string, history?: InterviewTurn[]): Promise<string>;
  listCharacterChatConversations(personId: string): Promise<CharacterChatConversationSummary[]>;
  getCharacterChatConversation(id: string): Promise<CharacterChatConversation | null>;
  createCharacterChatConversation(input: {
    personId: string;
    title: string;
    imageEnabled?: boolean;
  }): Promise<CharacterChatConversation>;
  setCharacterChatImagesEnabled(id: string, enabled: boolean): Promise<CharacterChatConversation | null>;
  sendCharacterChatMessage(id: string, question: string): Promise<CharacterChatSendResult>;
  deleteCharacterChatConversation(id: string): Promise<void>;
  /** Promote the AI proposal to canon. Null when there was nothing to accept. */
  acceptProposedBiography(personId: string): Promise<Character | null>;
  discardProposedBiography(personId: string): Promise<Character | null>;
  generateCharacterPortrait(
    personId: string,
    style?: DecorativeImageStyle,
    extra?: string | null
  ): Promise<Character | null>;
  /** The gallery WITHOUT the bytes; fetch those one at a time with getCharacterImageBlob. */
  listCharacterImages(personId: string): Promise<CharacterImage[]>;
  getCharacterImageBlob(imageId: string): Promise<{ blob: Uint8Array; mime: string } | null>;
  addCharacterImageFromFile(personId: string, kind?: CharacterImageKind): Promise<CharacterImage[]>;
  generateCharacterImage(
    personId: string,
    kind: CharacterImageKind,
    style?: DecorativeImageStyle,
    extra?: string | null
  ): Promise<CharacterImage>;
  updateCharacterImage(imageId: string, patch: { kind?: CharacterImageKind; label?: string | null }): Promise<void>;
  deleteCharacterImage(imageId: string): Promise<void>;
  setCharacterAvatarFromImage(imageId: string): Promise<void>;
  listCharacterAbilities(personId: string): Promise<CharacterAbility[]>;
  addCharacterAbility(personId: string, input: CharacterAbilityInput): Promise<CharacterAbility>;
  updateCharacterAbility(abilityId: string, patch: Partial<CharacterAbilityInput>): Promise<CharacterAbility | null>;
  deleteCharacterAbility(abilityId: string): Promise<void>;
  /** Add or update an alias, including whether it is a secret and who knows it. */
  setCharacterName(
    personId: string,
    name: string,
    kind: string | null,
    secret?: boolean,
    knownBy?: string | null
  ): Promise<Character | null>;
  deleteCharacterName(personId: string, name: string): Promise<Character | null>;
}
