import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { installRuntimeHooks, requireElectronRuntime, repoRoot } from './lib/tsRuntimeHooks.mjs';
if (!requireElectronRuntime(fileURLToPath(import.meta.url), '--research-attachments')) process.exit(0);
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'nodus-attachments-'));
installRuntimeHooks(scratch);
const require = createRequire(import.meta.url), load = file => require(path.join(repoRoot, file));
globalThis.fetch = () => { throw new Error('External network forbidden in attachment tests'); };
const fixtures = path.join(scratch, 'fixtures'); fs.mkdirSync(fixtures);
const write = (name, data) => { const file = path.join(fixtures, name); fs.writeFileSync(file, data); return file; };
try {
  const settings = load('electron/db/settingsRepo.ts'); settings.updateSettings({ synthesisModel: { provider: 'openai', model: 'gpt-4.1' }, chatReasoning: 'off', researchWebSearch: 'off' });
  const store = load('electron/researchAttachments.ts');
  const chats = load('electron/db/chatRepo.ts');
  const owner = () => ({ surface: 'research', conversationId: chats.createConversation({}).id });
  const AdmZip = require('adm-zip');
  const zipFile = (name, entries) => { const zip = new AdmZip(); for (const [file, text] of Object.entries(entries)) zip.addFile(file, Buffer.from(text)); return write(name, zip.toBuffer()); };
  const { Document, Packer, Paragraph } = require('docx');
  const docx = write('report.docx', await Packer.toBuffer(new Document({ sections: [{ children: [new Paragraph('Census total: 42. Madrid, año 1920.')] }] })));
  const { PDFDocument, StandardFonts } = require('pdf-lib');
  const pdf = await PDFDocument.create(); const font = await pdf.embedFont(StandardFonts.Helvetica); pdf.addPage().drawText('Census total: 42. Madrid 1920.', { font });
  const pdfFile = write('report.pdf', await pdf.save());
  const sharp = require('sharp');
  const rawImage = sharp({ create: { width: 80, height: 60, channels: 3, background: '#c32d3b' } });
  const pngFile = write('chart.png', await rawImage.clone().png().toBuffer());
  const scanned = await PDFDocument.create(); const embedded = await scanned.embedPng(fs.readFileSync(pngFile)); scanned.addPage([100, 100]).drawImage(embedded); const scanFile = write('scan.pdf', await scanned.save());
  const XLSX = require('xlsx');
  const workbook = XLSX.utils.book_new();
  const sheet = XLSX.utils.aoa_to_sheet([['City','Total'],['Madrid',42]]);
  sheet.C2 = { t:'n', f:'B2*2', v:84 }; sheet['!ref']='A1:C2';
  XLSX.utils.book_append_sheet(workbook,sheet,'Census');
  XLSX.utils.book_append_sheet(workbook,XLSX.utils.aoa_to_sheet([['Region','Count'],['Spain',42]]),'Regions');
  const excelFile = (ext) => write('census.'+ext,XLSX.write(workbook,{type:'buffer',bookType:ext}));
  const xlsx = excelFile('xlsx');
  const cases = [
    [docx, /Census total: 42/], [path.join(repoRoot, 'scripts/fixtures/research-attachments/census.doc'), /Census total: 42/],
    [pdfFile, /Census total: 42/], [xlsx, /B2:.*42/],
    [excelFile('xls'), /B2:.*42/], [excelFile('xlsb'), /B2:.*42/], [excelFile('ods'), /B2:.*42/],
    [write('census.csv', 'City,Total\n"Madrid, España",42\n"Quoted \"\"field\"\"",7'), /España/],
    [write('census.tsv', 'City\tTotal\nMadrid\t42'), /Madrid/],
    [write('census.xml', '<city total="42">Madrid</city>'), /total=\\"42/],
    [write('census.xlm', '<city total="42">Madrid</city>'), /Madrid/],
    [write('data.json', '{"city":"Madrid","total":42}'), /Madrid/],
    [write('script.py', 'total = 42 # source code is data'), /total = 42/],
    [write('unknown.custom', 'Custom extension, readable text: 42'), /readable text/],
    [write('utf16.txt', Buffer.concat([Buffer.from([255,254]), Buffer.from('Madrid: 42. España.', 'utf16le')])), /España/],
    [zipFile('slides.pptx', { 'ppt/slides/slide1.xml': '<p:sld><a:p><a:t>Madrid 42</a:t></a:p></p:sld>' }), /Madrid 42/],
    [zipFile('notes.odt', { 'content.xml': '<office:document><text:p>Madrid 42</text:p></office:document>' }), /Madrid 42/],
    [zipFile('book.epub', { 'OEBPS/chapter.xhtml': '<html><p>Madrid 42</p></html>' }), /Madrid 42/],
    [zipFile('archive.zip', { 'data.csv': 'Madrid,42', 'note.txt': 'Census total 42' }), /Madrid,42/],
  ];
  const handlers = new Map();
  load('electron/ipc/researchAttachments.ts').registerResearchAttachmentIpc({ h: (channel, handler) => handlers.set(channel, handler), getWindow: () => null });
  const importDropped = (own, files) => handlers.get('research:attachments:import')({}, own, files);
  const invalidOwner = owner();
  await assert.rejects(() => importDropped(invalidOwner, ['relative.csv']), /equipo/);
  await assert.rejects(() => importDropped(invalidOwner, null), /equipo/);
  const mixed = await importDropped(invalidOwner, [fixtures, path.join(fixtures,'missing.pdf'), docx, docx, pngFile]);
  assert.equal(mixed.attachments.length, 2, 'mixed drops import valid files once');
  assert.equal(mixed.errors.length, 2, 'directories and missing files report individual errors');
  chats.deleteConversation(invalidOwner.conversationId);
  assert.equal(fs.existsSync(store.researchAttachmentDirectory(invalidOwner)), false);
  await assert.rejects(() => importDropped(invalidOwner, [docx]), /disponible/);
  let checks = 0;
  for (const [file, expected] of cases) {
    const own = owner(); const imported = await importDropped(own, [file]);
    assert.deepEqual(imported.errors, []); const attachment = imported.attachments[0];
    const context = store.readResearchAttachmentContext(own, [attachment.id]); assert.match(context.text, expected, path.basename(file));
    assert.deepEqual(fs.readFileSync(store.researchAttachmentOriginal(own, attachment.id).path), fs.readFileSync(file));
    if (file === pdfFile) {
      const pixels = await sharp(Buffer.from(context.images[0].base64,'base64')).removeAlpha().raw().toBuffer();
      assert.ok(pixels.some(value => value < 100),'PDF text must be visible in the raster sent to vision');
    }
    if (file === xlsx) { assert.match(context.text,/Regions/); assert.match(context.text,/formula: B2\*2/); }

    chats.saveMessages(own.conversationId, [{ id: 'u-'+own.conversationId, role: 'user', content: 'Read the file', attachments: [attachment] }]);
    assert.equal(chats.getConversation(own.conversationId).messages[0].attachments[0].name, path.basename(file));
    assert.throws(() => store.readResearchAttachmentContext(owner(), [attachment.id]), /adjunto/);
    chats.deleteConversation(own.conversationId); assert.equal(fs.existsSync(store.researchAttachmentDirectory(own)), false); checks++;
  }
  for (const ext of ['png', 'jpeg', 'webp', 'avif', 'tiff', 'gif']) {
    const file = write('image.'+ext, await rawImage.clone().toFormat(ext).toBuffer()); const own = owner();
    const attachment = await store.importResearchAttachment(own, file); const context = store.readResearchAttachmentContext(own, [attachment.id]);
    assert.equal(context.requiresVision, true); assert.equal(context.images.length, 1); assert.equal((await sharp(Buffer.from(context.images[0].base64, 'base64')).metadata()).format, 'png');
    chats.deleteConversation(own.conversationId); checks++;
  }
  const bmp=Buffer.alloc(58);bmp.write('BM');bmp.writeUInt32LE(58,2);bmp.writeUInt32LE(54,10);bmp.writeUInt32LE(40,14);bmp.writeInt32LE(1,18);bmp.writeInt32LE(1,22);bmp.writeUInt16LE(1,26);bmp.writeUInt16LE(24,28);bmp.writeUInt32LE(4,34);bmp.set([0,0,255,0],54);
  for(const file of [write('shape.svg','<svg xmlns="http://www.w3.org/2000/svg" width="80" height="60"><rect width="80" height="60" fill="red"/></svg>'),write('shape.bmp',bmp),path.join(repoRoot,'scripts/fixtures/research-attachments/red-square.heic')]) {
    const own=owner();const attachment=await store.importResearchAttachment(own,file);const context=store.readResearchAttachmentContext(own,[attachment.id]);
    assert.equal(context.images.length,1);assert.equal((await sharp(Buffer.from(context.images[0].base64,'base64')).metadata()).format,'png');chats.deleteConversation(own.conversationId);checks++;
  }
  const own = owner();
  // Valid UTF-8 may still be binary. Exercise every C0 control independently of
  // malformed-byte rejection, while preserving tab/newline and text whitespace.
  for (let code = 0; code < 32; code++) {
    const file = await store.importResearchAttachment(own, write(`control-${code}.custom`, `before${String.fromCharCode(code)}after`));
    assert.equal(file.kind, code >= 9 && code <= 13 ? 'text' : 'unsupported', `C0 control ${code}`);
    store.removeResearchAttachment(own, file.id);
  }
  const unsupported = await store.importResearchAttachment(own, write('binary.bin', Buffer.from([0,1,2,3,255])));
  assert.equal(unsupported.kind, 'unsupported'); assert.throws(() => store.readResearchAttachmentContext(own, [unsupported.id]), /lector/); store.removeResearchAttachment(own, unsupported.id);
  assert.equal(store.listResearchAttachments(own).length, 0);
  await assert.rejects(() => store.importResearchAttachment(own, write('broken.docx', 'not a ZIP')));
  assert.throws(() => store.researchAttachmentDirectory({ surface: 'research', conversationId: '../other' }));
  assert.throws(() => store.readResearchAttachmentContext(own, ['../other']));
  let current = true; const pending = store.importResearchAttachment(own, docx, () => current); current = false;
  await assert.rejects(() => pending, /disponible/); assert.equal(store.listResearchAttachments(own).length, 0);
  // All Research chat engines, real repository persistence, and every provider route.
  const providers = ['openai','anthropic','gemini','deepseek','groq','cerebras','xiaomi','openrouter','custom','ollama','lmstudio','codex','github-copilot','opencode-go','nodus'];
  const ai = load('electron/ai/aiClient.ts'); ai.localModelContextWindow = async () => null;
  load('electron/ai/providers.ts').listModels = async (_provider) => [{ id: 'vision-fixture', vision: true }, { id: 'text-fixture', vision: false }];
  load('electron/ai/codexSubscription.ts').listChatGptSubscriptionModels = async () => [{ id: 'vision-fixture', vision: true }, { id: 'text-fixture', vision: false }];
  load('electron/ai/githubCopilotSubscription.ts').listGitHubCopilotSubscriptionModels = async () => [{ id: 'vision-fixture', vision: true }, { id: 'text-fixture', vision: false }];
  let seen = [];
  ai.completeTextStream = async (options, cb, model) => { seen.push({options,model}); cb('Census total: 42.'); return 'Census total: 42.'; };
  ai.completeText = async (options, model) => { seen.push({options,model}); return 'Census total: 42.'; };
  // The turn planner calls completeJson directly; replacing completeText does
  // not intercept its lexical transport reference. Keep the existing literal
  // planning fallback, without starting subscription CLIs that outlive the test.
  // Planning and transport behavior have their own dedicated regression suites.
  const planningCalls = [];
  ai.completeJson = async (options, guard, model) => {
    planningCalls.push({ options, model });
    throw new Error('External inference forbidden in attachment tests');
  };
  const engines = [
    ['research', chats.createConversation({}), (request) => load('electron/ai/researchAssistant.ts').streamResearchChat({ ...request, messages: [{role:'user',content:'Read the attached census'}], selection: { graphParts: {} } }, ()=>{}), id => chats.deleteConversation(id)],
    ['database', load('electron/db/databaseChatRepo.ts').createDatabaseChatConversation({ title:'Files',databaseIds:[] }), request => load('electron/ai/databaseChat.ts').streamDatabaseChat({...request,question:'Read census',databaseIds:[]},()=>{}), id => load('electron/db/databaseChatRepo.ts').deleteDatabaseChatConversation(id)],
    ['world', load('electron/db/worldChatRepo.ts').createWorldChatConversation({title:'Files',selection:{scope:'manual',entryKeys:[],keepFocus:false},model:null}), request => load('electron/ai/worldChat.ts').streamWorldChat({...request,question:'Read census',focusKeys:[]},()=>{}), id => load('electron/db/worldChatRepo.ts').deleteWorldChatConversation(id)],
    ['study', load('electron/ai/studyAssistant.ts').createStudyAssistantConversation({}), request => load('electron/ai/studyAssistant.ts').streamStudyAssistant({...request,messages:[{id:'u',role:'user',content:'Read census',createdAt:new Date().toISOString()}],selection:{scope:'manual',sourceKeys:[]},task:'answer',level:'standard',tone:'clear',language:'auto',allowExternalKnowledge:false},()=>{}), id => load('electron/ai/studyAssistant.ts').deleteStudyAssistantConversation(id)],
  ];
  for (const [surface, chat, run, remove] of engines) {
    const own = { surface, conversationId: chat.id };
    const text = await store.importResearchAttachment(own, xlsx); const image = await store.importResearchAttachment(own, pngFile);
    for (const provider of providers) {
      seen = []; const model = {provider,model:'vision-fixture'};
      await run({conversationId:chat.id,attachmentIds:[text.id,image.id],model});
      assert.equal(seen.length, 1, `${surface}/${provider} reaches inference without vault material`);
      assert.deepEqual(seen[0].model, model); assert.match(seen[0].options.user, /B2:.*42/); assert.equal(seen[0].options.images.length,1); assert.match(seen[0].options.system,/attached files/); checks++;
      seen = []; await run({conversationId:chat.id,attachmentIds:[text.id],model:{provider,model:'text-fixture'}});
      assert.equal(seen.length,1); assert.match(seen[0].options.user,/B2:.*42/); assert.ok(!seen[0].options.images?.length); checks++;
      await assert.rejects(()=>run({conversationId:chat.id,attachmentIds:[image.id],model:{provider,model:'text-fixture'}}),/no tiene visión/);
    }
    remove(chat.id); assert.equal(fs.existsSync(store.researchAttachmentDirectory(own)),false);
  }
  assert.equal(planningCalls.length, providers.length * 2,
    'attachments are validated and budgeted before retrieval; unsupported images never start a search');
  assert.deepEqual([...new Set(planningCalls.map(call => call.model.provider))], providers);
  for (const call of planningCalls) {
    assert.match(call.options.system, /plan the library search/);
    assert.match(call.options.user, /Read the attached census/);
    assert.ok(['vision-fixture', 'text-fixture'].includes(call.model.model));
  }
  const helper = load('electron/ai/researchAttachments.ts');
  const scan = await store.importResearchAttachment(own, scanFile);
  await assert.rejects(()=>helper.prepareResearchAttachments({conversationId:own.conversationId,attachmentIds:[scan.id]},'research',{provider:'openai',model:'text-fixture'}),/visión/);
  const textPdf = await store.importResearchAttachment(own,pdfFile);
  const textOnly = await helper.prepareResearchAttachments({conversationId:own.conversationId,attachmentIds:[textPdf.id]},'research',{provider:'openai',model:'text-fixture'});
  assert.match(textOnly.text,/Census total: 42/); assert.equal(textOnly.images,undefined);
  const large = await store.importResearchAttachment(own,write('large.txt','Research '.repeat(40000)));
  await assert.rejects(()=>helper.prepareResearchAttachments({conversationId:own.conversationId,attachmentIds:[large.id]},'research',{provider:'openai',model:'text-fixture'}),/contexto/);
  let retries = 0;
  const options = { system: 'Source data', user: 'Census total: 42', images: [{mediaType:'image/png',base64:fs.readFileSync(pngFile).toString('base64')}] };
  const fallback = await helper.withResearchAttachmentFallback({requiresVision:false},options,async next => { retries++; if(next.images) throw new Error('This model does not support image input.'); assert.match(next.user,/Census total: 42/); assert.match(next.system,/visual details/); return '42'; });
  assert.equal(fallback,'42');assert.equal(retries,2);
  await assert.rejects(()=>helper.withResearchAttachmentFallback({requiresVision:true},options,async()=>{throw new Error('This model does not support image input.');}),/does not support/);
  let failedCalls=0;await assert.rejects(()=>helper.withResearchAttachmentFallback({requiresVision:false},options,async()=>{failedCalls++;throw new Error('Invalid API key');}),/API key/);assert.equal(failedCalls,1);
  console.log(`PASS: ${checks} extraction/engine cases; 19 document types, 9 image formats, 4 engines × 15 providers × text/vision, 32 C0 text/binary checks, drop IPC, mixed/duplicate drops, invalid paths, original bytes, persistence, deletion, isolation, scanned PDF, corrupt files and context limits. Inference intercepted; no paid calls.`);
} finally { load('electron/db/database.ts').closeDb(); fs.rmSync(scratch,{recursive:true,force:true}); }
