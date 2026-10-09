/**
 * Recorded-reaction ids and the bond-edit audit's flags, shared by the precedent, synthesis-evidence
 * and textbook-scheme sections.
 *
 * The reaction index holds Open Reaction Database records (`ord-…`) and Lowe's USPTO patent records
 * (`lg:` grants, `la:` applications: patent number and paragraph). Every recorded reaction was read
 * by the bond-edit audit; one it flagged — a skeletal shift, or a bond made at a carbon nothing
 * activates — stays cited with its flags, because a record has no prose to declare a rearrangement
 * or radical step, so a real one looks the same as a transcription error.
 */

/** A recorded-reaction sample id the index can return. */
export const RECORD_ID = /^(?:ord-[0-9a-f]{32}|l[ag]:[A-Z]{2}[0-9A-Z]+:\d*)$/;

const PATENT_RECORD = /^l[ag]:([A-Z]{2}[0-9A-Z]+):(\d*)$/;

/** How a sample id is cited: an ORD id as code; a patent as its number (and paragraph), linked. */
export function recordLabel(id: string): string {
  const patent = PATENT_RECORD.exec(id);
  if (!patent) return `\`${id}\``;
  // Lowe zero-pads grant numbers (US05155269); the patent office's own form drops the padding.
  const number = patent[1].replace(/^US0+(?=\d)/, 'US');
  const paragraph = patent[2] ? ` ¶${Number(patent[2])}` : '';
  return `[${number}${paragraph}](https://patents.google.com/patent/${number})`;
}

const AUDIT_PHRASES: Record<string, string> = {
  '1,2-shift': 'a carbon moves to its neighbour (a 1,2-shift)',
  'reorganised skeleton': 'the carbon skeleton is reorganised',
  'unactivated C–C': 'a C–C bond forms at a carbon nothing activates',
  'unactivated C–X': 'a C–heteroatom bond forms at a carbon nothing activates',
  'stereo from achiral inputs': 'stereocentres appear from achiral inputs',
};

/** The flags a payload may carry: only the audit's own. */
export function normalizeAuditFlags(value: unknown): string[] {
  return Array.isArray(value) ? [...new Set(value.filter((flag): flag is string => typeof flag === 'string' && flag in AUDIT_PHRASES))] : [];
}

/** One line for a flagged record: what the audit saw, and what citing it requires. */
export function auditNote(flags: string[]): string {
  const seen = flags.filter((flag) => flag in AUDIT_PHRASES).map((flag) => AUDIT_PHRASES[flag]);
  if (!seen.length) return '';
  return `⚑ Bond-edit audit: as recorded, ${seen.join('; ')}. A step relying on this record must name the rearrangement or radical step; otherwise the record may be a transcription error.`;
}
