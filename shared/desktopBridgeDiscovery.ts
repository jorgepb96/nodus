/** Public discovery hints. Clients must verify their saved TLS pin and Mac ID
 * before sending any credential; these TXT records never authorize a device. */
export function desktopBridgeDiscoveryTXT(macId: string, origins: readonly string[]): string[] {
  if (!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(macId)) throw new Error('invalid_mac_identity');
  const valid = [...new Set(origins)].filter(origin => {
    try {
      const url = new URL(origin);
      return url.protocol === 'https:' && url.origin === origin && !url.username && !url.password
        && Buffer.byteLength(origin, 'utf8') <= 240;
    } catch { return false; }
  }).slice(0, 16);
  if (!valid.length) throw new Error('missing_discovery_origin');
  return ['discoveryVersion=1', `macId=${macId}`, `rc=${valid.length}`, ...valid.map((origin, index) => `r${index}=${origin}`)];
}
