import { learningText } from '@shared/academicLearningCopy';
import { getActiveLang } from '../i18n';
import { useState } from 'react';
import { motion } from 'framer-motion';
import type { VaultSummary, VaultType } from '@shared/types';
import { NodiAvatar } from '../components/nodi/NodiAvatar';
import { Icon } from '../components/ui';
import {
  isPreAlphaVaultType,
  PreAlphaVaultConfirmation,
  VaultTypePicker,
} from '../components/vaultTypeUi';
import { errorText, t } from '../i18n';

/**
 * "Your first vault" — the screen that follows the cinematic guide.
 *
 * Nodus used to hand every newcomer an academic vault called «Principal» and leave them
 * to discover, later and by accident, that the mode was a choice at all. The guide has
 * just spent its running time explaining that a vault IS the choice, so this asks it
 * while the explanation is still fresh.
 *
 * It RENAMES and RETYPES the vault the install already has rather than creating a
 * second one: the registry always materialises a first vault (`defaultVaultRecord` in
 * electron/vaults/vaultRegistry.ts) and re-adds it if it is ever removed, so creating
 * one here would leave an orphaned «Principal» behind for every new user.
 *
 * The mode grid is `VaultTypePicker`, the same component the switcher's "Añadir bóveda"
 * modal renders — same available types, same PREVIEW/BETA/Pronto tags, same notices —
 * so the two can never drift apart.
 */

/**
 * Bumped only if this screen must be shown again to installs that already answered it.
 * Stored app-wide in `firstVaultVersion`, next to `basicsTutorialVersion`.
 */
export const FIRST_VAULT_VERSION = 1;

export function FirstVaultSetup({
  vault,
  onComplete,
}: {
  /** The vault this install already has; it is renamed and retyped, never duplicated. */
  vault: VaultSummary;
  onComplete: () => Promise<unknown>;
}) {
  // Pre-filled so the screen is never a dead end: the newcomer can press Enter and move
  // on, and rename the vault from the switcher at any point afterwards.
  const [name, setName] = useState(() => t('Mi bóveda'));
  const [type, setType] = useState<VaultType>('academic');
  const [nameError, setNameError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [preAlphaConfirmOpen, setPreAlphaConfirmOpen] = useState(false);

  const submit = async (preAlphaConfirmed = false) => {
    if (busy) return;
    const trimmed = name.trim();
    if (!trimmed) {
      setNameError(t('Escribe un nombre para la bóveda.'));
      return;
    }
    setNameError(null);
    setError(null);
    if (isPreAlphaVaultType(type) && !preAlphaConfirmed) {
      setPreAlphaConfirmOpen(true);
      return;
    }
    setBusy(true);
    try {
      await window.nodus.renameVault(vault.id, trimmed);
      await window.nodus.setVaultType(vault.id, type);
      // Written last: if either call above fails the screen stays up and can be retried,
      // rather than being marked answered with the vault left half-configured.
      await window.nodus.updateSettings({ firstVaultVersion: FIRST_VAULT_VERSION, ...(type === 'academic' ? { academicInterfaceProfile: 'simple' as const } : { basicsTutorialVersion:0 }) });
      await onComplete();
    } catch (cause) {
      setError(errorText(cause));
      setBusy(false);
    }
  };

  return (
    <>
      <div className="tutorial-cinema tutorial-language-screen first-vault-screen" data-testid="first-vault-setup" role="dialog" aria-modal="true" aria-labelledby="first-vault-title">
        <div className="tutorial-aurora" aria-hidden="true" />
        <motion.main
          className="tutorial-language-card first-vault-card"
          initial={{ opacity: 0, y: 24, scale: .97 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ duration: .42, ease: [0.2, 0.8, 0.2, 1] }}
        >
          <div className="first-vault-intro">
            <NodiAvatar state="celebrating" height={108} />
            <div className="first-vault-copy">
              <p className="tutorial-eyebrow tutorial-language-brand"><Icon name="layers" size={15} /> {t('TU PRIMERA BÓVEDA')}</p>
              <h1 id="first-vault-title">{t('Vamos a crear tu primera bóveda')}</h1>
              <p>{t('Ponle un nombre y elige su modo. El modo decide qué secciones verás y cómo trabaja la IA contigo; puedes crear más bóvedas, de otros modos, cuando quieras.')}</p>
            </div>
          </div>

          <div className="first-vault-form">
            <label className="block text-left text-sm">
              {t('Nombre de la bóveda')}
              <input
                className="input mt-1 w-full"
                autoFocus
                data-testid="first-vault-name"
                aria-invalid={Boolean(nameError)}
                aria-describedby={nameError ? 'first-vault-name-error' : undefined}
                value={name}
                disabled={busy}
                onChange={(event) => { setName(event.target.value); if (nameError) setNameError(null); }}
                onKeyDown={(event) => { if (event.key === 'Enter') void submit(); }}
                placeholder={t('Nombre de la bóveda')}
              />
              {nameError && <span id="first-vault-name-error" data-testid="first-vault-name-error" role="alert" className="mt-1 block text-xs text-red-400">{nameError}</span>}
            </label>

            <div className="mt-4 text-left">
              <div className="mb-1.5 text-xs text-neutral-500">{t('Tipo de bóveda')}</div>
              <VaultTypePicker value={type} onChange={setType} disabled={busy} />
            </div>

            {error && <p role="alert" data-testid="first-vault-error" className="mt-3 rounded-lg border border-red-900/60 bg-red-950/20 px-3 py-2 text-left text-xs text-red-300">{error}</p>}

            <div className="first-vault-footer">
              <p className="flex min-w-0 flex-1 items-start gap-2 text-left text-xs leading-5 text-neutral-500" data-testid="first-vault-next-step">
                <Icon name="info" size={14} className="mt-0.5 shrink-0" />
                <span>{type==='academic'?learningText('intro',getActiveLang()):t('Después el asistente te ayudará a elegir su modelo de IA y su modelo de embeddings. Puedes cambiar el nombre en cualquier momento desde el selector de bóvedas.')}</span>
              </p>
              <button className="btn btn-primary gap-1.5" data-testid="first-vault-create" onClick={() => void submit()} disabled={busy}>
                <Icon name={busy ? 'sync' : 'check'} className={busy ? 'animate-spin' : ''} />
                {busy ? t('Preparando…') : t('Crear mi bóveda')}
              </button>
            </div>
          </div>
        </motion.main>
      </div>
      {preAlphaConfirmOpen && (
        <PreAlphaVaultConfirmation
          type={type}
          onCancel={() => setPreAlphaConfirmOpen(false)}
          onConfirm={() => {
            setPreAlphaConfirmOpen(false);
            void submit(true);
          }}
        />
      )}
    </>
  );
}
