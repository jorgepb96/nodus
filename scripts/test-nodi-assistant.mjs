import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { readSource } from './ipc-channel-census.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = async (file) => readSource(file);

test('Nodi owns an independent persisted model and chat history', async () => {
  const [types, settings, prefs, store, ipc, preload] = await Promise.all([
    read('@api'),
    read('shared/defaultAppSettings.ts'),
    read('electron/db/appPrefs.ts'),
    read('electron/nodiConversations.ts'),
    read('@main'),
    read('@bridge'),
  ]);
  assert.match(types, /nodiModel: ModelRef \| null/);
  assert.match(settings, /nodiModel: null/);
  assert.match(prefs, /'nodiModel'/);
  assert.match(store, /nodi-chat-history\.json/);
  assert.match(store, /MAX_CONVERSATIONS/);
  for (const contract of ['listNodiConversations', 'getNodiConversation', 'saveNodiConversation', 'deleteNodiConversation', 'clearNodiConversations']) {
    assert.match(types, new RegExp(contract));
    assert.match(ipc, new RegExp(contract));
    assert.match(preload, new RegExp(contract));
  }
});

test('Nodi context is explicit, bounded and rejects invented product claims', async () => {
  const [backend, documentation, app, deepResearch, immersion, contextSource] = await Promise.all([
    read('electron/ai/nodiChat.ts'),
    read('shared/nodiDocumentation.ts'),
    read('src/App.tsx'),
    read('src/views/DeepResearchView.tsx'),
    read('src/views/ImmersionView.tsx'),
    read('src/components/NodiViewContextSource.tsx'),
  ]);
  for (const context of ['documentation', 'current_view', 'vault', 'all_vaults']) assert.match(backend, new RegExp(`'${context}'`));
  assert.match(backend, /MAX_DOCUMENT_VIEW_CHARS = 120_000/);
  assert.match(backend, /MAX_TOTAL_CONTEXT_CHARS = 150_000/);
  assert.match(backend, /buildNodiResearchContext/);
  assert.match(backend, /buildNodiAllVaultsContext/);
  assert.match(backend, /Tu prioridad absoluta es la fiabilidad/);
  assert.match(backend, /No puedo verificarlo con las fuentes seleccionadas/);
  assert.match(backend, /termina con «Base:»/);
  assert.match(backend, /temperature: 0\.2/);
  assert.match(documentation, /El roadmap se abre desde Ajustes > Acerca de Nodus Research/);
  assert.match(documentation, /Notificaciones está inmediatamente antes de Ajustes/);
  assert.match(documentation, /NODUS_ROADMAP/);
  assert.match(documentation, /Vault de docencia/);
  assert.match(documentation, /Estado resumido del roadmap/);
  assert.match(documentation, /planificados, en desarrollo e implementados/);
  assert.match(documentation, /Fuentes primarias, Testimonios y Prosopografía están en PRE-ALPHA/);
  assert.match(documentation, /Worldbuilding está en ALPHA/);
  assert.match(documentation, /Apps para iOS y iPadOS/);
  for (const type of ['docencia', 'testimonios', 'prosopography']) {
    assert.match(backend, new RegExp(`${type}:`), `${type} has an explicit active-vault label`);
  }
  assert.match(backend, /active\.type === 'estudio' \|\| active\.type === 'docencia'/);
  assert.match(backend, /active\.type === 'prosopography'/);
  for (const language of ['French', 'German', 'European Portuguese', 'Brazilian Portuguese', 'Italian', 'Turkish']) {
    assert.match(backend, new RegExp(language), `${language} is a supported Nodi response language`);
  }
  assert.match(app, /data-nodi-view=\{view\}/);
  assert.match(app, /setNodiViewContext/);
  assert.match(app, /slice\(0, 12_000\)/);
  assert.match(app, /data-nodi-context-source="document"/);
  assert.match(app, /complete \? \(explicit\?\.textContent \|\| ''\)/);
  assert.match(contextSource, /data-nodi-context-source="document"/);
  assert.match(deepResearch, /NodiViewContextSource title=\{contextTitle\} text=\{contextMarkdown\}/);
  assert.match(immersion, /contextMarkdown = appliedTranslation\?\.markdown \?\? sessionMarkdown\(session\)/);
  assert.match(backend, /retrieveStudyAssistantEntries/);
  assert.match(backend, /relevant_materials/);
});

test('report selection offers icon-only copy, margin bookmark and Nodi quote actions', async () => {
  const [actions, css, companion, ipc, preload, types, windows, deepResearch, immersion] = await Promise.all([
    read('src/components/ReaderSelectionActions.tsx'),
    read('src/components/readerSelectionActions.css'),
    read('src/components/nodi/NodiCompanion.tsx'),
    read('@main'),
    read('@bridge'),
    read('@api'),
    read('shared/api/windows.ts'),
    read('src/views/DeepResearchView.tsx'),
    read('src/views/ImmersionView.tsx'),
  ]);
  assert.match(actions, /name="copy"/);
  assert.match(actions, /name=\{mark \? ['"]bookmarkFill['"] : ['"]bookmark['"]\}/);
  assert.match(actions, /name="quote"/);
  assert.match(actions, /role="toolbar"/);
  assert.match(actions, /contextmenu/);
  // Copy reads the ribbon's target, which is a loose selection or a stored highlight.
  assert.match(actions, /navigator\.clipboard\.writeText\(target\.anchor\.selectedText\)/);
  assert.match(actions, /localStorage\.setItem\(storageKey\(contextId\)/);
  assert.match(actions, /localStorage\.removeItem\(storageKey\(contextId\)/);
  assert.match(actions, /range\.getClientRects\(\)/, 'the margin markers stay aligned with their text ranges');
  // goToMark must stay on the imperative handle; the ribbon may expose more
  // besides it, so the members after it are not pinned.
  assert.match(actions, /useImperativeHandle\(ref, \(\) => \(\{[^}]*\bgoToMark\b/);
  assert.match(actions, /updateSettings\(\{ mascotEnabled: true \}\)/);
  assert.match(actions, /quoteNodiSelection\(text\)/);
  assert.match(css, /\.reader-margin-marker-bookmark/);
  assert.match(companion, /consumeNodiQuoteSelection/);
  assert.match(companion, /setQuotedSelection\(selection\.text\)/);
  assert.match(companion, /setPanel\('chat'\)/);
  for (const contract of ['quoteNodiSelection', 'consumeNodiQuoteSelection', 'onNodiQuoteSelection']) {
    assert.match(types, new RegExp(contract));
    assert.match(preload, new RegExp(contract));
  }
  assert.match(ipc, /nodi:quoteSelection:set/);
  assert.match(ipc, /webContents\.send\('nodi:quoteSelection'/);
  assert.match(windows, /'consumeNodiQuoteSelection'/);
  assert.match(deepResearch, /ReaderSelectionActions[^>]*targetRef=\{documentRef\}/);
  assert.match(deepResearch, /ReaderSelectionActions[^>]*scrollRef=\{mainRef\}/);
  assert.match(deepResearch, /label=\{t\('Ir al marcador de lectura'\)\}/);
  assert.match(deepResearch, /markActionsRef\.current\?\.goToMark\(\)/);
  assert.match(immersion, /immersionAnnotationDocumentId\(session\.id\)/);
  assert.match(immersion, /ReaderSelectionActions[\s\S]*?annotations=\{visibleAnnotations\}/);
  assert.match(immersion, /ReaderSelectionActions[\s\S]*?onCreateAnnotation=\{createAnnotation\}/);
  assert.match(immersion, /ReaderSelectionActions[\s\S]*?onUpdateComment=\{updateComment\}/);
  assert.match(immersion, /ReaderSelectionActions[\s\S]*?onDeleteAnnotation=\{deleteAnnotation\}/);
  assert.match(immersion, /ReaderHighlighterControl value=\{highlighterColor\}/);
  assert.match(immersion, /markActionsRef\.current\?\.goToMark\(\)/);
});

test('Nodi cites corpus sources like the research assistant, adapted to its own light/dark UI', async () => {
  const [backend, assistant, companion, card, css] = await Promise.all([
    read('electron/ai/nodiChat.ts'),
    read('electron/ai/researchAssistant.ts'),
    read('src/components/nodi/NodiCompanion.tsx'),
    read('src/components/nodi/NodiCitationCard.tsx'),
    read('src/components/nodi/companion.css'),
  ]);

  // Backend: the NotebookLM citation rulebook is a single source of truth shared with the
  // research chat, and Nodi enables it only for the academic idea-graph with a vault context.
  assert.match(assistant, /export const CHAT_CITATION_RULES/);
  assert.match(assistant, /export function humanizeResearchCitations/);
  assert.match(assistant, /export function sanitizeResearchCitations/);
  assert.match(backend, /CHAT_CITATION_RULES/);
  assert.match(backend, /sanitizeResearchCitations/);
  assert.match(backend, /function corpusCitationsEnabled/);
  // Academic corpus citations and world-entry citations are separate, explicit contracts.
  assert.match(backend, /return wantsVault && active\.type === 'academic'/);
  assert.match(backend, /return wantsVault && active\.type === 'worldbuilding'/);

  // Frontend: answers open a Nodi-native source card, wired through the read-only IPC.
  assert.match(companion, /import \{ NodiCitationCard \}/);
  assert.match(companion, /citation && <NodiCitationCard/);
  assert.match(companion, /onCitation=\{citesCorpus \? setCitation : undefined\}/);
  for (const ipc of ['getIdeaDetail', 'getWork', 'getGapDetail', 'getEdgeDetail', 'getPassage', 'openInZotero']) {
    assert.match(card, new RegExp(ipc));
  }

  // Design: the card + citation chips are themed for both light and dark.
  assert.match(css, /\.nodi-cite-card/);
  assert.match(css, /\.nodi-companion \.md \.citation-link/);
  assert.match(css, /\.nodi-theme-light \.nodi-cite-card/);
  assert.match(css, /\.nodi-theme-light\.nodi-companion \.md \.citation-link/);
});

test('Nodi and the genealogy assistant receive tags relative to the persisted tree focus', async () => {
  const [nodi, assistant, genealogy] = await Promise.all([
    read('electron/ai/nodiChat.ts'),
    read('electron/ai/researchAssistant.ts'),
    read('electron/ai/genealogyChatContext.ts'),
  ]);
  assert.match(genealogy, /getSettings\(\)\.treeFocusPersonId/);
  assert.match(genealogy, /deriveTreeKinship/);
  assert.match(genealogy, /persona_central/);
  assert.match(genealogy, /parentesco_tag/);
  assert.match(genealogy, /parentesco_con_persona_central/);
  assert.match(nodi, /parentesco_con_persona_central/);
  assert.match(nodi, /buildGenealogyContext/);
  assert.match(assistant, /parentesco_con_persona_central/);
  assert.match(assistant, /buildGenealogyContext/);
});

test('Nodi chat keeps model selection inside settings and exposes deletable history and dedicated scrollbars', async () => {
  const [component, css, settings, picker, pickerCss, globalCss] = await Promise.all([
    read('src/components/nodi/NodiCompanion.tsx'),
    read('src/components/nodi/companion.css'),
    read('src/views/Settings.tsx'),
    read('src/components/ModelPicker.tsx'),
    read('src/components/modelPicker.css'),
    read('src/index.css'),
  ]);
  for (const tool of ['history', 'contexts', 'settings']) assert.match(component, new RegExp(`'${tool}'`));
  assert.doesNotMatch(component, /chatTool === 'model'/);
  assert.doesNotMatch(component, /setChatTool\(\(tool\) => tool === 'model'/);
  // Assistant answers render the citation type appropriate to the active vault.
  assert.match(component, /onCitation=\{citesCorpus \? setCitation : undefined\}/);
  assert.match(component, /onWorldEntry=\{citesWorld/);
  assert.match(component, /listNodiConversations/);
  assert.match(component, /saveNodiConversation/);
  assert.match(component, /nodiOpenSettings/);
  assert.match(component, /Inventario transversal con conteos y elementos relevantes de cada vault/);
  assert.match(component, /nodi-history-delete/);
  assert.match(component, /setDeleteConfirmation\(\{ kind: 'all' \}\)/);
  assert.match(component, /clearNodiConversations\(\)/);
  assert.match(component, /role="dialog" aria-modal="true"/);
  assert.match(component, /<ModelPicker[^>]* menu /);
  // Scrollbars are themed once for the whole companion instead of per element,
  // so every present and future scroll container inherits the same tokens.
  assert.match(css, /\.nodi-companion \*::-webkit-scrollbar \{/);
  assert.match(css, /scrollbar-color: var\(--nodi-scrollbar-thumb\) var\(--nodi-scrollbar-track\)/);
  assert.match(css, /\.nodi-theme-light \{\s*\n\s*--nodi-scrollbar-track: #eef2f7;/);
  assert.match(css, /\.nodi-msg \.md table/);
  assert.match(css, /\.nodi-history-delete:hover/);
  assert.match(css, /\.nodi-confirm-overlay/);
  assert.match(css, /\.nodi-chat-tool \.model-picker-trigger/);
  assert.match(settings, /settings\.nodiModel/);
  assert.match(settings, /settings\.nodiModel[^\n]* compact menu/);
  assert.match(picker, /if \(menu\)/);
  assert.match(picker, /model-picker-options/);
  assert.match(picker, /import '\.\/modelPicker\.css'/);
  assert.match(pickerCss, /\.model-picker-trigger/);
  assert.match(pickerCss, /position:\s*absolute/);
  assert.match(pickerCss, /font-family:\s*inherit/);
  assert.match(css, /\.nodi-theme-light \.nodi-chat-tool \.model-picker-search > input/);
  assert.match(globalCss, /background-repeat: no-repeat/);
});

test('Nodi uses the bounded world model and opens validated worldbuilding references', async () => {
  const [backend, companion, ipc, preload, types, app] = await Promise.all([
    read('electron/ai/nodiChat.ts'),
    read('src/components/nodi/NodiCompanion.tsx'),
    read('@main'),
    read('@bridge'),
    read('@api'),
    read('src/App.tsx'),
  ]);
  assert.match(backend, /buildWorldChatFacts\(\{ question \}\)/);
  assert.match(backend, /composeWorldChatContext/);
  assert.match(backend, /transformChatProse\(answer, prose => validateWorldCitations\(prose, allowed\)\)/, 'world citations are validated without rewriting visual markup');
  assert.match(backend, /worldbuilding: 'construcción de mundos'/);
  assert.match(companion, /NODI_WORLD_STARTERS/);
  assert.match(companion, /vaultType === 'worldbuilding'/);
  for (const source of [preload, types, companion]) assert.match(source, /nodiOpenWorldEntry/);
  assert.match(ipc, /nodi:openWorldEntry/);
  assert.match(ipc, /win\.webContents\.send\('nodi:navigate', \{ view, kind, id \}\)/);
  assert.match(app, /setView\(target\.view\)/);
});

test('Nodi chat messages are selectable and expose a per-message copy action', async () => {
  const [component, css] = await Promise.all([
    read('src/components/nodi/NodiCompanion.tsx'),
    read('src/components/nodi/companion.css'),
  ]);
  assert.match(component, /navigator\.clipboard\.writeText\(text\)/, 'copy preserves the message Markdown source');
  assert.match(component, /className="nodi-msg-copy"/);
  assert.match(component, /name=\{copiedMessageIndex === i \? 'check' : 'copy'\}/, 'the action confirms a successful copy');
  assert.match(css, /\.nodi-msg[\s\S]*?-webkit-user-select:\s*text;\s*user-select:\s*text;/, 'message text overrides the overlay selection lock');
  assert.match(css, /\.nodi-msg-copy\s*\{[\s\S]*?user-select:\s*none;/, 'the icon itself does not interfere with text selection');
});

test('Nodi closes its eyes and centrifuges contracted limbs while thinking', async () => {
  const [component, figure, css] = await Promise.all([
    read('src/components/nodi/NodiCompanion.tsx'),
    read('src/components/nodi/Nodi.tsx'),
    read('src/components/nodi/nodi.css'),
  ]);
  assert.match(component, /streaming \? 'thinking'/, 'the live chat activates the thinking state');
  for (const limb of ['thinking-arm-l', 'thinking-arm-r', 'thinking-leg-l', 'thinking-leg-r']) assert.match(figure, new RegExp(limb));
  assert.match(css, /data-state="thinking"[^}]*\.eyes-open[^}]*display:\s*none/s);
  assert.match(css, /data-state="thinking"[^}]*\.eyes-sleep[^}]*display:\s*inline/s);
  assert.match(css, /animation:\s*nodi-centrifuge/);
  assert.match(css, /animation-play-state:\s*paused/, 'the rotor freezes at its current angle while fading back to rest');
  assert.match(css, /data-state="thinking"[^}]*\.limbs[^}]*scale\(\.7\)/s, 'normal limbs contract during the crossfade');
});

test('floating Nodi dismisses every open surface on an outside click or window blur', async () => {
  const [component, mascot, ipc, preload, types] = await Promise.all([
    read('src/components/nodi/NodiCompanion.tsx'),
    read('electron/mascotWindow.ts'),
    read('@main'),
    read('@bridge'),
    read('@api'),
  ]);
  assert.match(component, /const hasOpenSurface = menuOpen \|\| helpOpen \|\| panel !== 'none' \|\| contextMenuOpen \|\| closing/);
  assert.match(component, /nodiSetExpanded\(true\)/, 'the transparent overlay captures outside clicks while expanded');
  assert.match(component, /onNodiDismiss\(closeAll\)/, 'a native window dismissal closes menu, chat and help together');
  assert.match(mascot, /win\.on\('blur'/, 'clicking another application dismisses the overlay');
  assert.match(mascot, /webContents\.send\('nodi:dismiss'\)/);
  assert.match(ipc, /nodi:setExpanded/);
  assert.match(mascot, /width: EXPANDED_WIDTH/, 'opening controls must not resize a visible transparent NSPanel');
  assert.match(mascot, /applyClosedMousePassthrough/, 'closed transparent regions pass clicks to the app underneath');
  assert.match(component, /addEventListener\('mousemove'/, 'forwarded movement performs transparent-region hit testing');
  assert.match(ipc, /ipcMain\.on\('nodi:setMouseIgnore:async'/);
  assert.match(ipc, /nodi:setMouseIgnore:async'[\s\S]{0,220}setIgnoreMouseEvents/, 'the async channel still applies the native hit target');
  assert.match(preload, /ipcRenderer\.send\('nodi:setMouseIgnore:async'/);
  assert.match(component, /nodiGetOverlayPlacement\(\)/, 'the first renderer frame uses the native placement rather than a provisional anchor');
  // Nodi's own renderer must never wait on the main process: sendSync stalls this
  // window for as long as a backup, scan or import holds the main event loop, which
  // is exactly the freeze it was meant to prevent. The hit-test flag lands at the
  // same point in the loop either way, and the first frame's placement now travels
  // in the URL mascot.html is loaded with.
  assert.doesNotMatch(preload, /sendSync\('nodi:/, 'the Nodi overlay bridge must not block on synchronous IPC');
  assert.match(preload, /new URLSearchParams\(search\)\.get\('placement'\)/);
  assert.match(mascot, /searchParams\.set\('placement'/, 'the dev-server overlay URL carries the placement');
  assert.match(mascot, /loadFile\([^)]*mascot\.html'\), \{ query \}\)/, 'the packaged overlay URL carries the placement');
  assert.match(preload, /onNodiDismiss/);
  assert.match(types, /onNodiDismiss\(cb: \(\) => void\)/);
});

test('Nodi’s scrollable panels overflow instead of crushing their rows', async () => {
  const css = await read('src/components/nodi/companion.css');
  // A column flexbox with a definite height distributes any shortfall to its
  // children, so rows left at the default flex-shrink:1 are compressed to fit:
  // the list stops scrolling and every row's own `overflow: hidden` slices its
  // text in half. That is what turned the quick-notes panel into shredded lines
  // once the user had more notes than fit on screen.
  const rule = (selector) => {
    const at = css.indexOf(`${selector} {`) >= 0 ? css.indexOf(`${selector} {`) : css.indexOf(`${selector} `);
    assert.ok(at >= 0, `${selector} is missing from companion.css`);
    return css.slice(at, css.indexOf('}', at) + 1);
  };
  for (const [scroller, row] of [['.nodi-notes-list', '.nodi-note-row'], ['.nodi-chat-msgs', '.nodi-msg']]) {
    const scrollerRule = rule(scroller);
    assert.match(scrollerRule, /flex-direction:\s*column/, `${scroller} is a column flexbox`);
    assert.match(scrollerRule, /overflow-y:\s*auto/, `${scroller} scrolls`);
    assert.match(
      rule(row),
      /flex:\s*0\s+0\s+auto|flex-shrink:\s*0/,
      `${row} must not shrink, or ${scroller} squashes its rows instead of scrolling`,
    );
  }
});

test('floating Nodi restores mouse passthrough after its radial buttons finish collapsing', async () => {
  const component = await read('src/components/nodi/NodiCompanion.tsx');
  assert.match(component, /const RADIAL_COLLAPSE_MS = 450/);
  assert.match(
    component,
    /setTimeout\(\(\) => \{\s*void window\.nodus\.nodiSetExpanded\(false\)[\s\S]*?\}, RADIAL_COLLAPSE_MS\)/,
    'transparent-area passthrough waits until the radial transition finishes',
  );
  assert.match(component, /window\.clearTimeout\(releasePassthrough\)/, 'reopening Nodi cancels a pending passthrough hand-off');
});

test('Nodi drags in absolute screen space and closes through an animated context action', async () => {
  const [component, figure, figureCss, companionCss, mascot, ipc, preload, types, english, app] = await Promise.all([
    read('src/components/nodi/NodiCompanion.tsx'),
    read('src/components/nodi/Nodi.tsx'),
    read('src/components/nodi/nodi.css'),
    read('src/components/nodi/companion.css'),
    read('electron/mascotWindow.ts'),
    read('@main'),
    read('@bridge'),
    read('@api'),
    read('src/i18n.en.ts'),
    read('src/App.tsx'),
  ]);
  assert.match(component, /e\.screenX - origin\.screenX/);
  assert.match(component, /e\.screenY - origin\.screenY/);
  assert.match(component, /Math\.hypot\(dx, dy\) < DRAG_THRESHOLD_PX/, 'small pointer jitter remains a click');
  const pointerDownBody = component.slice(component.indexOf('const onFigurePointerDown'), component.indexOf('const onFigurePointerMove'));
  const pointerMoveBody = component.slice(component.indexOf('const onFigurePointerMove'), component.indexOf('const finishFigurePointer'));
  assert.doesNotMatch(pointerDownBody, /setDragging\(true\)/, 'pressing Nodi must not flash the drag pose before the pointer moves');
  assert.ok(
    pointerMoveBody.indexOf('Math.hypot(dx, dy) < DRAG_THRESHOLD_PX') < pointerMoveBody.indexOf('setDragging(true)'),
    'drag visuals only start after the pointer clears the drag threshold',
  );
  assert.match(component, /onLostPointerCapture=\{onFigurePointerCaptureLost\}/, 'a lost capture cannot leave Nodi stuck dragging');
  assert.match(component, /vertical === 'down' \? Math\.round\(figureH \* 0\.12\)/, 'the downward radial arc clears Nodi’s longer lower limbs');
  assert.match(component, /const RADIAL_NODE_GAP_PX = 58/, 'radial actions keep a deliberate 12px edge-to-edge gap');
  assert.match(component, /RADIAL_NODE_GAP_PX \/ \(2 \* Math\.sin/, 'the radial radius grows when more actions are added');
  assert.match(component, /Math\.asin\(Math\.min\(1, RADIAL_NODE_GAP_PX \/ \(2 \* radialRadius\)\)\)/, 'angular steps preserve the same centre spacing in every quadrant');
  assert.doesNotMatch(component, /e\.movement[XY]/, 'native-window movement must not distort the drag delta');
  for (const contract of ['nodiBeginWindowDrag', 'nodiDragWindow', 'nodiEndWindowDrag']) {
    assert.match(component, new RegExp(contract));
    assert.match(preload, new RegExp(contract));
    assert.match(types, new RegExp(contract));
  }
  assert.match(ipc, /nodi:windowDrag:begin/);
  assert.match(ipc, /nodi:windowDrag:move/);
  assert.doesNotMatch(mascot, /COMPACT_WIDTH/, 'the native host has no compact size to flash during menu opening');
  assert.match(mascot, /width: EXPANDED_WIDTH/);
  assert.match(mascot, /movable:\s*false/, 'AppKit must not apply a second, conflicting drag constraint at screen edges');
  assert.match(mascot, /backgroundThrottling:\s*false/, 'the desktop overlay compositor must keep drawing while another macOS app is active');
  assert.match(mascot, /placeWindowAroundNodi/);
  assert.match(mascot, /const isRepeatedRequest = requestedBounds/, 'clamped pointer movement must not repeatedly invalidate a native edge constraint');
  assert.match(mascot, /const appliedBounds = win\.getBounds\(\)/, 'renderer placement follows the bounds actually applied by the window manager');
  assert.match(mascot, /return placeWindowAroundNodi\(win, nodi\.x, nodi\.y\)/, 'menu state changes never resize the native host');
  assert.doesNotMatch(mascot, /windowDrag\.expanded/, 'dragging never switches the native host to a compact size');
  assert.match(mascot, /screen\.getDisplayNearestPoint/);
  assert.match(types, /horizontal: 'left' \| 'right'/);
  assert.match(component, /onContextMenu=\{onFigureContextMenu\}/);
  assert.match(component, /t\('Cerrar mascota'\)/);
  assert.match(component, /updateSettings\(\{ mascotEnabled: false \}\)/);
  assert.match(app, /onSettingsChanged\(\(\) => \{ void reloadSettings\(\); \}\)/, 'the main window unmounts Nodi after an overlay-originated settings change');
  assert.match(component, /closing \? 'closing'/);
  assert.match(component, /settings\?\.mascotStyle !== 'orb'\) wave\(\)/, 'opening the orb menu cannot replace its continuous float with a snapping rock animation');
  assert.match(component, /window\.innerWidth - overlayPlacement\.x - figureW/, 'the overlay anchor follows the stable native-window edge during horizontal resize');
  assert.match(component, /window\.innerHeight - overlayPlacement\.y - figureH/, 'the overlay anchor follows the stable native-window edge during vertical resize');
  assert.doesNotMatch(ipc, /if \(expanded\) win\.focus\(\)/, 'opening radial controls must not explicitly focus Electron over the active desktop app');
  assert.match(component, /vaultTypeColor\(vaultType\)/, 'every Nodi surface inherits the active vault accent');
  assert.match(component, /nodi-theme-\$\{lightUi \? 'light' : 'dark'\}/, 'all Nodi controls resolve one shared app theme');
  assert.doesNotMatch(component, /nodi-light/, 'quick notes must not carry a panel-only light theme');
  assert.match(companionCss, /\.nodi-theme-light \.nodi-node\s*\{[^}]*var\(--nodi-vault-accent/s, 'light radial actions use the vault accent');
  assert.match(companionCss, /\.nodi-theme-light \.nodi-panel\s*\{[^}]*background:\s*#ffffff/s, 'chat, notifications and notes share the light panel surface');
  assert.match(companionCss, /\.nodi-theme-light \.nodi-msg\.user\s*\{[^}]*var\(--nodi-vault-accent/s, 'light chat messages use the vault accent');
  assert.match(
    companionCss,
    /\.nodi-theme-light \.nodi-msg\.user \.md blockquote\s*\{[^}]*background:\s*rgba\(15, 23, 42, \.18\);[^}]*color:\s*inherit;[^}]*opacity:\s*1;/s,
    'reader quotations keep the user bubble foreground instead of becoming grey on the vault accent',
  );
  assert.match(figure, /closing-accessory-smoke/);
  assert.match(figure, /closing-body-smoke/);
  for (const animation of ['nodi-close-limb', 'nodi-close-accessory', 'nodi-close-face', 'nodi-close-core', 'nodi-close-smoke']) {
    assert.match(figureCss, new RegExp(animation));
  }
  assert.match(companionCss, /\.nodi-context-menu/);
  assert.match(
    companionCss,
    /\.nodi-theme-light \.nodi-context-menu button:hover,[\s\S]*?\.nodi-theme-light \.nodi-context-menu button:focus-visible\s*\{[^}]*color:\s*#9f1239/s,
    'the selected close-mascot action keeps readable text in the light theme',
  );
  assert.match(
    companionCss,
    /\.nodi-theme-light \.nodi-context-icon\s*\{[^}]*color:\s*#be123c/s,
    'the close-mascot icon keeps sufficient contrast in the light theme',
  );
  assert.match(companionCss, /\.nodi-anchor\.open-right/);
  assert.match(companionCss, /\.nodi-anchor\.open-down/);
  assert.match(companionCss, /\.nodi-figure\s*\{[^}]*z-index:\s*1/s);
  assert.match(companionCss, /\.nodi-node\s*\{[^}]*z-index:\s*2/s, 'radial actions stay clickable when they overlap Nodi near a top edge');
  assert.match(companionCss, /margin:\s*0 -23px -23px 0/, 'radial controls are centred on both anchor axes');
  assert.match(companionCss, /\.nodi-node\.open:hover[^}]*scale\(1\.06\)/s);
  assert.match(companionCss, /\.nodi-node:focus-visible/);
  assert.match(english, /'Cerrar mascota': 'Close mascot'/);
});

test('Nodi receives aggregated, rate-limited lifecycle notifications', async () => {
  const [notifications, catalogue, queue, embeddings, passages, component] = await Promise.all([
    read('electron/notifications.ts'),
    read('shared/nodiNotifications.ts'),
    read('electron/pipeline/scanQueue.ts'),
    read('electron/ai/embeddingPipeline.ts'),
    read('electron/ai/passageEmbeddingPipeline.ts'),
    read('src/components/nodi/NodiCompanion.tsx'),
  ]);
  assert.match(notifications, /DEFAULT_COOLDOWN_MS/);
  assert.match(notifications, /dedupeKey/);
  assert.match(notifications, /lastEmitted/);
  // The wording lives in the catalogue; the emitters only name its keys, so the same
  // stored notification reads in whatever language the panel is showing.
  assert.match(catalogue, /Cola de análisis completada/);
  assert.match(catalogue, /Nuevas conexiones en tu bóveda/);
  assert.match(catalogue, /Nodi ha encontrado relaciones semánticas/);
  assert.match(catalogue, /Embeddings de ideas completados/);
  assert.match(catalogue, /Índice de textos completado/);
  assert.match(queue, /nodiText\(failed \? 'scanQueueFailedTitle' : 'scanQueueDoneTitle'\)/);
  assert.match(queue, /nodiText\('connectionsTitle'\)/);
  assert.match(queue, /nodiText\('bridgesTitle'\)/);
  assert.match(queue, /notifiedTerminalIds/);
  assert.match(embeddings, /nodiText\(state\.error \? 'ideaEmbeddingsFailedTitle' : 'ideaEmbeddingsDoneTitle'\)/);
  assert.match(passages, /nodiText\(state\.error \? 'passageEmbeddingsFailedTitle' : 'passageEmbeddingsDoneTitle'\)/);
  assert.match(component, /notificationLine\(n\.titleText, n\.title\)/);
  assert.match(component, /onNotificationsChanged/);
  assert.match(component, /nodi-ntf-dot/);
  assert.match(component, /latestNotificationId/);
  assert.match(component, /setCelebrate\(true\)/);
});

test('a new Nodi chat starts on documentation, the current view and the current vault', async () => {
  const [types, companion, store] = await Promise.all([
    read('@api'),
    read('src/components/nodi/NodiCompanion.tsx'),
    read('electron/nodiConversations.ts'),
  ]);
  assert.match(
    types,
    /export const NODI_DEFAULT_CONTEXTS: NodiContextKind\[\] = \['documentation', 'current_view', 'vault'\];/,
    'the current vault is selected by default, next to the documentation and the visible view'
  );
  // One definition: the panel and the stored history must open on the same set.
  assert.match(companion, /useState<NodiContextKind\[\]>\(\[\.\.\.NODI_DEFAULT_CONTEXTS\]\)/);
  assert.match(store, /return \[\.\.\.NODI_DEFAULT_CONTEXTS\]/);
  // Reaching into every other vault stays a per-question decision.
  assert.doesNotMatch(types, /NODI_DEFAULT_CONTEXTS[^\n]*all_vaults/);
});

test('Nodi keeps the reading position stable while an answer is streaming', async () => {
  const companion = await read('src/components/nodi/NodiCompanion.tsx');
  assert.match(companion, /const scrollChatToBottom = useCallback/);
  assert.match(companion, /if \(panel === 'chat'\) scrollChatToBottom\(\);\s*\}, \[panel, scrollChatToBottom\]\);/s);
  assert.doesNotMatch(companion, /\[messages,\s*panel\]/, 'message deltas must not drive the scroll position');
  const deltaHandler = companion.match(/onDelta: \(delta\) => \{([\s\S]*?)\n\s*\},/)?.[1] ?? '';
  assert.doesNotMatch(deltaHandler, /scrollChatToBottom|scrollTop|scrollIntoView/);
});

test('Nodi only scales down from its original size and reaches forty percent', async () => {
  const [sizes, settings] = await Promise.all([
    read('shared/nodiSize.ts'),
    read('src/views/Settings.tsx'),
  ]);
  assert.match(sizes, /NODI_SIZE_SCALES = \[0\.4, 0\.5, 0\.6, 0\.7, 0\.8, 0\.9, 1\]/);
  assert.match(sizes, /NODI_DEFAULT_SCALE = 1/);
  assert.doesNotMatch(sizes, /1\.1|1\.2|1\.3|1\.4/);
  assert.match(settings, /El 100 % conserva el tamaño original de Nodi y es el máximo\. Puedes reducirlo hasta el 40 %\./);
});

test('the chat retrieval never holds the main process for a whole similarity scan', async () => {
  const [assistant, hierarchy] = await Promise.all([
    read('electron/ai/researchAssistant.ts'),
    read('electron/ai/hierarchicalRetrieval.ts'),
  ]);
  // researchAssistant builds the context for the research chat AND for Nodi's
  // active-vault context, both while the user is looking at the window. The
  // blocking queries scan every embedded row inside one statement: measured on a
  // real corpus (13,799 ideas, 44,138 passages) that is 95 ms per idea scan and
  // 366 ms per passage scan of frozen UI — the beachball. The paged scans
  // (db/vectorScan.ts) return the same rows and yield between rowid windows.
  for (const blocking of ['findSimilarIdeas', 'findSimilarWorks', 'findSimilarPassages']) {
    for (const [name, source] of [['research assistant', assistant], ['hierarchical retrieval', hierarchy]]) {
      assert.doesNotMatch(
        source,
        new RegExp(`${blocking}\\(`),
        `${name}: ${blocking}() blocks the event loop for the whole scan — use ${blocking}Paged()`
      );
    }
  }
  assert.match(assistant, /await findSimilarWorksPaged\(/, 'summary similarity remains an awaited paged scan');
  assert.match(hierarchy, /findSimilarIdeasPaged\(/, 'idea similarity is delegated to the paged hierarchy lane');
  assert.match(hierarchy, /findSimilarPassagesPaged\(/, 'passage similarity is delegated to the paged hierarchy lanes');
  assert.match(hierarchy, /await Promise\.all\(/, 'the first paged lanes are awaited as one bounded batch');
  assert.match(hierarchy, /await researchActivityStep\('context', 'expand', \(\) => findSimilarPassagesPaged\(/, 'the routed passage lane is awaited through its activity observer');
  // The passage section is the largest scan of all and runs twice per question.
  assert.match(assistant, /async function listRelevantPassages/);
  assert.match(assistant, /await listRelevantPassages\(/);
  assert.match(assistant, /async function selectDocumentWorks/);
  assert.match(assistant, /await selectDocumentWorks\(/);
});
