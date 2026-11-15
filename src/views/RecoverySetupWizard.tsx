import { motion } from 'framer-motion';
import { useState } from 'react';
import { t } from '../i18n';
import type {
  AppLanguage,
  RecoveryFolderInspection,
  RecoveryRestoreProgress,
  RecoverySetupResult,
  RecoveryStatus,
} from '@shared/types';
import { Icon } from '../components/ui';
import { NodiAvatar } from '../components/nodi/NodiAvatar';
import { backupPasswordsMatch, validateBackupPassword } from '@shared/backupPasswordPolicy';

type Mode = 'create' | 'restore';

export function RecoverySetupWizard({
  status,
  language,
  onComplete,
}: {
  status: RecoveryStatus;
  language: AppLanguage;
  onComplete: () => void | Promise<void>;
}) {
  const [mode, setMode] = useState<Mode>('create');
  const [folder, setFolder] = useState<RecoveryFolderInspection | null>(null);
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [recoveryKeyCopied, setRecoveryKeyCopied] = useState(false);
  const [selectedSnapshot, setSelectedSnapshot] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<RecoverySetupResult | null>(null);
  const [restoreProgress, setRestoreProgress] = useState<RecoveryRestoreProgress | null>(null);
  const [validationAttempted, setValidationAttempted] = useState(false);

  const snapshots = folder?.snapshots ?? [];
  const effectiveSnapshot = selectedSnapshot || snapshots[0]?.fileName || '';
  const passwordValidation = validateBackupPassword(password);
  const confirmationProvided = confirmPassword.trim().length > 0;
  const passwordsMatch = confirmationProvided && backupPasswordsMatch(password, confirmPassword);
  const canSubmit = mode === 'create'
    ? folder?.kind === 'empty' && passwordValidation.valid && passwordsMatch
    : folder?.kind === 'recovery' && Boolean(effectiveSnapshot) && passwordValidation.valid;
  const canAttemptSubmit = mode === 'create'
    ? folder?.kind === 'empty'
    : folder?.kind === 'recovery' && Boolean(effectiveSnapshot);
  const showPasswordError = !passwordValidation.valid && (validationAttempted || password.length > 0);
  const showConfirmationError = mode === 'create' && (
    (validationAttempted && !confirmationProvided)
    || (confirmationProvided && !passwordsMatch)
  );

  const chooseFolder = async () => {
    const picked = await window.nodus.chooseRecoveryFolder(mode, language);
    if (!picked) return;
    setFolder(picked);
    setSelectedSnapshot(picked.snapshots[0]?.fileName ?? '');
    setResult(null);
    setRestoreProgress(null);
    setValidationAttempted(false);
  };

  const submit = async () => {
    setValidationAttempted(true);
    if (!folder || !canSubmit) return;
    setBusy(true);
    setResult(null);
    if (mode === 'restore') setRestoreProgress({ phase: 'preparing', progress: 0, completedBytes: 0, totalBytes: 0 });
    try {
      const next = mode === 'create'
        ? await window.nodus.initializeRecoveryFolder(folder.path, password, language)
        : await window.nodus.restoreRecoverySnapshot(folder.path, effectiveSnapshot, password, language, setRestoreProgress);
      setResult(next);
      if (!next.ok) setRestoreProgress(null);
    } catch (error) {
      setResult({ ok: false, message: error instanceof Error ? error.message : String(error) });
      setRestoreProgress(null);
    } finally {
      setBusy(false);
    }
  };

  // A way through for someone who only wants to start: Nodus picks the folder and keeps
  // the credentials itself, and asks for the recovery kit later. Not offered over an
  // existing installation, whose vaults deserve a credential their owner chose.
  const quickStart = async () => {
    setBusy(true);
    setResult(null);
    try {
      const next = await window.nodus.quickStartRecovery(language, true);
      if (next.ok) await onComplete();
      else setResult(next);
    } catch (error) {
      setResult({ ok: false, message: error instanceof Error ? error.message : String(error) });
    } finally {
      setBusy(false);
    }
  };

  if (result?.ok) {
    return (
      <div className="recovery-cinema" data-testid="recovery-setup-success">
        <div className="recovery-aurora" aria-hidden="true" />
        <motion.main className="recovery-card recovery-success" initial={{ opacity: 0, y: 24, scale: .97 }} animate={{ opacity: 1, y: 0, scale: 1 }}>
          <NodiAvatar state="celebrating" height={220} />
          <div>
            <span className="recovery-kicker"><Icon name="check" size={14} /> {t('RECUPERACIÓN ACTIVADA')}</span>
            <h1>{mode === 'create' ? (t('Tus datos ya están protegidos')) : (t('Tus datos se han recuperado'))}</h1>
            <p>{result.message}</p>
            {result.snapshot && <div className="recovery-summary"><b>{result.snapshot.vaultCount} {t('bóveda(s)')}</b><span>{new Date(result.snapshot.date).toLocaleString()}</span><span>{formatBytes(result.snapshot.bytes)}</span></div>}
            {result.recoveryKey && (
              <div className="recovery-key" data-testid="recovery-key">
                <div><b>{t('Clave de recuperación independiente')}</b><small>{t('Permite recuperar tus copias aunque olvides la contraseña.')}</small></div>
                <code>{result.recoveryKey}</code>
                <button
                  className="btn btn-ghost"
                  onClick={() => void navigator.clipboard.writeText(result.recoveryKey ?? '').then(() => setRecoveryKeyCopied(true))}
                >
                  <Icon name={recoveryKeyCopied ? 'check' : 'copy'} />
                  {recoveryKeyCopied ? (t('Copiada')) : (t('Copiar clave'))}
                </button>
              </div>
            )}
            <p className="recovery-warning">{t('Guarda el kit fuera de este dispositivo. Podrás restaurar con la contraseña o con la clave de recuperación.')}</p>
            <div className="recovery-actions"><button className="btn btn-ghost" onClick={() => void window.nodus.saveBackupRecoveryKit()}><Icon name="download" />{t('Guardar kit de recuperación')}</button><button className="btn btn-primary" data-testid="recovery-setup-complete" onClick={() => void onComplete()}>{t('Continuar a Nodus')}<Icon name="chevronRight" /></button></div>
          </div>
        </motion.main>
      </div>
    );
  }

  return (
    <div className="recovery-cinema" data-testid="recovery-setup-wizard">
      <div className="recovery-aurora" aria-hidden="true" />
      <motion.main className="recovery-card" initial={{ opacity: 0, y: 28, scale: .97 }} animate={{ opacity: 1, y: 0, scale: 1 }}>
        <aside className="recovery-hero">
          <NodiAvatar state={busy ? 'loading' : status.previousInstallation ? 'discovering' : 'waving'} height={235} />
          <span className="recovery-kicker"><Icon name="archive" size={14} /> NODUS · {t('PROTECCIÓN DE DATOS')}</span>
          <h1>{status.previousInstallation ? (t('Hemos detectado una instalación anterior')) : (t('Elige dónde proteger Nodus'))}</h1>
          <p>{status.previousInstallation
            ? (t('Tus bóvedas actuales no se moverán ni se modificarán. Crearemos una primera copia cifrada y verificada antes de activar la recuperación.'))
            : (t('Configura una carpeta segura antes de empezar. Tus bóvedas seguirán trabajando localmente y Nodus guardará aquí copias recuperables.'))}</p>
          <div className="recovery-safety"><Icon name="lock" /><span>{t('La base de datos activa nunca se abre directamente desde Google Drive o Dropbox: así evitamos conflictos y corrupción.')}</span></div>
          {!status.previousInstallation && (
            <div className="recovery-quick-start" data-testid="recovery-quick-start">
              <button className="btn btn-ghost" data-testid="recovery-quick-start-button" disabled={busy} onClick={() => void quickStart()}><Icon name="chevronRight" />{t('Empezar ahora y protegerlo después')}</button>
              <small>{t('Nodus usará una carpeta propia en este ordenador y te recordará guardar el kit de recuperación más adelante.')}</small>
            </div>
          )}
        </aside>

        <section className="recovery-form">
          <div className="recovery-mode-tabs">
            <button className={mode === 'create' ? 'active' : ''} onClick={() => { setMode('create'); setFolder(null); setResult(null); setRestoreProgress(null); setValidationAttempted(false); }}><Icon name="lock" />{status.previousInstallation ? (t('Migrar y proteger este equipo')) : (t('Crear carpeta segura'))}</button>
            <button className={mode === 'restore' ? 'active' : ''} onClick={() => { setMode('restore'); setFolder(null); setResult(null); setRestoreProgress(null); setValidationAttempted(false); }}><Icon name="upload" />{t('Recuperar otro equipo')}</button>
          </div>

          <div className="recovery-block">
            <div><b>{mode === 'create' ? (t('1. Selecciona una carpeta vacía')) : (t('1. Selecciona la carpeta existente'))}</b><p>{mode === 'create'
              ? (t('Puede ser una carpeta local o una carpeta sincronizada por Google Drive, Dropbox, iCloud u otro servicio. Debe estar vacía.'))
              : (t('Busca la carpeta que contiene nodus-recovery.json y sus copias.'))}</p></div>
            <button className="btn btn-ghost recovery-folder-button" onClick={() => void chooseFolder()}><Icon name="folder" />{t('Elegir carpeta')}</button>
            {folder && <div className={`recovery-folder-result ${folder.kind}`}><Icon name={folder.kind === 'empty' || folder.kind === 'recovery' ? 'check' : 'alert'} /><span><b>{folder.path}</b><small>{folder.message}</small></span></div>}
          </div>

          {mode === 'create' && (
            <div className="recovery-block recovery-all-data">
              <Icon name="lock" />
              <div><b>{t('2. Todo Nodus quedará protegido')}</b><p>{t('Sin selecciones ni exclusiones: todas las bóvedas, documentos, preferencias, historiales, medios y claves API se incluirán automáticamente.')}</p></div>
            </div>
          )}

          {mode === 'restore' && folder?.kind === 'recovery' && snapshots.length > 0 && <div className="recovery-block"><div><b>{t('2. Elige una copia')}</b><p>{t('La más reciente aparece seleccionada. Puedes recuperar una versión anterior.')}</p></div><select className="input w-full" value={effectiveSnapshot} onChange={(event) => setSelectedSnapshot(event.target.value)}>{snapshots.map((snapshot) => <option key={snapshot.fileName} value={snapshot.fileName}>{new Date(snapshot.date).toLocaleString()} · {snapshot.vaultCount} vault(s) · {formatBytes(snapshot.bytes)} · Nodus {snapshot.appVersion}</option>)}</select></div>}

          <div className="recovery-block">
            <div><b>{mode === 'create' ? (t('3. Crea una contraseña maestra')) : (t('3. Introduce una credencial'))}</b><p>{mode === 'create'
              ? (t('Protege tus copias junto con una clave de recuperación independiente. Debe tener al menos 8 caracteres.'))
              : (t('Puedes usar la contraseña maestra o la clave de recuperación de tu kit.'))}</p></div>
            <PasswordField
              value={password}
              onChange={setPassword}
              visible={showPassword}
              onToggle={() => setShowPassword((value) => !value)}
              placeholder={mode === 'restore' ? (t('Contraseña o clave de recuperación')) : (t('Contraseña maestra'))}
              language={language}
              invalid={showPasswordError}
              describedBy="recovery-password-requirement"
              testId="recovery-password"
            />
            <small
              id="recovery-password-requirement"
              data-testid="recovery-password-requirement"
              className={passwordValidation.valid ? 'text-emerald-400' : showPasswordError ? 'text-red-400' : 'text-neutral-500'}
              role={showPasswordError ? 'alert' : undefined}
              aria-live="polite"
            >
              {passwordValidation.valid
                ? t('La contraseña cumple el mínimo de 8 caracteres.')
                : t('La contraseña debe tener al menos 8 caracteres. Los números y símbolos son opcionales.')}
            </small>
            {mode === 'create' && <PasswordField value={confirmPassword} onChange={setConfirmPassword} visible={showPassword} onToggle={() => setShowPassword((value) => !value)} placeholder={t('Repite la contraseña')} language={language} invalid={showConfirmationError} describedBy={showConfirmationError ? 'recovery-password-confirmation-error' : undefined} testId="recovery-password-confirmation" />}
            {showConfirmationError && (
              <small id="recovery-password-confirmation-error" className="text-red-400" role="alert" aria-live="polite">
                {confirmationProvided ? t('Las contraseñas no coinciden.') : t('Repite la contraseña para confirmar.')}
              </small>
            )}
          </div>

          {result && !result.ok && <div className="recovery-error"><Icon name="alert" />{result.message}</div>}
          {mode === 'restore' && busy && restoreProgress && (
            <div
              className="recovery-restore-progress"
              data-testid="recovery-restore-progress"
              data-phase={restoreProgress.phase}
              role="progressbar"
              aria-live="polite"
              aria-label={t('Progreso de restauración')}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.round(restoreProgress.progress * 100)}
            >
              <div className="recovery-restore-progress-heading">
                <span>{restoreProgressLabel(restoreProgress.phase)}</span>
                <b>{Math.round(restoreProgress.progress * 100)}%</b>
              </div>
              <div className="recovery-restore-progress-track" aria-hidden="true">
                <span style={{ width: `${Math.max(0, Math.min(100, restoreProgress.progress * 100))}%` }} />
              </div>
              {restoreProgress.totalBytes > 0 && (
                <small>{formatBytes(restoreProgress.completedBytes)} / {formatBytes(restoreProgress.totalBytes)}</small>
              )}
            </div>
          )}
          <footer className="recovery-footer"><span><Icon name="lock" />{t('AES-256-GCM · instantáneas SQLite consistentes · hashes de integridad')}</span><button className="btn btn-primary" disabled={!canAttemptSubmit || busy} onClick={() => void submit()}>{busy ? (mode === 'restore' && restoreProgress ? restoreProgressLabel(restoreProgress.phase) : t('Verificando y guardando…')) : mode === 'create' ? (t('Crear primera copia segura')) : (t('Verificar y recuperar'))}<Icon name={busy ? 'sync' : 'chevronRight'} className={busy ? 'animate-spin' : ''} /></button></footer>
        </section>
      </motion.main>
    </div>
  );
}

function restoreProgressLabel(phase: RecoveryRestoreProgress['phase']): string {
  if (phase === 'preparing') return t('Preparando…');
  if (phase === 'decrypting') return t('Descifrando…');
  if (phase === 'verifying') return t('Verificando…');
  if (phase === 'restoring') return t('Restaurando…');
  if (phase === 'finalizing' || phase === 'complete') return t('Finalizando…');
  return t('Restaurando…');
}

function PasswordField({ value, onChange, visible, onToggle, placeholder, language, invalid = false, describedBy, testId }: {
  value: string;
  onChange: (value: string) => void;
  visible: boolean;
  onToggle: () => void;
  placeholder: string;
  language: AppLanguage;
  invalid?: boolean;
  describedBy?: string;
  testId?: string;
}) {
  return <div className="recovery-password-field"><input className="input w-full" type={visible ? 'text' : 'password'} value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} aria-invalid={invalid} aria-describedby={describedBy} data-testid={testId} /><button type="button" onClick={onToggle} aria-label={visible ? (language === 'en' ? 'Hide password' : 'Ocultar contraseña') : (language === 'en' ? 'Show password' : 'Mostrar contraseña')} title={visible ? (language === 'en' ? 'Hide password' : 'Ocultar contraseña') : (language === 'en' ? 'Show password' : 'Mostrar contraseña')}><Icon name={visible ? 'eyeOff' : 'eye'} /></button></div>;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
}
