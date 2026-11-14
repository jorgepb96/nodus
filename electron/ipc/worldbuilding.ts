// worldbuilding channels, moved verbatim out of the monolithic registerIpc.
// The channel names are unchanged; scripts/test-ipc-contract.mjs is what proves it.
import { dialogTitle } from '../dialogTitles';
import {getMobileWorldChatSourcePack} from '../db/mobileWorldChatSource';
import type { IpcContext } from './context';
import type { CharacterInput, CharacterFilter, CharacterImage, CharacterImageKind, CharacterAbilityInput, CharacterAffiliationInput } from '@shared/types';
import { generateCharacterGalleryImage, generateCharacterPortrait, generateWorldEntityImage } from '../ai/decorativeImages';
import { DEFAULT_DECORATIVE_IMAGE_STYLE } from '@shared/imageStyles';
import { generateCharacterBiography } from '../ai/characterBiography';
import { composeCharacterSheetMarkdown } from '@shared/characterSheetExport';
import type { WorldPlaceInput } from '@shared/types';
import type { BeatThreadKind, WorldRuleInput, WorldQuestionInput, WorldQuestionOptionInput, WorldChatRequest, SceneDayLink, ThreadPartySide, WorldBeatInput, WorldThreadInput, WorldThreadKind, WorldArticleDraftMode, WorldArticleInput, WorldBibleOptions, WorldEntryRef, WorldGroupInput, WorldGroupKind, WorldImageEntityKind, WorldSceneInput, WorldSecretInput } from '@shared/types';
import { addKnower, addSceneCharacter, appearancesOfCharacter, createScene, createSecret, deleteScene, deleteSecret, listKnowers, listSceneCharacters, listScenes, listSecrets, removeKnower, removeSceneCharacter, secretsForCharacter, updateScene, updateSecret, listSceneDayLinks, recomputeSceneDays, setSceneDayLink, clearSceneDayLink, reorderScene } from '../db/worldStoryRepo';
import { addAffiliation, createWorldGroup, deleteAffiliation, deleteWorldGroup, getWorldGroup, listAffiliationsForCharacter, listAffiliationsForGroup, listWorldGroups, updateAffiliation, updateWorldGroup } from '../db/worldGroupsRepo';
import { addWorldImage, deleteWorldImage, getWorldImageBlob, listWorldImages } from '../db/worldImagesRepo';
import { draftWorldArticle } from '../ai/worldArticleDraft';
import { draftWorldRule } from '../ai/worldRules';
import { proposeQuestionOptions } from '../ai/worldQuestionOptions';
import { streamWorldChat } from '../ai/worldChat';
import { getSceneText, manuscriptProgress, manuscriptSpine, getSnapshotText, listSceneSnapshots, restoreSceneSnapshot, saveSceneText, setBookStart, takeSceneSnapshot, setChapterBreak } from '../db/worldManuscriptRepo';
import { exportManuscript } from '../export/manuscriptExport';
import { reviewWorldProse } from '../ai/worldProseReview';
import { analyzeMissingEntries } from '../ai/worldMissingEntries';
import { exportWorldBible } from '../export/worldBibleExport';
import { acceptRuleProposedText, createWorldRule, deleteWorldRule, getWorldRule, listWorldRules, rulesInPlay, setRuleProposedText, updateWorldRule } from '../db/worldRulesRepo';
import { applyQuestionOption, canUndoOption, deleteQuestionOption, deleteWorldQuestion, ensureQuestion, getWorldQuestion, listWorldQuestions, questionAnchorText, questionFeed, remainingHoles, sceneQuestionLoad, setQuestionOption, undoQuestionOption, updateWorldQuestion } from '../db/worldQuestionsRepo';
import { continuitySummary, listNoticeMutes, muteNotice, runContinuity, runContinuityUnfiltered, unmuteNotice } from '../db/worldContinuityRepo';
import { beatsForScene, createWorldThread, deleteWorldBeat, deleteWorldThread, getWorldThread, listWorldBeats, listWorldThreads, setThreadParties, setWorldBeat, threadBoardData, threadSceneContext, threadsForParty, updateWorldThread } from '../db/worldThreadsRepo';
import { acceptArticleProposedBody, acceptEntryProposal, createWorldArticle, deleteWorldArticle, dismissEntryProposal, listEntryProposals, getWorldEntry, indexEntryLinks, listWorldEntries, rebuildWorldLinks, resolveWorldLink, searchWorldBodies, setArticleProposedBody, updateWorldArticle, worldBacklinks, worldUnresolvedLinks } from '../db/worldEncyclopediaRepo';
import { createWorldPlace, deleteWorldPlace, getWorldPlace, inhabitantsOfPlace, listWorldPlaces, updateWorldPlace } from '../db/worldPlacesRepo';
import { childMaps, createWorldMap, deleteWorldMap, getMapImageBlob, getMapThumbnail, getWorldMap, growMapCanvas, listWorldMaps, mapAncestry, worldMapCoverage, placeMapAppearances, saveMapImage, updateWorldMap } from '../db/worldMapsRepo';
import * as worldChatHistory from '../db/worldChatRepo';
import * as characterChatHistory from '../db/characterChatRepo';
import { circleToPolygon, createMapLayer, createMapMarker, createTravelMode, deleteMapLayer, deleteMapMarker, deleteTravelMode, ensureTravelModes, listMapLayers, listMapMarkers, listTravelModes, updateMapLayer, updateMapMarker, updateTravelMode } from '../db/mapMarkersRepo';
import { readMapImageFile } from '../maps/mapImageStore';
import { listPresences } from '../db/worldPresenceRepo';
import { expandMapCanvas, generateMapImage, suggestMapMarkers, zoomIntoRegion, MapGenerationRequest } from '../maps/mapGeneration';
import type { CanvasGrowth } from '@shared/worldMapGeometry';
import type { MapLayerInput, MapMarkerInput, MapTravelModeInput, WorldMapInput } from '@shared/types';
import type { WorldDate } from '@shared/worldCalendar';
import { getEventWorldDateFull, getWorldCalendar, saveWorldCalendar, setEventWorldDateFull, WorldCalendarInput } from '../db/worldCalendarRepo';
import { interviewCharacter } from '../ai/characterInterview';
import { sendCharacterChatMessage } from '../ai/characterChat';
import type { InterviewTurn } from '@shared/characterInterview';
import { acceptProposedBiography, addCharacterAbility, addCharacterImage, characterCounts, createCharacter, deleteCharacter, deleteCharacterAbility, deleteCharacterImage, deleteCharacterName, getCharacter, getCharacterImageBlob, listCharacterAbilities, listCharacterEvents, listCharacterImages, listCharacters, listWorldEvents, setCharacterAvatarFromImage, setCharacterName, setEventWorldDate, setProposedBiography, updateCharacter, updateCharacterAbility, updateCharacterImage } from '../db/charactersRepo';
import path from 'node:path';
import fs from 'node:fs';
import { dialog } from 'electron';
import { showImportOpenDialog } from '../privacy';
import type { DecorativeImageStyle } from '@shared/types';
import { kinOf } from '../db/relationshipsRepo';
import { listSocialRelationsForPerson } from '../db/socialRepo';
import { getSettings } from '../db/settingsRepo';

export function registerWorldbuildingIpc({ h, getWindow, chatAborters }: IpcContext): void {
  // Worldbuilding characters. A character is a person row plus its overlay, so the
  // portrait, kinship, relations and event handlers above are reused as they are;
  // only the overlay and the in-world calendar need their own channels.
  h('characters:list', async (_e, filter?: CharacterFilter) => listCharacters(filter ?? {}));
  h('characters:get', async (_e, personId: string) => getCharacter(personId));
  h('characters:create', async (_e, input: CharacterInput) => createCharacter(input));
  h('characters:update', async (_e, personId: string, patch: Partial<CharacterInput>) =>
    updateCharacter(personId, patch)
  );
  h('characters:delete', async (_e, personId: string) => {
    deleteCharacter(personId);
  });
  h('characters:listEvents', async (_e, personId: string) => listCharacterEvents(personId));
  h('characters:setEventWorldDate', async (_e, eventId: string, worldYear: number | null, worldOrder?: number) => {
    setEventWorldDate(eventId, worldYear, worldOrder ?? 0);
  });
  h('characters:counts', async () => characterCounts());
  h('characters:listWorldEvents', async () => listWorldEvents());
  // Places, from a worldbuilding vault: the shared row plus its fiction overlay.
  h('places:listWorld', async () => listWorldPlaces());
  h('places:getWorld', async (_e, placeId: string) => getWorldPlace(placeId));
  h('places:createWorld', async (_e, input: WorldPlaceInput) => createWorldPlace(input));
  h('places:updateWorld', async (_e, placeId: string, patch: Partial<WorldPlaceInput>) =>
    updateWorldPlace(placeId, patch)
  );
  h('places:deleteWorld', async (_e, placeId: string) => {
    deleteWorldPlace(placeId);
  });
  // Which characters are recorded at a place, and what happened there. Both come from
  // tables genealogy already populates (person_places, events.place_id).
  h('places:inhabitants', async (_e, placeId: string) => inhabitantsOfPlace(placeId));
  // Groups: factions, cultures, religions, houses and orders — one collection, filtered.
  // Secrets and scenes.
  h('story:listSecrets', async () => listSecrets());
  h('story:secretsForCharacter', async (_e, personId: string) => secretsForCharacter(personId));
  h('story:createSecret', async (_e, input: WorldSecretInput) => createSecret(input));
  h('story:updateSecret', async (_e, id: string, patch: Partial<WorldSecretInput>) => updateSecret(id, patch));
  h('story:deleteSecret', async (_e, id: string) => {
    deleteSecret(id);
  });
  h('story:listKnowers', async (_e, secretId: string) => listKnowers(secretId));
  h('story:addKnower', async (_e, input: { secretId: string; personId: string; sinceWorldDay?: number | null; how?: string | null }) =>
    addKnower(input)
  );
  h('story:removeKnower', async (_e, id: string) => {
    removeKnower(id);
  });
  h('story:listScenes', async (_e, order?: 'narrative' | 'chronological') => listScenes(order ?? 'narrative'));
  h('story:createScene', async (_e, input: WorldSceneInput) => createScene(input));
  h('story:updateScene', async (_e, id: string, patch: Partial<WorldSceneInput>) => updateScene(id, patch));
  h('story:deleteScene', async (_e, id: string) => {
    deleteScene(id);
  });
  h('story:listSceneCharacters', async (_e, sceneId: string) => listSceneCharacters(sceneId));
  h('story:appearances', async (_e, personId: string) => appearancesOfCharacter(personId));
  h('story:addSceneCharacter', async (_e, sceneId: string, personId: string, role?: string | null) =>
    addSceneCharacter(sceneId, personId, role ?? null)
  );
  h('story:removeSceneCharacter', async (_e, id: string) => {
    removeSceneCharacter(id);
  });
  h('groups:list', async (_e, kind?: WorldGroupKind) => listWorldGroups(kind));
  h('groups:get', async (_e, groupId: string) => getWorldGroup(groupId));
  h('groups:create', async (_e, input: WorldGroupInput) => createWorldGroup(input));
  h('groups:update', async (_e, groupId: string, patch: Partial<WorldGroupInput>) =>
    updateWorldGroup(groupId, patch)
  );
  h('groups:delete', async (_e, groupId: string) => {
    deleteWorldGroup(groupId);
  });
  h('groups:listAffiliationsForCharacter', async (_e, personId: string) =>
    listAffiliationsForCharacter(personId)
  );
  h('groups:listAffiliationsForGroup', async (_e, groupId: string) => listAffiliationsForGroup(groupId));
  h('groups:addAffiliation', async (_e, input: CharacterAffiliationInput) => addAffiliation(input));
  h('groups:updateAffiliation', async (_e, id: string, patch: Partial<CharacterAffiliationInput>) =>
    updateAffiliation(id, patch)
  );
  h('groups:deleteAffiliation', async (_e, id: string) => {
    deleteAffiliation(id);
  });
  // Generic gallery, shared by characters, places, groups and scenes.
  h('world:listImages', async (_e, entityKind: WorldImageEntityKind, entityId: string) =>
    listWorldImages(entityKind, entityId)
  );
  h('world:getImageBlob', async (_e, imageId: string) => getWorldImageBlob(imageId));
  h('world:deleteImage', async (_e, imageId: string) => {
    deleteWorldImage(imageId);
  });
  h('world:addImageFromFile', async (
    _e,
    entityKind: WorldImageEntityKind,
    entityId: string,
    kind?: CharacterImageKind
  ) => {
    const win = getWindow();
    const picked = await showImportOpenDialog(win ?? undefined!, {
      title: dialogTitle('addImage', getSettings().uiLanguage),
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: 'Imágenes', extensions: ['png', 'jpg', 'jpeg', 'webp', 'bmp', 'tif', 'tiff'] }],
    });
    if (picked.canceled || picked.filePaths.length === 0) return [];
    return picked.filePaths.map((filePath) => {
      const bytes = fs.readFileSync(filePath);
      const ext = path.extname(filePath).toLowerCase();
      const mime =
        ext === '.png' ? 'image/png'
        : ext === '.webp' ? 'image/webp'
        : ext === '.bmp' ? 'image/bmp'
        : ext === '.tif' || ext === '.tiff' ? 'image/tiff'
        : 'image/jpeg';
      return addWorldImage({
        entityKind,
        entityId,
        blob: bytes,
        mimeType: mime,
        kind: kind ?? 'other',
        label: path.basename(filePath, ext),
        generated: false,
      });
    });
  });
  h('world:generateImage', async (
    _e,
    entityKind: WorldImageEntityKind,
    entityId: string,
    kind: CharacterImageKind,
    style?: DecorativeImageStyle
  ) => generateWorldEntityImage(entityKind, entityId, kind, style ?? DEFAULT_DECORATIVE_IMAGE_STYLE));
  // ── Maps of an invented world ──────────────────────────────────────────────
  // The image blob is fetched on its own (`maps:imageBlob`) rather than inlined with the
  // map: a base map is megabytes, and listing them would push every byte of every map
  // through the bridge just to draw a row of thumbnails.
  h('maps:list', async () => listWorldMaps());
  h('maps:get', async (_e, mapId: string) => getWorldMap(mapId));
  h('maps:create', async (_e, input: WorldMapInput) => createWorldMap(input));
  h('maps:update', async (_e, mapId: string, patch: Partial<WorldMapInput>) => updateWorldMap(mapId, patch));
  h('maps:delete', async (_e, mapId: string) => {
    deleteWorldMap(mapId);
  });
  h('maps:children', async (_e, mapId: string) => childMaps(mapId));
  h('maps:ancestry', async (_e, mapId: string) => mapAncestry(mapId));
  h('maps:placeAppearances', async (_e, placeId: string) => placeMapAppearances(placeId));
  h('maps:coverage', async () => worldMapCoverage());
  h('maps:imageBlob', async (_e, imageId: string) => getMapImageBlob(imageId));
  h('maps:thumbnail', async (_e, mapId: string) => getMapThumbnail(mapId));
  h('maps:importImage', async (_e, mapId: string) => {
    const win = getWindow();
    const picked = await showImportOpenDialog(win ?? undefined!, {
      title: dialogTitle('chooseMapImage', getSettings().uiLanguage),
      properties: ['openFile'],
      filters: [{ name: 'Imágenes', extensions: ['png', 'jpg', 'jpeg', 'webp', 'bmp', 'tif', 'tiff'] }],
    });
    if (picked.canceled || picked.filePaths.length === 0) return null;
    const prepared = await readMapImageFile(picked.filePaths[0]);
    saveMapImage({ mapId, role: 'base', ...prepared, generated: false });
    return getWorldMap(mapId);
  });
  h('maps:growCanvas', async (_e, mapId: string, growth: CanvasGrowth) => growMapCanvas(mapId, growth));
  // Generation. `zoom` with `cropOnly` needs no provider at all: it is the exact,
  // instant, offline half of "ampliación" and the one offered first.
  h('maps:generateImage', async (_e, request: MapGenerationRequest) => generateMapImage(request));
  h('maps:zoomRegion', async (_e, request: MapGenerationRequest) => zoomIntoRegion(request));
  h('maps:expandCanvas', async (_e, request: MapGenerationRequest) => expandMapCanvas(request));
  h('maps:suggestMarkers', async (_e, mapId: string) => suggestMapMarkers(mapId));

  h('maps:listMarkers', async (_e, mapId: string) => listMapMarkers(mapId));
  h('maps:createMarker', async (_e, input: MapMarkerInput) => createMapMarker(input));
  h('maps:updateMarker', async (_e, markerId: string, patch: Partial<MapMarkerInput>) => updateMapMarker(markerId, patch));
  h('maps:deleteMarker', async (_e, markerId: string) => {
    deleteMapMarker(markerId);
  });
  h('maps:circleToPolygon', async (_e, markerId: string, aspect: number, vertices?: number) =>
    circleToPolygon(markerId, aspect, vertices)
  );

  h('maps:listLayers', async (_e, mapId: string) => listMapLayers(mapId));
  h('maps:createLayer', async (_e, mapId: string, input: MapLayerInput) => createMapLayer(mapId, input));
  h('maps:updateLayer', async (_e, layerId: string, patch: Partial<MapLayerInput>) => updateMapLayer(layerId, patch));
  h('maps:deleteLayer', async (_e, layerId: string) => {
    deleteMapLayer(layerId);
  });

  // Where every character is, from scenes + events + residences. One call: the renderer
  // builds the tracks itself with the pure engine, so the playhead never round-trips.
  h('maps:presences', async () => listPresences());
  h('maps:listTravelModes', async () => listTravelModes());
  h('maps:ensureTravelModes', async () => ensureTravelModes());
  h('maps:createTravelMode', async (_e, input: MapTravelModeInput) => createTravelMode(input));
  h('maps:updateTravelMode', async (_e, modeId: string, patch: Partial<MapTravelModeInput>) => updateTravelMode(modeId, patch));
  h('maps:deleteTravelMode', async (_e, modeId: string) => {
    deleteTravelMode(modeId);
  });

  // The world's calendar. Saving it recomputes every derived absolute day, because a
  // month that gained a day moves every date after it.
  h('world:getCalendar', async () => getWorldCalendar());
  h('world:saveCalendar', async (_e, input: WorldCalendarInput) => saveWorldCalendar(input));
  h('world:getEventDate', async (_e, eventId: string) => getEventWorldDateFull(eventId));
  h('world:setEventDate', async (_e, eventId: string, date: WorldDate, worldOrder?: number) => {
    setEventWorldDateFull(eventId, date, worldOrder ?? 0);
  });

  // ── The encyclopedia ───────────────────────────────────────────────────────
  h('encyclopedia:list', async () => listWorldEntries());
  h('worldChat:mobileSourcePack',async (_e,request:unknown)=>getMobileWorldChatSourcePack(request));
  h('encyclopedia:get', async (_e, ref: WorldEntryRef) => getWorldEntry(ref));
  h('encyclopedia:searchBodies', async (_e, query: string) => searchWorldBodies(query));
  h('encyclopedia:createArticle', async (_e, input: WorldArticleInput) => createWorldArticle(input));
  h('encyclopedia:updateArticle', async (_e, articleId: string, patch: WorldArticleInput) =>
    updateWorldArticle(articleId, patch)
  );
  h('encyclopedia:deleteArticle', async (_e, articleId: string) => {
    deleteWorldArticle(articleId);
  });
  h('encyclopedia:backlinks', async (_e, ref: WorldEntryRef) => worldBacklinks(ref));
  h('encyclopedia:unresolved', async () => worldUnresolvedLinks());
  h('encyclopedia:resolveLink', async (_e, text: string, target: WorldEntryRef) => resolveWorldLink(text, target));
  h('encyclopedia:rebuildLinks', async () => rebuildWorldLinks());
  // Re-index a sheet that is not an article after it is edited elsewhere, so a link
  // written in a character's backstory shows up in the encyclopedia without a full rebuild.
  h('encyclopedia:indexEntry', async (_e, ref: WorldEntryRef) => indexEntryLinks(ref));
  h('encyclopedia:draft', async (_e, articleId: string, mode: WorldArticleDraftMode) =>
    draftWorldArticle(articleId, mode)
  );
  h('encyclopedia:acceptDraft', async (_e, articleId: string) => acceptArticleProposedBody(articleId));
  h('encyclopedia:rejectDraft', async (_e, articleId: string) => {
    setArticleProposedBody(articleId, null);
  });
  h('encyclopedia:analyzeMissing', async () => analyzeMissingEntries());
  h('encyclopedia:listProposals', async (_e, status?: 'pending' | 'accepted' | 'dismissed') =>
    listEntryProposals(status)
  );
  h('encyclopedia:acceptProposal', async (_e, proposalId: string) => acceptEntryProposal(proposalId));
  h('encyclopedia:dismissProposal', async (_e, proposalId: string) => {
    dismissEntryProposal(proposalId);
  });
  h('encyclopedia:exportBible', async (_e, options: WorldBibleOptions) => exportWorldBible(options));

  // ── The chain of days ──────────────────────────────────────────────────────
  h('scenes:dayLinks', async () => listSceneDayLinks());
  h('scenes:setDayLink', async (_e, sceneId: string, link: Omit<SceneDayLink, 'sceneId'>) =>
    setSceneDayLink(sceneId, link)
  );
  h('scenes:clearDayLink', async (_e, sceneId: string) => clearSceneDayLink(sceneId));
  h('scenes:reorder', async (_e, sceneId: string, toIndex: number) => reorderScene(sceneId, toIndex));

  // ── Threads and beats ──────────────────────────────────────────────────────
  h('threads:list', async (_e, kind?: WorldThreadKind) => listWorldThreads(kind));
  h('threads:get', async (_e, threadId: string) => getWorldThread(threadId));
  h('threads:create', async (_e, input: WorldThreadInput) => createWorldThread(input));
  h('threads:update', async (_e, threadId: string, patch: WorldThreadInput) => updateWorldThread(threadId, patch));
  h('threads:delete', async (_e, threadId: string) => {
    deleteWorldThread(threadId);
  });
  h('threads:setParties', async (
    _e,
    threadId: string,
    parties: { partyKind: 'character' | 'group'; partyId: string; side: ThreadPartySide }[]
  ) => setThreadParties(threadId, parties));
  h('threads:forParty', async (_e, partyKind: 'character' | 'group', partyId: string) =>
    threadsForParty(partyKind, partyId)
  );
  h('threads:beats', async () => listWorldBeats());
  h('threads:board', async () => threadBoardData());
  h('threads:sceneContext', async () => threadSceneContext());
  h('threads:beatsForScene', async (_e, sceneId: string) => beatsForScene(sceneId));
  h('threads:setBeat', async (_e, input: WorldBeatInput) => {
    setWorldBeat(input);
  });
  h('threads:deleteBeat', async (_e, threadKind: BeatThreadKind, threadId: string, sceneId: string) => {
    deleteWorldBeat(threadKind, threadId, sceneId);
  });

  // ── Continuity ─────────────────────────────────────────────────────────────
  h('continuity:run', async () => runContinuity());
  h('continuity:runAll', async () => runContinuityUnfiltered());
  h('continuity:mutes', async () => listNoticeMutes());
  h('continuity:mute', async (_e, input: Parameters<typeof muteNotice>[0]) => muteNotice(input));
  h('continuity:unmute', async (_e, fingerprint: string) => unmuteNotice(fingerprint));
  h('continuity:summary', async () => continuitySummary());

  // ── Rules ──────────────────────────────────────────────────────────────────
  h('rules:list', async () => listWorldRules());
  h('rules:get', async (_e, ruleId: string) => getWorldRule(ruleId));
  h('rules:create', async (_e, input: WorldRuleInput) => createWorldRule(input));
  h('rules:update', async (_e, ruleId: string, patch: WorldRuleInput) => updateWorldRule(ruleId, patch));
  h('rules:delete', async (_e, ruleId: string) => {
    deleteWorldRule(ruleId);
  });
  h('rules:inPlay', async (_e, sceneId: string) => rulesInPlay(sceneId));
  // A first sentence to disagree with, written into `proposed_text` and never into
  // `statement`. Accepting is a separate call.
  h('rules:draft', async (_e, ruleId: string) => draftWorldRule(ruleId));
  h('rules:acceptDraft', async (_e, ruleId: string) => acceptRuleProposedText(ruleId));
  h('rules:rejectDraft', async (_e, ruleId: string) => {
    setRuleProposedText(ruleId, null);
  });
  // ── Open questions ─────────────────────────────────────────────────────────
  // `feed` is the screen's only read: stored rows and the holes still in the prose arrive
  // as one ranked list, so the renderer never has to know which half a row came from.
  h('questions:feed', async (_e, includeSettled?: boolean) => questionFeed(includeSettled === true));
  h('questions:list', async () => listWorldQuestions());
  h('questions:get', async (_e, questionId: string) => getWorldQuestion(questionId));
  h('questions:ensure', async (_e, input: Parameters<typeof ensureQuestion>[0]) => ensureQuestion(input));
  h('questions:update', async (_e, questionId: string, patch: WorldQuestionInput) =>
    updateWorldQuestion(questionId, patch)
  );
  h('questions:delete', async (_e, questionId: string) => {
    deleteWorldQuestion(questionId);
  });
  h('questions:setOption', async (_e, input: WorldQuestionOptionInput) => setQuestionOption(input));
  h('questions:deleteOption', async (_e, optionId: string) => {
    deleteQuestionOption(optionId);
  });
  h('questions:apply', async (_e, optionId: string) => applyQuestionOption(optionId));
  h('questions:undo', async (_e, optionId: string) => undoQuestionOption(optionId));
  h('questions:canUndo', async (_e, optionId: string) => canUndoOption(optionId));
  h('questions:remainingHoles', async (_e, optionId: string) => remainingHoles(optionId));
  h('questions:anchorText', async (_e, kind: string, id: string, field: string) =>
    questionAnchorText(kind, id, field)
  );
  h('questions:forScene', async (_e, sceneId: string) => sceneQuestionLoad(sceneId));
  // The second: three answers, stored as options with `origin='ai'`. There is no accept
  // step because choosing one IS the accept step — an option is not canon until it is
  // applied, so the quarantine here is structural.
  h('questions:propose', async (_e, questionId: string) => proposeQuestionOptions(questionId));

  // ── The world chat ─────────────────────────────────────────────────────────
  h('worldChat:stream', async (e, requestId: string, request: WorldChatRequest) => {
    const controller = new AbortController();
    chatAborters.set(requestId, controller);
    try {
      return await streamWorldChat(
        request,
        (delta) => e.sender.send('worldChat:delta', requestId, delta),
        controller.signal
      );
    } finally {
      chatAborters.delete(requestId);
    }
  });
  h('worldChat:cancel', async (_e, requestId: string) => {
    chatAborters.get(requestId)?.abort();
  });
  h('worldChat:history:list', async (_e, includeArchived?: boolean) => worldChatHistory.listWorldChatConversations(Boolean(includeArchived)));
  h('worldChat:history:get', async (_e, id: string) => worldChatHistory.getWorldChatConversation(id));
  h('worldChat:history:create', async (_e, input: Parameters<typeof worldChatHistory.createWorldChatConversation>[0]) =>
    worldChatHistory.createWorldChatConversation(input)
  );
  h('worldChat:history:save', async (
    _e,
    id: string,
    messages: Parameters<typeof worldChatHistory.saveWorldChatConversation>[1],
    selection: Parameters<typeof worldChatHistory.saveWorldChatConversation>[2],
    focus: Parameters<typeof worldChatHistory.saveWorldChatConversation>[3],
    model: Parameters<typeof worldChatHistory.saveWorldChatConversation>[4]
  ) => worldChatHistory.saveWorldChatConversation(id, messages, selection, focus, model));
  h('worldChat:history:delete', async (_e, id: string) => {
    worldChatHistory.deleteWorldChatConversation(id);
  });

  // ── The manuscript ─────────────────────────────────────────────────────────
  h('manuscript:spine', async () => manuscriptSpine());
  h('manuscript:getText', async (_e, sceneId: string) => getSceneText(sceneId));
  h('manuscript:saveText', async (_e, sceneId: string, text: string | null) => saveSceneText(sceneId, text));
  h('manuscript:setChapter', async (
    _e,
    sceneId: string,
    input: { title?: string | null; epigraph?: string | null } | null
  ) => {
    setChapterBreak(sceneId, input);
  });
  h('manuscript:setBook', async (
    _e,
    sceneId: string,
    input: { title?: string | null; subtitle?: string | null; targetWords?: number | null } | null
  ) => {
    setBookStart(sceneId, input);
  });
  h('manuscript:snapshots', async (_e, sceneId: string) => listSceneSnapshots(sceneId));
  h('manuscript:snapshot', async (_e, sceneId: string) => takeSceneSnapshot(sceneId));
  h('manuscript:restore', async (_e, snapshotId: string) => restoreSceneSnapshot(snapshotId));
  h('manuscript:snapshotText', async (_e, snapshotId: string) => getSnapshotText(snapshotId));
  h('manuscript:progress', async () => manuscriptProgress());
  // A narrow, read-only model call. Its source is the manuscript text plus the
  // author's declared beats; it cannot write back to either.
  h('manuscript:review', async (_e, sceneId: string) => reviewWorldProse(sceneId));
  h('manuscript:export', async (
    _e,
    options: Parameters<typeof exportManuscript>[0]
  ) => exportManuscript(options));

  // The one mechanical fix: re-derive every scene's world day from the chain.
  h('scenes:recomputeDays', async () => recomputeSceneDays());
  h('characters:exportSheet', async (
    _e,
    personId: string,
    options?: { includeSecrets?: boolean; includeNotes?: boolean }
  ) => {
    const character = getCharacter(personId);
    if (!character) throw new Error('Personaje no encontrado.');
    const kin = kinOf(personId);
    const markdown = composeCharacterSheetMarkdown(
      {
        displayName: character.displayName,
        names: character.names,
        species: character.profile.species,
        gender: character.profile.gender,
        pronouns: character.profile.pronouns,
        lifeStatus: character.profile.lifeStatus,
        narrativeRole: character.profile.narrativeRole,
        birthDate: character.birthDate,
        deathDate: character.deathDate,
        birthYear: character.profile.birthYearSort,
        deathYear: character.profile.deathYearSort,
        appearance: character.profile.appearance,
        personality: character.profile.personality,
        backstory: character.profile.backstory,
        biography: character.biography,
        arc: character.profile.arc,
        voice: character.profile.voice,
        abilities: listCharacterAbilities(personId),
        events: listCharacterEvents(personId),
        kin: {
          parents: kin.parents.map((person) => person.displayName),
          spouses: kin.spouses.map((person) => person.displayName),
          children: kin.children.map((person) => person.displayName),
          siblings: kin.siblings.map((person) => person.displayName),
        },
        relations: listSocialRelationsForPerson(personId).map((relation) => ({
          role: relation.role,
          target: relation.targetName,
        })),
        notes: character.notes,
      },
      options ?? {}
    );
    const win = getWindow();
    const safeName = character.displayName.replace(/[^\p{L}\p{N} _-]/gu, '').trim() || 'personaje';
    const picked = await dialog.showSaveDialog(win ?? undefined!, {
      title: dialogTitle('exportCharacterSheet', getSettings().uiLanguage),
      defaultPath: `${safeName}.md`,
      filters: [{ name: 'Markdown', extensions: ['md'] }],
    });
    if (picked.canceled || !picked.filePath) return null;
    fs.writeFileSync(picked.filePath, markdown, 'utf8');
    return picked.filePath;
  });
  h('characters:generateBiography', async (_e, personId: string, mode?: 'faithful' | 'propose') =>
    generateCharacterBiography(personId, mode ?? 'faithful')
  );
  h('characters:interview', async (_e, personId: string, question: string, history?: InterviewTurn[]) =>
    interviewCharacter(personId, question, history ?? [])
  );
  h('characters:listChatConversations', async (_e, personId: string) =>
    characterChatHistory.listCharacterChatConversations(personId)
  );
  h('characters:getChatConversation', async (_e, id: string) =>
    characterChatHistory.getCharacterChatConversation(id)
  );
  h(
    'characters:createChatConversation',
    async (_e, input: { personId: string; title: string; imageEnabled?: boolean }) =>
      characterChatHistory.createCharacterChatConversation(input)
  );
  h('characters:setChatImagesEnabled', async (_e, id: string, enabled: boolean) =>
    characterChatHistory.setCharacterChatImagesEnabled(id, enabled)
  );
  h('characters:sendChatMessage', async (_e, id: string, question: string) =>
    sendCharacterChatMessage(id, question)
  );
  h('characters:deleteChatConversation', async (_e, id: string) => {
    characterChatHistory.deleteCharacterChatConversation(id);
  });
  h('characters:acceptProposedBiography', async (_e, personId: string) => acceptProposedBiography(personId));
  h('characters:discardProposedBiography', async (_e, personId: string) => {
    setProposedBiography(personId, null);
    return getCharacter(personId);
  });
  // Image gallery. The bytes never travel with the list — only on demand, per image.
  h('characters:listImages', async (_e, personId: string) => listCharacterImages(personId));
  h('characters:getImageBlob', async (_e, imageId: string) => getCharacterImageBlob(imageId));
  h('characters:addImageFromFile', async (_e, personId: string, kind?: CharacterImageKind) => {
    const win = getWindow();
    const picked = await showImportOpenDialog(win ?? undefined!, {
      title: dialogTitle('addCharacterImage', getSettings().uiLanguage),
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: 'Imágenes', extensions: ['png', 'jpg', 'jpeg', 'webp', 'bmp', 'tif', 'tiff'] }],
    });
    if (picked.canceled || picked.filePaths.length === 0) return [];
    const added: CharacterImage[] = [];
    for (const filePath of picked.filePaths) {
      const bytes = fs.readFileSync(filePath);
      const ext = path.extname(filePath).toLowerCase();
      const mime =
        ext === '.png' ? 'image/png'
        : ext === '.webp' ? 'image/webp'
        : ext === '.bmp' ? 'image/bmp'
        : ext === '.tif' || ext === '.tiff' ? 'image/tiff'
        : 'image/jpeg';
      added.push(
        addCharacterImage({
          personId,
          blob: bytes,
          mimeType: mime,
          kind: kind ?? 'portrait',
          label: path.basename(filePath, ext),
          generated: false,
        })
      );
    }
    return added;
  });
  h('characters:generateImage', async (
    _e,
    personId: string,
    kind: CharacterImageKind,
    style?: DecorativeImageStyle,
    extra?: string | null
  ) => generateCharacterGalleryImage(personId, kind, style ?? DEFAULT_DECORATIVE_IMAGE_STYLE, extra ?? null));
  h('characters:updateImage', async (_e, imageId: string, patch: { kind?: CharacterImageKind; label?: string | null }) => {
    updateCharacterImage(imageId, patch);
  });
  h('characters:deleteImage', async (_e, imageId: string) => {
    deleteCharacterImage(imageId);
  });
  h('characters:setAvatarFromImage', async (_e, imageId: string) => {
    setCharacterAvatarFromImage(imageId);
  });
  // Abilities
  h('characters:listAbilities', async (_e, personId: string) => listCharacterAbilities(personId));
  h('characters:addAbility', async (_e, personId: string, input: CharacterAbilityInput) =>
    addCharacterAbility(personId, input)
  );
  h('characters:updateAbility', async (_e, abilityId: string, patch: Partial<CharacterAbilityInput>) =>
    updateCharacterAbility(abilityId, patch)
  );
  h('characters:deleteAbility', async (_e, abilityId: string) => {
    deleteCharacterAbility(abilityId);
  });
  // Aliases, with the secret flag genealogy's addPersonName knows nothing about.
  h('characters:setName', async (
    _e,
    personId: string,
    name: string,
    kind: string | null,
    secret?: boolean,
    knownBy?: string | null
  ) => {
    setCharacterName(personId, name, kind, secret ?? false, knownBy ?? null);
    return getCharacter(personId);
  });
  h('characters:deleteName', async (_e, personId: string, name: string) => {
    deleteCharacterName(personId, name);
    return getCharacter(personId);
  });
  h('characters:generatePortrait', async (_e, personId: string, style?: DecorativeImageStyle, extra?: string | null) => {
    await generateCharacterPortrait(personId, style ?? DEFAULT_DECORATIVE_IMAGE_STYLE, extra ?? null);
    return getCharacter(personId);
  });
}
