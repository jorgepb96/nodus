// TLS material for serving the local Nodus Server to the local network.
//
// Sibling of electron/copilot/certs.ts, which solves the same problem for Word. It is not
// reused because that one is pinned to `localhost` by design and is trusted into the system
// keychain; this certificate has to name whatever addresses this machine currently holds on
// the network, and is verified by hand on a phone rather than installed into a keychain.
//
// A Nodus-owned CA (10 years) signs a leaf (1 year) whose SAN lists localhost, 127.0.0.1 and
// every private IPv4 address of this machine. The CA certificate is exportable so a phone or
// tablet can trust it once and stop warning; the fingerprint is shown in the interface so the
// person can compare it with what their browser reports before they type a password.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { X509Certificate } from 'node:crypto';
import { networkInterfaces } from 'node:os';
import path from 'node:path';
import { app } from 'electron';
import { createCA, createCert } from 'mkcert';

const CA_NAME = 'Nodus Local Server CA';
const CA_VALIDITY_DAYS = 3650;
const LEAF_VALIDITY_DAYS = 365;
/** Re-issue the leaf when fewer than this many days remain. */
const RENEW_BEFORE_DAYS = 30;

export interface LanCertMaterial {
  certPath: string;
  keyPath: string;
  caCertPath: string;
  caFingerprint: string;
  addresses: string[];
}

function certDir(): string {
  return path.join(app.getPath('userData'), 'local-server', 'tls');
}

function paths(dir: string) {
  return {
    caCert: path.join(dir, 'ca.crt'),
    caKey: path.join(dir, 'ca.key'),
    cert: path.join(dir, 'server.crt'),
    key: path.join(dir, 'server.key'),
  };
}

/**
 * Private IPv4 addresses this machine holds right now.
 *
 * Only RFC1918 ranges: a public address on a laptop means it is directly on the internet,
 * which is not what basic mode is for, and naming it in the certificate would invite exactly
 * the exposure the mode is meant to avoid. Link-local (169.254) addresses mean no network.
 */
export function lanAddresses(): string[] {
  const found = new Set<string>();
  for (const entries of Object.values(networkInterfaces())) {
    for (const entry of entries ?? []) {
      if (entry.family !== 'IPv4' || entry.internal) continue;
      const [a, b] = entry.address.split('.').map(Number);
      const isPrivate = a === 10
        || (a === 172 && b >= 16 && b <= 31)
        || (a === 192 && b === 168);
      const isTailnet = a === 100 && b >= 64 && b <= 127;
      if (isPrivate || isTailnet) found.add(entry.address);
    }
  }
  return [...found].sort();
}

function daysUntilExpiry(certPem: string): number | null {
  try {
    return (new Date(new X509Certificate(certPem).validTo).getTime() - Date.now()) / 86_400_000;
  } catch {
    return null;
  }
}

/**
 * The IP addresses currently named in a certificate.
 *
 * `subjectAltName` reads like `DNS:localhost, IP Address:127.0.0.1, IP Address:192.168.1.4`.
 */
function certAddresses(certPem: string): string[] {
  try {
    const san = new X509Certificate(certPem).subjectAltName ?? '';
    return san.split(',')
      .map((part) => part.trim())
      .filter((part) => part.startsWith('IP Address:'))
      .map((part) => part.slice('IP Address:'.length).trim())
      .filter((address) => address !== '127.0.0.1')
      .sort();
  } catch {
    return [];
  }
}

function sameAddresses(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

function fileIsValidCert(certPath: string, minDaysLeft = 0): boolean {
  if (!existsSync(certPath)) return false;
  try {
    const days = daysUntilExpiry(readFileSync(certPath, 'utf8'));
    return days !== null && days > minDaysLeft;
  } catch {
    return false;
  }
}

async function generateCa(p: ReturnType<typeof paths>): Promise<void> {
  const ca = await createCA({
    organization: CA_NAME,
    countryCode: 'ES',
    state: 'Local',
    locality: 'Local',
    validity: CA_VALIDITY_DAYS,
  });
  writeFileSync(p.caCert, ca.cert, { mode: 0o600 });
  writeFileSync(p.caKey, ca.key, { mode: 0o600 });
}

async function generateLeaf(p: ReturnType<typeof paths>, addresses: string[]): Promise<void> {
  const ca = { cert: readFileSync(p.caCert, 'utf8'), key: readFileSync(p.caKey, 'utf8') };
  const leaf = await createCert({
    ca,
    domains: ['localhost', '127.0.0.1', ...addresses],
    validity: LEAF_VALIDITY_DAYS,
  });
  writeFileSync(p.cert, leaf.cert, { mode: 0o600 });
  writeFileSync(p.key, leaf.key, { mode: 0o600 });
}

/**
 * Ensure a certificate exists that names this machine's current addresses.
 *
 * Idempotent, and cheap when nothing changed. The CA is stable — re-issuing it would
 * invalidate the trust a phone already granted — but the leaf is re-cut whenever the machine
 * moves to a different network. Without that check a laptop carried from home to the office
 * would keep presenting a certificate for an address it no longer has, and every device would
 * report a name mismatch that no amount of "trust this certificate" can clear.
 */
export async function ensureLanCert(dir: string = certDir()): Promise<LanCertMaterial> {
  const p = paths(dir);
  mkdirSync(dir, { recursive: true });

  const caValid = fileIsValidCert(p.caCert, RENEW_BEFORE_DAYS) && existsSync(p.caKey);
  if (!caValid) await generateCa(p);

  const addresses = lanAddresses();
  const leafFresh = caValid
    && fileIsValidCert(p.cert, RENEW_BEFORE_DAYS)
    && existsSync(p.key)
    && sameAddresses(certAddresses(readFileSync(p.cert, 'utf8')), addresses);
  if (!leafFresh) await generateLeaf(p, addresses);

  return {
    certPath: p.cert,
    keyPath: p.key,
    caCertPath: p.caCert,
    caFingerprint: new X509Certificate(readFileSync(p.caCert, 'utf8')).fingerprint256,
    addresses,
  };
}

/** Already-generated material, without creating anything. Null when basic mode never ran. */
export function readLanCert(dir: string = certDir()): LanCertMaterial | null {
  const p = paths(dir);
  if (!existsSync(p.caCert) || !existsSync(p.cert) || !existsSync(p.key)) return null;
  try {
    return {
      certPath: p.cert,
      keyPath: p.key,
      caCertPath: p.caCert,
      caFingerprint: new X509Certificate(readFileSync(p.caCert, 'utf8')).fingerprint256,
      addresses: certAddresses(readFileSync(p.cert, 'utf8')),
    };
  } catch {
    return null;
  }
}
