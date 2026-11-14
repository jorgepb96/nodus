import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const languages = ['es', 'en', 'fr', 'de', 'pt', 'pt-BR', 'it', 'tr', 'zh-Hans', 'zh-Hant', 'vi', 'ja', 'ru', 'uk', 'ko'];
const require = createRequire(import.meta.url);
const read = (name) => fs.readFileSync(path.join(root, name), 'utf8');

async function load(entry, label) {
  const outfile = path.join(os.tmpdir(), `nodus-${label}-${process.pid}.cjs`);
  await build({ entryPoints: [path.join(root, entry)], bundle: true, platform: 'node', format: 'cjs', outfile, logLevel: 'silent' });
  try { return require(outfile); } finally { fs.rmSync(outfile, { force: true }); }
}

test('all native graph prompt packs preserve contracts in all eight locales', async () => {
  const graph = await load('shared/graphPromptPacks.ts', 'graph-packs');
  const tutor = await load('shared/tutorPromptPacks.ts', 'tutor-packs');
  const study = await load('shared/studyImprove.ts', 'study-packs');
  for (const language of languages) {
    const argument = graph.argumentMapPrompt(language);
    const bridges = graph.semanticBridgePrompt(language);
    const tutorPlan = tutor.tutorPlanPrompt(language);
    const tutorStep = tutor.tutorStepPrompt(language);
    const studyPack = study.studyImprovePromptPack(language);
    for (const field of ['ideaId', 'overview', 'root', 'children', 'relation', 'supports', 'refutes', 'related']) assert.match(argument, new RegExp(field));
    for (const field of ['relations', 'from', 'to', 'type', 'confidence', 'rationale', 'extends', 'contradicts', 'refines']) assert.match(bridges, new RegExp(field));
    for (const field of ['overview', 'routes', 'title', 'description', 'weight', 'weightLabel', 'themes', 'stops', 'kind', 'nodeIds', 'edgeId']) assert.match(tutorPlan, new RegExp(field));
    for (const field of ['cierre_previo_para_contexto', 'Markdown']) assert.match(tutorStep, new RegExp(field));
    for (const field of ['role', 'mustReturn', 'preserve', 'noInvent', 'faithful', 'free', 'styleHeader', 'outputLanguage']) assert.ok(studyPack[field], `${language} study pack missing ${field}`);
    assert.ok(studyPack.conflictInstruction && studyPack.sameOriginal, `${language} study pack is missing locale-specific conflict/output fallback copy`);
  }
  assert.match(graph.argumentMapPrompt('en'), /You are Nodus/);
  assert.match(graph.semanticBridgePrompt('tr'), /Nodus'un/);
  assert.match(tutor.tutorStepPrompt('fr'), /Tutor de Nodus/);
});

test('non-Spanish runtime prompts do not retain legacy Spanish/English fallback prose', async () => {
  const graph = await load('shared/graphPromptPacks.ts', 'graph-packs-runtime');
  const tutor = await load('shared/tutorPromptPacks.ts', 'tutor-packs-runtime');
  const study = await load('shared/studyImprove.ts', 'study-packs-runtime');
  for (const language of languages.filter((value) => value !== 'es')) {
    const prompts = [
      graph.argumentMapPrompt(language),
      graph.semanticBridgePrompt(language),
      tutor.tutorPlanPrompt(language),
      tutor.tutorStepPrompt(language),
      study.studyImprovePromptPack(language),
    ];
    const text = prompts.slice(0, 4).join('\n');
    assert.doesNotMatch(text, /Eres el (cartógrafo|Tutor)|motor de descubrimiento semántico|SALIDA: EXCLUSIVAMENTE JSON/i, language);
    if (language !== 'en') assert.doesNotMatch(text, /OUTPUT: ONLY VALID JSON/i, `${language} retained English schema prose`);
    const pack = study.studyImprovePromptPack(language);
    if (language !== 'en') assert.doesNotMatch(`${pack.conflictInstruction} ${pack.sameOriginal}`, /If a style instruction conflicts|the same as the original/i, `${language} retained English study fallback`);
  }
});

test('prompt consumers resolve the explicit request language before calling the native pack', () => {
  assert.match(read('electron/ai/studyImprove.ts'), /request\.promptLanguage \?\? aiSettings\.promptLanguage/);
  assert.match(read('shared/studyImprovementGeneration.ts'), /studyImprovePromptPack\(language\)/);
  assert.match(read('electron/ai/studyImprove.ts'), /prepareStudyImprovement\(request, style, promptLanguage\)/);
  assert.match(read('electron/ai/tutor.ts'), /tutorPlanPrompt\(language, mode\)/);
  assert.match(read('electron/ai/tutor.ts'), /tutorStepPrompt\(request\.language \?\? getSettings\(\)\.promptLanguage/);
  assert.match(read('electron/ai/argumentMap.ts'), /argumentMapPrompt\(language\)/);
  assert.match(read('electron/ai/semanticBridges.ts'), /semanticBridgePrompt\(language\)/);
  assert.match(read('src/views/TutorPanel.tsx'), /language: settings\.promptLanguage/);
  assert.match(read('src/views/ArgumentMapView.tsx'), /language: settings\.promptLanguage/);
});

test('assessment, author, and chapter prompts have complete native packs and locale wiring', async () => {
  const packs = await load('shared/academicPromptPacks.ts', 'academic-packs');
  for (const language of languages) {
    const assessment = packs.assessmentPromptPack(language);
    assert.match(assessment.system, /items/);
    for (const marker of ['weight', 'minToAverage', 'isMandatory', 'evidence', 'children', 'notes']) assert.match(assessment.system, new RegExp(marker));
    const author = packs.authorPromptPack(language);
    for (const marker of ['thesis', 'remember', 'positioning', '3', '6']) assert.match(author.system, new RegExp(marker));
    const chapter = packs.chapterPromptPack(language);
    for (const marker of ['ideas', 'claim', 'finding', 'construct', 'method', 'framework', 'relations', 'chapterIdeaId', 'targetKind', 'targetId', 'confidence', 'rationale']) {
      assert.match(`${chapter.extract}\n${chapter.type}`, new RegExp(marker), `${language} chapter contract missing ${marker}`);
    }
    assert.ok(author.ideaTypes.claim && author.relationTypes.supports, `${language} author labels incomplete`);
  }
  assert.match(read('electron/ai/assessmentImport.ts'), /request\.language \?\? getSettings\(\)\.promptLanguage/);
  assert.match(read('electron/ai/assessmentImport.ts'), /assessmentPromptPack\(language\)/);
  assert.match(read('electron/ai/authorDossier.ts'), /authorPromptPack\(promptLanguage\)/);
  assert.match(read('electron/ai/chapterIdeas.ts'), /request\.language \?\? getSettings\(\)\.promptLanguage/);
  assert.match(read('electron/ai/chapterIdeas.ts'), /chapterPromptPack\(language\)\.extract/);
  assert.match(read('electron/ai/chapterIdeas.ts'), /chapterPromptPack\(language\)\.type/);
});

test('dictionary, document profile, folder and gap prompts are native and preserve schemas', async () => {
  const packs = await load('shared/academicPromptPacks.ts', 'resource-packs');
  for (const language of languages) {
    const dictionary = packs.dictionaryPromptPack(language);
    const dictionaryScaffold = packs.dictionaryScaffoldPack(language);
    for (const marker of ['paragraphs', 'claims', 'text', 'evidence', 'kind', 'idea|passage', 'authorSummaries']) assert.match(`${dictionary.system}\n${dictionary.authorSystem}`, new RegExp(marker), `${language} dictionary contract missing ${marker}`);
    for (const marker of ['none', 'authors', 'verifiedDescription', 'retryInvalidJson', 'retryReturnObject', 'retryShorten']) assert.ok(dictionaryScaffold[marker], `${language} dictionary scaffold missing ${marker}`);
    const profile = packs.documentProfilePromptPack(language);
    for (const marker of ['title', 'summary', 'claims', 'support_quote', 'source_language', 'fields', 'field_fixes', 'passed', 'confidence', 'centrality', 'hypothesis', 'finding']) assert.match(Object.values(profile).join('\n'), new RegExp(marker), `${language} document profile contract missing ${marker}`);
    const folder = packs.folderPromptPack(language);
    for (const marker of ['selected', 'id', 'reason', 'score']) assert.match(folder.system, new RegExp(marker), `${language} folder contract missing ${marker}`);
    const gap = packs.gapPromptPack(language);
    for (const marker of ['keywords', 'queries']) assert.match(gap.system, new RegExp(marker), `${language} gap contract missing ${marker}`);
  }
  assert.match(read('shared/dictionaryGenerationCore.ts'), /dictionaryPromptPack\(/);
  assert.match(read('electron/ai/dictionary.ts'), /generateDictionaryDefinition\(entry, evidence/);
  assert.match(read('shared/dictionaryGenerationCore.ts'), /dictionaryScaffoldPack\(/);
  assert.match(read('electron/ai/documentProfile.ts'), /documentProfilePromptPack\(/);
  assert.match(read('electron/ai/folderIdeaSuggestions.ts'), /folderPromptPack\(language\)/);
  assert.match(read('electron/ai/gapSearch.ts'), /gapPromptPack\(language\)/);
});

test('document profile preserves the full finding, audit, and repair contract in every locale', async () => {
  const packs = await load('shared/academicPromptPacks.ts', 'profile-finding-contract');
  const requirements = {
    es: [/MISMA sección/, /INVENTARIO OBLIGATORIO/, /Hechos narrativos o históricos/, /patrón cualitativo o descubrimiento archivístico/, /cantidad es señal de cobertura/, /CADA finding/, /cantidad, contraste o condición central perdida/, /circunstancias del objeto como limitation/, /prueba de tres condiciones/, /subcadena literal continua/],
    en: [/THE SAME section/, /MANDATORY INVENTORY/, /Narrative or historical facts/, /qualitative pattern or archival discovery/, /quantity signals coverage, not type/, /EACH finding/, /central quantity, contrast, or condition lost/, /circumstances of the subject as limitation/, /three-condition test/, /continuous literal substring/],
    fr: [/LA MÊME section/, /INVENTAIRE OBLIGATOIRE/, /faits narratifs ou historiques/i, /motif qualitatif ou une découverte archivistique/, /quantité signale la couverture/, /CHAQUE finding/, /quantité, tout contraste ou toute condition centrale perdus/, /circonstances de l’objet classées comme limitation/, /test des trois conditions/, /sous-chaîne littérale continue/],
    de: [/DERSELBEN Sektion/, /VERBINDLICHES INVENTAR/, /Narrative oder historische Fakten/, /qualitatives Muster oder ein Archivfund/, /Zahl ist ein Abdeckungssignal/, /JEDES finding/, /zentrale Menge, jeden Kontrast oder jede Bedingung/, /Umstände des Gegenstands als limitation/, /Drei-Bedingungen-Test/, /zusammenhängende wörtliche Teilzeichenfolge/],
    pt: [/MESMA secção/, /INVENTÁRIO OBRIGATÓRIO/, /Factos narrativos ou históricos/, /padrão qualitativo ou uma descoberta de arquivo/, /quantidade é sinal de cobertura/, /CADA finding/, /quantidade, contraste ou condição central perdida/, /circunstâncias do objeto como limitation/, /teste das três condições/, /subcadeia literal contínua/],
    'pt-BR': [/MESMA seção/, /INVENTÁRIO OBRIGATÓRIO/, /Fatos narrativos ou históricos/, /padrão qualitativo ou uma descoberta de arquivo/, /quantidade é sinal de cobertura/, /CADA finding/, /quantidade, contraste ou condição central perdida/, /circunstâncias do objeto como limitation/, /teste das três condições/, /substring literal contínua/],
    it: [/STESSA sezione/, /INVENTARIO OBBLIGATORIO/, /Fatti narrativi o storici/, /pattern qualitativo o una scoperta archivistica/, /quantità segnala copertura/, /OGNI finding/, /quantità, contrasto o condizione centrale persa/, /circostanze dell’oggetto come limitation/, /test delle tre condizioni/, /sottostringa letterale continua/],
    tr: [/AYNI bölüm/, /ZORUNLU ENVANTER/, /anlatısal veya tarihsel olgular/, /Nitel bir örüntü veya arşiv keşfi/, /miktar bir kapsam sinyalidir/, /HER finding/, /merkezi miktarı, karşılaştırmayı veya koşulu/, /limitation olarak sınıflandırılmış nesne koşullarını/, /üç koşullu testi/, /kesintisiz ve kelimesi kelimesine alt dizesi/],
  };
  const invariantProfileTokens = ['hypothesis', 'finding', 'conclusion', 'argument', 'question', 'thesis', 'genre', 'audience', 'role', 'claims'];
  const invariantAuditTokens = ['hypothesis', 'finding', 'conclusion', 'argument', 'question', 'limitation', 'genre', 'audience', 'claims'];
  for (const language of languages) {
    const profile = packs.documentProfilePromptPack(language);
    for (const token of invariantProfileTokens) assert.ok(profile.profile.includes(token), `${language} profile: missing ${token}`);
    for (const token of invariantAuditTokens) assert.ok(profile.audit.includes(token), `${language} audit: missing ${token}`);
    assert.match(profile.repair, /support_quote/);
    if (!requirements[language]) continue;
    for (const [index, pattern] of requirements[language].entries()) {
      const value = index < 5 ? profile.profile : index < 8 ? profile.audit : profile.repair;
      assert.match(value, pattern, `${language} document-profile semantic rule ${index + 1} missing`);
    }
  }
});

test('dictionary prompts preserve every semantic rule in every locale', async () => {
  const packs = await load('shared/academicPromptPacks.ts', 'dictionary-semantic-parity');
  const requirements = {
    es: [
      /ÍNDICE DE COBERTURA.*toda EVIDENCE/, /cantidad de pasajes.*importancia/, /fragmentos contiguos o repetitivos/,
      /varios autores u obras.*aportaciones sustantivas/, /una sola fuente monopolice/, /simetría artificial.*relevancia/,
      /Nombra al autor.*definición.*cita la evidencia/, /afirmación atómica independiente/, /cláusulas diferentes.*afirmaciones separadas/,
      /varias evidencias.*CADA una.*toda la afirmación/, /posición atribuida a cada autor.*solo después.*comparativa/,
      /acuerdos, desacuerdos, contradicciones y cambios temporales/, /límites de la evidencia/, /Markdown ni citas dentro de text/,
      /JSON válido.*forma exacta.*paragraphs.*claims.*kind.*idea\|passage.*id.*EVIDENCE/
    ],
    en: [
      /complete COVERAGE INDEX.*all EVIDENCE/, /number of passages.*importance/, /contiguous or repetitive fragments/,
      /several authors or works.*substantive contributions/, /source from monopolizing/, /artificial symmetry.*relevance/,
      /Name the author.*definition.*cite the specific evidence/, /independent atomic claim/, /different clauses.*separate claims/,
      /multiple evidence.*EACH one.*whole claim/, /position attributed to each author separately.*only then.*comparative/,
      /agreements, disagreements, contradictions, and temporal changes/, /limits of the evidence/, /Markdown or citations inside text/,
      /valid JSON.*exact form.*paragraphs.*claims.*kind.*idea\|passage.*id.*EVIDENCE/
    ],
    fr: [
      /INDEX DE COUVERTURE.*toute EVIDENCE/, /nombre de passages.*importance/, /fragments contigus ou répétitifs/,
      /plusieurs auteurs ou œuvres.*contributions substantielles/, /source de monopoliser/, /symétrie artificielle.*pertinence/,
      /Nommez l’auteur.*définition.*citez la preuve/, /affirmation atomique indépendante/, /clauses différentes.*affirmations séparées/,
      /plusieurs preuves.*CHACUNE.*toute l’affirmation/, /position attribuée.*séparément.*seulement.*comparat/,
      /accords, désaccords, contradictions et évolutions temporelles/, /limites des preuves/, /Markdown ni citations dans text/,
      /JSON valide.*forme exacte.*paragraphs.*claims.*kind.*idea\|passage.*id.*EVIDENCE/
    ],
    de: [
      /vollständigen DECKUNGSINDEX.*alle EVIDENCE/, /Anzahl.*Passagen.*Bedeutung/, /zusammenhängende oder repetitive Fragmente/,
      /mehreren Autoren oder Werken.*substanzielle Beiträge/, /Quelle.*monopolisiert/, /künstliche Symmetrie.*Relevanz/,
      /Nennen Sie den Autor.*Definition.*Beleg/, /unabhängige atomare Aussage/, /unterschiedliche Klauseln.*getrennte Aussagen/,
      /mehrere Belege.*JEDER.*gesamte Aussage/, /Position.*getrennt.*erst danach.*Vergleichsaussage/,
      /Übereinstimmungen, Meinungsverschiedenheiten, Widersprüche und zeitliche Veränderungen/, /Grenzen der Belege/, /kein Markdown.*Zitate in text/,
      /gültiges JSON.*exakten Form.*paragraphs.*claims.*kind.*idea\|passage.*id.*EVIDENCE/
    ],
    pt: [
      /ÍNDICE DE COBERTURA.*toda a EVIDENCE/, /quantidade de passagens.*importância/, /fragmentos contíguos ou repetitivos/,
      /vários autores ou obras.*contributos substanciais/, /fonte monopolize/, /simetria artificial.*relevância/,
      /Nomeia o autor.*definição.*cita a evidência/, /afirmação atómica independente/, /cláusulas diferentes.*afirmações separadas/,
      /várias evidências.*CADA uma.*afirmação inteira/, /posição atribuída a cada autor.*só depois.*comparativa/,
      /acordos, desacordos, contradições e mudanças temporais/, /limites da evidência/, /Markdown nem citações dentro de text/,
      /JSON válido.*forma exata.*paragraphs.*claims.*kind.*idea\|passage.*id.*EVIDENCE/
    ],
    'pt-BR': [
      /ÍNDICE DE COBERTURA.*toda a EVIDENCE/, /quantidade de passagens.*importância/, /fragmentos contíguos ou repetitivos/,
      /vários autores ou obras.*contribuições substantivas/, /fonte monopolize/, /simetria artificial.*relevância/,
      /Nomeie o autor.*definição.*cite a evidência/, /afirmação atômica independente/, /cláusulas diferentes.*afirmações separadas/,
      /várias evidências.*CADA uma.*toda a afirmação/, /posição atribuída a cada autor.*somente depois.*comparativa/,
      /acordos, desacordos, contradições e mudanças temporais/, /limites da evidência/, /Markdown nem citações dentro de text/,
      /JSON válido.*forma exata.*paragraphs.*claims.*kind.*idea\|passage.*id.*EVIDENCE/
    ],
    it: [
      /INDICE DI COPERTURA.*tutta EVIDENCE/, /numero di passaggi.*importanza/, /frammenti contigui o ripetitivi/,
      /più autori o opere.*contributi sostanziali/, /fonte monopolizzi/, /simmetria artificiale.*rilevanza/,
      /Nomina l’autore.*definizione.*cita la prova/, /affermazione atomica indipendente/, /clausole diverse.*affermazioni separate/,
      /più prove.*OGNUNA.*intera affermazione/, /posizione attribuita.*solo dopo.*comparativa/,
      /accordi, disaccordi, contraddizioni e cambiamenti temporali/, /limiti delle prove/, /Markdown né citazioni dentro text/,
      /JSON valido.*forma esatta.*paragraphs.*claims.*kind.*idea\|passage.*id.*EVIDENCE/
    ],
    tr: [
      /KAPSAM DİZİNİ’nin tamamı.*tüm EVIDENCE/, /pasajların sayısı.*önemini/, /bitişik veya tekrarlı parça/,
      /birden çok yazar veya eserden.*esaslı katkıyı/, /kaynağın açıklamayı tekeline/, /Yapay simetri.*ilgisi/,
      /(?=.*yazarı adlandırın)(?=.*tanım)(?=.*özgül kanıtı)/, /bağımsız atomik.*iddia/, /farklı.*cümlecikleri.*ayrı iddialar/,
      /birden çok kanıtı.*HER BİRİ.*iddianın tamamını/, /her yazara atfedilen konumu.*ayrı ayrı.*ancak bundan sonra.*karşılaştırmalı/,
      /Anlaşmaları, anlaşmazlıkları, çelişkileri ve zamansal değişimleri/, /kanıtın sınırlarını/, /text içinde Markdown veya alıntı/,
      /(?=.*geçerli JSON)(?=.*kesin biçimde).*paragraphs.*claims.*kind.*idea\|passage.*id.*EVIDENCE/
    ]
  };
  for (const language of languages) {
    const dictionary = packs.dictionaryPromptPack(language);
    if (requirements[language]) for (const [index, pattern] of requirements[language].entries()) assert.match(dictionary.system, new RegExp(pattern.source, `${pattern.flags}i`), `${language} dictionary semantic rule ${index + 1} missing`);
    assert.match(dictionary.authorSystem, /EVIDENCE.*AUTHORS/);
    assert.match(dictionary.authorSystem, /(?=.*(?:document|dokument|belgelenmiş|文献|文獻|文档|文書|tư liệu|tài liệu|ghi nhận|ghi chép|документ|документальн|засвідч|зафиксиров|문서|문헌|記録|기록|有据可查|有據可查))(?=.*(?:aportación|contribution|contributo|apport|Beitrag|contribuição|katkı|贡献|貢獻|貢献|đóng góp|вклад|внесок|기여))/i);
    assert.match(dictionary.authorSystem, /(?=.*Markdown[- ]nodus:\/\/)(?=.*(?:exactly|exactement|exactamente|exakt|exatamente|esattamente|aynen|精确|精確|正確|정확|точно|точн|chính xác))/i);
    assert.match(dictionary.authorSystem, /authorSummaries.*authorName.*summaryMarkdown/);
    assert.match(dictionary.system, /\{"paragraphs":\[\{"claims":\[\{"text":.*"evidence":\[\{"kind":"idea\|passage","id":/);
    assert.match(dictionary.authorSystem, /\{"authorSummaries":\[\{"authorName":.*"summaryMarkdown":/);
    assert.match(dictionary.authorSystem, /nodus:\/\//);
  }
});
