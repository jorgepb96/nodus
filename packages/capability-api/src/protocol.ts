import { TRUSTED_PROTOCOL } from './limits';
import { SLUG, exactKeys } from './json';

/** Wire format between the host and a trusted worker's utility process. Kept deliberately
 *  small and fully validated on both ends: a malformed frame must fail one call, never
 *  take down the process that received it. */

export type WorkerMethod =
  | 'health' | 'prepareChat' | 'invoke' | 'finalizeChat' | 'renderArtifact'
  | 'projectArtifactForModel' | 'getSettings' | 'applySettings' | 'runAction' | 'migrate' | 'renderLegacyResult' | 'shutdown';

export const WORKER_METHODS: readonly WorkerMethod[] = [
  'health', 'prepareChat', 'invoke', 'finalizeChat', 'renderArtifact',
  'projectArtifactForModel', 'getSettings', 'applySettings', 'runAction', 'migrate', 'renderLegacyResult', 'shutdown',
];

export type HostChannel = 'network' | 'storage' | 'secrets' | 'model' | 'svg' | 'models' | 'media' | 'vision' | 'maps' | 'subworker' | 'python' | 'attachments';

export const HOST_CHANNELS: readonly HostChannel[] = ['network', 'storage', 'secrets', 'model', 'svg', 'models', 'media', 'vision', 'maps', 'subworker', 'python', 'attachments'];

export type HostToWorkerMessage =
  | { type: 'call'; callId: string; method: WorkerMethod; payload: unknown }
  | { type: 'host-result'; callId: string; ok: true; value: unknown }
  | { type: 'host-result'; callId: string; ok: false; error: string }
  /** With `invocationId` (a host call id), only that call is cancelled; without, every call. */
  | { type: 'cancel'; invocationId?: string }
  | { type: 'shutdown' };

export type WorkerToHostMessage =
  | { type: 'ready'; protocol: number; capabilityId: string }
  | { type: 'result'; callId: string; ok: true; value: unknown }
  | { type: 'result'; callId: string; ok: false; error: string; code?: string }
  /** `parentCallId`: the host's call this request was made for, so the host answers it with that
   *  call's services and stops answering once that call is over. */
  | { type: 'host-call'; callId: string; channel: HostChannel; method: string; payload: unknown; parentCallId?: string }
  | { type: 'log'; level: 'debug' | 'info' | 'warn' | 'error'; message: string; detail?: Record<string, string | number | boolean> };

const CALL_ID = /^[a-z0-9]{1,64}$/;
const LEVELS = ['debug', 'info', 'warn', 'error'];

export function validateWorkerToHost(input: unknown): WorkerToHostMessage {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Malformed worker message.');
  const message = input as WorkerToHostMessage;
  switch (message.type) {
    case 'ready':
      if (!exactKeys(message, ['type', 'protocol', 'capabilityId']) || message.protocol !== TRUSTED_PROTOCOL || typeof message.capabilityId !== 'string') throw new Error('Malformed worker handshake.');
      return { type: 'ready', protocol: message.protocol, capabilityId: message.capabilityId };
    case 'result':
      if (typeof message.callId !== 'string' || !CALL_ID.test(message.callId)) throw new Error('Malformed worker result.');
      if (message.ok === true) {
        if (!exactKeys(message, ['type', 'callId', 'ok', 'value'])) throw new Error('Malformed worker result.');
        return { type: 'result', callId: message.callId, ok: true, value: message.value };
      }
      if (message.ok === false) {
        if (!exactKeys(message, ['type', 'callId', 'ok', 'error', 'code']) && !exactKeys(message, ['type', 'callId', 'ok', 'error'])) throw new Error('Malformed worker result.');
        if (typeof message.error !== 'string') throw new Error('Malformed worker result.');
        return { type: 'result', callId: message.callId, ok: false, error: message.error.slice(0, 2_000), ...(typeof message.code === 'string' && SLUG.test(message.code) ? { code: message.code } : {}) };
      }
      throw new Error('Malformed worker result.');
    case 'host-call':
      if (!(exactKeys(message, ['type', 'callId', 'channel', 'method', 'payload']) || exactKeys(message, ['type', 'callId', 'channel', 'method', 'payload', 'parentCallId']))
        || typeof message.callId !== 'string' || !CALL_ID.test(message.callId)
        || message.parentCallId !== undefined && (typeof message.parentCallId !== 'string' || !CALL_ID.test(message.parentCallId))
        || !HOST_CHANNELS.includes(message.channel)
        || typeof message.method !== 'string' || !/^[a-zA-Z][a-zA-Z0-9.]{0,40}$/.test(message.method)) throw new Error('Malformed host call.');
      return { type: 'host-call', callId: message.callId, channel: message.channel, method: message.method, payload: message.payload, ...(message.parentCallId ? { parentCallId: message.parentCallId } : {}) };
    case 'log': {
      if (!exactKeys(message, ['type', 'level', 'message', 'detail']) && !exactKeys(message, ['type', 'level', 'message'])) throw new Error('Malformed worker log.');
      if (!LEVELS.includes(message.level) || typeof message.message !== 'string') throw new Error('Malformed worker log.');
      const detail: Record<string, string | number | boolean> = {};
      for (const [key, value] of Object.entries(message.detail ?? {})) {
        if (!/^[a-zA-Z][a-zA-Z0-9_-]{0,40}$/.test(key)) continue;
        if (typeof value === 'string') detail[key] = value.slice(0, 500);
        else if (typeof value === 'number' || typeof value === 'boolean') detail[key] = value;
      }
      return { type: 'log', level: message.level, message: message.message.slice(0, 2_000), ...(Object.keys(detail).length ? { detail } : {}) };
    }
    default:
      throw new Error('Unsupported worker message.');
  }
}

export function validateHostToWorker(input: unknown): HostToWorkerMessage {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Malformed host message.');
  const message = input as HostToWorkerMessage;
  switch (message.type) {
    case 'call':
      if (!exactKeys(message, ['type', 'callId', 'method', 'payload'])
        || typeof message.callId !== 'string' || !CALL_ID.test(message.callId)
        || !WORKER_METHODS.includes(message.method)) throw new Error('Malformed host call.');
      return { type: 'call', callId: message.callId, method: message.method, payload: message.payload };
    case 'host-result':
      if (typeof message.callId !== 'string' || !CALL_ID.test(message.callId)) throw new Error('Malformed host result.');
      if (message.ok === true) {
        if (!exactKeys(message, ['type', 'callId', 'ok', 'value'])) throw new Error('Malformed host result.');
        return { type: 'host-result', callId: message.callId, ok: true, value: message.value };
      }
      if (message.ok === false && exactKeys(message, ['type', 'callId', 'ok', 'error']) && typeof message.error === 'string') {
        return { type: 'host-result', callId: message.callId, ok: false, error: message.error.slice(0, 2_000) };
      }
      throw new Error('Malformed host result.');
    case 'cancel':
      if (!exactKeys(message, ['type', 'invocationId']) && !exactKeys(message, ['type'])) throw new Error('Malformed cancel.');
      return { type: 'cancel', ...(typeof message.invocationId === 'string' && CALL_ID.test(message.invocationId) ? { invocationId: message.invocationId } : {}) };
    case 'shutdown':
      if (!exactKeys(message, ['type'])) throw new Error('Malformed shutdown.');
      return { type: 'shutdown' };
    default:
      throw new Error('Unsupported host message.');
  }
}
