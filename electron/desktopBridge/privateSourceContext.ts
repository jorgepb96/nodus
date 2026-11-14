import { createHash } from 'node:crypto';

type Row = Record<string, unknown>;
type Groups = Record<string, Row[]>;
const routes: Record<string, [string, string]> = {
  'study-recording': ['study/recording', 'study-recordings'],
  'prosop-person': ['prosop/person', 'prosopography-private'],
  'prosop-source': ['prosop/source', 'prosopography-private'],
  'prosop-factoid': ['prosop/factoid', 'prosopography-private'],
  'prosop-mention': ['prosop/mention', 'prosopography-private'],
  'testimony-participant': ['testimonios/participant', 'testimonies'],
  'testimony-interview': ['testimonios/interview', 'testimonies'],
  'testimony-transcript': ['testimonios/transcript', 'testimonies'],
  'testimony-contrast': ['testimonios/contrast', 'testimonies'],
};
const text = (row: Row, fields: string[]) => fields.map(key => row[key]).filter((value): value is string => typeof value === 'string' && !!value.trim()).join('\n\n');

/** Closed textual projections. Contacts, identity profiles, agreements, files,
 * media blobs and arbitrary columns never become model context. */
export function privateSourceMaterials(kind: string, id: string, root: Row, groups: Groups): Row[] {
  const route = routes[kind];
  if (!route) throw new Error('invalid_private_source_kind');
  const result: Row[] = [];
  const add = (targetKind: string, targetId: string, body: string, label: string, record: boolean, transcript?: string, locator?: string) => {
    if (!body.trim()) return;
    const [path, domain] = routes[targetKind];
    const citation = `nodus://${path}/${encodeURIComponent(targetId)}${transcript ? `?transcript=${encodeURIComponent(transcript)}` : ''}`;
    result.push({version:1,privateKind:targetKind, domain, recordId:targetId, kind:path.split('/')[0], citation,
      label:label || targetId, text:body, contentScope:record ? 'record' : 'metadata', ...(locator ? {locator} : {})});
  };
  const label = String((kind === 'testimony-participant' ? root.public_name : null) || root.title || root.display_name || root.literal_name || root.short_id || id);
  if (kind === 'prosop-source' && (groups.segments || []).some(row => row.source_id !== id)) throw new Error('private_source_ownership');
  if (['prosop-factoid','prosop-mention'].includes(kind) && (groups.segments || []).some(row => row.segment_id !== root.source_segment_id || row.source_id !== root.source_id)) throw new Error('private_source_ownership');
  if (kind === 'testimony-contrast' && (groups.items || []).some(row => row.contrast_id !== id)) throw new Error('private_source_ownership');
  const records = (key: string, fields: string[]) => (groups[key] || []).filter(row => key !== 'segments' || typeof row.quoted_text === 'string' && !!row.quoted_text.trim()).map(row => text(row, fields)).filter(Boolean).join('\n\n');
  if (kind === 'study-recording' || kind === 'testimony-interview' || kind === 'testimony-transcript') {
    if (kind !== 'testimony-transcript') add(kind,id,text(root,kind === 'testimony-interview' ? ['title','objective','context_markdown','abstract'] : ['title','session_label']),label,false);
    const transcripts = kind === 'testimony-transcript' ? [root] : groups.transcripts || [];
    for (const transcript of transcripts) {
      if (kind === 'study-recording' && transcript.recording_id !== id || kind === 'testimony-interview' && transcript.interview_id !== id) throw new Error('private_source_ownership');
      const transcriptId = String(transcript.id || '');
      if (!transcriptId) continue;
      const body = text(transcript,['content_markdown']) || (groups.segments || []).filter(row => row.transcript_id === transcriptId && typeof row.text === 'string' && !!row.text.trim()).map(row => text(row,['text','speaker','speaker_label'])).filter(Boolean).join('\n\n');
      const locator = `${String(transcript.kind || 'Transcripción')} · v${String(transcript.version_no || 1)} · ${String(transcript.language || '')} · ${String(transcript.status || '')}`;
      // A stored version is the citation identity; never silently select latest.
      add(kind === 'study-recording' ? kind : 'testimony-transcript',kind === 'study-recording' ? id : transcriptId,body,label,true,kind === 'study-recording' ? transcriptId : undefined,locator);
    }
  } else if (kind === 'prosop-source') {
    const literal = records('segments',['locator_display','quoted_text']);
    add(kind,id,[text(root,['title','citation','description','coverage_notes','reliability_notes']),literal].filter(Boolean).join('\n\n'),label,!!literal);
  } else if (kind === 'prosop-factoid' || kind === 'prosop-mention') {
    const literal = records('segments',['locator_display','quoted_text']);
    add(kind,id,[text(root,kind === 'prosop-factoid' ? ['summary','factoid_kind','status','extraction_certainty'] : ['literal_name','context','role_or_title','identity_status','certainty']),literal,
      records('statements',['literal_value','rationale','reading_certainty','source_assertion_certainty'])].filter(Boolean).join('\n\n'),label,!!literal);
  } else if (kind === 'testimony-contrast') {
    const literal = records('items',['quote_snapshot']);
    add(kind,id,[text(root,['title','memo_markdown']),literal].filter(Boolean).join('\n\n'),label,!!literal);
  } else {
    add(kind,id,text(root,['display_name','notes','biography']),label,false);
  }
  return result;
}

export function matchPrivateSource(row: Row, query: string): boolean {
  const fold = (value: string) => value.normalize('NFD').replace(/\p{M}/gu,'').toLowerCase();
  const tokens = fold(query).match(/[\p{L}\p{N}]{2,}/gu) || [];
  const haystack = fold(`${String(row.label)} ${String(row.text)}`);
  return tokens.some(token => haystack.includes(token));
}
export const privateContextRevision = (revision: string, rows: Row[]) => createHash('sha256').update(revision).update(JSON.stringify(rows)).digest('hex');
