/** Portable revision inputs survive native JSON encoders reordering object keys.
 * Hashing is supplied by the host (Node or Web Crypto); no provider is involved. */
export function mobileSourceRevisionInput(value: unknown): string {
  const json: unknown = JSON.parse(JSON.stringify(value));
  const order = (item: unknown): unknown => {
    if (Array.isArray(item)) return item.map(order);
    if (item && typeof item === 'object') return Object.fromEntries(Object.entries(item).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, child]) => [key, order(child)]));
    return item;
  };
  return JSON.stringify(order(json));
}

export type MobileSourceHasher = (value: string) => Promise<string>;
export const hashMobileSource: MobileSourceHasher = async value => Array.from(new Uint8Array(
  await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))), byte => byte.toString(16).padStart(2, '0')).join('');
