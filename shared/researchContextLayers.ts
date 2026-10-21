import type { ResearchContextLayers, ResearchContextSelection } from './types';

/*
 * The context balloon offers layers, not sections. A layer maps onto the sections the
 * retrieval already understands, so every path that reads sections (the vaults without
 * a documentary corpus) keeps working unchanged, while the academic corpus run reads
 * the layers themselves.
 */

/** The corpus layers a turn reads, every one decided. The web is the composer's own state. */
export type ResearchCorpusLayers = { ideas: boolean; documents: boolean; indexed: boolean };
export type ResearchCorpusLayer = keyof ResearchCorpusLayers;

/** The layers a selection chooses. One saved before layers existed is read from its sections;
 * in an academic vault its documents were always read, so they stay on. One saved before the
 * indexed texts had a switch of their own searched them with the documents layer, and 5.12.0's
 * exclusive indexed-texts mode reads as that switch alone. Full documents build on the indexed
 * texts, so they never come without them. */
export function researchContextLayers(selection: ResearchContextSelection, academic = false): ResearchCorpusLayers {
  const saved = selection.layers;
  if (saved?.indexedOnly) return { ideas: false, documents: false, indexed: true };
  if (saved) return { ideas: !!saved.ideas, documents: !!saved.documents, indexed: !!saved.documents || !!(saved.indexed ?? saved.documents) };
  const documents = academic || selection.documents || selection.passages !== false;
  return {
    ideas: selection.ideas || selection.themes || selection.contradictions || selection.gaps || selection.readingPath || selection.authors || selection.graph,
    documents, indexed: documents,
  };
}

/** The chat's web choice: its own when it made one, off in 5.12.0's exclusive mode (which never
 * read the web), and otherwise the composer's saved setting. */
export function researchContextWeb(selection: ResearchContextSelection, savedSetting: boolean): boolean {
  return selection.layers?.web ?? (selection.layers?.indexedOnly ? false : savedSetting);
}

/** A selection choosing exactly these layers, with its sections set to match: the indexed texts
 * are the passages, full documents the document section. The chat's web choice is kept, or set
 * when `web` is given. */
export function withResearchContextLayers(selection: ResearchContextSelection, layers: ResearchContextLayers): ResearchContextSelection {
  // Choosing a layer manually leaves the temporary pause and uses that new choice.
  const { contextBeforePause: _contextBeforePause, ...current } = selection;
  const { ideas, documents, indexed } = researchContextLayers({ ...selection, layers });
  const web = layers.web ?? selection.layers?.web ?? (layers.indexedOnly || selection.layers?.indexedOnly ? false : undefined);
  return {
    ...current,
    layers: { ideas, documents, indexed, ...(web === undefined ? {} : { web }) },
    ideas, themes: ideas, contradictions: ideas, gaps: ideas, readingPath: ideas, authors: ideas, graph: ideas,
    graphParts: { ideaNodes: ideas, themeNodes: ideas, ideaEdges: ideas, authorGraph: ideas },
    documents, passages: indexed,
  };
}

/** Pause every source without changing the saved web preference or losing individual sections,
 * source filters and notebook scope. The snapshot travels with drafts, queued turns and chats. */
export function toggleResearchContext(selection: ResearchContextSelection, webEnabled: boolean, academic = false): ResearchContextSelection {
  if (selection.contextBeforePause) return { ...structuredClone(selection.contextBeforePause), sourceFilter: selection.sourceFilter, notebookId: selection.notebookId };
  if (researchContextIsEmpty(researchContextLayers(selection, academic), researchContextWeb(selection, webEnabled))) return selection;
  const contextBeforePause = structuredClone(selection);
  // Pin legacy selections' inherited web choice, so later preference changes cannot alter it.
  contextBeforePause.layers = { ...researchContextLayers(selection, academic), ...selection.layers, web: researchContextWeb(selection, webEnabled) };
  return { ...withResearchContextLayers(selection, { ideas: false, documents: false, indexed: false, web: false }), contextBeforePause };
}

/** The layers after one switch of the balloon: full documents switched on bring the indexed
 * texts they read from, and the indexed texts switched off take full documents with them. */
export function toggleResearchContextLayer(layers: ResearchCorpusLayers, layer: ResearchCorpusLayer, on: boolean): ResearchCorpusLayers {
  const next = { ...layers, [layer]: on };
  if (layer === 'documents' && on) next.indexed = true;
  if (layer === 'indexed' && !on) next.documents = false;
  return next;
}

/** Whether a turn reads the indexed texts and nothing else, as NotebookLM works: one search of the
 * passage index and an answer from those passages alone, with no planner, profiles, ideas or web. */
export function researchIndexedTextsAlone(layers: ResearchCorpusLayers, webEnabled = false): boolean {
  return layers.indexed && !layers.ideas && !layers.documents && !webEnabled;
}

/** Whether a turn may consult nothing of the corpus and no web: it answers from general knowledge. */
export function researchContextIsEmpty(layers: ResearchCorpusLayers, webEnabled: boolean): boolean {
  return !layers.ideas && !layers.documents && !layers.indexed && !webEnabled;
}
