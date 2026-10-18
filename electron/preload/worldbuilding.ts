// worldbuilding half of the renderer bridge, paired with electron/ipc/worldbuilding.ts.
// Typed as WorldbuildingApi so the compiler, not a test, guarantees the slice is complete.
import { ipcRenderer } from 'electron';

import type { WorldbuildingApi } from '@shared/api/worldbuilding';
import { chatStreamRegistry } from './chatStreams';

// Tracks the world-chat streams in flight so cancelWorldChat can abort the one of the chat
// it was pressed in. It sat in preload.ts beside the other chat streams; it belongs with
// the bindings that are its only users.
const worldChatStreams = chatStreamRegistry();

export const worldbuildingApi: WorldbuildingApi = {
  // Worldbuilding characters — the person-side bridges above (portrait, names,
  // events, kinship, relations) are reused as they are.
  listCharacters: (filter) => ipcRenderer.invoke('characters:list', filter),
  getCharacter: (personId) => ipcRenderer.invoke('characters:get', personId),
  createCharacter: (input) => ipcRenderer.invoke('characters:create', input),
  updateCharacter: (personId, patch) => ipcRenderer.invoke('characters:update', personId, patch),
  deleteCharacter: (personId) => ipcRenderer.invoke('characters:delete', personId).then(() => undefined),
  listCharacterEvents: (personId) => ipcRenderer.invoke('characters:listEvents', personId),
  setCharacterEventWorldDate: (eventId, worldYear, worldOrder) =>
    ipcRenderer.invoke('characters:setEventWorldDate', eventId, worldYear, worldOrder).then(() => undefined),
  characterCounts: () => ipcRenderer.invoke('characters:counts'),
  listWorldEvents: () => ipcRenderer.invoke('characters:listWorldEvents'),
  listWorldPlaces: () => ipcRenderer.invoke('places:listWorld'),
  getWorldPlace: (placeId) => ipcRenderer.invoke('places:getWorld', placeId),
  createWorldPlace: (input) => ipcRenderer.invoke('places:createWorld', input),
  updateWorldPlace: (placeId, patch) => ipcRenderer.invoke('places:updateWorld', placeId, patch),
  deleteWorldPlace: (placeId) => ipcRenderer.invoke('places:deleteWorld', placeId).then(() => undefined),
  placeInhabitants: (placeId) => ipcRenderer.invoke('places:inhabitants', placeId),
  listSecrets: () => ipcRenderer.invoke('story:listSecrets'),
  secretsForCharacter: (personId) => ipcRenderer.invoke('story:secretsForCharacter', personId),
  createSecret: (input) => ipcRenderer.invoke('story:createSecret', input),
  updateSecret: (id, patch) => ipcRenderer.invoke('story:updateSecret', id, patch),
  deleteSecret: (id) => ipcRenderer.invoke('story:deleteSecret', id).then(() => undefined),
  listKnowers: (secretId) => ipcRenderer.invoke('story:listKnowers', secretId),
  addKnower: (input) => ipcRenderer.invoke('story:addKnower', input),
  removeKnower: (id) => ipcRenderer.invoke('story:removeKnower', id).then(() => undefined),
  listScenes: (order) => ipcRenderer.invoke('story:listScenes', order),
  createScene: (input) => ipcRenderer.invoke('story:createScene', input),
  updateScene: (id, patch) => ipcRenderer.invoke('story:updateScene', id, patch),
  deleteScene: (id) => ipcRenderer.invoke('story:deleteScene', id).then(() => undefined),
  listSceneCharacters: (sceneId) => ipcRenderer.invoke('story:listSceneCharacters', sceneId),
  appearancesOfCharacter: (personId) => ipcRenderer.invoke('story:appearances', personId),
  addSceneCharacter: (sceneId, personId, role) => ipcRenderer.invoke('story:addSceneCharacter', sceneId, personId, role),
  removeSceneCharacter: (id) => ipcRenderer.invoke('story:removeSceneCharacter', id).then(() => undefined),
  listWorldGroups: (kind) => ipcRenderer.invoke('groups:list', kind),
  getWorldGroup: (groupId) => ipcRenderer.invoke('groups:get', groupId),
  createWorldGroup: (input) => ipcRenderer.invoke('groups:create', input),
  updateWorldGroup: (groupId, patch) => ipcRenderer.invoke('groups:update', groupId, patch),
  deleteWorldGroup: (groupId) => ipcRenderer.invoke('groups:delete', groupId).then(() => undefined),
  listAffiliationsForCharacter: (personId) => ipcRenderer.invoke('groups:listAffiliationsForCharacter', personId),
  listAffiliationsForGroup: (groupId) => ipcRenderer.invoke('groups:listAffiliationsForGroup', groupId),
  addAffiliation: (input) => ipcRenderer.invoke('groups:addAffiliation', input),
  updateAffiliation: (id, patch) => ipcRenderer.invoke('groups:updateAffiliation', id, patch),
  deleteAffiliation: (id) => ipcRenderer.invoke('groups:deleteAffiliation', id).then(() => undefined),
  listWorldImages: (entityKind, entityId) => ipcRenderer.invoke('world:listImages', entityKind, entityId),
  getWorldImageBlob: (imageId) => ipcRenderer.invoke('world:getImageBlob', imageId),
  deleteWorldImage: (imageId) => ipcRenderer.invoke('world:deleteImage', imageId).then(() => undefined),
  addWorldImageFromFile: (entityKind, entityId, kind) =>
    ipcRenderer.invoke('world:addImageFromFile', entityKind, entityId, kind),
  generateWorldImage: (entityKind, entityId, kind, style) =>
    ipcRenderer.invoke('world:generateImage', entityKind, entityId, kind, style),
  exportCharacterSheet: (personId, options) => ipcRenderer.invoke('characters:exportSheet', personId, options),
  listWorldEntries: () => ipcRenderer.invoke('encyclopedia:list'),
  getWorldEntry: (ref) => ipcRenderer.invoke('encyclopedia:get', ref),
  searchWorldBodies: (query) => ipcRenderer.invoke('encyclopedia:searchBodies', query),
  createWorldArticle: (input) => ipcRenderer.invoke('encyclopedia:createArticle', input),
  updateWorldArticle: (articleId, patch) => ipcRenderer.invoke('encyclopedia:updateArticle', articleId, patch),
  deleteWorldArticle: (articleId) => ipcRenderer.invoke('encyclopedia:deleteArticle', articleId).then(() => undefined),
  worldBacklinks: (ref) => ipcRenderer.invoke('encyclopedia:backlinks', ref),
  worldUnresolvedLinks: () => ipcRenderer.invoke('encyclopedia:unresolved'),
  resolveWorldLink: (text, target) => ipcRenderer.invoke('encyclopedia:resolveLink', text, target),
  rebuildWorldLinks: () => ipcRenderer.invoke('encyclopedia:rebuildLinks'),
  indexWorldEntry: (ref) => ipcRenderer.invoke('encyclopedia:indexEntry', ref),
  draftWorldArticle: (articleId, mode) => ipcRenderer.invoke('encyclopedia:draft', articleId, mode),
  acceptWorldArticleDraft: (articleId) => ipcRenderer.invoke('encyclopedia:acceptDraft', articleId),
  rejectWorldArticleDraft: (articleId) => ipcRenderer.invoke('encyclopedia:rejectDraft', articleId).then(() => undefined),
  analyzeMissingEntries: () => ipcRenderer.invoke('encyclopedia:analyzeMissing'),
  listEntryProposals: (status) => ipcRenderer.invoke('encyclopedia:listProposals', status),
  acceptEntryProposal: (proposalId) => ipcRenderer.invoke('encyclopedia:acceptProposal', proposalId),
  dismissEntryProposal: (proposalId) => ipcRenderer.invoke('encyclopedia:dismissProposal', proposalId).then(() => undefined),
  exportWorldBible: (options) => ipcRenderer.invoke('encyclopedia:exportBible', options),
  listSceneDayLinks: () => ipcRenderer.invoke('scenes:dayLinks'),
  setSceneDayLink: (sceneId, link) => ipcRenderer.invoke('scenes:setDayLink', sceneId, link),
  clearSceneDayLink: (sceneId) => ipcRenderer.invoke('scenes:clearDayLink', sceneId),
  reorderScene: (sceneId, toIndex) => ipcRenderer.invoke('scenes:reorder', sceneId, toIndex),
  listWorldThreads: (kind) => ipcRenderer.invoke('threads:list', kind),
  getWorldThread: (threadId) => ipcRenderer.invoke('threads:get', threadId),
  createWorldThread: (input) => ipcRenderer.invoke('threads:create', input),
  updateWorldThread: (threadId, patch) => ipcRenderer.invoke('threads:update', threadId, patch),
  deleteWorldThread: (threadId) => ipcRenderer.invoke('threads:delete', threadId).then(() => undefined),
  setThreadParties: (threadId, parties) => ipcRenderer.invoke('threads:setParties', threadId, parties),
  threadsForParty: (partyKind, partyId) => ipcRenderer.invoke('threads:forParty', partyKind, partyId),
  listWorldBeats: () => ipcRenderer.invoke('threads:beats'),
  threadBoardData: () => ipcRenderer.invoke('threads:board'),
  threadSceneContext: () => ipcRenderer.invoke('threads:sceneContext'),
  beatsForScene: (sceneId) => ipcRenderer.invoke('threads:beatsForScene', sceneId),
  setWorldBeat: (input) => ipcRenderer.invoke('threads:setBeat', input).then(() => undefined),
  deleteWorldBeat: (threadKind, threadId, sceneId) =>
    ipcRenderer.invoke('threads:deleteBeat', threadKind, threadId, sceneId).then(() => undefined),
  runWorldContinuity: () => ipcRenderer.invoke('continuity:run'),
  runWorldContinuityUnfiltered: () => ipcRenderer.invoke('continuity:runAll'),
  listNoticeMutes: () => ipcRenderer.invoke('continuity:mutes'),
  muteNotice: (input) => ipcRenderer.invoke('continuity:mute', input),
  unmuteNotice: (fingerprint) => ipcRenderer.invoke('continuity:unmute', fingerprint),
  continuitySummary: () => ipcRenderer.invoke('continuity:summary'),
  listWorldRules: () => ipcRenderer.invoke('rules:list'),
  getWorldRule: (ruleId) => ipcRenderer.invoke('rules:get', ruleId),
  createWorldRule: (input) => ipcRenderer.invoke('rules:create', input),
  updateWorldRule: (ruleId, patch) => ipcRenderer.invoke('rules:update', ruleId, patch),
  deleteWorldRule: (ruleId) => ipcRenderer.invoke('rules:delete', ruleId).then(() => undefined),
  rulesInPlay: (sceneId) => ipcRenderer.invoke('rules:inPlay', sceneId),
  draftWorldRule: (ruleId) => ipcRenderer.invoke('rules:draft', ruleId),
  acceptRuleDraft: (ruleId) => ipcRenderer.invoke('rules:acceptDraft', ruleId),
  rejectRuleDraft: (ruleId) => ipcRenderer.invoke('rules:rejectDraft', ruleId).then(() => undefined),
  questionFeed: (includeSettled) => ipcRenderer.invoke('questions:feed', includeSettled === true),
  listWorldQuestions: () => ipcRenderer.invoke('questions:list'),
  getWorldQuestion: (questionId) => ipcRenderer.invoke('questions:get', questionId),
  ensureQuestion: (input) => ipcRenderer.invoke('questions:ensure', input),
  updateWorldQuestion: (questionId, patch) => ipcRenderer.invoke('questions:update', questionId, patch),
  deleteWorldQuestion: (questionId) => ipcRenderer.invoke('questions:delete', questionId).then(() => undefined),
  setQuestionOption: (input) => ipcRenderer.invoke('questions:setOption', input),
  deleteQuestionOption: (optionId) => ipcRenderer.invoke('questions:deleteOption', optionId).then(() => undefined),
  applyQuestionOption: (optionId) => ipcRenderer.invoke('questions:apply', optionId),
  undoQuestionOption: (optionId) => ipcRenderer.invoke('questions:undo', optionId),
  canUndoQuestionOption: (optionId) => ipcRenderer.invoke('questions:canUndo', optionId),
  questionRemainingHoles: (optionId) => ipcRenderer.invoke('questions:remainingHoles', optionId),
  questionAnchorText: (kind, id, field) => ipcRenderer.invoke('questions:anchorText', kind, id, field),
  questionsForScene: (sceneId) => ipcRenderer.invoke('questions:forScene', sceneId),
  proposeQuestionOptions: (questionId) => ipcRenderer.invoke('questions:propose', questionId),
  worldChatStream: async (request, handlers) => {
    const requestId = `world-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const onDelta = (_e: unknown, id: string, delta: string) => {
      if (id === requestId) handlers.onDelta(delta);
    };
    ipcRenderer.on('worldChat:delta', onDelta);
    const untrack = worldChatStreams.track(requestId, request.conversationId);
    try {
      return await ipcRenderer.invoke('worldChat:stream', requestId, request);
    } finally {
      untrack();
      ipcRenderer.removeListener('worldChat:delta', onDelta);
    }
  },
  listWorldChatConversations: (includeArchived) => ipcRenderer.invoke('worldChat:history:list', includeArchived),
  getWorldChatConversation: (id) => ipcRenderer.invoke('worldChat:history:get', id),
  createWorldChatConversation: (input) => ipcRenderer.invoke('worldChat:history:create', input),
  saveWorldChatConversation: (id, messages, selection, focus, model) =>
    ipcRenderer.invoke('worldChat:history:save', id, messages, selection, focus, model),
  deleteWorldChatConversation: (id) => ipcRenderer.invoke('worldChat:history:delete', id).then(() => undefined),
  manuscriptSpine: () => ipcRenderer.invoke('manuscript:spine'),
  getSceneText: (sceneId) => ipcRenderer.invoke('manuscript:getText', sceneId),
  saveSceneText: (sceneId, text) => ipcRenderer.invoke('manuscript:saveText', sceneId, text),
  setChapterBreak: (sceneId, input) => ipcRenderer.invoke('manuscript:setChapter', sceneId, input).then(() => undefined),
  setBookStart: (sceneId, input) => ipcRenderer.invoke('manuscript:setBook', sceneId, input).then(() => undefined),
  listSceneSnapshots: (sceneId) => ipcRenderer.invoke('manuscript:snapshots', sceneId),
  takeSceneSnapshot: (sceneId) => ipcRenderer.invoke('manuscript:snapshot', sceneId),
  restoreSceneSnapshot: (snapshotId) => ipcRenderer.invoke('manuscript:restore', snapshotId),
  getSnapshotText: (snapshotId) => ipcRenderer.invoke('manuscript:snapshotText', snapshotId),
  manuscriptProgress: () => ipcRenderer.invoke('manuscript:progress'),
  reviewWorldProse: (sceneId) => ipcRenderer.invoke('manuscript:review', sceneId),
  exportManuscript: (options) => ipcRenderer.invoke('manuscript:export', options),
  cancelWorldChat: async (conversationId) => {
    const requestId = worldChatStreams.find(conversationId);
    if (requestId) await ipcRenderer.invoke('worldChat:cancel', requestId);
  },
  recomputeSceneDays: () => ipcRenderer.invoke('scenes:recomputeDays'),
  listWorldMaps: () => ipcRenderer.invoke('maps:list'),
  getWorldMap: (mapId) => ipcRenderer.invoke('maps:get', mapId),
  createWorldMap: (input) => ipcRenderer.invoke('maps:create', input),
  updateWorldMap: (mapId, patch) => ipcRenderer.invoke('maps:update', mapId, patch),
  deleteWorldMap: (mapId) => ipcRenderer.invoke('maps:delete', mapId).then(() => undefined),
  childMaps: (mapId) => ipcRenderer.invoke('maps:children', mapId),
  mapAncestry: (mapId) => ipcRenderer.invoke('maps:ancestry', mapId),
  placeMapAppearances: (placeId) => ipcRenderer.invoke('maps:placeAppearances', placeId),
  mapCoverage: () => ipcRenderer.invoke('maps:coverage'),
  getMapImageBlob: (imageId) => ipcRenderer.invoke('maps:imageBlob', imageId),
  getMapThumbnail: (mapId) => ipcRenderer.invoke('maps:thumbnail', mapId),
  importMapImage: (mapId) => ipcRenderer.invoke('maps:importImage', mapId),
  growMapCanvas: (mapId, growth) => ipcRenderer.invoke('maps:growCanvas', mapId, growth),
  generateMapImage: (request) => ipcRenderer.invoke('maps:generateImage', request),
  zoomMapRegion: (request) => ipcRenderer.invoke('maps:zoomRegion', request),
  expandMapCanvas: (request) => ipcRenderer.invoke('maps:expandCanvas', request),
  suggestMapMarkers: (mapId) => ipcRenderer.invoke('maps:suggestMarkers', mapId),
  listMapMarkers: (mapId) => ipcRenderer.invoke('maps:listMarkers', mapId),
  createMapMarker: (input) => ipcRenderer.invoke('maps:createMarker', input),
  updateMapMarker: (markerId, patch) => ipcRenderer.invoke('maps:updateMarker', markerId, patch),
  deleteMapMarker: (markerId) => ipcRenderer.invoke('maps:deleteMarker', markerId).then(() => undefined),
  circleToPolygon: (markerId, aspect, vertices) => ipcRenderer.invoke('maps:circleToPolygon', markerId, aspect, vertices),
  listMapLayers: (mapId) => ipcRenderer.invoke('maps:listLayers', mapId),
  createMapLayer: (mapId, input) => ipcRenderer.invoke('maps:createLayer', mapId, input),
  updateMapLayer: (layerId, patch) => ipcRenderer.invoke('maps:updateLayer', layerId, patch),
  deleteMapLayer: (layerId) => ipcRenderer.invoke('maps:deleteLayer', layerId).then(() => undefined),
  listWorldPresences: () => ipcRenderer.invoke('maps:presences'),
  listTravelModes: () => ipcRenderer.invoke('maps:listTravelModes'),
  ensureTravelModes: () => ipcRenderer.invoke('maps:ensureTravelModes'),
  createTravelMode: (input) => ipcRenderer.invoke('maps:createTravelMode', input),
  updateTravelMode: (modeId, patch) => ipcRenderer.invoke('maps:updateTravelMode', modeId, patch),
  deleteTravelMode: (modeId) => ipcRenderer.invoke('maps:deleteTravelMode', modeId).then(() => undefined),
  getWorldCalendar: () => ipcRenderer.invoke('world:getCalendar'),
  saveWorldCalendar: (input) => ipcRenderer.invoke('world:saveCalendar', input),
  getEventWorldDate: (eventId) => ipcRenderer.invoke('world:getEventDate', eventId),
  setEventWorldDate: (eventId, date, worldOrder) =>
    ipcRenderer.invoke('world:setEventDate', eventId, date, worldOrder).then(() => undefined),
  generateCharacterBiography: (personId, mode) => ipcRenderer.invoke('characters:generateBiography', personId, mode),
  interviewCharacter: (personId, question, history) =>
    ipcRenderer.invoke('characters:interview', personId, question, history),
  listCharacterChatConversations: (personId) =>
    ipcRenderer.invoke('characters:listChatConversations', personId),
  getCharacterChatConversation: (id) =>
    ipcRenderer.invoke('characters:getChatConversation', id),
  createCharacterChatConversation: (input) =>
    ipcRenderer.invoke('characters:createChatConversation', input),
  setCharacterChatImagesEnabled: (id, enabled) =>
    ipcRenderer.invoke('characters:setChatImagesEnabled', id, enabled),
  sendCharacterChatMessage: (id, question) =>
    ipcRenderer.invoke('characters:sendChatMessage', id, question),
  deleteCharacterChatConversation: (id) =>
    ipcRenderer.invoke('characters:deleteChatConversation', id).then(() => undefined),
  acceptProposedBiography: (personId) => ipcRenderer.invoke('characters:acceptProposedBiography', personId),
  discardProposedBiography: (personId) => ipcRenderer.invoke('characters:discardProposedBiography', personId),
  generateCharacterPortrait: (personId, style, extra) =>
    ipcRenderer.invoke('characters:generatePortrait', personId, style, extra),
  listCharacterImages: (personId) => ipcRenderer.invoke('characters:listImages', personId),
  getCharacterImageBlob: (imageId) => ipcRenderer.invoke('characters:getImageBlob', imageId),
  addCharacterImageFromFile: (personId, kind) => ipcRenderer.invoke('characters:addImageFromFile', personId, kind),
  generateCharacterImage: (personId, kind, style, extra) =>
    ipcRenderer.invoke('characters:generateImage', personId, kind, style, extra),
  updateCharacterImage: (imageId, patch) =>
    ipcRenderer.invoke('characters:updateImage', imageId, patch).then(() => undefined),
  deleteCharacterImage: (imageId) => ipcRenderer.invoke('characters:deleteImage', imageId).then(() => undefined),
  setCharacterAvatarFromImage: (imageId) =>
    ipcRenderer.invoke('characters:setAvatarFromImage', imageId).then(() => undefined),
  listCharacterAbilities: (personId) => ipcRenderer.invoke('characters:listAbilities', personId),
  addCharacterAbility: (personId, input) => ipcRenderer.invoke('characters:addAbility', personId, input),
  updateCharacterAbility: (abilityId, patch) => ipcRenderer.invoke('characters:updateAbility', abilityId, patch),
  deleteCharacterAbility: (abilityId) =>
    ipcRenderer.invoke('characters:deleteAbility', abilityId).then(() => undefined),
  setCharacterName: (personId, name, kind, secret, knownBy) =>
    ipcRenderer.invoke('characters:setName', personId, name, kind, secret, knownBy),
  deleteCharacterName: (personId, name) => ipcRenderer.invoke('characters:deleteName', personId, name),
};
