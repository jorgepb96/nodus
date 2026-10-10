import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const [
  view,
  corpus,
  navigation,
  authors,
  ai,
  academicIpc,
  generationQueue,
  preload,
  promptPresets,
  dictionaryI18n,
  viewSnapshots,
  academicPrompts,
] =
  await Promise.all([
    readFile(path.join(root, "src/views/DictionaryView.tsx"), "utf8"),
    readFile(path.join(root, "src/app/views/corpus.tsx"), "utf8"),
    readFile(path.join(root, "src/navigation.ts"), "utf8"),
    readFile(path.join(root, "src/views/AuthorsView.tsx"), "utf8"),
    Promise.all([readFile(path.join(root, "electron/ai/dictionary.ts"), "utf8"), readFile(path.join(root, "shared/dictionaryGenerationCore.ts"), "utf8")]).then(files => files.join("\n")),
    readFile(path.join(root, "electron/ipc/academic.ts"), "utf8"),
    readFile(
      path.join(root, "electron/ai/dictionaryGenerationQueue.ts"),
      "utf8",
    ),
    readFile(path.join(root, "electron/preload/academic.ts"), "utf8"),
    readFile(path.join(root, "shared/dictionaryPromptPresets.ts"), "utf8"),
    readFile(path.join(root, "src/i18n.dictionary.ts"), "utf8"),
    readFile(path.join(root, "src/app/viewSnapshots.ts"), "utf8"),
    readFile(path.join(root, "shared/academicPromptPacks.ts"), "utf8"),
  ]);

assert.match(
  navigation,
  /id: 'dictionary'[\s\S]*group: 'analyze'/,
  "Dictionary sits in the Analyse group",
);
assert.match(
  corpus,
  /dictionary:[\s\S]*<DictionaryView/,
  "Dictionary is registered as an internal view",
);
assert.match(
  corpus,
  /snapshot=\{snapshots\.read\('dictionary'\)\}[\s\S]*onSnapshotChange=\{\(patch\) => snapshots\.patch\('dictionary', patch\)\}/,
  "Dictionary participates in the shared per-vault view snapshot store",
);
assert.match(
  viewSnapshots,
  /export interface DictionarySnapshot[\s\S]*openEntries: OpenEntityTab\[\][\s\S]*activeEntryId: string \| null[\s\S]*detailTabs: Record<string, DictionaryDetailTab>/,
  "Dictionary remembers its open entries, active entry and inner tabs",
);
assert.match(
  view,
  /WorkspaceTabStrip/,
  "entries use the existing internal-tab strip",
);
assert.match(
  view,
  /bg-white text-neutral-900 dark:bg-neutral-950 dark:text-neutral-100/,
  "Dictionary supports the existing light and dark themes",
);
assert.match(
  view,
  /DictionaryRows/,
  "the overview uses an Ideas-style row list",
);
assert.match(
  view,
  /<ConfirmModal/,
  "destructive actions use the app confirmation modal",
);
assert.doesNotMatch(
  view,
  /window\.confirm/,
  "Dictionary never opens a native confirmation window",
);
assert.doesNotMatch(
  view,
  /md:grid-cols-2 2xl:grid-cols-3/,
  "the overview no longer renders a card grid",
);
assert.match(
  view,
  /input input-with-leading-icon/,
  "search fields use the shared leading-icon padding",
);
assert.match(
  view,
  /useFeatureModel\(settings, ["']dictionaryModel["']\)/,
  "Dictionary persists an independent model selection",
);
assert.match(
  view,
  /<ModelPicker/,
  "Dictionary exposes the shared saved-model picker",
);
assert.match(
  view,
  /data-testid="dictionary-prompt-preset"/,
  "new entries expose a prompt preset selector",
);
assert.match(
  view,
  /data-testid="dictionary-focus-prompt"/,
  "the selected preset remains editable",
);
assert.match(
  view,
  /setPromptPreset\(matching\?\.id \?\? "custom"\)/,
  "editing a preset prompt switches the selector to Custom",
);
assert.match(
  view,
  /focusPrompt: t\([\s\S]*dictionaryPromptPresetOption\(DEFAULT_DICTIONARY_PROMPT_PRESET\)\.prompt/,
  "the basic definition-and-authors prompt is the translated default",
);
assert.match(
  navigation,
  /id: 'dictionary', label: 'Diccionario'/,
  "the sidebar uses the Spanish translation key for the section name",
);
assert.match(
  view,
  /t\("Diccionario"\)[\s\S]*tx\("Diccionario \(\{n\}\)"/,
  "the Dictionary header and home tab use the translated section name",
);
for (const id of [
  "basic",
  "historical",
  "debate",
  "genealogy",
  "applications",
  "critical",
]) {
  assert.match(
    promptPresets,
    new RegExp(`id: ["']${id}["']`),
    `Dictionary includes the ${id} prompt preset`,
  );
}
const translatedPromptKeys = [
  "Preconfiguración del prompt",
  "Escribe o adapta libremente las instrucciones para la síntesis.",
  "Básico · definición y autores",
  "Evolución histórica",
  "Debate entre autores",
  "Genealogía teórica",
  "Usos y aplicaciones",
  "Lectura crítica",
];
for (const key of translatedPromptKeys) {
  const occurrences = dictionaryI18n.split(key).length - 1;
  assert.ok(
    occurrences >= 7,
    `${key} is translated for all seven non-Spanish interface languages`,
  );
}
assert.match(
  view,
  /onCitation=\{onCitation\}/,
  "inline citations are interactive",
);
assert.match(
  view,
  /onOpenIdea\(item\.id\)/,
  "evidence can navigate to its idea",
);
assert.match(
  view,
  /onOpenAuthor\(author\.id, author\.name\)/,
  "related authors navigate to Authors",
);
assert.match(
  authors,
  /showAuthor\(\{ id: target\.authorId, label: target\.name \}\)/,
  "Authors consumes external tab targets",
);
assert.match(
  view,
  /onOpenLibraryWork\(work\.id\)/,
  "works open in Nodus Library",
);
assert.match(
  view,
  /window\.nodus\.openInZotero/,
  "valid Zotero references use the existing opener",
);
assert.match(
  view,
  /readDictionaryCatalogue\(request => window\.nodus\.listDictionaryEntries\(request\), \{[\s\S]*?query,[\s\S]*?letter:[\s\S]*?sort:/,
  "overview sends search, filters and sorting through IPC",
);
assert.match(view, /updateDictionaryEntry/, "manual editing is wired");
assert.match(
  view,
  /scanDictionaryNewEvidence/,
  "new-evidence detection is user controllable",
);
assert.match(
  view,
  /grid-cols-\[minmax\(0,1fr\)_minmax\(118px,0\.58fr\)_minmax\(118px,0\.58fr\)\][\s\S]*busy === "scan"/,
  "the three entry actions share one stable aligned grid",
);
assert.match(
  view,
  /const regenerationBusy =[\s\S]*backgroundBusy[\s\S]*DictionaryGenerationState/,
  "regeneration keeps visible progress after the enqueue IPC returns",
);
assert.match(
  view,
  /const updateBusy =[\s\S]*progress\?\.mode === "update"[\s\S]*updateBusy \?/,
  "update owns its own persistent busy feedback",
);
assert.match(
  view,
  /setTab\(generation === "update" \? "versions" : "overview"\)/,
  "regeneration returns to the regenerated description",
);
assert.match(
  view,
  /generate\(["']update["']\)/,
  "Update is separate from regeneration",
);
assert.match(
  view,
  /startDictionaryGeneration\(\{/,
  "creation starts the automatic background pipeline without an evidence-review gate",
);
assert.equal(
  (view.match(/startDictionaryGeneration\(\{/g) ?? []).length,
  2,
  "creation, regeneration and update all enter the main-process background pipeline",
);
assert.match(
  view,
  /data-testid="dictionary-add-concept"/,
  "the creation dialog can add more concepts to a batch",
);
assert.match(
  view,
  /Promise\.allSettled\([\s\S]*batch\.map[\s\S]*startDictionaryGeneration/,
  "all concepts are persisted and queued independently without one failure cancelling the batch",
);
assert.match(
  view,
  /if \(!queuedDrafts\.has\(draft\.key\)\)[\s\S]*startDictionaryGeneration[\s\S]*setQueuedDrafts/,
  "retrying a partial batch does not generate entries that were already queued successfully",
);
assert.match(
  view,
  /new Set\(names\)\.size !== names\.length/,
  "a batch rejects duplicate normalized concept names before persisting them",
);
assert.doesNotMatch(
  view,
  /window\.nodus\.generateDictionaryEntry/,
  "no Dictionary generation is owned by a disposable renderer view",
);
assert.match(
  view,
  /listDictionaryGenerationJobs\(\)/,
  "Dictionary rehydrates background job progress when the view remounts",
);
assert.match(
  view,
  /jobs\s*\.filter\(\(job\) => job\.phase !== ["']done["']\)/,
  "a completed job does not permanently cover the entry lifecycle status after remounting",
);
assert.match(
  view,
  /progress\.phase === ["']done["'][\s\S]*reload\(false\)\.then\(\(reloaded\)[\s\S]*next\.delete\(progress\.entryId\)/,
  "the generated confirmation yields to the saved Active status after a successful reload",
);
assert.match(
  view,
  /progress\.phase === ["']done["'] && status !== ["']draft["'][\s\S]*<StatusPill status=\{status\}/,
  "stale successful progress cannot replace an already-persisted lifecycle status",
);
assert.match(
  view,
  /const hasEvidence = detail\.coverage\.included > 0/,
  "generation eligibility uses the live included selection, not a nonexistent draft version",
);
assert.match(
  view,
  /backgroundFailure && <ErrorNotice>/,
  "a failed background generation exposes the backend reason in the entry",
);
assert.match(
  view,
  /onDictionaryProgress/,
  "the overview subscribes to background generation progress",
);
assert.match(
  view,
  /Icon name="refresh"[\s\S]*animate-spin/,
  "the status column renders an animated generation indicator",
);
assert.match(
  academicIpc,
  /new DictionaryGenerationQueue\([\s\S]*generateDictionaryEntry\(request, report\)/,
  "the background queue runs the shared Dictionary investigation and synthesis",
);
assert.match(
  ai,
  /await investigateDictionaryEvidence\(resolved\)/,
  "explicit generation investigates the authorized corpus before writing",
);
assert.match(
  academicIpc,
  /dictionary:generate:jobs[\s\S]*dictionaryGenerationJobs\.list\(\)/,
  "the main process exposes running and completed jobs for view reconnection",
);
assert.match(
  generationQueue,
  /const execute = this\.bindExecution\(\(\) => this\.#run\(request, token\)\)[\s\S]*setImmediate\(\(\) => \{ void execute\(\)/,
  "every entry gets its own independently scheduled background execution",
);
assert.match(
  generationQueue,
  /#tokens[\s\S]*delete\(entryIds[\s\S]*#tokens\.delete/,
  "deleting an entry invalidates its running job so stale progress cannot return",
);
assert.match(
  preload,
  /listDictionaryGenerationJobs: \(\) => ipcRenderer\.invoke\('dictionary:generate:jobs'\)/,
  "the renderer can reconnect to Dictionary jobs after changing views",
);
assert.match(
  preload,
  /failureDetail[\s\S]*throw new Error\(result\.failureDetail\)/,
  "synchronous regeneration preserves the real backend failure detail",
);
assert.match(
  view,
  /mode: "creation"/,
  "the automatic creation result is saved as the initial applied version",
);
assert.match(
  view,
  /<ButtonBusy[\s\S]*tx\("Preparando \{n\} definiciones…"/,
  "batch creation closes after preparing all persisted background jobs",
);
assert.match(
  view,
  /className="btn btn-primary !text-white disabled:!text-white"/,
  "primary generation controls retain white text in every theme",
);
assert.match(
  view,
  /restoreDictionaryVersion/,
  "version restoration is available",
);
assert.match(
  ai,
  /return saveDictionaryVersion\(await generateDictionaryDefinition\(/,
  "the owning vault saves only after the shared generation and verification core completes",
);
assert.match(
  view,
  /La versión anterior se conserva/,
  "a degraded generation reports that the previous version is preserved",
);
assert.match(
  ai,
  /const maxAttempts = 3/,
  "generation makes an initial attempt plus two bounded automatic retries",
);
assert.match(
  ai,
  /findSimilarIdeasPaged\(vector,[\s\S]*nodusIds: scope\.ids/,
  "retrieval reuses scoped Deep Research idea embeddings",
);
assert.match(
  ai,
  /findSimilarPassagesPaged\([\s\S]*?vector,[\s\S]*?nodusIds: scope\.ids/,
  "retrieval reuses scoped Deep Research passage embeddings",
);
assert.match(
  ai,
  /FROM edges e JOIN ideas related/,
  "automatic retrieval enriches idea evidence with existing graph relations",
);
assert.match(
  ai,
  /Relación almacenada en el grafo:/,
  "stored relations are supplied to the synthesis as evidence",
);
assert.match(
  ai,
  /selectedIdeas < DICTIONARY_SELECTION_LIMITS\.ideas[\s\S]*selectedPassages < DICTIONARY_SELECTION_LIMITS\.passages/,
  "initial retrieval automatically selects a bounded, source-balanced set of ideas and passages",
);
assert.match(
  ai,
  /dictionaryPromptPack\([\s\S]*copy\.system/,
  "Dictionary synthesis resolves its locale-specific native prompt pack",
);
assert.match(
  academicPrompts,
  /cantidad de pasajes recuperados[\s\S]*no mide por sí sola la importancia/,
  "Dictionary native prompt keeps the rule that repeated passages do not determine author importance",
);
assert.match(
  ai,
  /structuredDictionaryCoverageProblems/,
  "Dictionary synthesis validates multi-source coverage before persistence",
);
assert.match(
  ai,
  /applyCitationPolicy[\s\S]*extractCitationClaims[\s\S]*aiVerifyCitations/,
  "generation reuses Deep Research citation validation",
);
assert.match(
  ai,
  /copy\.noEvidenceError/,
  "an empty automatic retrieval fails explicitly without inventing content",
);
assert.doesNotMatch(
  ai,
  /SELECT type,label,statement,created_at,updated_at FROM ideas/,
  "retrieval never queries a nonexistent ideas.updated_at column",
);

console.log("test-dictionary-ui: OK");
