import {createHash} from 'node:crypto';
import type {BuiltSnapshot} from '../serverSync/serverSnapshot';
import {mobileConsultationSnapshot} from '../../shared/mobileConsultationSnapshot';
import {stellarPage, stellarThemes} from '../graph/stellarService';
import {discoverArgumentRoutes} from '../ai/argumentMap';
import {getPodcastEpisode, listPodcastEpisodes, getPodcastImageBytes} from '../db/podcastRepo';
import type {GraphNode, GraphEdge} from '../../shared/types';

export const LINK_DOWNLOAD_SECTIONS = ['ideas','authors','dictionary','deepResearch','graph','argument','library','podcast'] as const;
const base = ['works','authors','work_authors','themes','work_themes','collections','work_collections','zotero_tags','work_zotero_tags','work_metadata'];
const ideas = ['ideas','idea_occurrences','idea_theme_links','evidence','edges','edge_feedback','edge_traces','gaps','work_idea_synthesis'];

/** Read-only, bounded projections. Documents, recordings, vectors and unrelated authored
 * work never enter a section download. Podcast audio is selected independently per episode. */
export function buildSectionDownload(built: BuiltSnapshot, section: string) {
  if (!(LINK_DOWNLOAD_SECTIONS as readonly string[]).includes(section)) throw new Error('invalid_section');
  const original = JSON.parse(built.buffer.toString('utf8'));
  if (original.vault?.type !== 'academic') throw new Error('unsupported_vault');
  let selected: Record<string, unknown[]>;
  if (section === 'dictionary') {
    selected = mobileConsultationSnapshot(original, 'dictionary').tables as Record<string, unknown[]>;
  } else {
    const names = new Set(section === 'deepResearch'
      ? [...base, 'writing_saved_drafts','writing_draft_reads','writing_draft_annotations','decorative_images','content_translations']
      : section === 'podcast' ? [] : [...base,...ideas,'author_relations','author_dossier_synthesis','work_summaries']);
    selected = Object.fromEntries(Object.entries(original.tables).filter(([name]) => names.has(name))) as Record<string, unknown[]>;
  }
  let reportIds = new Set<string>();
  if (section === 'deepResearch') {
    const drafts = (selected.writing_saved_drafts ?? []) as {id: string; brief_json: string}[];
    const reports = drafts.filter(row => JSON.parse(row.brief_json)?.kind === 'deep_research');
    reportIds = new Set(reports.map(row => row.id)); selected.writing_saved_drafts = reports;
    for (const name of ['writing_draft_reads','writing_draft_annotations']) {
      selected[name] = ((selected[name] ?? []) as {draft_id: string}[]).filter(row => reportIds.has(row.draft_id));
    }
    for (const name of ['decorative_images','content_translations']) {
      selected[name] = ((selected[name] ?? []) as {entity_kind: string; entity_id: string}[])
        .filter(row => row.entity_kind === 'deep_research' && reportIds.has(row.entity_id));
    }
  }
  const assets = section === 'deepResearch' ? built.assets.filter(asset => asset.table === 'decorative_images' && asset.key.some(id => reportIds.has(id))) : [];
  const snapshot = {...original, generatedAt: undefined, embeddingIndex: null, library: undefined, tables: selected,
    assets: assets.map(({data: _data, thumbData: _thumbData, ...ref}) => ref),
    capabilities: {...original.capabilities, includesLibraryDocuments: false, includesPassages: Boolean(selected.passages), includesUserContent: section === 'deepResearch' || section === 'dictionary'}};
  let graph: {nodes: GraphNode[]; edges: GraphEdge[]; themes: ReturnType<typeof stellarThemes>} | undefined;
  if (['ideas','graph','argument'].includes(section)) {
    const nodes = new Map<string, GraphNode>(), edges = new Map<string, GraphEdge>();
    let cursor: number | null = 0;
    while (cursor !== null) {
      const page = stellarPage({kind: 'corpus', cursor, limit: 200});
      page.nodes.forEach(node => nodes.set(node.id, node)); page.edges.forEach(edge => edges.set(edge.id, edge));
      if (page.next !== null && page.next <= cursor) throw new Error('invalid_section_pagination');
      cursor = page.next;
    }
    graph = {nodes: [...nodes.values()], edges: [...edges.values()], themes: stellarThemes()};
  }
  const episodes = section === 'podcast' ? listPodcastEpisodes().map(item => getPodcastEpisode(item.id)).filter(Boolean) : undefined;
  const podcastImages = section === 'podcast' ? (episodes ?? []).flatMap(item => {
    if (!item) return [];
    const image = getPodcastImageBytes(item.id, 0, 'thumbnail') ?? getPodcastImageBytes(item.id, 0, 'image');
    return image ? [{id: item.id, dataURL: `data:${image.mime};base64,${Buffer.from(image.bytes).toString('base64')}`}] : [];
  }) : undefined;
  const payload = {version: 1, section, snapshot, graph,
    argumentRoutes: section === 'argument' ? discoverArgumentRoutes() : undefined,
    episodes, podcastImages,
    assets: assets.flatMap(asset => [{hash: asset.hash, mime: asset.mime, base64: asset.data.toString('base64')},
      ...(asset.thumbHash && asset.thumbData ? [{hash: asset.thumbHash, mime: asset.thumbMime, base64: asset.thumbData.toString('base64')}] : [])])};
  const revision = 'section:' + createHash('sha256').update(JSON.stringify(payload)).digest('base64url');
  const buffer = Buffer.from(JSON.stringify({...payload, revision, snapshot: {...snapshot, revision}}));
  if (buffer.length > 50 * 1024 * 1024 - 128 * 1024) throw new Error('section_download_too_large');
  return {revision, buffer};
}
