export const CLOUDFLARE_TABLE_CHUNK_ROWS = 15;
export const CLOUDFLARE_TABLE_CHUNK_BYTES = 1024 * 1024;
export const CLOUDFLARE_MAX_PUBLICATION_REQUESTS = 10_000;

/** Include the JSON envelope, commas and UTF-8 encoding in the worker's byte ceiling. */
export function* cloudflareTableChunks<T>(rows: T[]): Generator<T[]> {
  let chunk: T[] = [];
  let bytes = Buffer.byteLength('{"rows":[]}');
  for (const row of rows) {
    const rowBytes = Buffer.byteLength(JSON.stringify(row));
    if (rowBytes + Buffer.byteLength('{"rows":[]}') > CLOUDFLARE_TABLE_CHUNK_BYTES) {
      throw new Error('Una fila supera el límite de publicación de Cloudflare.');
    }
    if (chunk.length && (chunk.length >= CLOUDFLARE_TABLE_CHUNK_ROWS || bytes + rowBytes + 1 > CLOUDFLARE_TABLE_CHUNK_BYTES)) {
      yield chunk;
      chunk = [];
      bytes = Buffer.byteLength('{"rows":[]}');
    }
    bytes += rowBytes + (chunk.length ? 1 : 0);
    chunk.push(row);
  }
  if (chunk.length) yield chunk;
}

export function validateCloudflarePartBytes(value: number): number {
  if (!Number.isSafeInteger(value) || value < 5 * 1024 * 1024 || value > 8 * 1024 * 1024) {
    throw new Error('Cloudflare devolvió un tamaño de parte no válido. Se ha detenido la publicación.');
  }
  return value;
}
