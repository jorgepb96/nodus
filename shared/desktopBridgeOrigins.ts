/** Recalculate addresses on every offer: laptops change LAN/VPN while the listener stays open. */
export function desktopBridgeOrigins(port: number, addresses: readonly string[], hostname: string): string[] {
  const local = hostname.replace(/\.$/, '').toLowerCase();
  const stable = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.local$/.test(local) ? [`https://${local}:${port}`] : [];
  const origins = [...new Set([...stable, ...addresses.map(address => `https://${address}:${port}`)])];
  return origins.length ? origins : [`https://127.0.0.1:${port}`];
}
