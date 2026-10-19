import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomBytes, randomUUID, scryptSync, timingSafeEqual } from 'node:crypto';
import { normalizeServerLanguage } from './i18n.mjs';
import { migrateState, STATE_VERSION } from './roles.mjs';

export function token(bytes = 32) {
  return randomBytes(bytes).toString('base64url');
}

/**
 * Thirty-two symbols a person can read off a screen and type without a second try.
 *
 * No I, O, 0 or 1 — the four that get transcribed as each other — and no lower case, because the
 * pairing routes uppercase whatever arrives. Exactly 32 so a random byte masked to five bits picks
 * one uniformly, with no modulo bias and no rejection loop.
 */
const PAIRING_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

/**
 * A pairing code in the shape `XXXX-XXXX`.
 *
 * It replaces `` `${token(4).slice(0, 4)}-${token(4).slice(0, 4)}`.toUpperCase() ``, which was
 * wrong twice. base64url includes `-` and `_`, so 22% of codes carried one *inside* a group,
 * beside the group separator: `HT5--E2FR` and `-HLJ-VF-Y` are real output, and the administration
 * page asks somebody to read that off a screen and type it into the desktop. And uppercasing
 * base64url folds `a` onto `A`, so letters came out twice as likely as digits — an alphabet of 38
 * symbols that were never worth 38.
 *
 * Forty bits, uniform. The code expires in fifteen minutes and the route is rate limited, so the
 * point of the change is legibility; the entropy simply stopped being a guess.
 */
export function pairingCode() {
  const bytes = randomBytes(8);
  let code = '';
  for (let index = 0; index < 8; index += 1) {
    if (index === 4) code += '-';
    code += PAIRING_ALPHABET[bytes[index] & 31];
  }
  return code;
}

export function digest(value) {
  return createHash('sha256').update(String(value)).digest('base64url');
}

export function hashPassword(password, salt = token(16)) {
  return { salt, hash: scryptSync(password, salt, 64).toString('base64url') };
}

export function verifyPassword(password, salt, expected) {
  const actual = Buffer.from(scryptSync(password, salt, 64).toString('base64url'));
  const wanted = Buffer.from(expected);
  return actual.length === wanted.length && timingSafeEqual(actual, wanted);
}

const DUMMY_PASSWORD = hashPassword('nodus-invalid-login-password', 'nodus-dummy-auth-salt');

function normalizedEmail(value) {
  const email = String(value).trim().toLowerCase();
  if (!email || email.length > 320 || !email.includes('@')) throw new Error('Enter a valid email address.');
  return email;
}

function validatePassword(value) {
  const password = String(value);
  if (password.length < 12) throw new Error('The password must contain at least 12 characters.');
  if (password.length > 1024) throw new Error('The password is too long.');
  return password;
}

function initialState() {
  return {
    version: STATE_VERSION,
    settings: { name: 'Nodus Server', publicUrl: '', language: 'en', instanceId: randomUUID() },
    users: [],
    spaces: [],
    memberships: [],
    pairingCodes: [],
    // A short-lived, single-use ticket handed out by POST /api/v1/auth/login so the client
    // can pick a space without sending its password a second time.
    authTickets: [],
    deviceTokens: [],
    sessions: [],
    oauthClients: [],
    oauthCodes: [],
    accessTokens: [],
    refreshTokens: [],
    // Typed Desktop work is kept in the control-plane state so the classic server can serve
    // the same action contract as the Cloudflare worker without introducing a second database.
    spaceActions: [],
  };
}

export class Store {
  constructor(root) {
    this.root = path.resolve(root);
    this.stateFile = path.join(this.root, 'state.json');
    this.spacesDir = path.join(this.root, 'spaces');
    fs.mkdirSync(this.spacesDir, { recursive: true });
    this.migration = { migrated: false, from: STATE_VERSION, to: STATE_VERSION };
    this.state = this.readState();
    // Persist the upgrade immediately. Leaving it in memory would mean re-running it on
    // every boot and, worse, a crash between here and the first write would leave a state
    // file whose shape no longer matches what the running code assumes.
    if (this.migration.migrated) this.save();
  }

  readState() {
    if (!fs.existsSync(this.stateFile)) return initialState();
    try {
      const parsed = JSON.parse(fs.readFileSync(this.stateFile, 'utf8'));
      const settings = { ...initialState().settings, ...(parsed.settings ?? {}) };
      settings.language = normalizeServerLanguage(settings.language);
      // The spread puts the stored `version` back on top of the one initialState declares,
      // so the migration has to run after it, not before.
      const merged = { ...initialState(), ...parsed, settings };
      this.migration = migrateState(merged);
      return merged;
    } catch (error) {
      throw new Error(`Could not read ${this.stateFile}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  save() {
    const temporary = `${this.stateFile}.tmp-${process.pid}-${Date.now()}`;
    fs.writeFileSync(temporary, JSON.stringify(this.state, null, 2), { mode: 0o600 });
    fs.renameSync(temporary, this.stateFile);
    try { fs.chmodSync(this.stateFile, 0o600); } catch { /* Windows */ }
  }

  safePathId(value, label = 'id') {
    const id = String(value ?? '');
    if (!/^[A-Za-z0-9_-]{1,128}$/.test(id)) throw new Error(`Invalid ${label}`);
    return id;
  }

  safeHash(value) {
    const hash = String(value ?? '');
    if (!/^[0-9a-f]{64}$/.test(hash)) throw new Error('Invalid content hash');
    return hash;
  }

  cleanup(now = Date.now()) {
    const keep = (entry) => !entry.expiresAt || Date.parse(entry.expiresAt) > now;
    this.state.sessions = this.state.sessions.filter(keep);
    this.state.oauthCodes = this.state.oauthCodes.filter(keep);
    this.state.accessTokens = this.state.accessTokens.filter(keep);
    this.state.refreshTokens = this.state.refreshTokens.filter(keep);
    this.state.pairingCodes = this.state.pairingCodes.filter((entry) => keep(entry) && !entry.usedAt);
    this.state.authTickets = (this.state.authTickets ?? []).filter((entry) => keep(entry) && !entry.usedAt);
    // Replica device tokens carry a sliding expiry; publisher tokens have none and are
    // revoked by hand, by a membership change, or by a password rotation.
    this.state.deviceTokens = this.state.deviceTokens.filter(keep);
  }

  createUser(email, password, role = 'member') {
    const normalized = normalizedEmail(email);
    const cleanPassword = validatePassword(password);
    if (this.state.users.some((user) => user.email === normalized)) throw new Error('An account already exists for that email address.');
    const protectedPassword = hashPassword(cleanPassword);
    const user = { id: randomUUID(), email: normalized, role, ...protectedPassword, createdAt: new Date().toISOString() };
    this.state.users.push(user);
    this.save();
    return user;
  }

  authenticate(email, password) {
    const user = this.state.users.find((entry) => entry.email === String(email).trim().toLowerCase());
    // Always perform the same expensive password verification. Returning early for
    // an unknown email makes account discovery possible through response timing.
    const protectedPassword = user ?? DUMMY_PASSWORD;
    const valid = verifyPassword(String(password).slice(0, 1024), protectedPassword.salt, protectedPassword.hash);
    return user && valid ? user : null;
  }

  syncAdminCredentials(email, password) {
    const normalized = normalizedEmail(email);
    const cleanPassword = validatePassword(password);
    let admin = this.state.users.find((entry) => entry.role === 'admin');
    if (!admin) {
      admin = this.createUser(normalized, cleanPassword, 'admin');
      return { created: true, emailChanged: false, passwordChanged: false };
    }
    if (this.state.users.some((entry) => entry.id !== admin.id && entry.email === normalized)) {
      throw new Error('The configured administrator email already belongs to another account.');
    }
    const emailChanged = admin.email !== normalized;
    const passwordChanged = !verifyPassword(cleanPassword, admin.salt, admin.hash);
    if (emailChanged) this.changeEmail(admin.id, normalized);
    if (passwordChanged) this.replacePassword(admin.id, cleanPassword);
    return { created: false, emailChanged, passwordChanged };
  }

  replacePassword(userId, password, exceptSessionHash = null) {
    const user = this.state.users.find((entry) => entry.id === userId);
    if (!user) throw new Error('The account does not exist.');
    const cleanPassword = validatePassword(password);
    Object.assign(user, hashPassword(cleanPassword), { passwordChangedAt: new Date().toISOString() });

    // A password change is also a credential-recovery event: stale browser and
    // OAuth credentials must stop working immediately. The session performing a
    // self-service change may remain signed in, but receives a new CSRF secret.
    this.state.sessions = this.state.sessions.filter((entry) => entry.userId !== userId || entry.hash === exceptSessionHash);
    const currentSession = exceptSessionHash
      ? this.state.sessions.find((entry) => entry.hash === exceptSessionHash && entry.userId === userId)
      : null;
    if (currentSession) currentSession.csrf = token(18);
    this.state.oauthCodes = this.state.oauthCodes.filter((entry) => entry.userId !== userId);
    this.state.accessTokens = this.state.accessTokens.filter((entry) => entry.userId !== userId);
    this.state.refreshTokens = this.state.refreshTokens.filter((entry) => entry.userId !== userId);
    this.state.pairingCodes = this.state.pairingCodes.filter((entry) => entry.userId !== userId);
    // Device tokens were exempt from this sweep, which meant rotating a password left every
    // paired desktop and replica publishing and pulling as if nothing had happened. They are
    // long-lived bearer credentials for this account like any other, so they go too.
    this.state.deviceTokens = this.state.deviceTokens.filter((entry) => entry.userId !== userId);
    this.save();
    return user;
  }

  changePassword(userId, currentPassword, newPassword, currentSessionHash) {
    const user = this.state.users.find((entry) => entry.id === userId);
    if (!user || !verifyPassword(String(currentPassword), user.salt, user.hash)) throw new Error('The current password is incorrect.');
    if (verifyPassword(String(newPassword), user.salt, user.hash)) throw new Error('The new password must be different from the current password.');
    return this.replacePassword(userId, newPassword, currentSessionHash);
  }

  resetPassword(userId, newPassword) {
    return this.replacePassword(userId, newPassword);
  }

  createSession(userId) {
    const raw = token();
    this.cleanup();
    const existing = this.state.sessions.filter((entry) => entry.userId === userId).sort((a, b) => Date.parse(b.expiresAt) - Date.parse(a.expiresAt));
    const retained = new Set(existing.slice(0, 19));
    this.state.sessions = this.state.sessions.filter((entry) => entry.userId !== userId || retained.has(entry));
    this.state.sessions.push({ hash: digest(raw), userId, csrf: token(18), expiresAt: new Date(Date.now() + 12 * 3600_000).toISOString() });
    this.save();
    return raw;
  }

  session(raw) {
    if (!raw) return null;
    this.cleanup();
    const session = this.state.sessions.find((entry) => entry.hash === digest(raw));
    if (!session) return null;
    const user = this.state.users.find((entry) => entry.id === session.userId);
    return user ? { session, user } : null;
  }

  unlockSensitiveAccess(sessionHash, password, ttlMs = 5 * 60_000) {
    const session = this.state.sessions.find((entry) => entry.hash === sessionHash);
    const user = session && this.state.users.find((entry) => entry.id === session.userId);
    if (!session || !user || user.role !== 'admin' || !verifyPassword(String(password).slice(0, 1024), user.salt, user.hash)) {
      throw new Error('The current administrator password is incorrect.');
    }
    session.sensitiveAccessUntil = new Date(Date.now() + ttlMs).toISOString();
    this.save();
    return session.sensitiveAccessUntil;
  }

  sensitiveAccessValid(session, now = Date.now()) {
    return Boolean(session?.sensitiveAccessUntil && Date.parse(session.sensitiveAccessUntil) > now);
  }

  changeEmail(targetUserId, email) {
    const user = this.state.users.find((entry) => entry.id === targetUserId);
    if (!user) throw new Error('The account does not exist.');
    const normalized = normalizedEmail(email);
    if (this.state.users.some((entry) => entry.id !== user.id && entry.email === normalized)) {
      throw new Error('An account already exists for that email address.');
    }
    if (user.email === normalized) return { user, changed: false };
    user.email = normalized;
    user.emailChangedAt = new Date().toISOString();
    // An email is a login identifier. Changing it is therefore a credential-recovery event,
    // not a cosmetic profile edit: every outstanding way into this account is revoked.
    this.state.sessions = this.state.sessions.filter((entry) => entry.userId !== user.id);
    this.state.oauthCodes = this.state.oauthCodes.filter((entry) => entry.userId !== user.id);
    this.state.accessTokens = this.state.accessTokens.filter((entry) => entry.userId !== user.id);
    this.state.refreshTokens = this.state.refreshTokens.filter((entry) => entry.userId !== user.id);
    this.state.authTickets = this.state.authTickets.filter((entry) => entry.userId !== user.id);
    this.state.pairingCodes = this.state.pairingCodes.filter((entry) => entry.userId !== user.id);
    this.state.deviceTokens = this.state.deviceTokens.filter((entry) => entry.userId !== user.id);
    this.save();
    return { user, changed: true };
  }

  snapshotPath(spaceId) {
    const publication = this.state.spaces.find(space => space.id === spaceId)?.embeddingPublication;
    if (publication && /^[a-f0-9]{64}$/.test(publication)) return path.join(this.spaceDir(spaceId), 'embedding-publications', publication, 'snapshot.json.gz');
    const dir = path.join(this.spacesDir, this.safePathId(spaceId, 'space id'));
    fs.mkdirSync(dir, { recursive: true });
    return path.join(dir, 'snapshot.json.gz');
  }

  writeSnapshot(spaceId, bytes) {
    const target = this.snapshotPath(spaceId);
    const temporary = `${target}.tmp-${process.pid}-${Date.now()}`;
    fs.writeFileSync(temporary, bytes, { mode: 0o600 });
    fs.renameSync(temporary, target);
    return target;
  }

  removeSnapshot(spaceId) {
    const dir = path.join(this.spacesDir, this.safePathId(spaceId, 'space id'));
    fs.rmSync(dir, { recursive: true, force: true });
  }

  spaceDir(spaceId) {
    const dir = path.join(this.spacesDir, this.safePathId(spaceId, 'space id'));
    fs.mkdirSync(dir, { recursive: true });
    return dir;
  }

  // ── Nodi's quick notes ──────────────────────────────────────────────────────
  //
  // One file per *user*, not per space: Nodi is the companion, and a jot made while reading
  // one vault is still there when the next one is open. Kept out of `state.json` because
  // that file is rewritten whole on every session, token and pairing change, and a person's
  // notes have no business being copied five hundred times an hour.

  nodiNotesPath(userId) {
    const dir = path.join(this.root, 'nodi');
    fs.mkdirSync(dir, { recursive: true });
    // The id is a UUID the server minted, but a path is a path: anything that could climb
    // out of the directory is refused rather than sanitised.
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(String(userId))) throw new Error('Invalid user id');
    return path.join(dir, `${userId}.json`);
  }

  readNodiNotes(userId) {
    try {
      const parsed = JSON.parse(fs.readFileSync(this.nodiNotesPath(userId), 'utf8'));
      if (parsed?.ownerUserId != null && parsed.ownerUserId !== String(userId)) throw new Error('Nodi notes ownership mismatch');
      return Array.isArray(parsed?.notes) ? parsed.notes : [];
    } catch {
      return [];
    }
  }

  writeNodiNotes(userId, notes) {
    const target = this.nodiNotesPath(userId);
    const temporary = `${target}.tmp-${process.pid}-${Date.now()}`;
    fs.writeFileSync(temporary, JSON.stringify({ version: 2, ownerUserId: String(userId), notes }), { mode: 0o600 });
    fs.renameSync(temporary, target);
  }

  removeNodiNotes(userId) {
    try { fs.rmSync(this.nodiNotesPath(userId), { force: true }); } catch { /* never existed */ }
  }

  // Assets are addressed by the sha256 of their bytes and fanned out two levels. A shared
  // genealogy or Deep Research space can hold tens of thousands of images, and a flat
  // directory degrades badly at that size on every filesystem we ship on.
  assetPath(spaceId, hash) {
    const safeHash = this.safeHash(hash);
    return path.join(this.spacesDir, this.safePathId(spaceId, 'space id'), 'assets', safeHash.slice(0, 2), safeHash.slice(2, 4), safeHash);
  }

  assetsDir(spaceId) {
    return path.join(this.spacesDir, this.safePathId(spaceId, 'space id'), 'assets');
  }

  // Yjs deltas are arbitrary binary, never images. They use their own content-addressed
  // namespace so the image sniffer can remain strict and the JSON relay stays scalar-only.
  documentUpdatePath(spaceId, hash) {
    const safeHash = this.safeHash(hash);
    return path.join(this.spacesDir, this.safePathId(spaceId, 'space id'), 'document-updates', safeHash.slice(0, 2), safeHash);
  }

  documentUpdatesDir(spaceId) {
    return path.join(this.spacesDir, this.safePathId(spaceId, 'space id'), 'document-updates');
  }

  sharedBlobPath(spaceId, hash) {
    const safeHash = this.safeHash(hash);
    return path.join(this.spacesDir, this.safePathId(spaceId, 'space id'), 'blobs', safeHash.slice(0, 2), safeHash);
  }

  sharedBlobsDir(spaceId) {
    return path.join(this.spacesDir, this.safePathId(spaceId, 'space id'), 'blobs');
  }

  sharedBlobUploadsDir(spaceId) {
    return path.join(this.spacesDir, this.safePathId(spaceId, 'space id'), 'blob-uploads');
  }

  sharedBlobUploadDir(spaceId, hash) {
    return path.join(this.spacesDir, this.safePathId(spaceId, 'space id'), 'blob-uploads', this.safeHash(hash));
  }

  // Clean-Markdown document packages are deliberately separate from the image channel.
  // They are ZIPs addressed by the SHA-256 of their bytes; source PDFs never enter here.
  libraryPackagePath(spaceId, hash) {
    const safeHash = this.safeHash(hash);
    return path.join(this.spacesDir, this.safePathId(spaceId, 'space id'), 'library', safeHash.slice(0, 2), safeHash.slice(2, 4), `${safeHash}.zip`);
  }

  libraryPackagesDir(spaceId) {
    return path.join(this.spacesDir, this.safePathId(spaceId, 'space id'), 'library');
  }

  // The mutation ledger is append-only NDJSON rather than a key in state.json, because
  // `save()` rewrites that whole file on every change: a space with fifty thousand pending
  // mutations would rewrite megabytes on each login.
  mutationsPath(spaceId) {
    return path.join(this.spacesDir, this.safePathId(spaceId, 'space id'), 'mutations.ndjson');
  }

  vectorsPath(spaceId, kind) {
    const safeKind = String(kind ?? '');
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(safeKind)) throw new Error('Invalid vector kind');
    const publication = this.state.spaces.find(space => space.id === spaceId)?.embeddingPublication;
    if (publication && /^[a-f0-9]{64}$/.test(publication)) return path.join(this.spaceDir(spaceId), 'embedding-publications', publication, `vectors-${safeKind}.bin`);
    return path.join(this.spacesDir, this.safePathId(spaceId, 'space id'), `vectors-${safeKind}.bin`);
  }
}
