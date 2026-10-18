/** Text-bearing originals supported by the local Library extraction pipeline. */
export function isDocumentaryTextMime(mime: string | null | undefined): boolean {
  const value = mime?.split(';', 1)[0].trim().toLowerCase() ?? '';
  return value.startsWith('text/') || [
    'application/pdf', 'application/epub+zip',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ].includes(value);
}
