// Regression coverage for the optional decorative-image pipeline and the
// global-search result wiring/detail mapper. No provider request is performed.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { build } from 'esbuild';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { readSource } from './ipc-channel-census.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

if (!process.argv.includes('--electron-decorative-images-test')) {
  execFileSync(
    path.join(root, 'node_modules/.bin/electron'),
    [path.join(root, 'scripts/test-decorative-images.mjs'), '--electron-decorative-images-test'],
    { cwd: root, env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, stdio: 'inherit' }
  );
  process.exit(0);
}

const tmp = await mkdtemp(path.join(os.tmpdir(), 'nodus-decorative-images-'));

try {
  // Exercise the real centralized style/prompt implementation.
  const outfile = path.join(tmp, 'imageStyles.mjs');
  await build({
    entryPoints: [path.join(root, 'shared/imageStyles.ts')],
    outfile,
    bundle: true,
    format: 'esm',
    platform: 'node',
    external: ['./types'],
    logLevel: 'silent',
  });
  const { DECORATIVE_IMAGE_STYLES, DEFAULT_DECORATIVE_IMAGE_STYLE, buildDecorativeImagePrompt } =
    await import(pathToFileURL(outfile).href);
  assert.equal(DEFAULT_DECORATIVE_IMAGE_STYLE, 'antique_book');
  assert.equal(DECORATIVE_IMAGE_STYLES.length, 12, 'the centralized style choices (illustrated + photographic) remain available');
  assert.equal(new Set(DECORATIVE_IMAGE_STYLES.map((style) => style.id)).size, 12, 'style ids are unique');
  for (const id of ['realistic_photo', 'vintage_photograph', 'black_and_white', 'cinematic', 'oil_painting']) {
    assert.ok(DECORATIVE_IMAGE_STYLES.some((style) => style.id === id), `photographic/realistic style ${id} is available`);
  }
  for (const style of DECORATIVE_IMAGE_STYLES) {
    const prompt = buildDecorativeImagePrompt(style.id, `  Escena   visual de ${style.label}  `);
    assert.ok(prompt.length <= 560, 'final prompt is deliberately bounded');
    assert.ok(prompt.includes('no text') && prompt.includes('no logos') && prompt.includes('no watermark'));
    assert.ok(!/\s{2,}/.test(prompt), 'visual context whitespace is compacted');
  }

  const [service, imageStorage, ipc, jobs, migration, imageModels, card, imageModal, searchView, app, providersUi, modelListUi, audioSettingsUi] = await Promise.all([
    Promise.resolve(readSource('electron/ai/decorativeImages.ts')),
    Promise.resolve(readSource('electron/imageStorage.ts')),
    Promise.resolve(readSource('@main')),
    Promise.resolve(readSource('src/backgroundJobs.ts')),
    Promise.resolve(readSource('electron/db/migrations.ts')),
    Promise.resolve(readSource('electron/ai/imageModels.ts')),
    Promise.resolve(readSource('src/components/DecorativeImageCard.tsx')),
    Promise.resolve(readSource('src/components/DecorativeImageModal.tsx')),
    Promise.resolve(readSource('src/views/SearchView.tsx')),
    Promise.resolve(readSource('src/App.tsx')),
    Promise.resolve(readSource('src/views/ProvidersSettings.tsx')),
    Promise.resolve(readSource('src/components/SettingsModelList.tsx')),
    Promise.resolve(readSource('src/views/NarrationSettings.tsx')),
  ]);

  // Disabled means a DB-only not-requested state: no text/image provider path.
  const off = service.indexOf("if (!option?.enabled) return markNotRequested");
  const queued = service.indexOf('return queueDecorativeImageGeneration', off);
  assert.ok(off >= 0 && queued > off, 'disabled option exits before the generation queue');
  assert.ok(service.includes('setTimeout(() => void runGeneration'), 'image work starts asynchronously');
  assert.ok(service.includes('active.get(key) !== token'), 'stale/deleted attempts cannot overwrite image state');
  assert.ok(service.includes('interruptDecorativeImageGenerations'), 'vault/app shutdown can invalidate process-local image work');
  assert.ok(service.includes("decorativeImageContextCall(source,getSettings().promptLanguage ?? 'es')"), 'visual-context call follows the configured prompt language');
  const contextModule = path.join(tmp, 'decorativeImageContext.mjs');
  await build({entryPoints: [path.join(root, 'shared/decorativeImageContext.ts')], outfile: contextModule,
    bundle: true, format: 'esm', platform: 'node', logLevel: 'silent'});
  const {decorativeImageContextCall} = await import(pathToFileURL(contextModule).href);
  for (const [language, marker] of [['en', 'Maximum 45 words'], ['fr', '45 mots maximum'], ['de', 'Höchstens 45 Wörter'], ['pt', 'Máximo de 45 palavras'], ['it', 'Massimo 45 parole'], ['tr', 'En fazla 45 kelime']]) {
    const call = decorativeImageContextCall({title: 'Fixture title', content: 'Fixture source'}, language);
    assert.ok(call.system.includes(marker), `visual-context copy includes ${marker}`);
    assert.ok(call.user.includes('Fixture title') && call.user.includes('Fixture source'), 'the canonical call preserves its supplied source');
    assert.equal(call.maxTokens, 100, 'visual-context call remains short');
    assert.equal(call.noRetry, true, 'visual-context calls do not duplicate provider work');
  }
  assert.ok(service.includes('request.visualContext') && service.includes('buildDecorativeImagePrompt(style, context)'), 'a user-edited scene rebuilds the styled prompt');
  assert.ok(service.includes('maxRetries: 0'), 'Google image calls are single-attempt');
  assert.ok(service.includes('IMAGE_CONTEXT_TIMEOUT_MS = 45_000') && service.includes('IMAGE_TIMEOUT_MS = 120_000'), 'both context and image work are time-bounded');
  assert.ok(!/for\s*\([^)]*retry|while\s*\([^)]*retry/i.test(service), 'there is no automatic retry loop');

  // Main content is awaited/saved first in both owner flows.
  const immersionOwner = ipc.indexOf("h('immersion:generate'");
  assert.ok(ipc.indexOf('await generateImmersionSession', immersionOwner) < ipc.indexOf("applyDecorativeImageOption('immersion'", immersionOwner));
  const reportOwner = ipc.indexOf("h('writing:saved:save'");
  assert.ok(ipc.indexOf('saveWritingWorkshopDraft(request)', reportOwner) < ipc.indexOf("applyDecorativeImageOption('deep_research'", reportOwner));
  assert.ok(jobs.includes('decorativeImage: currentRequest.decorativeImage'), 'background Deep Research save carries the option');

  // Provider endpoints/models stay grounded in the documented integrations.
  assert.ok(service.includes("client.interactions.create"), 'Google uses the official Interactions API client');
  assert.ok(service.includes("https://api.openai.com/v1/images/generations"), 'OpenAI uses the official Images API');
  assert.ok(service.includes("https://openrouter.ai/api/v1/images"), 'OpenRouter uses the image endpoint');
  assert.ok(service.includes('media_type') && imageStorage.includes("from '@napi-rs/canvas'"), 'documented OpenRouter formats are decoded for their independent thumbnail');
  assert.ok(service.includes("quality: 'high'") && service.includes("output_format: 'png'"), 'OpenAI requests a high-quality lossless source');
  assert.ok(imageModels.includes("gemini-3.1-flash-lite-image"), 'verified Google image model is present');
  assert.ok(imageModels.includes("architecture?.output_modalities?.includes('image')"), 'OpenRouter results require image output');
  assert.ok(imageModels.includes('imagePriceUsd: cheapest?.value ?? null'), 'unpublished image prices remain unavailable');
  assert.ok(providersUi.includes('image-generation-model-list'), 'image models use the shared settings list pattern');
  assert.ok(providersUi.includes('provider-model-list-'), 'provider model catalogs use the shared settings list pattern');
  assert.ok(audioSettingsUi.includes('data-testid="narration-models"') && audioSettingsUi.includes('SettingsModelList') && audioSettingsUi.includes('settingsModelRowClass'), 'narration models and voices use the shared settings list pattern');
  assert.ok(modelListUi.includes('dark:bg-neutral-950/20') && modelListUi.includes('bg-indigo-50'), 'the shared list defines explicit light and dark surfaces');

  // Persistence includes every requested audit field plus an independent thumbnail.
  for (const column of ['requested', 'status', 'provider', 'model', 'style', 'prompt', 'asset_ref', 'error', 'thumbnail_blob']) {
    assert.ok(migration.includes(column), `migration persists ${column}`);
  }
  assert.ok(card.includes("if (thumbnail)"));
  assert.ok(card.includes("current?.status !== 'ready' || !dataUrl) return null"), 'missing thumbnails render no broken space');
  assert.ok(card.includes('relative h-24 overflow-hidden rounded-lg'), 'thumbnail owns a default height that callers can override');
  assert.ok(card.includes('absolute inset-0 h-full w-full object-cover'), 'thumbnail image fills the complete caller-provided frame');
  // The main views stay uncluttered: a single "Design" pill opens the modal,
  // where style/scene editing and regeneration live. Cost is disclosed there.
  assert.ok(card.includes('DesignPill') && card.includes('DecorativeImageModal'), 'the card exposes only a design entry point and hosts the modal');
  assert.ok(!card.includes("t('Regenerar')"), 'the card no longer renders an inline regenerate button');
  assert.ok(imageModal.includes("action: 'regenerate'") && imageModal.includes('coste adicional'), 'the design modal regenerates and discloses the new cost');
  assert.ok(imageModal.includes('Descripción de la escena'), 'the design modal lets the user edit the scene');

  // The engine is chosen per image, and a retry must NOT go back to the provider that
  // just failed: switching provider in Ajustes (or here) was the one reaction a failure
  // invites, and pinning made it look like nothing had changed.
  assert.ok(
    !/action === 'retry' && current\?\.(provider|model)/.test(service),
    'a retry no longer repeats the provider and model of the failed attempt'
  );
  assert.ok(
    service.includes('IMAGE_PROVIDERS.includes(request.provider)'),
    'a renderer-supplied provider is validated against the known image providers'
  );
  assert.ok(
    service.includes('request.provider && request.model') && service.includes('?? settings.imageProvider'),
    'the chosen engine falls back to the Ajustes default, and only as a complete pair'
  );
  assert.ok(
    imageModal.includes("t('Modelo de imagen')") && imageModal.includes('listImageModels'),
    'the design modal offers the full image-model catalogue'
  );
  assert.ok(
    imageModal.includes('provider: engine?.provider') && imageModal.includes('model: engine?.model'),
    'the modal sends the chosen engine with every generation request'
  );
  assert.ok(
    imageModal.includes("const keepsOwnEngine = status !== 'failed'"),
    'a failed image opens on the current default engine, not on the one that refused it'
  );
  assert.ok(
    card.includes('provider: opts.provider') && card.includes('model: opts.model'),
    'the card forwards the chosen engine across the bridge'
  );

  // One failure, one message. The modal used to print a generic sentence AND the
  // provider's reason under it, which read as two answers disagreeing.
  assert.ok(
    imageModal.includes("t(image?.error || 'La imagen no pudo generarse.')"),
    'the modal leads with the real reason, translated'
  );
  assert.ok(
    card.includes("t(current?.error || 'La imagen no pudo generarse.')"),
    'the card leads with the real reason, translated'
  );
  assert.ok(
    !imageModal.includes('La imagen no pudo generarse. El contenido está guardado'),
    'the contradictory combined headline is gone'
  );

  // Custom upload + revert-to-previous are reachable from the same design modal.
  assert.ok(imageModal.includes("t('Subir mi imagen')") && imageModal.includes('accept="image/*"'), 'the modal offers a user image upload');
  assert.ok(imageModal.includes('image?.hasPrevious') && imageModal.includes("t('Volver a la imagen anterior')"), 'the modal offers reverting to the previous image only when one exists');
  assert.ok(!card.includes('compressImageForUpload') && !card.includes('canvas.toBlob'), 'uploads are never recompressed in the renderer');
  assert.ok(card.includes('file.arrayBuffer()') && card.includes('file.type'), 'the exact uploaded bytes and MIME cross the bridge');
  assert.ok(card.includes('uploadDecorativeImage') && card.includes('revertDecorativeImage'), 'the card wires upload and revert to the bridge');
  assert.ok(service.includes('saveCustomDecorativeImage') && service.includes('prepareImageStorage(bytes, mimeType)'), 'a custom upload preserves its source and derives a thumbnail separately');
  assert.ok(imageStorage.includes('image: Buffer.from(bytes)') && imageStorage.includes("thumbnailMimeType: 'image/jpeg'"), 'the shared pipeline keeps the original byte-for-byte');
  assert.ok(service.includes('export function revertDecorativeImage') && service.includes('invalidateDecorativeImageGeneration'), 'revert discards any in-flight generation');
  assert.ok(ipc.includes("h('images:upload'") && ipc.includes("h('images:revert'"), 'upload and revert are exposed over IPC');
  assert.ok(ipc.includes("e.sender.send('images:changed', localizedForUi(image))"), 'upload/revert broadcast so other mounted cards stay in sync');
  // A pushed event never passes through `h`, so without this the SAME failure read
  // localized when fetched over IPC and raw Spanish when it arrived by event.
  assert.equal(
    (ipc.match(/sender\.send\('images:changed', /g) ?? []).length,
    (ipc.match(/sender\.send\('images:changed', localizedForUi\(/g) ?? []).length,
    'every images:changed broadcast is localized like an IPC result'
  );
  for (const column of ['source', 'prev_image_blob', 'prev_thumbnail_blob', 'thumbnail_mime_type', 'prev_thumbnail_mime_type', 'prev_style', 'prev_source']) {
    assert.ok(migration.includes(column), `migration persists ${column}`);
  }

  // Drive the real repository: regenerate snapshots the prior image, revert
  // restores it, a failed retry never wipes the snapshot, and an upload lands
  // as a 'custom' image that is itself undoable.
  const require = createRequire(import.meta.url);
  const Database = require('better-sqlite3');
  const repoOutfile = path.join(tmp, 'decorativeRepo.mjs');
  await build({
    entryPoints: [path.join(root, 'electron/db/decorativeImagesRepo.ts')],
    outfile: repoOutfile,
    bundle: true,
    format: 'esm',
    platform: 'node',
    external: ['@shared/types'],
    plugins: [{
      name: 'inject-decorative-deps',
      setup(builder) {
        builder.onResolve({ filter: /\/database$/ }, () => ({ path: 'database', namespace: 'dec-db' }));
        builder.onLoad({ filter: /.*/, namespace: 'dec-db' }, () => ({
          contents: 'export function getDb(){ return globalThis.__nodusDecorativeRepoDb; }',
          loader: 'js',
        }));
        builder.onResolve({ filter: /@shared\/imageStyles$/ }, () => ({ path: 'styles', namespace: 'dec-styles' }));
        builder.onLoad({ filter: /.*/, namespace: 'dec-styles' }, () => ({
          contents: "export const DEFAULT_DECORATIVE_IMAGE_STYLE = 'antique_book';",
          loader: 'js',
        }));
      },
    }],
    logLevel: 'silent',
  });
  const repoDb = new Database(':memory:');
  globalThis.__nodusDecorativeRepoDb = repoDb;
  repoDb.exec(`
    CREATE TABLE decorative_images (
      entity_kind TEXT NOT NULL, entity_id TEXT NOT NULL,
      requested INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'not_requested',
      provider TEXT, model TEXT, style TEXT NOT NULL DEFAULT 'antique_book',
      visual_context TEXT, prompt TEXT, asset_ref TEXT, mime_type TEXT,
      image_blob BLOB, thumbnail_blob BLOB, thumbnail_mime_type TEXT, error TEXT, source TEXT,
      prev_image_blob BLOB, prev_thumbnail_blob BLOB, prev_mime_type TEXT, prev_thumbnail_mime_type TEXT,
      prev_style TEXT, prev_visual_context TEXT, prev_prompt TEXT,
      prev_provider TEXT, prev_model TEXT, prev_source TEXT,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
      PRIMARY KEY (entity_kind, entity_id)
    );
  `);
  const repo = await import(pathToFileURL(repoOutfile).href);
  const K = 'immersion', ID = 's1';
  const pend = (style, preserveContext = true, preservePrompt = false) =>
    repo.markDecorativeImagePending({ entityKind: K, entityId: ID, provider: 'google', model: 'm', style, preserveContext, preservePrompt });
  const bytesOf = () => repo.getDecorativeImageData(K, ID)?.bytes.toString('utf8') ?? null;

  pend('antique_book', false, false);
  let img = repo.saveDecorativeImageReady(K, ID, Buffer.from('A-full'), 'image/png', Buffer.from('A-thumb'), 'image/jpeg');
  assert.equal(img.status, 'ready'); assert.equal(img.source, 'ai'); assert.equal(img.hasPrevious, false);
  assert.equal(bytesOf(), 'A-full');

  pend('watercolor');
  assert.equal(repo.getDecorativeImage(K, ID).status, 'pending');
  assert.equal(repo.getDecorativeImage(K, ID).hasPrevious, true, 'pending regeneration snapshots the prior image');
  img = repo.saveDecorativeImageReady(K, ID, Buffer.from('B-full'), 'image/png', Buffer.from('B-thumb'), 'image/jpeg');
  assert.equal(img.hasPrevious, true, 'the snapshot survives the new image becoming ready');
  assert.equal(bytesOf(), 'B-full');

  img = repo.restorePreviousDecorativeImage(K, ID);
  assert.equal(img.status, 'ready'); assert.equal(img.hasPrevious, false); assert.equal(bytesOf(), 'A-full');

  pend('antique_book');
  assert.equal(repo.getDecorativeImage(K, ID).hasPrevious, true);
  repo.saveDecorativeImageFailure(K, ID, 'boom');
  assert.equal(repo.getDecorativeImage(K, ID).status, 'failed');
  assert.equal(repo.getDecorativeImage(K, ID).hasPrevious, true, 'a failure keeps the snapshot');
  pend('antique_book', false, true);
  assert.equal(repo.getDecorativeImage(K, ID).hasPrevious, true, 'a retry after failure preserves the previous image');
  repo.saveDecorativeImageReady(K, ID, Buffer.from('C-full'), 'image/png', Buffer.from('C-thumb'), 'image/jpeg');

  img = repo.saveCustomDecorativeImageReady(K, ID, Buffer.from('U-full'), 'image/png', Buffer.from('U-thumb'), 'image/jpeg', 'watercolor');
  assert.equal(img.source, 'custom'); assert.equal(img.status, 'ready'); assert.equal(img.hasPrevious, true);
  assert.equal(bytesOf(), 'U-full');
  img = repo.restorePreviousDecorativeImage(K, ID);
  assert.equal(img.source, 'ai', 'reverting an upload restores the generated image it replaced');
  assert.equal(bytesOf(), 'C-full');

  // Drive the real queue over that same database. Two Deep Research reports were
  // stuck exactly here: they had failed on `codex`, the user changed the image
  // provider to Google in Ajustes, and every "Reintentar" went straight back to
  // codex because a retry reused the record's own provider and model. Source-text
  // assertions could not have caught it — only the persisted pending row can.
  const serviceOutfile = path.join(tmp, 'decorativeService.mjs');
  const stub = (filter, name, contents) => ({
    name: `stub-${name}`,
    setup(builder) {
      builder.onResolve({ filter }, () => ({ path: name, namespace: `stub-${name}` }));
      builder.onLoad({ filter: /.*/, namespace: `stub-${name}` }, () => ({ contents, loader: 'js' }));
    },
  });
  await build({
    entryPoints: [path.join(root, 'electron/ai/decorativeImages.ts')],
    outfile: serviceOutfile,
    bundle: true,
    format: 'esm',
    platform: 'node',
    external: ['@shared/types'],
    plugins: [
      // Matches both `../db/database` (the service) and `./database` (the repo it bundles).
      stub(/\/database$/, 'db', 'export function getDb(){ return globalThis.__nodusDecorativeRepoDb; }'),
      stub(/\/db\/settingsRepo$/, 'settings', 'export function getSettings(){ return globalThis.__nodusImageSettings; }'),
      stub(/@google\/genai$/, 'genai', 'export class GoogleGenAI { constructor(){ throw new Error("no network in tests"); } }'),
      stub(/\/vaults\/vaultRegistry$/, 'vault', "export function getActiveVault(){ return { type: 'academic' }; }"),
      stub(/\.\/aiClient$/, 'ai', 'export async function completeText(){ return "escena"; } export async function completeTextStream(){ return "escena"; }'),
      stub(/\.\/codexSubscription$/, 'codex', 'export async function generateImageWithChatGptSubscription(){ throw new Error("codex must not be called"); }'),
      stub(/\.\/nodusLocalImages$/, 'local', 'export async function generateNodusLocalImage(){ throw new Error("local engine must not be called"); }'),
      stub(/\/secrets\/secretStore$/, 'secrets', 'export function getApiKey(){ return null; }'),
      stub(/\/db\/entitiesRepo$/, 'entities', 'export function setPersonPortrait(){}'),
      stub(/\/db\/charactersRepo$/, 'characters', 'export function addCharacterImage(){} export function getCharacter(){ return null; }'),
      stub(/\/db\/worldImagesRepo$/, 'worldImages', 'export function addWorldImage(){}'),
      stub(/\/db\/worldPlacesRepo$/, 'worldPlaces', 'export function getWorldPlace(){ return null; }'),
      stub(/\/db\/worldGroupsRepo$/, 'worldGroups', 'export function getWorldGroup(){ return null; }'),
      stub(/\/imageStorage$/, 'storage', 'export function prepareImageStorage(){ throw new Error("unreached"); }'),
    ],
    logLevel: 'silent',
  });
  const queueService = await import(pathToFileURL(serviceOutfile).href);
  globalThis.__nodusImageSettings = {
    imageProvider: 'google',
    imageModel: 'gemini-3.1-flash-image',
    imageStyle: 'antique_book',
    imageQuality: 'balanced',
  };

  const failOn = (provider, model) => {
    repo.markDecorativeImagePending({
      entityKind: K, entityId: ID, provider, model,
      style: 'black_and_white', preserveContext: false, preservePrompt: false,
    });
    repo.saveDecorativeImageFailure(K, ID, 'ChatGPT no pudo generar la imagen.');
    queueService.invalidateDecorativeImageGeneration(K, ID);
  };

  failOn('codex', 'gpt-5.6-luna');
  let requeued = queueService.queueDecorativeImageGeneration({ entityKind: K, entityId: ID, action: 'retry' });
  assert.equal(requeued.provider, 'google', 'a retry follows the provider now configured, not the one that failed');
  assert.equal(requeued.model, 'gemini-3.1-flash-image', 'a retry follows the model now configured');
  assert.equal(requeued.style, 'black_and_white', 'a retry still repeats the style of the failed request');
  queueService.invalidateDecorativeImageGeneration(K, ID);

  failOn('codex', 'gpt-5.6-luna');
  requeued = queueService.queueDecorativeImageGeneration({
    entityKind: K, entityId: ID, action: 'retry', provider: 'openai', model: 'gpt-image-2',
  });
  assert.equal(requeued.provider, 'openai', 'the engine picked in the design modal wins over the Ajustes default');
  assert.equal(requeued.model, 'gpt-image-2');
  queueService.invalidateDecorativeImageGeneration(K, ID);

  failOn('codex', 'gpt-5.6-luna');
  requeued = queueService.queueDecorativeImageGeneration({
    entityKind: K, entityId: ID, action: 'retry', provider: 'not-a-provider', model: 'whatever',
  });
  assert.equal(requeued.provider, 'google', 'an unknown provider from the renderer falls back to the setting');
  assert.equal(requeued.model, 'gemini-3.1-flash-image', 'the fallback takes provider and model together');
  queueService.invalidateDecorativeImageGeneration(K, ID);

  failOn('codex', 'gpt-5.6-luna');
  requeued = queueService.queueDecorativeImageGeneration({
    entityKind: K, entityId: ID, action: 'retry', provider: 'openai',
  });
  assert.equal(requeued.provider, 'google', 'a provider without a model is not honoured on its own');
  queueService.invalidateDecorativeImageGeneration(K, ID);

  delete globalThis.__nodusImageSettings;
  repoDb.close();
  delete globalThis.__nodusDecorativeRepoDb;

  // A result click reuses the surface that owns it: ideas and works open the
  // same detail modals as the Ideas and Library sections; other kinds jump to
  // their home view. The disclosure arrow only rotates.
  assert.ok(searchView.includes('onClick={() => openResult(r)}'));
  assert.ok(searchView.includes('<IdeaDetailModal') && searchView.includes('<WorkIdeasModal'));
  assert.ok(searchView.includes("r.kind === 'idea') return setIdeaModalId(r.id)"));
  assert.ok(searchView.includes("r.kind === 'work') return setWorkModal("));
  const arrowClass = app.match(/className=\{`transition-transform duration-200[^`]+`\}/)?.[0] ?? '';
  assert.ok(arrowClass.includes('rotate-90') && !arrowClass.includes('translate'), 'search disclosure arrow rotates without translating');

  // Drive the real detail mapper against a representative record of every
  // indexed type. This locks the shared modal contract beyond source wiring.
  const searchOutfile = path.join(tmp, 'searchRepo.mjs');
  await build({
    entryPoints: [path.join(root, 'electron/db/searchRepo.ts')],
    outfile: searchOutfile,
    bundle: true,
    format: 'esm',
    platform: 'node',
    external: ['@shared/*'],
    plugins: [{
      name: 'inject-test-database',
      setup(builder) {
        builder.onResolve({ filter: /\/settingsRepo$/ }, () => ({ path: 'settings', namespace: 'test-settings' }));
        builder.onLoad({ filter: /.*/, namespace: 'test-settings' }, () => ({ contents: 'export function getSettings(){ return { academicMode: \"auto\" }; }', loader: 'js' }));
        builder.onResolve({ filter: /\/database$/ }, () => ({ path: 'database', namespace: 'test-db' }));
        builder.onLoad({ filter: /.*/, namespace: 'test-db' }, () => ({
          contents: 'export function getDb(){ return globalThis.__nodusDecorativeTestDb; }',
          loader: 'js',
        }));
      },
    }],
    logLevel: 'silent',
  });
  const db = new Database(':memory:');
  globalThis.__nodusDecorativeTestDb = db;
  db.exec(`
    CREATE TABLE ideas (global_id TEXT PRIMARY KEY, type TEXT, label TEXT, statement TEXT, created_at TEXT);
    CREATE TABLE works (nodus_id TEXT PRIMARY KEY, title TEXT, authors_json TEXT, year INTEGER, item_type TEXT, doi TEXT, zotero_key TEXT, notes TEXT, source_type TEXT, resolved_text_hash TEXT, deep_hash TEXT);
    CREATE TABLE idea_occurrences (global_id TEXT, nodus_id TEXT, role TEXT, development TEXT, confidence REAL);
    CREATE TABLE evidence (id TEXT, global_id TEXT, quote TEXT, location TEXT, kind TEXT);
    CREATE TABLE themes (theme_id TEXT PRIMARY KEY, label TEXT, pinned INTEGER, created_at TEXT);
    CREATE TABLE idea_theme_links (global_id TEXT, theme_id TEXT);
    CREATE TABLE work_themes (nodus_id TEXT, theme_id TEXT);
    CREATE TABLE work_summaries (nodus_id TEXT, summary TEXT);
    CREATE TABLE passages (passage_id TEXT PRIMARY KEY, nodus_id TEXT, text TEXT, page_label TEXT, chunk_index INTEGER, char_len INTEGER, created_at TEXT, content_hash TEXT);
    CREATE TABLE gaps (id TEXT PRIMARY KEY, kind TEXT, statement TEXT, confidence REAL, nodus_id TEXT, related_idea TEXT, evidence_id TEXT);
    CREATE TABLE authors (author_id TEXT PRIMARY KEY, name TEXT, affiliation TEXT, canonical_key TEXT);
    CREATE TABLE work_authors (author_id TEXT, nodus_id TEXT, role TEXT NOT NULL DEFAULT 'author');
    CREATE TABLE note_folders (id TEXT PRIMARY KEY, name TEXT);
    CREATE TABLE notes (id TEXT PRIMARY KEY, title TEXT, kind TEXT, content TEXT, folder_id TEXT, created_at TEXT, updated_at TEXT, trashed_at TEXT);
    INSERT INTO ideas VALUES ('i1','claim','Idea de prueba','Enunciado completo','2026-01-01');
    INSERT INTO works (nodus_id,title,authors_json,year,item_type,doi,zotero_key,notes,source_type)
      VALUES ('w1','Obra de prueba','["Autora, A."]',2026,'book','10/test','Z1','Notas','pdf');
    INSERT INTO idea_occurrences VALUES ('i1','w1','central','Desarrollo',0.9);
    INSERT INTO evidence VALUES ('e1','i1','Cita literal','p. 4','quote');
    INSERT INTO themes VALUES ('t1','Tema de prueba',1,'2026-01-01');
    INSERT INTO idea_theme_links VALUES ('i1','t1');
    INSERT INTO work_themes VALUES ('w1','t1');
    INSERT INTO work_summaries VALUES ('w1','Resumen completo');
    INSERT INTO passages (passage_id,nodus_id,text,page_label,chunk_index,char_len,created_at)
      VALUES ('p1','w1','Pasaje completo','4',0,15,'2026-01-01');
    INSERT INTO gaps VALUES ('g1','evidence','Hueco de prueba',0.8,'w1','i1','e1');
    INSERT INTO authors VALUES ('a1','Autora de prueba','Universidad','autora-prueba');
    INSERT INTO work_authors VALUES ('a1','w1','author');
    CREATE VIEW work_attributions AS
      SELECT wa.nodus_id, wa.author_id, wa.role,
             CASE WHEN wa.role = 'author' THEN 'author' ELSE 'editor_only' END AS basis
      FROM work_authors wa
      WHERE wa.role = 'author'
         OR NOT EXISTS (SELECT 1 FROM work_authors peer WHERE peer.nodus_id = wa.nodus_id AND peer.role = 'author');
    INSERT INTO note_folders VALUES ('f1','Carpeta');
    INSERT INTO notes VALUES ('n1','Nota de prueba','markdown','Contenido completo','f1','2026-01-01','2026-01-02',NULL);
  `);
  const { getSearchResultDetail } = await import(pathToFileURL(searchOutfile).href);
  const cases = [['idea', 'i1'], ['work', 'w1'], ['passage', 'p1'], ['gap', 'g1'], ['theme', 't1'], ['author', 'a1'], ['note', 'n1']];
  for (const [kind, id] of cases) {
    const detail = getSearchResultDetail(kind, id);
    assert.ok(detail, `${kind} detail exists`);
    assert.equal(detail.kind, kind);
    assert.ok(detail.title.length > 0 && Array.isArray(detail.metadata) && Array.isArray(detail.sections));
  }
  db.close();
  delete globalThis.__nodusDecorativeTestDb;

  console.log('decorative images + search result modal test passed');
} finally {
  await rm(tmp, { recursive: true, force: true });
}
