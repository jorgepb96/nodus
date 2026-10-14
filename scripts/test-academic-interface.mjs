import assert from 'node:assert/strict';
import test from 'node:test';
import { buildSync } from 'esbuild';
import { createRequire } from 'node:module';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
const scratch = await mkdtemp(path.join(os.tmpdir(), 'nodus-interface-'));
function load(entry) {
  const out = path.join(scratch, path.basename(entry) + '.cjs');
  buildSync({ entryPoints: [entry], outfile: out, bundle: true, format: 'cjs', platform: 'node', logLevel: 'silent' });
  return require(out);
}
const { academicNavigation, academicNavigationGroups, academicProfilePatch, academicCustomizationPatch, academicSidebarEditorState, academicInitialView, ACADEMIC_INTERFACE_PROFILES } = load('src/academicInterfaceProfiles.ts');
const { migrateLegacyAcademicInterface } = load('shared/academicInterfaceSettings.ts');
const { HEADER_ACTION_IDS, headerActionVisible, sanitizeHeaderActionVisibility } = load('shared/headerActions.ts');
const { academicPreparationSummary } = load('src/academicInterfaceGuideState.ts');
const base = { sidebarOrder: [], sidebarHidden: [], sidebarCustomized: false, toolkitPinnedPages: ['translate'], academicMode: 'manual', synthesisModel: { provider: 'nodus', model: 'fixture' } };
const ids = settings => academicNavigation(settings).map(item => item.id);
test.after(() => rm(scratch, { recursive: true, force: true }));

test('presets keep section boundaries, the dictionary and the three shared tools', () => {
  assert.deepEqual(ids({ ...base, academicInterfaceProfile: 'simple' }), ['library', 'researchChat', 'toolkit', 'workspace', 'toolkit:drift', 'toolkit:presenter', 'settings']);
  assert.deepEqual(ids({ ...base, academicInterfaceProfile: 'intermediate' }), ['home', 'library', 'ideas', 'authors', 'argument', 'graph', 'researchChat', 'dictionary', 'deepResearch', 'toolkit', 'workspace', 'toolkit:drift', 'toolkit:presenter', 'settings']);
  for (const profile of ['simple', 'intermediate', 'advanced', 'custom']) {
    const navigation = ids({ ...base, academicInterfaceProfile: profile });
    for (const tool of ['workspace', 'toolkit:drift', 'toolkit:presenter']) assert.ok(navigation.includes(tool), `${profile}: ${tool}`);
    assert.equal(navigation.filter(id => id === 'notes' || id === 'workspace').length, 1);
  }
  assert.deepEqual(academicNavigationGroups({ ...base, academicInterfaceProfile: 'intermediate' }).map(group => group.id), ['explore', 'analyze', 'tools']);
  assert.equal(academicInitialView('simple'), 'researchChat');
  assert.equal(academicInitialView('intermediate'), 'researchChat');
  assert.equal(academicInitialView('advanced'), 'home');
});

test('advanced includes the full academic workspace with one Scriptor', () => {
  const actual = ids({ ...base, academicInterfaceProfile: 'advanced', sidebarHidden: ['graph', 'hypothesis'], sidebarCustomized: true });
  for (const id of ['hypothesis', 'reading', 'graph', 'workspace', 'research', 'toolkit:translate']) assert.ok(actual.includes(id), id);
  assert.equal(actual.filter(id => id === 'workspace' || id === 'notes').length, 1);
  assert.equal(new Set(actual).size, actual.length);
  assert.equal(actual[0], 'home'); assert.equal(actual.at(-1), 'settings');
});

test('presets preserve a saved custom layout; custom orders inside the established groups', () => {
  const custom = { ...base, academicInterfaceProfile: 'custom', sidebarCustomized: true, sidebarHidden: ['library'], sidebarOrder: ['toolkit', 'graph', 'researchChat'] };
  assert.deepEqual(ids(custom).slice(0, 2), ['home', 'graph']);
  assert.ok(ids(custom).indexOf('researchChat') < ids(custom).indexOf('toolkit'));
  assert.ok(!ids(custom).includes('library'));
  const intermediate = { ...custom, ...academicProfilePatch(custom, 'intermediate') };
  const restored = { ...intermediate, ...academicProfilePatch(intermediate, 'custom') };
  assert.deepEqual(ids(restored), ids(custom));
  assert.deepEqual(restored.sidebarHidden, custom.sidebarHidden);
});

test('legacy defaults are frozen before leaving and profile changes carry no processing authority', () => {
  const patch = academicProfilePatch(base, 'simple');
  assert.ok(patch.sidebarHidden.includes('hypothesis'));
  assert.ok(patch.sidebarHidden.includes('reading'));
  assert.deepEqual(patch.sidebarOrder, base.sidebarOrder);
  for (const key of Object.keys(patch)) assert.ok(['academicInterfaceProfile', 'sidebarCustomized', 'sidebarHidden', 'sidebarOrder'].includes(key), key);
  const updated = { ...base, ...patch };
  assert.equal(updated.academicMode, 'manual'); assert.deepEqual(updated.synthesisModel, base.synthesisModel);
  assert.equal(base.academicInterfaceProfile, undefined);
});

test('editing a preset starts from its effective navigation and pins remain available', () => {
  const simple = { ...base, academicInterfaceProfile: 'simple' };
  const custom = { ...simple, ...academicCustomizationPatch(simple) };
  assert.equal(custom.academicInterfaceProfile, 'custom');
  assert.deepEqual(ids(custom), ['home', 'library', 'researchChat', 'toolkit', 'workspace', 'toolkit:drift', 'toolkit:presenter', 'settings']);
  assert.deepEqual(custom.toolkitPinnedPages, base.toolkitPinnedPages);
});

test('legacy personalized layouts migrate once and retain hidden sections and their positions', () => {
  const legacy = { ...base, sidebarCustomized: true, sidebarOrder: ['authors', 'graph', 'ideas', 'researchChat', 'dictionary'], sidebarHidden: ['graph', 'dictionary'] };
  const patch = migrateLegacyAcademicInterface(legacy, 'academic');
  assert.equal(patch.academicInterfaceProfile, 'custom');
  assert.deepEqual(patch.sidebarOrder, legacy.sidebarOrder);
  assert.deepEqual(patch.sidebarHidden, legacy.sidebarHidden);
  const migrated = { ...legacy, ...patch };
  assert.deepEqual(migrateLegacyAcademicInterface(migrated, 'academic'), {});
  assert.deepEqual(migrateLegacyAcademicInterface(legacy, 'worldbuilding'), {});
  assert.deepEqual(migrateLegacyAcademicInterface(base, 'academic'), {});
  assert.equal(migrateLegacyAcademicInterface({ ...legacy, sidebarCustomized: undefined }, 'academic').academicInterfaceProfile, 'custom');
  let settings = migrated;
  for (const profile of ['simple', 'intermediate', 'advanced', 'custom']) {
    settings = { ...settings, ...academicProfilePatch(settings, profile) };
    assert.deepEqual(settings.sidebarOrder, legacy.sidebarOrder);
    assert.deepEqual(settings.sidebarHidden, legacy.sidebarHidden);
  }
  assert.deepEqual(ids(settings), ids(migrated));
});

test('editing visibility in Custom keeps the order of hidden entries and preserves other preferences', () => {
  const settings = { ...base, academicInterfaceProfile: 'custom', sidebarCustomized: true, sidebarOrder: ['authors', 'graph', 'ideas', 'dictionary', 'researchChat'], sidebarHidden: ['graph', 'dictionary'] };
  assert.deepEqual(academicSidebarEditorState(settings).order, settings.sidebarOrder);
  const edited = { ...settings, ...academicCustomizationPatch(settings), sidebarHidden: ['dictionary'] };
  assert.deepEqual(edited.sidebarOrder, settings.sidebarOrder);
  assert.ok(ids(edited).indexOf('authors') < ids(edited).indexOf('graph'));
  assert.ok(ids(edited).indexOf('graph') < ids(edited).indexOf('ideas'));
  assert.equal(edited.academicMode, 'manual');
  assert.deepEqual(edited.synthesisModel, settings.synthesisModel);
  for (const profile of ['simple', 'intermediate', 'advanced']) {
    const preset = { ...edited, ...academicProfilePatch(edited, profile) };
    const headerEdit = { ...preset, headerActionVisibility: { feedback: true } };
    assert.equal(headerEdit.academicInterfaceProfile, profile);
    assert.deepEqual(ids(headerEdit), ids({ ...base, academicInterfaceProfile: profile }));
    const custom = { ...headerEdit, ...academicCustomizationPatch(headerEdit) };
    assert.equal(custom.academicInterfaceProfile, 'custom');
    assert.deepEqual(ids(custom).filter(id => id !== 'home'), ids(preset).filter(id => id !== 'home'));
  }
});

test('header defaults hide secondary actions in every profile and include theme in Simple', () => {
  for (const profile of [undefined, 'simple', 'intermediate', 'advanced', 'custom']) {
    for (const id of ['sync', 'focus', 'feedback', 'skills']) assert.equal(headerActionVisible(id, undefined, profile), false, `${profile}: ${id}`);
    for (const id of ['commands', 'theme', 'queue', 'notifications', 'settings']) assert.equal(headerActionVisible(id, undefined, profile), true, `${profile}: ${id}`);
  }
  assert.equal(headerActionVisible('toolkit', undefined, 'simple'), false);
  assert.equal(headerActionVisible('toolkit', undefined, 'intermediate'), true);
  assert.equal(headerActionVisible('skills', { skills: true }, 'simple'), true);
  assert.equal(headerActionVisible('theme', { theme: false }, 'advanced'), false);
  assert.deepEqual(sanitizeHeaderActionVisibility({ focus: true, theme: false, unknown: true, queue: 'false' }), { focus: true, theme: false });
  assert.deepEqual(sanitizeHeaderActionVisibility(null), {});
  assert.equal(new Set(HEADER_ACTION_IDS).size, HEADER_ACTION_IDS.length);
  assert.equal(HEADER_ACTION_IDS.includes('gettingStarted'), false, 'getting started is exclusive to the interface selector');
  assert.deepEqual(sanitizeHeaderActionVisibility({ gettingStarted: true, theme: false }), { theme: false });
});

function document(id, preparation, extra = {}) {
  return { id, workId: id, preparation: { lexical: 'missing', embeddings: 'missing', status: 'catalogued', reason: null, ...preparation }, ...extra };
}
test('guide counts partial, failed and paused preparation without including chat attachments or notes', () => {
  const summary = academicPreparationSummary({ documents: [
    document('ready', { lexical: 'ready', embeddings: 'ready', status: 'ready' }),
    document('failed', { status: 'failed', reason: 'provider_failed' }),
    document('paused', { status: 'paused' }),
    document('attachment', { status: 'failed' }, { conversationAttachment: true }),
    document('note', { status: 'failed' }, { noteId: 'note' }),
  ] });
  assert.deepEqual(summary, { total: 3, ready: 1, failed: 1, pending: true, paused: true, noModel: false });
  assert.equal(academicPreparationSummary({ documents: [document('missing-model', { status: 'blocked', reason: 'no_model' })] }).noModel, true);
  assert.equal(academicPreparationSummary(null).total, 0);
  assert.equal(academicPreparationSummary({ documents: [document('text-ready', { lexical: 'ready', embeddings: 'failed', status: 'ready' })] }).failed, 1);
  const textReady = { documents: [document('indexing', { lexical: 'ready', embeddings: 'partial', status: 'ready' })] };
  assert.equal(academicPreparationSummary(textReady, { campaigns: [{ vaultId: 'current', jobs: [{ documentId: 'indexing', state: 'running' }] }] }, 'current').pending, true);
  assert.equal(academicPreparationSummary(textReady, { campaigns: [{ vaultId: 'other', jobs: [{ documentId: 'indexing', state: 'running' }] }] }, 'current').pending, false);
});

test('every profile label and description is translated in every active language', () => {
  const { ACADEMIC_INTERFACE_TRANSLATIONS: tables } = load('src/i18n.academicInterface.ts');
  for (const [lang, table] of Object.entries(tables)) {
    for (const profile of ACADEMIC_INTERFACE_PROFILES) {
      assert.ok(table[profile.label], `${lang}: ${profile.label}`);
      assert.ok(table[profile.description], `${lang}: ${profile.description}`);
    }
    for (const [key, value] of Object.entries(tables.en)) assert.ok(table[key]?.trim(), `${lang}: ${value}`);
  }
});

test('older catalogue entries cannot replace the new profile and header translations', () => {
  const { ACADEMIC_INTERFACE_TRANSLATIONS: tables } = load('src/i18n.academicInterface.ts');
  const names = { en: 'EN', fr: 'FR', de: 'DE', pt: 'PT', 'pt-BR': 'PT_BR', it: 'IT', tr: 'TR', 'zh-CN': 'ZH_CN', 'zh-TW': 'ZH_TW', ja: 'JA', ko: 'KO' };
  for (const [lang, table] of Object.entries(tables)) {
    const actual = load(`src/i18n.${lang}.ts`)[names[lang]];
    for (const [key, value] of Object.entries(table)) assert.equal(actual[key], value, `${lang}: ${key}`);
  }
});
