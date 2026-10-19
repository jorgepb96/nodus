// Only closed technical badges cross the report boundary. Message parameters,
// provider prose, model names, document names and job identifiers never do.
export const PIPELINE_BADGES='invalid_json schema_mismatch output_truncated timeout connection rate_limit provider_5xx auth bad_request context_overflow provider_empty model_missing model_unavailable embedding_failed embedding_count_mismatch extract_failed figure_skipped no_legible_text ocr_failed index_failed publish_failed source_changed queue_paused cancelled db_error burst_limit uncaught unknown'.split(' ');
const badges=new Set(PIPELINE_BADGES);
const components={model:'models',embedding:'models',provider:'models',connection:'network',storage:'storage',system:'app'};
export function technicalLogEntry(entry,sanitize) {
  return {code:badges.has(entry.code)?`PIPELINE_${entry.code.toUpperCase()}`:sanitize(typeof entry.detail==='string'?entry.detail:typeof entry.code==='string'?entry.code:''),component:components[entry.category]??'pipeline',at:entry.at,
    ...(Number.isSafeInteger(entry.httpStatus)&&entry.httpStatus>=100&&entry.httpStatus<=599?{httpStatus:entry.httpStatus}:{}),
    ...(Number.isSafeInteger(entry.repeat)&&entry.repeat>1?{repeat:entry.repeat}:{})};
}
