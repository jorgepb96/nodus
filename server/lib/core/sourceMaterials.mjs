import {rows} from './snapshot.mjs';

// Closed public projections using citation routes already written by Desktop.
// Private identity tables, rosters, grades and audio never enter this contract.
export const SOURCE_MATERIALS = [
  ['persons','persons','person_id','person',['display_name','notes','biography']],
  ['places','places','place_id','place',['name','kind','notes']],
  ['events','events','event_id','event',['title','name','description','notes']],
  ['world-groups','world_groups','group_id','world/group',['name','summary','description','notes']],
  ['world-scenes','world_scenes','scene_id','world/scene',['title','summary','notes']],
  ['world-articles','world_articles','article_id','world/article',['title','summary','body','notes']],
  ['world-threads','world_threads','thread_id','world/thread',['title','pitch','stakes','outcome']],
  ['world-rules','world_rules','rule_id','world/rule',['title','statement','cost','limits']],
  ['world-questions','world_questions','question_id','world/question',['question']],
  ['world-secrets','world_secrets','secret_id','world/secret',['title','content','notes']],
  ['study-docs','study_docs','id','study/doc',['title','summary','content','content_markdown','notes']],
  ['study-materials','study_materials','id','study/material',['title','description','summary','text']],
  ['archive-items','archive_items','item_id','archive',['title','description','notes','source','date_display']],
  ['archive-excerpts','archive_excerpts','excerpt_id','primary-source-excerpt',['quoted_text','locator_display']],
  ['testimony-interviews','testimony_interviews','id','testimonios/interview',['title','description','summary','notes']],
  ['testimony-contrasts','testimony_contrasts','id','testimonios/contrast',['title','memo_markdown','summary','description']],
];
const fold = value => String(value).normalize('NFD').replace(/\p{M}/gu,'').toLowerCase();
const stop = new Set('de la el en al es un an of to on is in le et du que como cual cuales las los del con por para una unos unas entre sobre the and for from how what with this that are les des une dans der die das und'.split(' '));

export function sourceMaterialRows(snapshot, query) {
  const tokens = [...new Set(fold(query).split(/[^\p{L}\p{N}]+/u).filter(token => token.length >= 2 && !stop.has(token)))];
  if (!tokens.length) return [];
  const result = [];
  for (const [collection, table, primaryKey, route, fields] of SOURCE_MATERIALS) {
    for (const row of rows(snapshot, table)) {
      const id = row[primaryKey];
      if (typeof id !== 'string' || !id) continue;
      const parts = fields.map(field => row[field]).filter(value => typeof value === 'string' && value.trim());
      if (collection === 'world-scenes') {
        const body = rows(snapshot,'world_scene_text').find(value => value.scene_id === id);
        const text = body?.content_markdown ?? body?.text ?? body?.body;
        if (typeof text === 'string' && text.trim()) parts.push(text);
      }
      const text = parts.join('\n\n');
      const score = tokens.reduce((count, token) => count + (fold(text).includes(token) ? 1 : 0), 0);
      if (!score) continue;
      let citation = `nodus://${route}/${encodeURIComponent(id)}`;
      if (route === 'primary-source-excerpt') {
        if (typeof row.item_id !== 'string' || !rows(snapshot,'archive_items').some(item => item.item_id === row.item_id)) continue;
        citation = `nodus://primary-source/${encodeURIComponent(row.item_id)}/excerpt/${encodeURIComponent(id)}`;
      }
      const metadataOnly = collection === 'study-materials' && !row.text;
      result.push({score, value: {version:1, collection, recordId:id, kind:citation.split('://')[1].split('/')[0], citation,
        label:String(row.title ?? row.name ?? row.display_name ?? row.question ?? row.locator_display ?? parts[0] ?? id).slice(0,240),
        text:metadataOnly ? `Solo metadatos del material; no contiene su documento original ni una extracción de este.\n\n${text}` : text,
        contentScope:metadataOnly ? 'metadata' : 'record', locator:typeof row.locator_display === 'string' ? row.locator_display : null,
        parentId:route === 'primary-source-excerpt' ? row.item_id : null}});
    }
  }
  return result.sort((a,b) => b.score-a.score || a.value.citation.localeCompare(b.value.citation)).map(row => row.value);
}
