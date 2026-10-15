import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { selectorPanelMotion } from './selectorMotion';
import type { AppSettings, CustomAppTheme, RemoteSignIn, VaultSummary, VaultType } from '@shared/types';
import { isPreviewVaultType } from '@shared/vaultTypes';
import { errorText, t, tr, tx } from '../i18n';
import { clearFilterPreferences } from '../app/filterPreferences';
import { ConfirmModal } from './ConfirmModal';
import { ThemePalettePicker, themePickerOptions } from './ThemePalettePicker';
import { Icon } from './ui';
import {
  NEW_VAULT_TYPES,
  isPreAlphaVaultType,
  PreAlphaVaultConfirmation,
  PreviewBadge,
  VAULT_TYPE_COLOR,
  VaultPhaseBadge,
  VaultTypePicker,
  vaultTypeIcon,
  vaultTypeLabel,
  vaultTypePhase,
} from './vaultTypeUi';

// The vault-type vocabulary — labels, glyphs, colours, phases and the picker itself —
// lives in ./vaultTypeUi so this modal and the first-run chooser can never disagree
// about which modes exist or how they are tagged. Re-exported here because the header
// and Settings have imported them from this file since before that split.
export { vaultTypeIcon, vaultTypeLabel } from './vaultTypeUi';

interface VaultSwitcherProps {
  /** Trigger element the panel anchors under (centre badge or right-rail icon);
   *  null when the panel is closed. */
  anchorEl: HTMLElement | null;
  onClose: () => void;
  vaults: VaultSummary[];
  onVaultsChanged: () => Promise<unknown>;
  onActiveVaultChanged: () => Promise<unknown>;
}

type DestructiveKind = 'delete' | 'reset';
type DestructiveStep = 'intro' | 'code' | 'final';
type SortKey = 'recent' | 'created' | 'name';

interface PendingDestructiveAction {
  kind: DestructiveKind;
  vault: VaultSummary;
}

function generateFourDigitCode(): string {
  return Array.from({ length: 4 }, () => Math.floor(Math.random() * 10)).join('');
}

export function VaultSwitcher({ anchorEl, onClose, vaults, onVaultsChanged, onActiveVaultChanged }: VaultSwitcherProps) {
  const open = anchorEl != null;
  const reducedMotion = useReducedMotion();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  // Fixed-position placement computed from the trigger's rect so the panel unfolds
  // directly under whichever trigger opened it (centre badge or right-rail icon).
  const [pos, setPos] = useState<{ left: number; top: number; width: number; originX: number } | null>(null);

  // Panel filters.
  const [query, setQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState<VaultType | 'all'>('all');
  const [sortKey, setSortKey] = useState<SortKey>('recent');

  // Add-vault modal.
  const [addOpen, setAddOpen] = useState(false);
  const [addName, setAddName] = useState('');
  const [addNameError, setAddNameError] = useState<string | null>(null);
  const [addType, setAddType] = useState<VaultType>('academic');
  const [addError, setAddError] = useState<string | null>(null);
  // Appearance for the vault being created. `null` means the step was left alone, so
  // creating writes nothing and the vault keeps whatever the scope gives it.
  const [addPalette, setAddPalette] = useState<AppSettings['appTheme'] | null>(null);
  const [addSharesPalette, setAddSharesPalette] = useState<boolean | null>(null);
  const [addPaletteOpen, setAddPaletteOpen] = useState(false);
  const [addAppearance, setAddAppearance] = useState<{ appTheme: AppSettings['appTheme']; shareAppThemeAcrossVaults: boolean; customThemes: CustomAppTheme[] } | null>(null);
  const [preAlphaConfirmOpen, setPreAlphaConfirmOpen] = useState(false);

  // Connected-vault flow. Signing in returns a ticket plus the spaces this account can
  // reach, so the space is picked from what the server actually offers rather than typed.
  const [addMode, setAddMode] = useState<'local' | 'connected'>('local');
  const [remoteUrl, setRemoteUrl] = useState('');
  const [remoteEmail, setRemoteEmail] = useState('');
  const [remotePassword, setRemotePassword] = useState('');
  const [showRemotePassword, setShowRemotePassword] = useState(false);
  const [remoteSession, setRemoteSession] = useState<RemoteSignIn | null>(null);
  const [remoteSpaceId, setRemoteSpaceId] = useState('');

  // Rename / duplicate modals.
  const [renameTarget, setRenameTarget] = useState<VaultSummary | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [dupTarget, setDupTarget] = useState<VaultSummary | null>(null);
  const [dupName, setDupName] = useState('');

  // Delete / reset (two-step confirmation + manual code).
  const [pendingAction, setPendingAction] = useState<PendingDestructiveAction | null>(null);
  const [destructiveStep, setDestructiveStep] = useState<DestructiveStep>('intro');
  const [destructiveCode, setDestructiveCode] = useState('');
  const [destructiveEntry, setDestructiveEntry] = useState('');
  const [destructiveError, setDestructiveError] = useState<string | null>(null);

  // Position the popover under its anchor, clamped to the viewport, and keep it
  // pinned on resize/scroll. `originX` points the unfold animation at the anchor.
  useLayoutEffect(() => {
    if (!open || !anchorEl) {
      setPos(null);
      return;
    }
    const compute = () => {
      const r = anchorEl.getBoundingClientRect();
      const width = Math.min(520, window.innerWidth - 32);
      const rawLeft = r.left + r.width / 2 - width / 2;
      const left = Math.max(16, Math.min(rawLeft, window.innerWidth - width - 16));
      setPos({ left, top: r.bottom + 8, width, originX: r.left + r.width / 2 - left });
    };
    compute();
    window.addEventListener('resize', compute);
    window.addEventListener('scroll', compute, true);
    return () => {
      window.removeEventListener('resize', compute);
      window.removeEventListener('scroll', compute, true);
    };
  }, [open, anchorEl]);

  // Dismiss on outside click / Escape. Clicks on a trigger (`data-vault-trigger`)
  // or inside an open child modal (`[role="dialog"]`) are ignored so they can
  // toggle or interact without the panel yanking closed underneath them.
  useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (panelRef.current?.contains(target)) return;
      if (target instanceof Element && target.closest('[data-vault-trigger],[role="dialog"]')) return;
      onClose();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('mousedown', onDown, true);
    window.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown, true);
      window.removeEventListener('keydown', onKey);
    };
  }, [open, onClose]);

  const run = async (task: () => Promise<void>) => {
    setBusy(true);
    setMessage(null);
    try {
      await task();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  // Filtered + sorted vault list for the panel.
  const shownVaults = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = vaults.filter(
      (v) => (typeFilter === 'all' || v.type === typeFilter) && (!q || (v.name ?? '').toLowerCase().includes(q))
    );
    const byRecent = (a: VaultSummary, b: VaultSummary) => (b.lastOpenedAt || '').localeCompare(a.lastOpenedAt || '');
    const byCreated = (a: VaultSummary, b: VaultSummary) => (b.createdAt || '').localeCompare(a.createdAt || '');
    const byName = (a: VaultSummary, b: VaultSummary) => (a.name ?? '').localeCompare(b.name ?? '');
    return [...filtered].sort(sortKey === 'created' ? byCreated : sortKey === 'name' ? byName : byRecent);
  }, [vaults, query, typeFilter, sortKey]);

  // What the wizard shows before anything is touched: the shared palette while the
  // profile shares one, and the default otherwise — a new vault never starts on the
  // palette of the vault that happened to be open.
  const addPaletteOptions = useMemo(() => themePickerOptions(addAppearance?.customThemes ?? []), [addAppearance]);
  const selectedPalette = addPaletteOptions.find((option) => option.id === (
    addPalette ?? (addAppearance?.shareAppThemeAcrossVaults ? addAppearance.appTheme : 'default')
  )) ?? addPaletteOptions[0];

  const openAddVault = () => {
    setAddNameError(null);
    setAddError(null);
    setShowRemotePassword(false);
    setAddPaletteOpen(false);
    // The palette step shows what the vault would get if nothing is touched: the
    // shared palette while the profile shares one, and the default otherwise, since
    // a vault never inherits the palette of the vault that happened to be open.
    setAddPalette(null);
    setAddSharesPalette(null);
    setAddAppearance(null);
    void window.nodus.getSettings()
      .then((current) => setAddAppearance({
        appTheme: current.appTheme,
        shareAppThemeAcrossVaults: current.shareAppThemeAcrossVaults,
        customThemes: current.customThemes ?? [],
      }))
      .catch(() => setAddAppearance(null));
    setAddOpen(true);
  };

  const loadVault = (vaultId: string) =>
    run(async () => {
      const result = await window.nodus.switchVault(vaultId);
      setMessage(tr(result.message));
      if (result.ok) {
        await onActiveVaultChanged();
        onClose();
      } else {
        await onVaultsChanged();
      }
    });

  /** Dismiss the add-vault dialog, leaving nothing typed behind it — a revealed
   *  password must never still be on screen the next time it opens. */
  const closeAddModal = () => {
    setAddOpen(false);
    setShowRemotePassword(false);
  };

  /**
   * Connect to a Nodus Server space, in the two steps the server itself imposes.
   *
   * First press signs in and lists the spaces this account can reach; second press takes a
   * device token for the chosen one and hydrates the replica. Splitting it this way is what
   * lets the user pick from what really exists instead of typing a space id, and it means
   * the password is sent exactly once.
   */
  const connectVault = async () => {
    if (busy) return;
    setAddError(null);
    setBusy(true);
    try {
      if (!remoteSession) {
        const session = await window.nodus.remoteSignIn(remoteUrl, remoteEmail, remotePassword);
        setRemoteSession(session);
        setRemoteSpaceId(session.spaces[0]?.id ?? '');
        // The password is not kept once it has been exchanged for a ticket.
        setRemotePassword('');
        setShowRemotePassword(false);
        return;
      }
      const space = remoteSession.spaces.find((candidate) => candidate.id === remoteSpaceId);
      if (!space) {
        setAddError(t('Elige el espacio al que quieres conectarte.'));
        return;
      }
      const created = await window.nodus.createConnectedVault({
        url: remoteSession.url,
        ticket: remoteSession.ticket,
        space,
        userEmail: remoteSession.userEmail,
        serverName: remoteSession.serverName,
        serverKind: remoteSession.serverKind,
      });
      const switched = await window.nodus.switchVault(created.vault.id);
      if (!switched.ok) throw new Error(switched.message);
      setAddOpen(false);
      setRemoteSession(null);
      setRemoteSpaceId('');
      setRemoteUrl('');
      setRemoteEmail('');
      setMessage(tr(switched.message));
      await onActiveVaultChanged();
      onClose();
    } catch (error) {
      // A ticket is single use, so a failure past that point has to start over rather than
      // leave the user pressing a button that can no longer work.
      setRemoteSession(null);
      setAddError(errorText(error));
    } finally {
      setBusy(false);
    }
  };

  const createVault = async (preAlphaConfirmed = false) => {
    if (busy) return;
    const name = addName.trim();
    if (!name) {
      setAddNameError(t('Escribe un nombre para la bóveda.'));
      return;
    }
    setAddNameError(null);
    if (isPreAlphaVaultType(addType) && !preAlphaConfirmed) {
      setPreAlphaConfirmOpen(true);
      return;
    }

    let createdVaultId: string | null = null;
    setAddError(null);
    setBusy(true);
    try {
      // The vault is created bare: its AI and embedding models are chosen in the
      // setup wizard that opens right after, where Nodus can discover them from
      // the keys already stored instead of asking here.
      const created = await window.nodus.createVault({ name, type: addType });
      createdVaultId = created.vault.id;
      const result = await window.nodus.switchVault(created.vault.id);
      if (!result.ok) throw new Error(result.message);
      createdVaultId = null;
      // The palette step belongs to the vault that is now active: with the palette
      // shared it lands in the profile store, and otherwise it is stored on the vault
      // itself rather than inherited from whichever vault was open before.
      if (addPalette !== null || addSharesPalette !== null) {
        await window.nodus.updateSettings({
          ...(addPalette !== null ? { appTheme: addPalette } : {}),
          ...(addSharesPalette !== null ? { shareAppThemeAcrossVaults: addSharesPalette } : {}),
        });
      }
      setAddOpen(false);
      setPreAlphaConfirmOpen(false);
      setAddName('');
      setAddType('academic');
      setAddPalette(null);
      setAddSharesPalette(null);
      setAddAppearance(null);
      setAddPaletteOpen(false);
      setMessage(tr(result.message));
      await onActiveVaultChanged();
      onClose();
    } catch (error) {
      if (createdVaultId) {
        await window.nodus.deleteVault(createdVaultId, true).catch(() => undefined);
      }
      setAddError(errorText(error));
      await onVaultsChanged();
    } finally {
      setBusy(false);
    }
  };

  const confirmRename = () =>
    run(async () => {
      if (!renameTarget) return;
      const name = renameValue.trim();
      if (!name) {
        setMessage(t('Escribe un nombre para la bóveda.'));
        return;
      }
      await window.nodus.renameVault(renameTarget.id, name);
      setRenameTarget(null);
      await onVaultsChanged();
      setMessage(t('Bóveda renombrada.'));
    });

  const confirmDuplicate = () =>
    run(async () => {
      if (!dupTarget) return;
      const name = dupName.trim();
      if (!name) {
        setMessage(t('Escribe un nombre para la bóveda.'));
        return;
      }
      await window.nodus.duplicateVault(dupTarget.id, name);
      setDupTarget(null);
      await onVaultsChanged();
      setMessage(t('Bóveda duplicada.'));
    });

  const startDestructiveAction = (kind: DestructiveKind, vault: VaultSummary) => {
    setPendingAction({ kind, vault });
    setDestructiveStep('intro');
    setDestructiveCode(generateFourDigitCode());
    setDestructiveEntry('');
    setDestructiveError(null);
  };
  const closeDestructiveAction = () => {
    setPendingAction(null);
    setDestructiveEntry('');
    setDestructiveError(null);
  };
  const confirmDestructiveCode = () => {
    if (destructiveEntry !== destructiveCode) {
      setDestructiveError(destructiveEntry.length === 4 ? t('Código incorrecto.') : t('Escribe las cuatro cifras para continuar.'));
      return;
    }
    setDestructiveError(null);
    setDestructiveStep('final');
  };
  const executeDestructiveAction = () => {
    if (!pendingAction) return;
    const action = pendingAction;
    closeDestructiveAction();
    void run(async () => {
      if (action.kind === 'delete') {
        await window.nodus.deleteVault(action.vault.id, true);
        // The gallery preferences of a vault that no longer exists are not a cut of
        // anything; they would only sit in the store until a new vault reused the id.
        clearFilterPreferences(action.vault.id);
        await onVaultsChanged();
        setMessage(t('Bóveda eliminada.'));
        return;
      }
      await window.nodus.resetVault(action.vault.id);
      if (action.vault.active) {
        await onActiveVaultChanged();
        onClose();
      } else {
        await onVaultsChanged();
      }
      setMessage(t('Bóveda reinicializada.'));
    });
  };

  const deleteDisabledReason = (v: VaultSummary) =>
    v.active
      ? t('La bóveda activa no se puede eliminar. Carga otra bóveda antes.')
      : v.legacy
        ? t('La bóveda principal no se puede eliminar; puedes reinicializarla.')
        : null;

  return (
    <>
      {createPortal(
        <AnimatePresence>
          {open && pos && (
            <motion.div
              ref={panelRef}
              data-testid="vault-switcher-panel"
              data-browser-native-overlay="true"
              key="vault-panel"
              {...selectorPanelMotion(Boolean(reducedMotion) || document.documentElement.classList.contains('reduce-motion'))}
              style={{
                position: 'fixed',
                left: pos.left,
                top: pos.top,
                width: pos.width,
                transformOrigin: `${pos.originX}px top`,
                zIndex: 55,
              }}
              className="overflow-hidden rounded-lg border border-neutral-800 bg-neutral-950 shadow-2xl"
            >
          <div className="flex items-center justify-between gap-2 border-b border-neutral-800 px-3 py-2">
            <div className="text-sm font-semibold text-neutral-200">{tx('Bóvedas ({n})', { n: vaults.length })}</div>
            <div className="flex items-center gap-1">
              <button className="btn btn-primary gap-1.5 px-2 py-1 text-xs" onClick={openAddVault} title={t('Añadir bóveda')}>
                <Icon name="plus" size={14} /> {t('Añadir')}
              </button>
              <button className="btn btn-ghost px-2 py-1" onClick={() => onClose()} title={t('Cerrar')}>
                <Icon name="x" />
              </button>
            </div>
          </div>

          {/* Search + type filter + sort */}
          <div className="flex flex-wrap items-center gap-2 border-b border-neutral-800 px-3 py-2">
            <div className="relative min-w-0 flex-1">
              <Icon name="search" size={13} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-neutral-500" />
              <input
                className="input input-with-leading-icon h-8 w-full py-1 text-xs"
                placeholder={t('Buscar bóvedas…')}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </div>
            <select
              className="input h-8 w-auto min-w-0 py-1 text-xs"
              value={typeFilter}
              onChange={(e) => setTypeFilter(e.target.value as VaultType | 'all')}
              title={t('Filtrar por tipo')}
            >
              <option value="all">{t('Todos los tipos')}</option>
              {NEW_VAULT_TYPES.map((tp) => (
                <option key={tp} value={tp}>
                  {vaultTypeLabel(tp)}
                </option>
              ))}
            </select>
            <select
              className="input h-8 w-auto min-w-0 py-1 text-xs"
              value={sortKey}
              onChange={(e) => setSortKey(e.target.value as SortKey)}
              title={t('Ordenar')}
            >
              <option value="recent">{t('Último uso')}</option>
              <option value="created">{t('Fecha de creación')}</option>
              <option value="name">{t('Nombre')}</option>
            </select>
          </div>

          <div className="max-h-[62vh] space-y-1.5 overflow-y-auto p-3">
            {shownVaults.length === 0 && <p className="px-1 py-2 text-xs text-neutral-500">{t('Sin coincidencias.')}</p>}
            {shownVaults.map((vault) => {
              const delReason = deleteDisabledReason(vault);
              return (
                <div key={vault.id} className="flex min-w-0 items-center gap-2 rounded-md border border-neutral-800 px-2 py-2">
                  <span data-testid={`vault-type-icon-${vault.type}`} className="grid h-7 w-7 shrink-0 place-items-center rounded-md text-white" style={{ backgroundColor: VAULT_TYPE_COLOR[vault.type] ?? '#6366f1' }}>
                    <Icon name={vaultTypeIcon(vault.type)} size={15} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex min-w-0 items-center gap-1.5">
                      <span className="truncate text-sm text-neutral-200">{vault.name}</span>
                      {vault.active && <span className="shrink-0 rounded bg-indigo-600 px-1 py-0.5 text-[9px] font-semibold uppercase text-white">{t('Activa')}</span>}
                    </div>
                    <div className="flex items-center gap-1.5 text-xs text-neutral-500">
                      <span className="truncate">{vaultTypeLabel(vault.type)}</span>
                      {vaultTypePhase(vault.type) && <VaultPhaseBadge phase={vaultTypePhase(vault.type)!} compact />}
                      {isPreviewVaultType(vault.type) && <PreviewBadge compact />}
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-0.5">
                    <IconBtn
                      icon={vault.active ? 'check' : 'play'}
                      title={vault.active ? t('Bóveda activa') : t('Cargar')}
                      onClick={() => !vault.active && void loadVault(vault.id)}
                      disabled={busy || vault.active}
                    />
                    <IconBtn
                      icon="edit"
                      title={t('Renombrar')}
                      onClick={() => {
                        setRenameTarget(vault);
                        setRenameValue(vault.name);
                      }}
                      disabled={busy}
                    />
                    <IconBtn
                      icon="copy"
                      title={t('Duplicar')}
                      onClick={() => {
                        setDupTarget(vault);
                        setDupName(tx('{name} copia', { name: vault.name }));
                      }}
                      disabled={busy}
                    />
                    <IconBtn
                      icon="trash"
                      title={delReason ?? t('Eliminar')}
                      danger
                      onClick={() => startDestructiveAction('delete', vault)}
                      disabled={busy || Boolean(delReason)}
                    />
                  </div>
                </div>
              );
            })}

            {message && <div className="rounded-md border border-neutral-800 px-2 py-1 text-xs text-neutral-300">{message}</div>}
          </div>
            </motion.div>
          )}
        </AnimatePresence>,
        document.body
      )}

      {/* Add-vault modal */}
      {addOpen &&
        createPortal(
          <ModalShell title={t('Añadir bóveda')} onCancel={() => { if (!busy) closeAddModal(); }} wide>
            <div className="mb-4 grid grid-cols-2 gap-2" role="radiogroup" aria-label={t('Origen de la bóveda')}>
              {(['local', 'connected'] as const).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  role="radio"
                  aria-checked={addMode === mode}
                  data-testid={`vault-origin-${mode}`}
                  disabled={busy}
                  onClick={() => { setAddMode(mode); setAddError(null); }}
                  className={`rounded-xl border px-3 py-2.5 text-left transition ${addMode === mode ? 'border-indigo-500 bg-indigo-500/10' : 'border-neutral-800 hover:border-neutral-700'}`}
                >
                  <span className="block text-sm font-medium">{mode === 'local' ? t('Bóveda local') : t('Bóveda conectada')}</span>
                  <span className="mt-0.5 block text-xs leading-4 text-neutral-500">
                    {mode === 'local'
                      ? t('Vive solo en este equipo. Es lo habitual.')
                      : t('Réplica de un espacio de Nodus Server. Necesitas su dirección y tus credenciales.')}
                  </span>
                </button>
              ))}
            </div>

            {/* Both origins live in one box of fixed height: the connected form is a
                third as tall as the nine-mode grid, and without this the dialog jumped
                between two sizes every time you switched origin. The inner padding
                keeps the selected mode's ring from being clipped by the scroller. */}
            <div className="-mx-1 h-[min(32rem,58vh)] overflow-y-auto px-1">
            {addMode === 'connected' ? (
              <div className="space-y-3">
                {!remoteSession ? (
                  <>
                    <label className="block text-sm">
                      {t('Dirección del servidor')}
                      <input className="input mt-1 w-full" type="url" placeholder="https://nodus.ejemplo.es" value={remoteUrl} onChange={(e) => setRemoteUrl(e.target.value)} />
                    </label>
                    <label className="block text-sm">
                      {t('Correo')}
                      <input className="input mt-1 w-full" type="email" autoComplete="username" value={remoteEmail} onChange={(e) => setRemoteEmail(e.target.value)} />
                    </label>
                    <label className="block text-sm">
                      {t('Contraseña')}
                      {/* `.input` is declared after the utilities layer, so its own px-3
                          beats a plain pr-* class: the trailing-action helper is what
                          actually keeps the text from running under the eye. */}
                      <div className="relative mt-1">
                        <input
                          className="input input-with-trailing-action w-full"
                          type={showRemotePassword ? 'text' : 'password'}
                          autoComplete="current-password"
                          value={remotePassword}
                          onChange={(e) => setRemotePassword(e.target.value)}
                        />
                        <button
                          type="button"
                          className="absolute right-2 top-1/2 -translate-y-1/2 text-neutral-400 hover:text-neutral-100"
                          onClick={() => setShowRemotePassword((value) => !value)}
                          aria-label={t(showRemotePassword ? 'Ocultar contraseña' : 'Mostrar contraseña')}
                          title={t(showRemotePassword ? 'Ocultar contraseña' : 'Mostrar contraseña')}
                        >
                          <Icon name={showRemotePassword ? 'eyeOff' : 'eye'} size={17} />
                        </button>
                      </div>
                    </label>
                  </>
                ) : (
                  <>
                    <p className="text-xs text-neutral-500">{t('Espacios disponibles para {email} en {server}.').replace('{email}', remoteSession.userEmail).replace('{server}', remoteSession.serverName)}</p>
                    <div className="max-h-64 space-y-2 overflow-y-auto pr-1">
                      {remoteSession.spaces.length === 0 && (
                        <p className="rounded-lg border border-neutral-800 px-3 py-2 text-xs text-neutral-500">{t('Esta cuenta todavía no tiene acceso a ningún espacio.')}</p>
                      )}
                      {remoteSession.spaces.map((space) => (
                        <button
                          key={space.id}
                          type="button"
                          data-testid={`remote-space-${space.id}`}
                          onClick={() => setRemoteSpaceId(space.id)}
                          className={`flex w-full items-start justify-between gap-3 rounded-xl border px-3 py-2.5 text-left transition ${remoteSpaceId === space.id ? 'border-indigo-500 bg-indigo-500/10' : 'border-neutral-800 hover:border-neutral-700'}`}
                        >
                          <span>
                            <span className="block text-sm font-medium">{space.name}</span>
                            <span className="mt-0.5 block text-xs text-neutral-500">
                              {space.hasSnapshot ? t('Publicado por última vez el {date}.').replace('{date}', new Date(space.updatedAt ?? '').toLocaleString()) : t('Todavía sin publicar.')}
                            </span>
                          </span>
                          <span className="shrink-0 rounded-full border border-neutral-700 px-2 py-0.5 text-[11px] text-neutral-400">
                            {space.role === 'reader' ? t('Solo lectura') : space.role === 'writer' ? t('Escritura') : t('Propietario')}
                          </span>
                        </button>
                      ))}
                    </div>
                    <p className="flex items-start gap-2 text-xs leading-5 text-neutral-500">
                      <Icon name="info" size={14} className="mt-0.5 shrink-0" />
                      <span>
                        {remoteSession.spaces.find((space) => space.id === remoteSpaceId)?.role === 'reader'
                          ? t('Con acceso de solo lectura, todo lo que escribas o generes se quedará en este equipo y no se enviará al vault principal.')
                          : t('Lo que escribas aquí viajará al vault principal la próxima vez que su propietario se conecte.')}
                      </span>
                    </p>
                  </>
                )}
              </div>
            ) : (
            <>
            <label className="block text-sm">
              {t('Nombre de la bóveda')}
              <input
                className="input mt-1 w-full"
                autoFocus
                aria-invalid={Boolean(addNameError)}
                aria-describedby={addNameError ? 'vault-name-error' : undefined}
                value={addName}
                onChange={(e) => { setAddName(e.target.value); if (addNameError) setAddNameError(null); }}
                placeholder={t('Nombre de la bóveda')}
              />
              {addNameError && <span id="vault-name-error" data-testid="vault-name-error" role="alert" className="mt-1 block text-xs text-red-400">{addNameError}</span>}
            </label>
            <div className="mt-3">
              <div className="mb-1.5 text-xs text-neutral-500">{t('Tipo de bóveda')}</div>
              <VaultTypePicker value={addType} onChange={setAddType} disabled={busy} />
            </div>
            {/* Palette and scope for the new vault. Collapsed to the current choice: the
                type list above is already long, and the full grid stays one click away
                instead of pushing the step out of the modal's first screen. */}
            <div className="mt-3 rounded-lg border border-neutral-800 px-3 py-2" data-testid="vault-new-appearance">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-xs text-neutral-500">{t('Paleta de la bóveda')}</span>
                <button
                  type="button"
                  data-testid="vault-new-palette-toggle"
                  aria-expanded={addPaletteOpen}
                  disabled={busy}
                  onClick={() => setAddPaletteOpen((open) => !open)}
                  className="flex items-center gap-2 rounded-md border border-neutral-700 px-2 py-1 text-xs text-neutral-300 hover:text-neutral-100 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <span className="flex flex-shrink-0 overflow-hidden rounded border border-black/20">
                    {selectedPalette.swatch.map((colour, index) => <span key={index} className="block h-4 w-2" style={{ background: colour }} />)}
                  </span>
                  <span className="min-w-0 truncate">{selectedPalette.id === 'default' ? t('Predeterminado') : selectedPalette.label}</span>
                  <Icon name={addPaletteOpen ? 'chevronUp' : 'chevronDown'} size={12} />
                </button>
              </div>
              {addPaletteOpen && (
                <div className="mt-2 max-h-48 overflow-y-auto pr-1">
                  <ThemePalettePicker
                    value={selectedPalette.id}
                    customThemes={addAppearance?.customThemes ?? []}
                    disabled={busy}
                    onSelect={(id) => setAddPalette(id as AppSettings['appTheme'])}
                    testId="vault-new-palette"
                  />
                </div>
              )}
              <label className="mt-2 flex items-center gap-2 text-xs text-neutral-400">
                <input
                  type="checkbox"
                  data-testid="vault-new-share-palette"
                  checked={addSharesPalette ?? addAppearance?.shareAppThemeAcrossVaults ?? false}
                  disabled={busy}
                  onChange={(event) => setAddSharesPalette(event.target.checked)}
                />
                {t('Usar la misma paleta en todas las bóvedas')}
              </label>
            </div>
            <p className="mt-4 flex items-start gap-2 text-xs leading-5 text-neutral-500" data-testid="vault-models-next-step">
              <Icon name="info" size={14} className="mt-0.5 shrink-0" />
              <span>{t('Al crear la bóveda, el asistente te llevará a elegir su modelo de IA y su modelo de embeddings, con los modelos de tus proveedores ya cargados.')}</span>
            </p>
            </>
            )}
            </div>
            {addError && <p role="alert" data-testid="vault-creation-error" className="mt-3 rounded-lg border border-red-900/60 bg-red-950/20 px-3 py-2 text-xs text-red-300">{addError}</p>}
            <div className="mt-5 flex justify-end gap-2">
              <button className="btn btn-ghost" onClick={() => closeAddModal()} disabled={busy}>
                {t('Cancelar')}
              </button>
              <button
                className="btn btn-primary gap-1.5"
                onClick={() => void (addMode === 'connected' ? connectVault() : createVault())}
                disabled={busy || (addMode === 'connected' && Boolean(remoteSession) && !remoteSpaceId)}
              >
                <Icon name={busy ? 'sync' : 'plus'} className={busy ? 'animate-spin' : ''} />
                {busy ? t('Preparando…') : addMode === 'connected' && !remoteSession ? t('Continuar') : t('Crear')}
              </button>
            </div>
          </ModalShell>,
          document.body
        )}

      {preAlphaConfirmOpen && (
        <PreAlphaVaultConfirmation
          type={addType}
          onCancel={() => setPreAlphaConfirmOpen(false)}
          onConfirm={() => {
            setPreAlphaConfirmOpen(false);
            void createVault(true);
          }}
        />
      )}

      {/* Rename modal */}
      {renameTarget &&
        createPortal(
          <ModalShell title={t('Renombrar bóveda')} onCancel={() => setRenameTarget(null)}>
            <input
              className="input w-full"
              autoFocus
              value={renameValue}
              onChange={(e) => setRenameValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void confirmRename();
                if (e.key === 'Escape') setRenameTarget(null);
              }}
            />
            <div className="mt-5 flex justify-end gap-2">
              <button className="btn btn-ghost" onClick={() => setRenameTarget(null)}>
                {t('Cancelar')}
              </button>
              <button className="btn btn-primary" onClick={() => void confirmRename()} disabled={busy}>
                {t('Renombrar')}
              </button>
            </div>
          </ModalShell>,
          document.body
        )}

      {/* Duplicate modal (with confirmation) */}
      {dupTarget &&
        createPortal(
          <ModalShell title={t('Duplicar bóveda')} onCancel={() => setDupTarget(null)}>
            <p className="mb-3 text-sm text-neutral-400">
              {tx('Se creará una copia de «{name}» con todos sus datos.', { name: dupTarget.name })}
            </p>
            <label className="block text-sm">
              {t('Nombre de la copia')}
              <input className="input mt-1 w-full" autoFocus value={dupName} onChange={(e) => setDupName(e.target.value)} />
            </label>
            <div className="mt-5 flex justify-end gap-2">
              <button className="btn btn-ghost" onClick={() => setDupTarget(null)}>
                {t('Cancelar')}
              </button>
              <button className="btn btn-primary gap-1.5" onClick={() => void confirmDuplicate()} disabled={busy}>
                <Icon name="copy" /> {t('Duplicar')}
              </button>
            </div>
          </ModalShell>,
          document.body
        )}

      {renderDestructiveModal({
        pendingAction,
        step: destructiveStep,
        code: destructiveCode,
        entry: destructiveEntry,
        error: destructiveError,
        setEntry: setDestructiveEntry,
        setError: setDestructiveError,
        onCancel: closeDestructiveAction,
        onIntroConfirm: () => setDestructiveStep('code'),
        onCodeConfirm: confirmDestructiveCode,
        onFinalConfirm: executeDestructiveAction,
      })}
    </>
  );
}

function IconBtn({ icon, title, onClick, disabled, danger }: { icon: string; title: string; onClick: () => void; disabled?: boolean; danger?: boolean }) {
  return (
    <button
      className={`rounded p-1.5 transition-colors disabled:cursor-not-allowed disabled:opacity-35 ${
        danger
          ? 'text-neutral-500 hover:bg-red-100 hover:text-red-600 dark:text-neutral-400 dark:hover:bg-red-950/40 dark:hover:text-red-400'
          : 'text-neutral-500 hover:bg-neutral-100 hover:text-neutral-900 dark:text-neutral-400 dark:hover:bg-neutral-800 dark:hover:text-neutral-200'
      }`}
      title={title}
      onClick={onClick}
      disabled={disabled}
    >
      <Icon name={icon} size={15} />
    </button>
  );
}

/** A small centered modal shell used by the add / rename / duplicate dialogs. */
function ModalShell({ title, children, onCancel, wide = false }: { title: string; children: React.ReactNode; onCancel: () => void; wide?: boolean }) {
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-6" onClick={onCancel}>
      <div className={`card-modal max-h-[90vh] w-full overflow-y-auto p-5 ${wide ? 'max-w-2xl' : 'max-w-md'}`} role="dialog" aria-modal="true" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <h2 className="mb-3 text-base font-semibold">{title}</h2>
        {children}
      </div>
    </div>
  );
}

function renderDestructiveModal({
  pendingAction,
  step,
  code,
  entry,
  error,
  setEntry,
  setError,
  onCancel,
  onIntroConfirm,
  onCodeConfirm,
  onFinalConfirm,
}: {
  pendingAction: PendingDestructiveAction | null;
  step: DestructiveStep;
  code: string;
  entry: string;
  error: string | null;
  setEntry: (value: string) => void;
  setError: (value: string | null) => void;
  onCancel: () => void;
  onIntroConfirm: () => void;
  onCodeConfirm: () => void;
  onFinalConfirm: () => void;
}) {
  if (!pendingAction) return null;

  const title = pendingAction.kind === 'delete' ? t('Eliminar bóveda') : t('Reinicializar bóveda');
  const introMessage =
    pendingAction.kind === 'delete'
      ? tx('Esta acción eliminará la bóveda "{name}" y sus archivos locales. No afecta a otras bóvedas.', { name: pendingAction.vault.name })
      : tx('Esta acción borrará el contenido de "{name}" y recreará su base de datos vacía. No afecta a otras bóvedas.', { name: pendingAction.vault.name });
  const codeMessage =
    pendingAction.kind === 'delete'
      ? tx('Introduce este código manualmente para eliminar la bóveda "{name}".', { name: pendingAction.vault.name })
      : t('Introduce este código manualmente');
  const finalMessage =
    pendingAction.kind === 'delete'
      ? tx('Código correcto. Confirma una última vez para eliminar la bóveda "{name}".', { name: pendingAction.vault.name })
      : t('Código correcto. Confirma una última vez para ejecutar la acción.');
  const finalLabel = pendingAction.kind === 'delete' ? t('Eliminar definitivamente') : t('Reinicializar definitivamente');

  if (step === 'intro') {
    return <ConfirmModal title={title} message={introMessage} confirmLabel={t('Continuar')} danger onConfirm={onIntroConfirm} onCancel={onCancel} />;
  }

  if (step === 'final') {
    return (
      <ConfirmModal
        title={t('Confirmación final')}
        message={finalMessage}
        confirmLabel={finalLabel}
        danger
        onConfirm={onFinalConfirm}
        onCancel={onCancel}
      />
    );
  }

  return createPortal(
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-6" onClick={onCancel}>
      <div className="card w-full max-w-sm p-5" role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}>
        <h2 className="mb-2 font-semibold">{t('Código de seguridad')}</h2>
        <p className="mb-4 text-sm text-neutral-400">{codeMessage}</p>
        <div className="mb-4 flex select-none justify-center gap-2 text-2xl font-semibold tracking-[0.25em] text-neutral-100" onCopy={(event) => event.preventDefault()}>
          {code.split('').map((digit, index) => (
            <span key={`${digit}-${index}`} className="rounded-md border border-neutral-700 px-3 py-2">
              {digit}
            </span>
          ))}
        </div>
        <input
          className="input w-full text-center text-lg tracking-[0.3em]"
          value={entry}
          inputMode="numeric"
          autoComplete="off"
          pattern="[0-9]*"
          maxLength={4}
          autoFocus
          onChange={(event) => {
            setEntry(event.target.value.replace(/\D/g, '').slice(0, 4));
            setError(null);
          }}
          onPaste={(event) => {
            event.preventDefault();
            setError(t('No se puede pegar aquí. Escribe las cuatro cifras manualmente.'));
          }}
          onDrop={(event) => {
            event.preventDefault();
            setError(t('No se puede pegar aquí. Escribe las cuatro cifras manualmente.'));
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter') onCodeConfirm();
            if (event.key === 'Escape') onCancel();
          }}
        />
        {error && <div className="mt-2 text-xs text-red-300">{error}</div>}
        <div className="mt-5 flex justify-end gap-2">
          <button className="btn btn-ghost" onClick={onCancel}>
            {t('Cancelar')}
          </button>
          <button className="btn bg-red-600 text-white hover:bg-red-500" onClick={onCodeConfirm}>
            {t('Continuar')}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
