// Tailscale detection and setup for the local Nodus Server.
//
// This is the access path Nodus recommends, and the reason is worth stating: `tailscale serve`
// gives the local server a real Let's Encrypt certificate for a name like
// `laptop.tail1234.ts.net`, reachable only by devices signed in to the same tailnet, without
// opening a single port on the router. No self-signed warning to teach people to click through,
// no DNS record, no port forwarding — and the traffic is WireGuard-encrypted underneath.
//
// Nodus only ever reads Tailscale's state, or asks it to forward to our own loopback port. It
// never logs in, never changes the tailnet and never enables Funnel (which would publish to the
// open internet, the one thing basic mode exists to avoid).
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { promisify } from 'node:util';
import type { LocalServerAccess, LocalServerTailscale } from '@shared/types';

const execFileAsync = promisify(execFile);
const COMMAND_TIMEOUT_MS = 10_000;

/** Where the CLI lives on each platform. The macOS app bundles it inside itself. */
const CANDIDATES: Record<string, string[]> = {
  darwin: [
    '/Applications/Tailscale.app/Contents/MacOS/Tailscale',
    '/usr/local/bin/tailscale',
    '/opt/homebrew/bin/tailscale',
  ],
  linux: ['/usr/bin/tailscale', '/usr/local/bin/tailscale'],
  win32: [
    'C:\\Program Files\\Tailscale\\tailscale.exe',
    'C:\\Program Files (x86)\\Tailscale\\tailscale.exe',
  ],
};

export const DISCONNECTED: LocalServerTailscale = {
  installed: false,
  connected: false,
  dnsName: null,
  httpsAvailable: false,
  servingOurPort: false,
  url: null,
};

/** Absolute path to the Tailscale CLI, or null when it is not installed. */
export function tailscaleBinary(platform: NodeJS.Platform = process.platform): string | null {
  return (CANDIDATES[platform] ?? []).find((candidate) => existsSync(candidate)) ?? null;
}

async function run(binary: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync(binary, args, {
    timeout: COMMAND_TIMEOUT_MS,
    windowsHide: true,
    maxBuffer: 4 * 1024 * 1024,
  });
  return stdout;
}

interface StatusJson {
  Self?: { DNSName?: string; Online?: boolean };
  CertDomains?: string[];
  BackendState?: string;
}

/**
 * Whether `tailscale serve` already forwards the tailnet HTTPS port to our port.
 *
 * The shape of `serve status --json` has changed across Tailscale versions, so rather than
 * walk a structure that may be `Web` keyed by `host:443` in one release and something else in
 * the next, this asks the only question that matters — does the configuration mention our
 * loopback port — of the serialized text. A false positive is not free: stopTailscaleServe
 * relies on it before turning the 443 handler off.
 */
export function servesPort(serveJson: string, port: number): boolean {
  // Bounded on the right: a plain substring test let port 3000 match a proxy to
  // 127.0.0.1:30000, and stopTailscaleServe would then take down that unrelated 443 config.
  return new RegExp(`(?:127\\.0\\.0\\.1|localhost):${port}(?!\\d)`).test(serveJson);
}

/** Read Tailscale's current state. Never throws: an absent or broken CLI is just "not available". */
export async function tailscaleStatus(port: number): Promise<LocalServerTailscale> {
  const binary = tailscaleBinary();
  if (!binary) return DISCONNECTED;
  try {
    const status = JSON.parse(await run(binary, ['status', '--json'])) as StatusJson;
    // DNSName arrives with a trailing dot, as a fully qualified name does.
    const dnsName = (status.Self?.DNSName ?? '').replace(/\.$/, '') || null;
    const connected = status.BackendState === 'Running' && Boolean(dnsName);
    const httpsAvailable = Array.isArray(status.CertDomains) && status.CertDomains.length > 0;
    let servingOurPort = false;
    if (connected) {
      try {
        servingOurPort = servesPort(await run(binary, ['serve', 'status', '--json']), port);
      } catch {
        // `serve status` exits non-zero when nothing is configured — that is a "no", not a fault.
      }
    }
    return {
      installed: true,
      connected,
      dnsName,
      httpsAvailable,
      servingOurPort,
      url: connected && servingOurPort && dnsName ? `https://${dnsName}` : null,
    };
  } catch {
    return { ...DISCONNECTED, installed: true };
  }
}

/**
 * Point the tailnet's HTTPS port at our local server, in the background.
 *
 * Deliberately `serve` and not `funnel`: serve is visible to the tailnet only. Idempotent —
 * running it again with the same target changes nothing.
 */
export async function startTailscaleServe(port: number): Promise<LocalServerTailscale> {
  const binary = tailscaleBinary();
  if (!binary) throw new Error('Tailscale is not installed on this computer.');
  const before = await tailscaleStatus(port);
  if (!before.connected) throw new Error('Tailscale is installed but this computer is not signed in to a tailnet.');
  if (!before.httpsAvailable) {
    throw new Error('HTTPS certificates are not enabled for this tailnet. Enable them in the Tailscale admin console and try again.');
  }
  // --yes because this runs with no terminal attached: an interactive confirmation would
  // simply hang until the timeout rather than ask anybody anything.
  await run(binary, ['serve', '--bg', '--yes', '--https=443', `http://127.0.0.1:${port}`]);
  return tailscaleStatus(port);
}

/**
 * Whether a forward set up under an earlier setting is now publishing something nobody asked for.
 *
 * `tailscale serve` is configuration the daemon keeps: it outlives this setting, this process and
 * a reboot. So the moment the user picks a different access path — or moves the server to another
 * port — the forward they set up earlier is still handing the whole tailnet to whatever binds the
 * old one. That includes this same server the next time somebody starts it in "this computer
 * only" mode, while the panel tells them nobody else can connect.
 *
 * A predicate rather than an `if` buried in the settings handler, because it is the one piece of
 * this that can be silently wrong and the only piece a test can reach without a real tailnet.
 */
export function forwardOutlivedSetting(
  previous: { access: LocalServerAccess; port: number },
  next: { access: LocalServerAccess; port: number },
): boolean {
  if (previous.access !== 'tailscale') return false;
  return next.access !== 'tailscale' || next.port !== previous.port;
}

/**
 * Stop forwarding to our port.
 *
 * Only when the current configuration is actually ours. `serve --https=443 off` removes
 * whatever is on that port, and somebody may well have been serving something else there long
 * before Nodus existed — switching a Nodus setting is not permission to dismantle that.
 */
export async function stopTailscaleServe(port: number): Promise<LocalServerTailscale> {
  const binary = tailscaleBinary();
  if (!binary) return DISCONNECTED;
  const current = await tailscaleStatus(port);
  if (!current.servingOurPort) return current;
  try {
    await run(binary, ['serve', '--https=443', 'off']);
  } catch {
    // Already gone, or an older CLI spelling. Either way there is nothing left to undo.
  }
  return tailscaleStatus(port);
}
