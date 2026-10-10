/** Compact, versioned QR representation. The complete link remains available to
 * existing clients; QR metadata retains every granted vault and relay field. */
export function desktopPairingQR(offer: {id:string;code:string;origins:string[];certificateFingerprint:string;domains:readonly string[];expiresAt:string;deviceName:string;macDeviceId:string;vaults:Array<{id:string;name:string;type:string}>;relay?:unknown;renewalPairingId?:string}): string {
  const payload = [2,offer.id,offer.code,offer.origins,offer.certificateFingerprint,offer.domains,offer.expiresAt,
    offer.deviceName,offer.vaults.map(vault=>[vault.id,vault.name,vault.type]),offer.relay ?? null,offer.macDeviceId];
  if (offer.renewalPairingId) payload.push(offer.renewalPairingId);
  const bytes = new TextEncoder().encode(JSON.stringify(payload));
  const encoded = btoa(Array.from(bytes, byte => String.fromCharCode(byte)).join(''))
    .replaceAll('+','-').replaceAll('/','_').replaceAll('=','');
  return 'nodus://pair?q='+encoded;
}
