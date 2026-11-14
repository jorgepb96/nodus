import assert from 'node:assert/strict';
import test from 'node:test';
import { readSource } from './ipc-channel-census.mjs';

const read = async (file) => readSource(file);

test('study vault uses its teal header logo and the shared dock accent', async () => {
  const [app, logo, dock, vaultColors] = await Promise.all([
    read('@shell'),
    read('src/assets/nodus-logo-teal.svg'),
    read('src/dockIcon.ts'),
    read('shared/vaultColors.ts'),
  ]);
  assert.match(app, /import nodusLogoTeal/);
  assert.match(app, /isEstudio \? nodusLogoTeal/);
  assert.match(app, /data-vault-logo=.*isEstudio \? 'estudio'/s);
  assert.match(logo, /#0f766e/i);
  // The accent lives once in shared/vaultColors; the dock reads it through vaultTypes.
  assert.match(vaultColors, /estudio: '#0f766e'/);
  assert.match(dock, /vaultTypeColor\(type\)/);
});

test('study and teaching notes serialize saves and keep local drafts on failure', async () => {
  const [editor,chrome]=await Promise.all([read('src/components/editor/StudyEditor.tsx'),read('src/components/workspace/EditorialChrome.tsx')]);
  assert.match(editor,/const STUDY_AUTOSAVE_DELAY_MS = 800/);
  assert.match(editor,/saveQueueRef/);
  assert.match(editor,/if \(documentId === active.id && !await flushLatest\(\)\) return/);
  assert.match(editor,/retainEditorialDraft/);assert.match(editor,/expectedRevision: revisionRef/);
  assert.match(chrome,/data-testid="study-editor-save-state"[^>]*role="status"[^>]*aria-live="polite"/);
});

test('study and teaching expandable icon buttons remain centred while labels are hidden', async () => {
  const [organization, materials, pdf, css] = await Promise.all([
    read('src/views/StudyOrganizationView.tsx'),
    read('src/views/StudyMaterialsView.tsx'),
    read('src/components/materials/PdfViewer.tsx'),
    read('src/index.css'),
  ]);
  for (const source of [organization, materials, pdf]) assert.match(source, /icon-reveal-button/);
  assert.match(css, /\.btn\.header-action,\s*\.btn\.icon-reveal-button\s*\{\s*gap:\s*0;/s);
  assert.match(css, /\.btn\.icon-reveal-button > svg:first-child\s*\{\s*display:\s*block;/s);
});

test('the shared editor model menu is searchable and never scrolls horizontally', async () => {
  const [picker, css, editor] = await Promise.all([
    read('src/components/ModelPicker.tsx'),
    read('src/components/modelPicker.css'),
    read('src/components/editor/StudyEditor.tsx'),
  ]);
  assert.match(editor, /<ModelPicker[^>]* menu /, 'every vault editor reaches the shared menu variant');
  assert.match(picker, /data-testid="model-picker-search"/);
  assert.match(picker, /placeholder=\{t\('Buscar modelo…'\)\}/);
  assert.match(picker, /filteredModels = models\.filter/);
  assert.match(picker, /Ningún modelo coincide con «\{query\}»/);
  assert.match(css, /\.model-picker-options\s*\{[^}]*overflow:\s*hidden/s);
  assert.match(css, /\.model-picker-list\s*\{[^}]*overflow-x:\s*hidden/s);
  assert.match(css, /\.model-picker-list button\s*\{[^}]*box-sizing:\s*border-box[^}]*width:\s*100%[^}]*max-width:\s*100%/s);
});

test('macOS keeps the last vault and theme dock icon after Nodus exits', async () => {
  const [main, ipc, persistentIcon, dockPlugin, packageJson, generator, rendererIcon, geometrySource] = await Promise.all([
    read('electron/main.ts'),
    read('@main'),
    read('electron/dockIcon.ts'),
    read('build/docktile/NodusDockTilePlugin.m'),
    read('package.json'),
    read('scripts/generate-icons.mjs'),
    read('src/dockIcon.ts'),
    read('shared/nodusMark.json'),
  ]);
  assert.match(main, /restorePersistedDockIcon\(\)/);
  assert.match(ipc, /setPersistentDockIcon\(pngDataUrl\)/);
  assert.match(persistentIcon, /last-dock-icon\.png/);
  assert.match(persistentIcon, /app\.dock\.setIcon\(image\)/);
  assert.match(dockPlugin, /NSDockTilePlugIn/);
  assert.match(dockPlugin, /Library\/Application Support\/nodus\/last-dock-icon\.png/);
  assert.doesNotMatch(dockPlugin, /Library\/Application Support\/Nodus\/last-dock-icon\.png/);
  assert.match(dockPlugin, /dockTile\.contentView = self\.imageView/);
  assert.match(packageJson, /"NSDockTilePlugIn": "NodusDockTile\.docktileplugin"/);
  assert.match(generator, /shared', 'nodusMark\.json/);
  assert.match(generator, /markGeometry\.markScaleRatio/);
  assert.match(rendererIcon, /import markGeometry from '@shared\/nodusMark\.json'/);
  assert.equal(JSON.parse(geometrySource).markScaleRatio, 0.6);
  assert.doesNotMatch(generator, /#15131f|#1d1830|rgba\(8, 7, 14, 0\.42\)/);
});

test('left sidebar is resizable and remembers the selected width', async () => {
  const [app, css] = await Promise.all([read('@shell'), read('src/index.css')]);
  assert.match(app, /nodus\.sidebarWidth/);
  assert.match(app, /data-testid="resizable-sidebar"/);
  assert.match(app, /data-testid="sidebar-scroll-region"[^>]*mr-\[6px\][^>]*overflow-y-auto/);
  assert.match(app, /data-testid="sidebar-resize-handle"/);
  assert.ok(
    app.indexOf('data-testid="sidebar-scroll-region"') < app.indexOf('data-testid="sidebar-resize-handle"'),
    'the scroll region should be rendered before the resize handle',
  );
  assert.match(app, /const SIDEBAR_MIN_WIDTH = 64/);
  assert.match(app, /const SIDEBAR_MAX_WIDTH = 360/);
  assert.match(app, /Math\.max\(SIDEBAR_MIN_WIDTH, Math\.min\(SIDEBAR_MAX_WIDTH/);
  assert.match(app, /onDoubleClick/);
  assert.match(css, /\.sidebar-resize-handle/);
  assert.match(css, /cursor: col-resize/);
  assert.match(app, /--vault-accent.*dockColorForVaultType\(activeVault\?\.type\)/);
  assert.match(css, /\.is-resizing-sidebar \.sidebar-resize-handle::after\s*\{[^}]*var\(--vault-accent, #6366f1\)/s);
  assert.doesNotMatch(css, /\.is-resizing-sidebar \.sidebar-resize-handle::after\s*\{[^}]*#0f766e/s);
});

test('sidebar header keeps the Nodus brand centered, stable when hidden and fully clickable', async () => {
  const [app, css] = await Promise.all([read('@shell'), read('src/index.css')]);
  assert.match(app, /data-testid="sidebar-header-toggle"/);
  assert.match(
    app,
    /data-testid="sidebar-header-toggle"[\s\S]*?className="[^"]*relative[^"]*h-full[^"]*justify-center[^"]*"[\s\S]*?style=\{\{ width: sidebarWidth \}\}/,
  );
  assert.doesNotMatch(app, /style=\{\{ width: navCollapsed \?/);
  assert.ok(
    app.indexOf('data-testid="sidebar-header-toggle"') < app.indexOf('data-testid="sidebar-header-brand"')
      && app.indexOf('data-testid="sidebar-header-brand"') < app.indexOf('data-testid="nodus-logo"'),
    'the centred Nodus brand should remain inside the full-width sidebar header control',
  );
  assert.match(app, /data-testid="sidebar-header-brand" className="flex items-center justify-center gap-2"/);
  assert.match(app, /className="absolute right-2 text-neutral-600"/);
  assert.match(app, /data-platform=\{IS_MAC \? 'macos' : 'other'\}/);
  assert.match(app, /MACOS_FULL_SIDEBAR_BRAND_MIN_WIDTH = 248/);
  assert.match(
    app,
    /data-testid="sidebar-header-brand"[\s\S]*?style=\{\{ transform: sidebarCompact && IS_MAC \? 'translateY\(0\.5625rem\)' : undefined \}\}/,
    'compact macOS mode should reserve a contained safe area below the window controls',
  );
  assert.doesNotMatch(app, /sidebarCompact && IS_MAC \? 'pt-8'/);
  assert.match(app, /sidebarCompact && IS_MAC[\s\S]*?\? 'h-\[18px\] w-\[18px\]'/);
  assert.doesNotMatch(css, /\[data-testid='sidebar-header-toggle'\]\s*\{[^}]*padding-left/s);
});

test('study home cards expose dedicated light-theme surfaces', async () => {
  const [home, css] = await Promise.all([
    read('src/views/StudyHome.tsx'),
    read('src/index.css'),
  ]);
  assert.match(home, /className="study-home h-full/);
  assert.ok((home.match(/study-home-card/g) ?? []).length >= 3);
  assert.ok((home.match(/study-home-icon/g) ?? []).length >= 2);
  assert.match(css, /\.light \.study-home-card\s*\{[^}]*background-color:\s*#ffffff;[^}]*border-color:\s*#cbdedb;/s);
  assert.match(css, /\.light \.study-home-card:hover\s*\{[^}]*background-color:\s*#f0fdfa;/s);
  assert.match(css, /\.light \.study-home-icon\s*\{[^}]*background-color:\s*#e6f4f2;[^}]*color:\s*#0f766e;/s);
});

test('study searches reserve icon space through the common input contract', async () => {
  const [view, css] = await Promise.all([
    read('src/views/StudyOrganizationView.tsx'),
    read('src/index.css'),
  ]);
  assert.match(view, /input input-with-leading-icon w-full/);
  assert.match(css, /\.input\.input-with-leading-icon\s*\{[^}]*padding-left:/s);
  assert.doesNotMatch(view, /className="input w-full pl-/);
});

test('study materials expose downloadable hover actions and pedagogical Deep Research', async () => {
  const [materials, preload, ipc, types, app, navigation, adapter, deep, markdown] = await Promise.all([
    read('src/views/StudyMaterialsView.tsx'),
    read('@bridge'),
    read('@main'),
    read('@api'),
    read('@shell'),
    read('src/navigation.ts'),
    read('electron/ai/studyDeepResearch.ts'),
    read('shared/portableStudyDeepResearch.ts'),
    read('src/components/Markdown.tsx'),
  ]);
  assert.match(materials, /study-material-download/);
  assert.match(materials, /group-hover:max-w-40/);
  assert.match(preload, /downloadStudyMaterial/);
  assert.match(types, /downloadStudyMaterial/);
  assert.match(ipc, /study:materials:download/);
  assert.match(navigation, /studyDeepResearch/);
  assert.match(app, /studyDeepResearch: \(/);
  assert.match(app, /isStudy/);
  assert.match(adapter, /portableStudyDeepResearch\(\{completeJson,completeText,retrieveStudyAssistantEntries,listStudyIdeasForSources\}\)/, 'Desktop must inject real completions and study source retrieval into the canonical prompt implementation');
  for (const language of ['es', 'en', 'fr', 'tr', 'de', 'pt']) assert.match(deep, new RegExp(`\\n  ${language}: \\{`));
  assert.match(deep, /\n {2}'pt-BR': \{/);
  assert.match(deep, /conceptos complejos paso a paso/);
  assert.match(deep, /retrieveStudyAssistantEntries/);
  assert.match(deep, /kinds: \['material', 'document', 'transcript'\]/);
  assert.match(markdown, /const studyMaterial = href/);
});

test('shared study and teaching material tables center every column header', async () => {
  const materials = await read('src/views/StudyMaterialsView.tsx');

  for (const tableId of ['study-material-notes-table', 'study-material-table']) {
    const header = materials.match(new RegExp(`data-testid="${tableId}">([\\s\\S]*?)</thead>`))?.[1];
    assert.ok(header, `${tableId} has a table header`);

    const headerClasses = [...header.matchAll(/<th className="([^"]+)"/g)].map((match) => match[1]);
    assert.ok(headerClasses.length > 0, `${tableId} exposes column headers`);
    for (const classes of headerClasses) {
      assert.match(classes, /(?:^|\s)text-center(?:\s|$)/, `${tableId} centers ${classes}`);
    }
  }
});

test('study actions use renderer dialogs and the sidebar has no onboarding spacer', async () => {
  const [view, editor, sidebar, css] = await Promise.all([
    read('src/views/StudyOrganizationView.tsx'),
    read('src/components/editor/StudyEditor.tsx'),
    read('src/components/StudySidebar.tsx'),
    read('src/index.css'),
  ]);
  assert.doesNotMatch(`${view}\n${editor}`, /window\.prompt/);
  for (const testId of ['study-create-course', 'study-create-subject', 'study-create-topic', 'study-create-folder', 'study-create-document', 'study-organization-material-import']) {
    assert.match(view, new RegExp(`testId="${testId}"`));
  }
  assert.match(view, /importStudyMaterials\(placement\)/);
  assert.match(view, /data-testid="study-browser-layout-list"/);
  assert.match(view, /data-testid="study-browser-layout-grid"/);
  assert.match(view, /localStorage\.getItem\('nodus-study-browser-layout'\) === 'grid' \? 'grid' : 'list'/);
  assert.match(view, /study-browser-table-head/);
  assert.match(css, /\.light \.study-browser-table-head\s*\{[^}]*background-color:\s*#f3f4f6/s);
  assert.match(view, /StudyBrowserActions/);
  assert.match(view, /ConfirmModal/);
  assert.match(view, /moveStudyEntity/);
  assert.match(view, /'study-metadata-dialog' : 'study-create-dialog'/);
  assert.match(view, /data-testid="study-create-description"/);
  assert.match(view, /data-testid="study-create-year"/);
  assert.match(view, /IconEmojiPicker/);
  assert.match(view, /data-testid="study-create-image"/);
  assert.match(view, /data-testid="study-organization-search"/);
  for (const testId of ['study-organization-course-filter', 'study-organization-subject-filter', 'study-organization-topic-filter', 'study-organization-sort']) {
    assert.match(view, new RegExp(`data-testid="${testId}"`));
  }
  for (const sort of ['year-desc', 'year-asc', 'created-desc', 'created-asc', 'updated-desc', 'name-asc', 'name-desc']) {
    assert.match(view, new RegExp(`value="${sort}"`));
  }
  assert.match(view, /compareStudyOrganization/);
  assert.match(view, /matchesOrganizationFilters/);
  assert.equal((view.match(/data-testid="study-organization-search"/g) ?? []).length, 1);
  assert.doesNotMatch(view, /placeholder=\{t\('Buscar materiales…'\)\}/);
  assert.match(view, /StudyDocumentCollection documents=\{documents\} layout=\{browserLayout\}/);
  assert.match(view, /data-testid="study-organization-browser-section"/);
  assert.doesNotMatch(view, /<section className="border-b border-neutral-800 p-5">/);
  assert.match(editor, /TextInputModal/);
  assert.doesNotMatch(sidebar, /Crea tu primer curso para empezar/);
  assert.match(sidebar, /data-testid="study-sidebar-organization" className=\{`\$\{compact \? 'mt-1 border-t border-neutral-800\/70 pt-1' : 'mt-2'\} flex flex-col gap-1`\}/);
  assert.match(sidebar, /data-testid="study-sidebar-organization-toggle"/);
  assert.match(sidebar, /nodus\.studyOrganizationCollapsed/);
  assert.match(sidebar, /aria-expanded=\{!collapsed\}/);
  assert.doesNotMatch(sidebar, /study-sidebar-organization" className="[^"]*flex-1/);
});

test('study and teaching sources share two-step linked-knowledge deletion', async () => {
  const [materials, organization, flow, ideas, preload, ipc, types] = await Promise.all([
    read('src/views/StudyMaterialsView.tsx'),
    read('src/views/StudyOrganizationView.tsx'),
    read('src/components/LinkedKnowledgeDeleteFlow.tsx'),
    read('src/views/IdeasView.tsx'),
    read('@bridge'),
    read('@main'),
    read('@api'),
  ]);
  assert.match(materials, /selectedSources/);
  assert.match(materials, /study-library-delete-selected/);
  assert.match(materials, /<LinkedKnowledgeDeleteFlow/);
  assert.match(organization, /<LinkedKnowledgeDeleteFlow/);
  assert.match(flow, /step === 'sources'/);
  assert.match(flow, /Eliminar ideas y embeddings/);
  assert.match(flow, /Conservar ideas/);
  assert.match(materials, /purgeLinkedKnowledge/);
  assert.match(organization, /purgeLinkedKnowledge/);
  assert.match(ideas, /Eliminar idea/);
  assert.match(preload, /deleteStudyIdea/);
  assert.match(preload, /deleteIdea/);
  assert.match(ipc, /study:knowledge:idea:delete/);
  assert.match(ipc, /ideas:delete/);
  assert.match(types, /purgeLinkedKnowledge\?: boolean/);
});

test('study metadata uses one searchable icon and emoji catalogue', async () => {
  const [view, picker, ui] = await Promise.all([
    read('src/views/StudyOrganizationView.tsx'),
    read('src/components/IconEmojiPicker.tsx'),
    read('src/components/ui.tsx'),
  ]);
  assert.match(view, /<IconEmojiPicker icon=\{icon\} emoji=\{emoji\}/);
  assert.match(picker, /data-testid="study-create-icon-emoji"/);
  assert.match(picker, /data-testid="study-icon-search"/);
  assert.match(picker, /ICON_NAMES\.filter/);
  assert.match(picker, /EMOJI_SEARCH_GROUPS/);
  assert.match(picker, /aria-label=\{t\(allowEmoji \? 'Seleccionar icono o emoji' : 'Seleccionar icono'\)\}/);
  assert.doesNotMatch(picker, /Emoji seleccionado/);
  assert.doesNotMatch(picker, /\{emoji \|\| icon \|\| t\('Seleccionar icono o emoji'\)\}/);
  assert.match(ui, /export const ICON_NAMES/);
  assert.match(view, /className="sr-only" type="file"/);
  assert.match(view, /t\(imageData \? 'Cambiar archivo' : 'Seleccionar archivo'\)/);
});

test('study test, exam and flashcard creation share a searchable multi-content selector', async () => {
  const [organization, generator, app] = await Promise.all([
    read('src/views/StudyOrganizationView.tsx'),
    read('src/components/StudyTestGenerator.tsx'),
    read('@shell'),
  ]);
  assert.match(organization, /testId="study-create-ai-test"/);
  assert.match(organization, /testId="study-create-ai-exam"/);
  assert.match(organization, /kind=\{assessmentGenerator\}/);
  assert.match(generator, /data-testid="study-content-selector"/);
  assert.match(generator, /Buscar curso, asignatura o tema/);
  assert.match(generator, /type="checkbox"/);
  assert.match(generator, /study-content-show-nested/);
  assert.match(generator, /Mostrar materiales y apuntes/);
  assert.match(generator, /study-app-checkbox/);
  assert.match(generator, /kind === 'flashcards' \? \[10, 20, 30\]/);
  assert.match(generator, /generateStudyQuestions/);
  assert.match(generator, /kind === 'exam' \? 'essay' : 'definition'/);
  assert.match(generator, /createStudyFlashcardsFromQuestions/);
  assert.doesNotMatch(generator, /gradeStudyAnswer|Finalizar y calcular nota/);
  assert.match(generator, /La IA solo genera el contenido de la actividad/);
  assert.match(app, /studyQuestions: \([^)]*\) => \(\s*<StudyBankView/);
});

test('redundant study views are removed while courses, chat, review and the question bank remain', async () => {
  const [navigation, app, home, organization, bank, chat, sidebar, review] = await Promise.all([
    read('src/navigation.ts'),
    read('@shell'),
    read('src/views/StudyHome.tsx'),
    read('src/views/StudyOrganizationView.tsx'),
    read('src/views/StudyBankView.tsx'),
    read('src/views/StudyChatView.tsx'),
    read('src/components/StudySidebar.tsx'),
    read('src/views/StudyReviewView.tsx'),
  ]);
  for (const route of ['studyTests', 'studyExams', 'studyProgress', 'studyPlanner']) {
    assert.doesNotMatch(navigation, new RegExp(route));
    assert.doesNotMatch(app, new RegExp(route));
  }
  for (const component of ['StudyTestView', 'StudyExamView', 'StudyProgressView', 'StudyPlannerView', 'StudyGuideView']) {
    assert.doesNotMatch(app, new RegExp(component));
    await assert.rejects(() => read(`src/views/${component}.tsx`), (error) => error?.code === 'ENOENT');
  }
  assert.doesNotMatch(home, /Guía de estudio del corpus|studyPlanner|studyProgress/);
  assert.doesNotMatch(organization, /study-open-tests|Ver tests/);
  assert.doesNotMatch(bank, /onOpenTests|onOpenExams|Usar en test|Usar en examen/);
  assert.match(organization, /study-create-ai-test/);
  assert.match(organization, /study-create-ai-exam/);
  assert.match(organization, /study-create-ai-flashcards/);
  assert.match(organization, /icon="quiz"/);
  assert.match(organization, /icon="exam"/);
  assert.match(organization, /icon="flashcards"/);
  assert.match(organization, /setAssessmentGenerator\('flashcards'\)/);
  assert.match(review, /study-review-wizard/);
  assert.match(review, /createStudyFlashcardsFromQuestions/);
  assert.match(bank, /study-bank-category/);
  assert.match(organization, /function StudyHeaderAction/);
  assert.match(organization, /group-hover:max-w-48/);
  assert.match(organization, /testId="study-export-scope"/);
  assert.doesNotMatch(organization, /aria-label=\{t\('Formato de exportación'\)\}/);
  assert.match(organization, /data-testid="study-export-modal"/);
  assert.match(organization, /data-testid="study-export-format"/);
  assert.match(organization, /data-testid="study-export-progress"/);
  assert.match(organization, /data-testid="study-export-download"/);
  assert.match(bank, /study-question-bank/);
  assert.match(bank, /study-question-table/);
  assert.match(bank, /study-question-table-row/);
  assert.match(bank, /study-question-answer-card/);
  assert.match(bank, /<option value="all">\{t\('Todos'\)\}<\/option>/);
  assert.match(bank, /study-flashcard-/);
  assert.match(bank, /study-bank-flashcard-modal/);
  assert.match(bank, /study-bank-flashcard-detail/);
  assert.match(bank, /createPortal/);
  assert.doesNotMatch(bank, /study-question-detail[^\n]+selectedCard/);
  assert.doesNotMatch(bank, /category === 'flashcards' && <div className="grid/);
  assert.match(navigation, /'studyChat'/);
  assert.match(app, /<StudyChatView/);
  assert.doesNotMatch(sidebar, /view: 'studyChat'/);
  assert.doesNotMatch(sidebar, /view: 'studyReview'/);
  const sharedChat = await read('src/views/ResearchAssistantModal.tsx');
  assert.match(chat, /<ResearchAssistantModal[^>]*adapter=\{adapter\}/);
  assert.match(chat, /id: 'study', modelFeature: 'studyModel'/);
  for (const control of ['research-history-toggle', 'research-history-sidebar', 'research-context-toggle', 'research-context-sidebar']) {
    assert.ok(sharedChat.includes(`data-testid="${control}"`), `shared study chat preserves ${control}`);
  }
  assert.match(sharedChat, /contextOpen && <aside/);
  assert.match(sharedChat, /nodus\.\$\{panelKey\}ChatContextOpen/);
  for (const method of ['listStudyAssistantConversations', 'createStudyAssistantConversation', 'updateStudyAssistantConversation', 'deleteStudyAssistantConversation']) {
    assert.ok(chat.includes(method), `study adapter preserves ${method}`);
  }
  assert.match(sharedChat, /<ConfirmModal/);
  assert.match(sharedChat, /rows=\{1\}/);
  for (const control of ['research-composer-input', 'research-composer-send', 'ResearchEffortControl', 'ResearchSystemPromptControl']) {
    assert.ok(sharedChat.includes(control), `study chat uses the shared ${control}`);
  }
  assert.doesNotMatch(chat + sharedChat, /window\.confirm/);
});

test('study timetable exposes editable weekdays, periods and subject styling', async () => {
  const [view, sidebar, navigation, app, preload, ipc] = await Promise.all([
    read('src/views/StudyScheduleView.tsx'),
    read('src/components/StudySidebar.tsx'),
    read('src/navigation.ts'),
    read('@shell'),
    read('@bridge'),
    read('@main'),
  ]);
  assert.match(sidebar, /view: 'studySchedule'/);
  assert.match(navigation, /id: 'studySchedule'/);
  assert.match(app, /studySchedule: \([^)]*\) => <StudyScheduleView/);
  for (const marker of ['study-schedule-view', 'study-schedule-table', 'study-schedule-add-morning', 'study-schedule-add-afternoon', 'study-schedule-subject-styles']) assert.match(view, new RegExp(marker));
  assert.match(view, /study-schedule-add-morning" className="btn btn-primary"/);
  assert.match(view, /study-schedule-add-afternoon" className="btn btn-primary"/);
  assert.match(view, /STUDY_SCHEDULE_DAYS\.map/);
  assert.match(view, /type="time"/);
  assert.match(view, /<IconEmojiPicker/);
  assert.match(view, /updateStudyEntity\('subject'/);
  assert.match(view, /study-schedule-day-clear-/);
  assert.match(view, /study-schedule-day-actions-/);
  assert.match(view, /study-schedule-subject-clear-/);
  assert.match(view, /study-schedule-cell-popover/);
  assert.doesNotMatch(view, /study-schedule-cell-modal/);
  assert.match(view, /study-schedule-kind-subject/);
  assert.match(view, /study-schedule-kind-activity/);
  assert.match(view, /study-schedule-activity-title/);
  assert.match(view, /title=\{subject\?\.name \|\| cell\?\.activityTitle \|\| undefined\}/);
  assert.match(view, /break-words text-xs font-semibold leading-4/);
  assert.match(view, /flex-1 break-words text-sm leading-5/);
  assert.doesNotMatch(view, /flex-1 truncate text-sm text-neutral-200/);
  assert.match(view, /<Icon name="trash" size=\{12\} \/>/);
  assert.match(sidebar, /view: 'studySchedule', icon: 'clock'/);
  assert.match(sidebar, /view: 'studyCalendar', icon: 'calendar'/);
  assert.match(navigation, /id: 'studySchedule', label: 'Horarios', icon: 'clock'/);
  assert.match(navigation, /id: 'studyCalendar', label: 'Calendario', icon: 'calendar'/);
  assert.match(preload, /study:schedule:get/);
  assert.match(preload, /study:schedule:save/);
  assert.match(ipc, /study:schedule:get/);
  assert.match(ipc, /study:schedule:save/);
  const css = await read('src/index.css');
  assert.match(css, /\.light \.study-schedule-page/);
  assert.match(css, /\.light \.study-schedule-panel tbody th/);
  assert.match(css, /\[data-testid='study-schedule-subject-styles'\]/);
  assert.match(css, /\.study-schedule-panel input\[type='time'\]/);
  assert.match(view, /data-study-schedule-period-header/);
  assert.match(view, /data-study-schedule-time-controls className="mt-2 grid min-w-0 grid-cols-\[minmax\(0,1fr\)_auto_minmax\(0,1fr\)\]/);
  assert.doesNotMatch(view, /<div className="mt-2 flex items-center gap-1"><input aria-label=\{t\('Hora de inicio'\)\}/);
  assert.match(css, /min-width: 108px/);
  assert.match(css, /\.study-schedule-subject-cell\.has-color/);
  assert.match(css, /var\(--subject-color\) 34%/);
  assert.match(css, /\.light \.study-schedule-subject-cell\.has-color/);
});

test('student calendar exposes month, week and year views with durable event actions', async () => {
  const [view, layout, navigation, app, sidebar, types, preload, ipc, reminders, notificationCatalogue] = await Promise.all([
    read('src/views/StudyCalendarView.tsx'), read('src/views/studyCalendarLayout.ts'), read('src/navigation.ts'), read('@shell'), read('src/components/StudySidebar.tsx'), read('@api'), read('@bridge'), read('@main'), read('electron/studyCalendarReminders.ts'), read('shared/nodiNotifications.ts'),
  ]);
  for (const marker of ['study-calendar-view', 'study-calendar-month-grid', 'study-calendar-week-grid', 'study-calendar-year-grid', 'study-calendar-editor', 'study-calendar-reminder']) assert.match(view, new RegExp(marker));
  for (const marker of ['study-calendar-event-bar', 'study-calendar-month-event-layer', 'study-calendar-week-event-layer']) assert.match(view, new RegExp(marker));
  assert.match(view, /layoutCalendarWeek\(events, week\[0\], \{ maxLanes: 4 \}\)/);
  assert.match(view, /eventsByCoveredDay\(events\)/);
  assert.match(layout, /continuesBefore: candidate\.range\.start < weekStart/);
  assert.match(layout, /continuesAfter: candidate\.range\.end > weekEnd/);
  assert.match(view, /<ConfirmModal/);
  assert.match(view, /data-testid="study-calendar-event-detail"/);
  assert.match(view, /data-testid="study-calendar-event-actions"/);
  assert.match(view, /title=\{t\('Editar'\)\}[\s\S]{0,200}editEvent\(selectedEvent\)/);
  assert.match(view, /title=\{t\('Exportar a Outlook \(\.ics\)'\)\}[\s\S]{0,200}exportCalendar\(selectedEvent\.id\)/);
  assert.match(view, /title=\{t\('Añadir a Google Calendar'\)\}[\s\S]{0,300}exportCalendar\(selectedEvent\.id, 'google'\)/);
  assert.match(view, /title=\{t\('Eliminar'\)\}/);
  assert.match(view, /<ConfirmModal zIndex=\{180\}/);
  assert.match(view, /const openEvent = \(event: StudyCalendarEvent\) => \{ setExported\(false\); setError\(''\); setSelectedEvent\(event\); \}/);
  // iCloud is no longer a one-off .ics copy opened from the event: the Apple panel owns
  // that destination and keeps the copy in step, so only Outlook and Google stay manual.
  assert.match(view, /<AppleCalendarSyncPanel \/>/);
  assert.match(view, /data-testid="study-calendar-outlook-export"/);
  assert.match(view, /exportCalendar\(editor\.id!\)/);
  assert.match(view, /exportCalendar\(editor\.id!, 'google'\)/);
  assert.match(navigation, /studyCalendar/); assert.match(app, /<StudyCalendarView/); assert.match(sidebar, /studyCalendar/);
  assert.match(types, /updateStudyCalendarEvent/); assert.match(types, /deleteStudyCalendarEvent/);
  assert.match(preload, /study:planner:event:external/); assert.match(ipc, /calendar\.google\.com/); assert.match(ipc, /params\.append\('sprop', 'name:Nodus'\)/);
  assert.match(reminders, /reminder_at <= \?/); assert.match(reminders, /notified_at/);
  // The reminder is stored as a key plus the event's own timestamp, so it reads in the
  // reader's language and date format rather than in the emitting vault's.
  assert.match(reminders, /nodiText\(delayed \? 'studyCalendarLateBody' : 'studyCalendarBody'/);
  assert.match(reminders, /datetime: new Date\(String\(row\.starts_at\)\)\.toISOString\(\)/);
  assert.match(notificationCatalogue, /Aviso mostrado con retraso/);
});

test('apple calendar panel asks for consent only on an explicit action and needs a destination', async () => {
  const [panel, preload, ipc] = await Promise.all([
    read('src/components/AppleCalendarSyncPanel.tsx'), read('@bridge'), read('@main'),
  ]);
  // Mounting the view reads the status; only the button may enumerate accounts, because
  // that call is the one that raises the macOS permission dialog.
  assert.equal((panel.match(/listAppleCalendarDestinations/g) ?? []).length, 1);
  assert.match(panel, /const choose = async \(\) => \{[\s\S]{0,300}listAppleCalendarDestinations\(\)/);
  assert.match(panel, /getAppleCalendarSyncStatus\?\.\(\)/);
  // Missing native module, platform or packaging keeps the panel out of the way.
  assert.match(panel, /if \(!status\?\.available\) return null/);
  // Enabling always names the calendar: no implicit destination and no free-text id.
  assert.match(panel, /disabled=\{busy \|\| !selected\} onClick=\{\(\) => void configure\(true\)\}/);
  assert.match(panel, /configureAppleCalendarSync\(\{ enabled, calendarId: selected \|\| status\?\.calendarId \|\| undefined \}\)/);
  assert.match(panel, /configure\(false\)/, 'sync can always be turned off again');
  assert.match(preload, /study:calendar:apple:status/);
  assert.match(preload, /study:calendar:apple:destinations/);
  assert.match(preload, /study:calendar:apple:configure/);
  // The handler resolves the vault on the main process, never from the renderer.
  assert.match(ipc, /getAppleCalendarSyncStatus\(getActiveVault\(\)\.id\)/);
  assert.match(ipc, /configureAppleCalendarSync\(getActiveVault\(\)\.id, input\)/);
  assert.match(ipc, /listAppleCalendars\(true\)/);
});

test('study editor exposes BlockNote controls through contextual menus and selection', async () => {
  const [editor, canvas, css] = await Promise.all([read('src/components/editor/StudyEditor.tsx'),read('src/components/editor/BlockNoteCanvas.tsx'),read('src/components/workspace/editorialWorkspace.css')]);
  for (const id of ['study-insert-toolbar','study-heading-level','study-editor-undo','study-editor-redo','study-inline-code','study-inline-formula','study-selection-text-color','study-selection-heading','study-editor-model-picker','study-doc-style']) assert.ok(editor.includes(id),id);
  assert.match(canvas, /@blocknote\/ariakit/);
  assert.match(canvas,/FormattingToolbarController/);
  assert.match(canvas,/editor\.undo\(\)/); assert.match(canvas,/editor\.redo\(\)/);
  assert.match(canvas,/setMeta\('addToHistory', false\)/);assert.match(canvas,/closeHistory\(tr\)/);
  assert.match(editor,/requestAnimationFrame\(flush\)/);
  assert.match(editor,/useFeatureModel\(settings, 'improveModel'\)/);
  assert.match(editor,/onToolbarElement=\{setSelectionToolbar\}/);
  assert.match(css,/editorial-options:not\(\[open\]\)/);
  assert.doesNotMatch(editor,/@milkdown/);
  assert.doesNotMatch(css,/\.milkdown/);
});

test('study search follows the minimal global-search layout', async () => {
  const [studySearch, globalSearch, css] = await Promise.all([
    read('src/views/StudySearchView.tsx'),
    read('src/views/SearchView.tsx'),
    read('src/index.css'),
  ]);
  assert.match(studySearch, /mx-auto w-full max-w-3xl shrink-0/);
  assert.match(studySearch, /input input-with-leading-icon w-full pr-10/);
  assert.match(studySearch, /showFilters &&/);
  assert.match(studySearch, /study-search-panel/);
  assert.match(studySearch, /input study-search-filter h-9 text-xs/);
  assert.deepEqual(
    [...studySearch.matchAll(/<select\s+aria-label=\{t\('([^']+)'\)\}/g)].map((match) => match[1]),
    ['Curso', 'Asignatura', 'Tema'],
    'advanced filters scope the course, subject and topic; content kinds use persistent chips'
  );
  assert.match(studySearch, /<SearchKindFilters\b[^\n]*selected=\{kinds\}[^\n]*onChange=\{setKinds\}/);
  assert.ok(studySearch.indexOf('<SearchKindFilters') < studySearch.indexOf('{showFilters &&'), 'content filters remain outside the collapsible advanced panel');
  assert.match(studySearch, /sort: 'relevance'/);
  assert.match(globalSearch, /<SearchKindFilters\b/);
  assert.match(studySearch, /rounded-md border border-neutral-800 bg-neutral-900\/40 px-3 py-2/);
  assert.match(globalSearch, /max-w-3xl/);
  assert.match(css, /\.light \.study-search-panel\s*\{[^}]*background-color:\s*#f8faf9;[^}]*border-color:\s*#d7e3e1/s);
  assert.match(css, /\.light \.study-search-filter\s*\{[^}]*background-color:\s*#ffffff;[^}]*color:\s*#171717/s);
  assert.match(css, /\.light \.study-search-filter option,[^{]*\{[^}]*background-color:\s*#ffffff/s);
  assert.match(css, /\.study-search-filter:hover\s*\{[^}]*border-color:\s*#52706c/s);
  assert.match(css, /\.study-search-filter:focus\s*\{[^}]*border-color:\s*#2dd4bf;[^}]*box-shadow:/s);
  assert.match(css, /\.light \.study-search-filter:hover\s*\{[^}]*border-color:\s*#8fc5bd/s);
  assert.doesNotMatch(studySearch, /Coincidencia literal, relevancia textual, proximidad/);
  assert.doesNotMatch(studySearch, /h-11 w-full pr-28 text-base/);
});

test('study material state reuses database select chips', async () => {
  const [materials, pdf, epub, preload, ipc, types, css, materialIndex, studySearch, organization, app] = await Promise.all([
    read('src/views/StudyMaterialsView.tsx'),
    read('src/components/materials/PdfViewer.tsx'),
    read('src/components/materials/EpubViewer.tsx'),
    read('@bridge'),
    read('@main'),
    read('@api'),
    read('src/index.css'),
    read('electron/ai/studyMaterialIndex.ts'),
    read('electron/ai/studySearch.ts'),
    read('src/views/StudyOrganizationView.tsx'),
    read('@shell'),
  ]);
  assert.match(materials, /import \{ ChipSelectCell \} from '\.\.\/components\/dbGrid'/);
  assert.match(materials, /<ChipSelectCell values=\{\[material\.readState\]\}/);
  assert.match(materials, /onPlacementsChange=\{updatePlacementDimension\}/);
  assert.match(materials, /\(\['course', 'subject', 'folder', 'topic'\] as const\)\.map/);
  assert.match(materials, /options=\{locationOptions\[dimension\]\}/);
  assert.match(materials, /options=\{locationOptions\[dimension\]\} multi onChange=\{\(ids\)/);
  assert.match(materials, /removeStudyMaterialPlacement\(material\.id, placement\.id\)/);
  assert.match(materials, /announceStudyWorkspaceChanged\(\);\s+await load\(\)/);
  assert.doesNotMatch(materials, /<select[^>]*value=\{material\.readState\}/);
  assert.match(materials, /data-testid="study-material-dropzone"/);
  const materialResultsStart = materials.indexOf('<main className="relative min-h-0 flex-1 overflow-auto">');
  const materialResultsEnd = materials.indexOf('</main>', materialResultsStart);
  const materialDropzone = materials.indexOf('data-testid="study-material-dropzone"');
  assert.ok(materialResultsStart >= 0 && materialDropzone > materialResultsStart && materialDropzone < materialResultsEnd, 'drag overlay stays inside the results area below search and filters');
  assert.match(materials, /onDrop=\{\(event\) =>/);
  assert.match(materials, /getPathForDroppedFile\(file\)/);
  assert.match(materials, /prepareDroppedMaterials\(event\.dataTransfer\.files\)/);
  assert.match(materials, /setImportDialogPaths\(\[\.\.\.new Set\(paths\)\]\)/);
  assert.match(materials, /data-testid="study-material-import-dialog"/);
  assert.match(materials, /data-testid="study-material-import-dropzone"/);
  assert.match(materials, /data-testid="study-material-import-confirm"/);
  assert.match(materials, /data-testid="study-material-add-location"/);
  assert.match(materials, /data-testid="study-material-import-location"/);
  assert.match(materials, /importStudyMaterialPaths\(draft\.paths/);
  assert.match(materials, /placements\.slice\(1\)/);
  assert.match(materials, /addStudyMaterialPlacement\(material\.id, placement\)/);
  assert.match(materials, /updateStudyMaterial\(material\.id/);
  assert.match(materials, /testId="study-material-reindex"/);
  assert.match(materials, /reindexStudyMaterial\(material\.id\)/);
  assert.match(materials, /onStudyMaterialIndexChanged/);
  assert.match(materials, /STUDY_WORKSPACE_CHANGED/);
  assert.match(materials, /workspace\.documents\.filter/);
  assert.match(materials, /data-testid="study-material-notes-section"/);
  assert.match(materials, /data-testid="study-material-notes-table"/);
  assert.match(materials, /data-testid=\{`study-material-note-\$\{document\.id\}`\}/);
  assert.match(materials, /onOpen\(document\.id\)/);
  assert.match(materials, /visualDescription/);
  assert.match(materials, /chooseStudyMaterialPaths\(folder\)/);
  assert.match(preload, /webUtils\.getPathForFile/);
  assert.match(preload, /study:materials:choosePaths/);
  assert.match(preload, /study:materials:importPaths/);
  assert.match(preload, /study:materials:reindex/);
  assert.match(preload, /study:materials:indexChanged/);
  assert.match(preload, /study:materials:placement:remove/);
  assert.match(ipc, /h\('study:materials:choosePaths'/);
  assert.match(ipc, /h\('study:materials:importPaths'/);
  assert.match(ipc, /queueStudyMaterialIndex/);
  assert.match(ipc, /h\('study:materials:reindex'/);
  assert.match(ipc, /h\('study:materials:placement:remove'/);
  assert.match(materialIndex, /analyzeImageBytes/);
  assert.match(materialIndex, /supportsVision/);
  assert.match(materialIndex, /descripción visual:/);
  assert.match(materialIndex, /queueStudyMaterialIndex/);
  assert.match(materialIndex, /visualDescriptionGenerated/);
  assert.match(studySearch, /row\.visual_description/);
  assert.doesNotMatch(studySearch, /materialEmbedding/, 'each fragment must receive its own semantic vector');
  assert.match(studySearch, /study-fragment-v2/);
  assert.match(types, /chooseStudyMaterialPaths\(folder\?: boolean\): Promise<string\[\]>/);
  assert.match(types, /getPathForDroppedFile\(file: unknown\): string/);
  assert.match(types, /importStudyMaterialPaths\(paths: string\[\]/);
  assert.match(types, /removeStudyMaterialPlacement\(id: string, placementId: string\): Promise<void>/);
  assert.match(organization, /window\.nodus\.listStudyMaterials\(\)/);
  assert.match(organization, /material\.placements\.some/);
  assert.match(organization, /data-testid=\{`study-organization-material-\$\{material\.id\}`\}/);
  assert.match(organization, /documents\.length \+ scopedMaterials\.length/);
  assert.match(organization, /onOpenMaterial\(material\.id\)/);
  assert.match(app, /const openMaterial = \(ctx: ViewContext\) => \(id: string, location\?: StudySearchLocation \| null\) => \{\s*ctx\.setStudyMaterialTarget\(\{\s*id,\s*pageNumber: location\?\.pageNumber \?\? null,\s*slideNumber: location\?\.slideNumber \?\? null,\s*\}\);\s*ctx\.setView\('studyLibrary'\);/,
    'a study material jump carries the cited page or slide, not only the material id');
  assert.match(materials, /className="absolute inset-0 z-40 flex flex-col/);
  assert.doesNotMatch(materials, /data-testid="study-material-viewer"[^\n]*fixed/);
  assert.match(materials, /material\.extension === 'md' \|\| material\.extension === 'markdown'/);
  assert.match(materials, /bg-white p-8 text-sm leading-7 text-neutral-900[^"\n]*dark:bg-neutral-900 dark:text-neutral-100/);
  assert.match(pdf, /data-testid="study-pdf-continuous-mode"/);
  assert.match(pdf, /data-testid="study-pdf-single-mode"/);
  assert.match(pdf, /key=\{`\$\{number\}:\$\{scale\}:\$\{viewMode\}`\}/,
    'study PDFs remount their canvas for every scale and view lifecycle');
  assert.match(pdf, /renderTask\?\.cancel\(\)/,
    'study PDF render tasks are explicitly cancelled');
  assert.match(pdf, /data-testid="study-pdf-zoom-out"/);
  assert.match(pdf, /data-testid="study-pdf-zoom-in"/);
  assert.match(pdf, /IntersectionObserver/);
  assert.match(pdf, /data-testid="study-pdf-thumbnails-toggle"/);
  assert.match(pdf, /data-testid="study-pdf-search-toggle"/);
  assert.match(pdf, /function PdfThumbnail/);
  assert.match(pdf, /pageTextCacheRef/);
  assert.match(pdf, /matches\.length < 250/);
  assert.match(pdf, /onOpenPage\(result\.pageNumber\)/);
  assert.match(pdf, /study-pdf-tool-\$\{value\}/);
  assert.match(pdf, /study-pdf-brush-thickness/);
  assert.match(pdf, /study-material-annotations-sidebar/);
  assert.match(pdf, /study-pdf-sticky-dialog/);
  assert.match(pdf, /exportAnnotatedStudyMaterial/);
  assert.match(pdf, /range\.getClientRects\(\)/);
  assert.match(epub, /data-testid="study-epub-viewer"/);
  assert.match(epub, /study-epub-brush-thickness/);
  assert.match(epub, /study-epub-annotations-sidebar/);
  assert.match(epub, /study-epub-sticky-dialog/);
  assert.match(epub, /exportAnnotatedStudyMaterial/);
  assert.match(materials, /material\.extension === 'epub'/);
  assert.match(preload, /study:materials:annotation:export/);
  assert.match(ipc, /h\('study:materials:annotation:export'/);
  assert.match(types, /exportAnnotatedStudyMaterial\(id: string\)/);
  assert.doesNotMatch(pdf, /Crear apunte de esta fuente/);
  assert.match(css, /\.light \.study-material-state-cell button:hover/);
});

test('study recordings use explicit light and dark surfaces throughout the audio workflow', async () => {
  const [recordings, audio, editor, markdown, organization, app, repository] = await Promise.all([
    read('src/views/StudyRecordingsView.tsx'),
    read('src/components/AudioPanel.tsx'),
    read('src/components/editor/StudyEditor.tsx'),
    read('src/components/Markdown.tsx'),
    read('src/views/StudyOrganizationView.tsx'),
    read('@shell'),
    read('electron/db/studyRecordingsRepo.ts'),
  ]);
  assert.match(recordings, /border-neutral-200 bg-neutral-50 p-3 dark:border-neutral-800 dark:bg-neutral-900\/35/);
  assert.match(recordings, /data-testid="study-recordings-table"/);
  assert.match(recordings, /data-testid=\{`study-recording-\$\{recording\.id\}`\}/);
  assert.match(recordings, /data-testid=\{`study-recording-trash-\$\{recording\.id\}`\}/);
  assert.match(recordings, /data-testid="study-recording-detail-trash"/);
  assert.match(recordings, /<ConfirmModal/);
  assert.match(recordings, /Mover grabación a la papelera/);
  assert.match(recordings, /setConfirmDelete\(\{ id: recording\.id, title: recording\.title \}\)/);
  assert.doesNotMatch(recordings, /event\.stopPropagation\(\); void window\.nodus\.setStudyRecordingLifecycle/);
  assert.match(recordings, /createPortal\(<div className="fixed inset-0 z-\[150\]/);
  assert.match(recordings, /data-testid="study-recording-note-dialog"/);
  assert.match(recordings, /data-testid="study-recording-note-location"/);
  assert.match(recordings, /createStudyNoteFromTranscript\(recording\.id, transcriptId, validLocations/);
  assert.match(recordings, /data-testid="study-recording-generate-corrected"/);
  assert.match(recordings, /data-testid="study-recording-generate-notes"/);
  assert.doesNotMatch(recordings, /kind: 'corrected',[\s\S]{0,500}kind: 'notes'/);
  assert.match(recordings, /text-neutral-600 hover:bg-neutral-100 dark:text-neutral-500 dark:hover:bg-neutral-800/);
  assert.match(recordings, /text-neutral-900 outline-none dark:text-neutral-100/);
  assert.match(repository, /requestedPlacements/);
  assert.match(repository, /addStudyPlacement\(document\.id, placement\)/);
  assert.match(await read('src/components/editor/BlockNoteCanvas.tsx'), /onOpenRecording\?\.\(decodeURIComponent/);
  assert.match(editor, /onOpenRecording=\{onOpenRecording\}/);
  assert.match(markdown, /onStudyRecording/);
  assert.match(organization, /onOpenRecording=\{onOpenRecording\}/);
  assert.match(app, /setStudyRecordingTarget\(\{ id, timestamp \}\); ctx\.setView\('studyRecordings'\)/);
  assert.match(audio, /border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-900\/40/);
  assert.match(audio, /bg-teal-100[^"\n]*text-teal-800 dark:bg-teal-950\/70 dark:text-teal-200/);
});
