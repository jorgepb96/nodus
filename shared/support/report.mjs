// Public reports use an allowlist, not an attempt to anonymize arbitrary application content.
const knownCodes = new Set(`SUPPORT_SCHEMA_NEWER INSTALLATION_RECOVERY_REQUIRED INSTALLATION_INTEGRITY_FAILED RECOVERY_SELECTION_CONFLICT INVALID_GUIDE CONFIGURATION_CHECKED MODEL_NOT_SELECTED BACKUP_LOCATION_MISSING BACKUP_LOCATION_UNAVAILABLE MODEL_ENDPOINT_INVALID LOCAL_ENGINE_UNAVAILABLE MODEL_ENDPOINT_REPAIRED NO_KNOWN_REPAIR COPIED_SYNC_PAUSED PARTIAL_RECOVERY LIBRARY_PARTIAL LIBRARY_REBUILT SUPPORT_WRITE_DENIED SUPPORT_NETWORK_DENIED SUPPORT_PROCESS_DENIED SUPPORT_EXTERNAL_ACTION_DENIED ARCHIVE_DUPLICATE ARCHIVE_PATH_ESCAPE ARCHIVE_RECOVERED ARCHIVE_RECOVERY_FAILED ARCHIVE_SPECIAL_FILE ARCHIVE_TOO_LARGE CANDIDATE_FAILED CLOSE_NODUS_FIRST CONCURRENT_CHANGE COPY_NOT_VERIFIED DATABASES_CHECKED DATABASES_NOT_FOUND DESTINATION_EXISTS DIAGNOSTIC_PROFILE_ONLY DOWNLOAD_FAILED DOWNLOAD_HASH_MISMATCH DOWNLOAD_ORIGIN_INVALID DOWNLOAD_TOO_LARGE INSTALLATION_NOT_SELECTED INSTALLATION_UNAVAILABLE PROCESS_CHECK_UNAVAILABLE INSTALLER_FAILED INSTALLER_NOT_SUPPORTED INVALID_ACTION INVALID_PATH INVALID_REQUEST INVALID_SENDER INVALID_SESSION INVALID_STATE INVALID_VAULT_PATH JOURNAL_INVALID JSON_TOO_LARGE LEGACY_READ_ONLY LIBRARY_UNAVAILABLE LINK_NOT_SUPPORTED LOG_UNREADABLE NOT_ENOUGH_SPACE NO_INSTALLATION_CHANGE NO_POLICY_APPLIED OPERATION_FAILED OPERATION_RUNNING OVERLAPPING_STORAGE PATH_ESCAPE PREFERENCES_UNREADABLE PROBE_INVALID PROBE_NO_RESULT PROBE_UNAVAILABLE PROFILE_NOT_FOUND PROFILE_UNAVAILABLE PROTECTION_REQUIRED RECOVERY_PASSWORD_REQUIRED REGISTRY_UNREADABLE RELEASE_INCOMPATIBLE RELEASE_MANIFEST_UNAVAILABLE RELEASE_NOT_TRUSTED RELEASE_SIGNATURE_INVALID RELEASE_SIGNING_NOT_CONFIGURED RELEASE_VERSION_UNKNOWN REPAIR_NOT_QUALIFIED RUNTIME_CHECKED RUNTIME_UNAVAILABLE SOURCE_CHANGED SOURCE_SELECTION_CHANGED SPECIAL_FILE_NOT_SUPPORTED SUPPORT_STARTUP_FAILED TEST_CANCELLED TEST_FAILED TEST_TIMEOUT USER_CONFIRMATION_REQUIRED USER_TRIAL_REQUIRED VAULT_UNAVAILABLE STARTUP_IMPORT_FAILED EACCES EPERM ENOSPC ENOENT EBUSY EIO EMFILE EROFS ENOTDIR EEXIST MODULE_NOT_FOUND SQLITE_CORRUPT SQLITE_NOTADB SQLITE_BUSY SQLITE_LOCKED SQLITE_READONLY SQLITE_FULL SQLITE_IOERR SQLITE_CANTOPEN SQLITE_ERROR SQLITE_CONSTRAINT ERR_MODULE_NOT_FOUND ERR_FAILED ERR_CONNECTION_REFUSED ERR_CONNECTION_RESET ERR_TIMED_OUT ERR_NAME_NOT_RESOLVED ERR_NETWORK_CHANGED ERR_INTERNET_DISCONNECTED ERR_CERT_AUTHORITY_INVALID ERR_FILE_NOT_FOUND ERR_ABORTED`.split(' '));
const code = value => knownCodes.has(value) ? value : 'UNCLASSIFIED_ERROR';
const components = new Set('app storage profile installation pipeline startup logging release graphics database sync library plugins backup models network'.split(' '));
const component = value => components.has(value) ? value : 'app';
const actions = new Set('fresh-profile software-graphics copy-profile disable-plugins database-check rebuild-library restore-copy reinstall configuration-check model-check repair-local-endpoints pause-sync archive-roundtrip library-check recover-database safety-check apply-solution undo-solution'.split(' '));
const statuses = new Set('running passed failed blocked reverted'.split(' '));
export function safeError(value) {
  const text = String(value ?? '');
  const found = text.match(/\b(?:ERR_[A-Z_]+|EACCES|EPERM|ENOSPC|ENOENT|SQLITE_[A-Z_]+|MODULE_NOT_FOUND)\b/);
  return code(found ? found[0] : text);
}
export function publicReport(inspection, session, findings, errors) {
  const version = /^\d+\.\d+\.\d+(?:-[a-z0-9.-]+)?$/i.test(inspection.version ?? '') ? inspection.version : 'unknown';
  return {
    format: 'nodus.support-report', version: 1, appVersion: version,
    platform: ['win32', 'darwin', 'linux'].includes(inspection.platform) ? inspection.platform : 'unknown',
    arch: ['x64', 'arm64'].includes(inspection.arch) ? inspection.arch : 'unknown',
    symptom: ['startup', 'tool', 'data', 'sync', 'update', 'other'].includes(session.symptom) ? session.symptom : 'other',
    status: ['created', 'protecting', 'protected', 'testing', 'awaiting-user', 'confirmed', 'reverted', 'blocked', 'interrupted', 'conflict'].includes(session.status) ? session.status : 'blocked',
    findings: findings.map(f => ({ code: code(f.code), component: component(f.component), level: ['error', 'warning', 'info'].includes(f.level) ? f.level : 'info' })),
    tests: session.actions.map(a => ({ action: actions.has(a.action) ? a.action : 'unknown-test', status: statuses.has(a.status) ? a.status : 'unknown', ...(a.code ? { code: code(a.code) } : {}) })),
    errors: errors.map(e => ({ code: code(e.code), component: component(e.component), ...(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{3})?Z$/.test(e.at ?? '') ? { at: e.at } : {}) })),
  };
}
export function reportMarkdown(report) {
  return `# Nodus support report\n\nNodus: ${report.appVersion}\nSystem: ${report.platform} ${report.arch}\nProblem: ${report.symptom}\nStatus: ${report.status}\n\n## Findings\n\n${report.findings.map(f => `- ${f.component}: ${f.code}`).join('\n') || '- No classified finding'}\n\n## Tests and changes\n\n${report.tests.map(t => `- ${t.action}: ${t.status}${t.code ? ` (${t.code})` : ''}`).join('\n') || '- No repair applied'}\n\n## Error codes\n\n${report.errors.map(e => `- ${e.at ? `${e.at} ` : ''}${e.component}: ${e.code}`).join('\n') || '- No classified errors available'}\n\nSupport does not delete source data or recovery copies. This report selects technical fields; it contains no documents or raw logs. Review edited text before sharing.\n`;
}
export function issueDraft(report, reviewed) {
  const base = 'https://github.com/jorgepb96/nodus/issues/new';
  const summary = `Nodus ${report.appVersion}; ${report.platform} ${report.arch}; ${report.symptom}; ${report.status}.`;
  const params = new URLSearchParams({ template: 'bug_report.yml', title: `[Bug] ${report.symptom} (${report.platform})`, version: report.appVersion, environment: `${report.platform} ${report.arch}`, description: summary, additional: reviewed });
  let issueUrl = `${base}?${params}`; const needsClipboard = issueUrl.length > 2000;
  if (needsClipboard) { params.set('additional', 'The reviewed support report is available locally. Paste it here before publishing.'); issueUrl = `${base}?${params}`; }
  return { issueUrl, needsClipboard };
}
