import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'node:crypto';

export interface RelayFrame {
  version: 1; keyId: string; clientId: string; epoch: string; id: string; sequence: number; final: boolean; sealed: string;
}
type Direction = 'request' | 'response';
export function relayAAD(channel: string, frame: Omit<RelayFrame, 'sealed' | 'version'>, direction: Direction): Buffer {
  return Buffer.from(['nodus-relay-v1', channel, frame.keyId, frame.clientId, frame.epoch, frame.id, String(frame.sequence), frame.final ? '1' : '0', direction].join('\n'));
}
function key(secret: string, channel: string, direction: Direction): Buffer {
  const material = Buffer.from(secret, 'base64');
  if (material.length !== 32) throw new Error('invalid_relay_key');
  return Buffer.from(hkdfSync('sha256', material, Buffer.from(channel), Buffer.from(`nodus-relay-v1/${direction}`), 32));
}
export function sealRelay(secret: string, channel: string, frame: Omit<RelayFrame, 'sealed' | 'version'>, direction: Direction, bytes: Buffer): RelayFrame {
  const nonce = randomBytes(12), cipher = createCipheriv('aes-256-gcm', key(secret, channel, direction), nonce);
  cipher.setAAD(relayAAD(channel, frame, direction));
  const encrypted = Buffer.concat([cipher.update(bytes), cipher.final()]);
  return { ...frame, version: 1, sealed: Buffer.concat([nonce, encrypted, cipher.getAuthTag()]).toString('base64') };
}
export function openRelay(secret: string, channel: string, frame: RelayFrame, direction: Direction): Buffer {
  if (frame.version !== 1 || !Number.isSafeInteger(frame.sequence) || frame.sequence < 0 || typeof frame.final !== 'boolean') throw new Error('invalid_relay_frame');
  const bytes = Buffer.from(frame.sealed, 'base64');
  if (bytes.length < 28 || bytes.length > 512 * 1024) throw new Error('invalid_relay_frame');
  const decipher = createDecipheriv('aes-256-gcm', key(secret, channel, direction), bytes.subarray(0, 12));
  decipher.setAAD(relayAAD(channel, frame, direction)); decipher.setAuthTag(bytes.subarray(-16));
  return Buffer.concat([decipher.update(bytes.subarray(12, -16)), decipher.final()]);
}
