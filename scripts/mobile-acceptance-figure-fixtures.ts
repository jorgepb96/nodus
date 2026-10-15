import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {nativeImage} from 'electron';
import {withVaultDatabase} from '../electron/db/database';
import {listVaults, withOwningVault} from '../electron/vaults/vaultRegistry';
import {getWritingWorkshopDraft, saveWritingWorkshopDraft} from '../electron/db/writingDraftsRepo';
import {chatAssetOwner, getChatImage, importDocumentFigureAsset} from '../electron/chatAssets';
import {readDocumentVisuals, writeDocumentVisuals} from '../electron/capabilities/documentStore';
import {documentBlocks, type DocumentVisualManifest} from '../shared/documentSkills';
import {researchVisualFields} from '../shared/documentVisualContent';
import {validateViewDocument} from '../packages/capability-api/src/views';
import type {WritingWorkshopDraft} from '../shared/types';

const reportId = 'd09c9568-df00-40c7-84b5-1f194b9b9161';
const revision = 'd09c9568-df00-40c7-84b5-1f194b9b9162';
const figureId = 'd09c9568-df00-40c7-84b5-1f194b9b9163';
const posterId = 'd09c9568-df00-40c7-84b5-1f194b9b9164';
const attachmentId = 'd09c9568-df00-40c7-84b5-1f194b9b9165';
const legacyFigureId = 'd09c9568-df00-40c7-84b5-1f194b9b9166';
const title = 'Aceptación de figuras Mac 0.1.0';
const body = 'Este informe ficticio verifica imágenes y figuras del Mac en la lectura móvil, sus descargas elegidas y el PDF. No utiliza datos de investigación ni llama a un proveedor.\n\nLa imagen verde y el recurso azul contienen una región de ruido determinista para exigir varias lecturas HTTPS por bloques.';
const digest = (data: Buffer | string) => createHash('sha256').update(data).digest('hex');

/** Actual PNG pixels, large enough to require multiple bounded HTTP chunks. */
function png(blue: boolean): Buffer {
  const width = 900, height = 600, pixels = Buffer.alloc(width * height * 4);
  let state = 0x734abc19;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const offset = (y * width + x) * 4;
    state ^= state << 13; state ^= state >>> 17; state ^= state << 5;
    // Electron's bitmap is native premultiplied BGRA on this Mac.
    pixels[offset] = y < height / 2 ? (blue ? 255 : 0) : state & 255;
    pixels[offset + 1] = y < height / 2 ? (blue ? 0 : 255) : (state >>> 8) & 255;
    pixels[offset + 2] = y < height / 2 ? 0 : (state >>> 16) & 255;
    pixels[offset + 3] = 255;
  }
  const bytes = nativeImage.createFromBitmap(pixels, {width, height, scaleFactor: 1}).toPNG();
  if (bytes.length <= 524288 || bytes.length > 8 * 1048576) throw new Error('Acceptance figure must exercise bounded multi-chunk PNG transfer');
  return bytes;
}

/** Adds one explicitly fictional report to the marked COPY, through canonical stores. */
export async function ensureAcceptanceFigureFixtures(lab: string): Promise<void> {
  if (!fs.existsSync(path.join(lab, '.nodus-mobile-acceptance-lab'))) throw new Error('Isolated figure lab marker required');
  const vaults = listVaults();
  if (!vaults.every(vault => path.resolve(vault.path).startsWith(path.resolve(lab) + path.sep))) throw new Error('Every figure-fixture vault must be isolated');
  const vault = vaults.find(item => item.name === 'Principal');
  if (!vault) throw new Error('Principal laboratory copy required for figures');
  const marker = path.join(lab, 'native-figure-read-fixture.json');
  await withOwningVault(vault.id, () => withVaultDatabase(vault.id, () => {
    if (fs.existsSync(marker)) {
      const saved = JSON.parse(fs.readFileSync(marker, 'utf8'));
      const draft = getWritingWorkshopDraft(reportId), manifest = readDocumentVisuals(vault.id, {kind: 'deep-research', id: reportId});
      if (saved.formatVersion !== 1 || saved.vaultId !== vault.id || draft?.draft.draftMarkdown !== body || !manifest || digest(JSON.stringify(manifest)) !== saved.manifestSha256) throw new Error('Existing figure fixture changed; it will not be overwritten');
      for (const asset of saved.assets) {
        const actual = getChatImage(`${asset.owner}/${asset.id}`);
        if (!actual || actual.mime !== 'image/png' || actual.blob.length !== asset.byteCount || digest(actual.blob) !== asset.sha256) throw new Error('Actual acceptance figure bytes are missing or changed');
      }
      return;
    }
    if (getWritingWorkshopDraft(reportId)) throw new Error('Figure fixture identity already exists without its receipt');
    const now = new Date().toISOString();
    const draft: WritingWorkshopDraft = {title, draftMarkdown: body, abstract: '', generatedAt: now,
      brief: {kind: 'deep_research', objective: title, language: 'es'},
      selection: {ideaIds: [], themeIds: [], gapIds: [], contradictionIds: [], workIds: [], passageIds: [], tutorRouteIds: []},
      outline: [], matrix: [], bibliography: [], nextSteps: [], limitations: ['Contenido ficticio de aceptación.'],
      stats: {selectedIdeas: 0, selectedThemes: 0, selectedGaps: 0, selectedContradictions: 0, selectedWorks: 0, selectedPassages: 0, selectedTutorRoutes: 0, contextChars: body.length, truncated: false}};
    saveWritingWorkshopDraft({draft}, reportId);
    const owner = chatAssetOwner('document-figure', `deep-research:${reportId}:${revision}:${figureId}`, vault.id);
    const assets = [{id: posterId, bytes: png(false)}, {id: attachmentId, bytes: png(true)}].map(asset => {
      importDocumentFigureAsset(owner, asset.id, {bytes: asset.bytes, mimeType: 'image/png'}, {title: 'Fictitious mobile figure acceptance'});
      return {id: asset.id, owner, byteCount: asset.bytes.length, sha256: digest(asset.bytes)};
    });
    const fields = researchVisualFields(draft), blocks = documentBlocks(fields);
    const legacy = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aGwoAAAAASUVORK5CYII=';
    const manifest: DocumentVisualManifest = {schemaVersion: 1, target: {kind: 'deep-research', id: reportId}, vaultId: vault.id,
      revision, createdAt: now, updatedAt: now, state: 'ready', contentHash: digest(JSON.stringify(fields)),
      policy: {enabled: true, skills: []}, usage: {}, blocks, figures: [
        {id: figureId, owner, ownerRevision: revision, blockId: blocks[0].id, skillId: 'builtin-svg', brief: 'Fictitious source',
          caption: 'Figura de aceptación verde con recurso azul', sources: [], layout: 'wide', state: 'ready',
          poster: `nodus-image://chat/${owner}/${posterId}`,
          view: validateViewDocument({schemaVersion: 1, title: 'Recurso azul', summary: 'Recurso ficticio de aceptación', nodes: [
            {kind: 'image', attachmentId, title: 'Imagen azul', alt: 'Región azul y ruido determinista', name: 'blue.png', mimeType: 'image/png', bytes: assets[1].byteCount, width: 900, height: 600}
          ]})},
        {id: legacyFigureId, owner: chatAssetOwner('document-figure', `deep-research:${reportId}:${revision}:${legacyFigureId}`, vault.id), ownerRevision: revision,
          blockId: blocks.at(-1)!.id, skillId: 'builtin-svg', brief: 'Legacy inline poster', caption: 'Poster inline histórico', sources: [], layout: 'compact', state: 'ready', poster: legacy}
      ]};
    writeDocumentVisuals(manifest);
    if (!readDocumentVisuals(vault.id, manifest.target)) throw new Error('The canonical figure manifest is unreadable');
    fs.writeFileSync(marker, JSON.stringify({formatVersion: 1, fixtureKind: 'explicit fictional report and real PNG pixels, canonical stores',
      vaultId: vault.id, reportId, title, revision, figureId, posterId, attachmentId, owner, assets,
      contentHash: manifest.contentHash, manifestSha256: digest(JSON.stringify(manifest)), providerCalls: 0, extractionOrIndexingStarted: false}), {mode: 0o600});
  }));
}
