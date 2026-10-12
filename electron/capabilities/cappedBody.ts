/** A response body read with a ceiling: refused on its declared length, and cut off as soon as
 *  the bytes received pass the limit, so an oversized answer is never buffered whole. */
export async function readCappedBody(response: Response, limit: number, tooLarge: string): Promise<Buffer> {
  const declared = Number(response.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > limit) {
    await response.body?.cancel().catch(() => undefined);
    throw new Error(tooLarge);
  }
  if (!response.body) {
    // No stream to read incrementally (an empty body, or a minimal Response-like object).
    const whole = Buffer.from(await response.arrayBuffer());
    if (whole.byteLength > limit) throw new Error(tooLarge);
    return whole;
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    received += value.byteLength;
    if (received > limit) {
      await reader.cancel().catch(() => undefined);
      throw new Error(tooLarge);
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks, received);
}
