// The startup sequence: everything that can take over the whole screen before the
// app shell is allowed to render.
//
// These were seven early `return`s threaded through App.tsx's render, between the
// hooks and the shell. Each condition added over time had to be reasoned about
// against all the ones above it — `isPreviewVault`, `newInstall` and
// `whatsNewSettled` all ended up entangled that way — and nothing but reading
// order stopped two of them from being reachable at once.
//
// As an ordered list, the first guard whose predicate holds owns the screen. That
// is not a stylistic difference: showing two startup steps at once stops being
// something to check and becomes something the shape rules out.
//
// Pure movement: same predicates, same order, same components as before.
import type { ReactNode } from 'react';
import type { AppSettings, RecoveryStatus, VaultSummary } from '@shared/types';
import type { View } from '../navigation';
import { BASICS_TUTORIAL_VERSION, BasicsTutorial } from '../views/BasicsTutorial';
import { FirstVaultSetup } from '../views/FirstVaultSetup';
import { Onboarding } from '../views/Onboarding';
import { RecoverySetupWizard } from '../views/RecoverySetupWizard';
import { RecoveryStatusLoading } from '../components/RecoveryStatusLoading';
import { preferencesForTutorialLanguage } from '@shared/tutorialPreferences';
import { t, setActiveLang } from '../i18n';

/** Everything the startup steps read or call. Assembled once, in App.tsx. */
export interface StartupState {
  loadError: string | null;
  settings: AppSettings | null;
  activeVault: VaultSummary | null;
  recoveryStatus: RecoveryStatus | null;
  /** A read-only preview of another vault never runs the startup sequence. */
  isPreviewVault: boolean;
  /** True only for a run that started before the guide had ever been completed. */
  newInstall: boolean;
  whatsNewSettled: boolean;
  onboardingDiscardsVault: boolean;
  clearLoadError: () => void;
  reloadSettings: () => Promise<unknown>;
  reloadVaults: () => Promise<unknown>;
  reloadRecoveryStatus: () => Promise<unknown>;
  cancelOnboarding: () => void;
  setView: (view: View) => void;
}

/** A settled state: past the point where settings may still be missing. */
type SettledState = StartupState & { settings: AppSettings };

interface Guard<S extends StartupState> {
  id: string;
  when: (state: S) => boolean;
  render: (state: S) => ReactNode;
}

/**
 * The two steps that can run before settings have loaded. Nothing below them may
 * assume `settings`, which is exactly why they are a separate list.
 */
const UNSETTLED_GUARDS: readonly Guard<StartupState>[] = [
  {
    id: 'load-error',
    when: (state) => state.loadError !== null,
    render: (state) => (
      <div className="h-full flex flex-col items-center justify-center gap-3 p-8 text-center">
        <div className="text-red-400 font-semibold">{t('No se pudo iniciar Nodus')}</div>
        <div className="text-neutral-400 text-sm max-w-md">{state.loadError}</div>
        <button className="btn btn-primary" onClick={() => { state.clearLoadError(); void state.reloadSettings(); }}>
          {t('Reintentar')}
        </button>
      </div>
    ),
  },
  {
    id: 'settings-loading',
    when: (state) => state.settings === null,
    render: () => <div className="h-full flex items-center justify-center text-neutral-500">{t('Cargando Nodus…')}</div>,
  },
];

/** The five steps that decide what a settled install still owes the user. */
const SETTLED_GUARDS: readonly Guard<SettledState>[] = [
  {
    // The cinematic guide owns first-run language selection. A positive value means
    // it has been seen and remains authoritative across every future app update;
    // Settings deliberately resets it to zero when the user asks to replay it.
    id: 'basics-tutorial',
    when: (state) => !state.isPreviewVault && state.settings.basicsTutorialVersion === 0,
    render: (state) => (
      <BasicsTutorial
        language={state.settings.uiLanguage}
        onLanguageChosen={async (language) => {
          await window.nodus.updateSettings(preferencesForTutorialLanguage(language));
          await state.reloadSettings();
        }}
        onNodiStyleChosen={async (mascotStyle) => {
          await window.nodus.updateSettings({ mascotStyle, mascotStyleChosen: true });
          await state.reloadSettings();
        }}
        onComplete={async () => {
          await window.nodus.updateSettings({ basicsTutorialVersion: BASICS_TUTORIAL_VERSION });
          await state.reloadSettings();
        }}
      />
    ),
  },
  {
    // Straight out of the guide, and before anything else asks for a decision: name the
    // vault and pick its mode. Nodus used to skip this and hand over an academic vault
    // called «Principal», which is why the mode felt like something that had happened to
    // the user rather than something they chose. Only a run that STARTED before the guide
    // was ever completed gets here (see `newInstall`), so no existing vault is ever
    // renamed underneath its owner.
    id: 'first-vault',
    when: (state) => !state.isPreviewVault && state.newInstall && state.settings.firstVaultVersion === 0 && !!state.activeVault,
    render: (state) => (
      <FirstVaultSetup
        vault={state.activeVault!}
        onComplete={async () => {
          await Promise.all([state.reloadSettings(), state.reloadVaults()]);
        }}
      />
    ),
  },
  {
    id: 'recovery-status-unknown',
    when: (state) => !state.isPreviewVault && state.recoveryStatus === null,
    render: () => <RecoveryStatusLoading />,
  },
  {
    // New installs see this immediately after the cinematic tutorial. Existing
    // installs first dismiss the release notes and then receive the migration wizard.
    id: 'recovery-setup',
    when: (state) => !state.isPreviewVault
      && !!state.recoveryStatus?.needsSetup
      && (!state.recoveryStatus.previousInstallation || state.whatsNewSettled),
    render: (state) => (
      <RecoverySetupWizard
        status={state.recoveryStatus!}
        language={state.settings.uiLanguage}
        onComplete={async () => {
          await Promise.all([state.reloadSettings(), state.reloadVaults(), state.reloadRecoveryStatus()]);
        }}
      />
    ),
  },
  {
    id: 'onboarding',
    when: (state) => !state.isPreviewVault && !state.settings.onboardingComplete,
    render: (state) => (
      <Onboarding
        activeVault={state.activeVault}
        settings={state.settings}
        providerKeys={state.settings.providerKeys}
        onDone={(nextView = 'home') => state.reloadSettings().then(() => state.setView(nextView))}
        onCancel={state.cancelOnboarding}
        discardsVault={state.onboardingDiscardsVault}
      />
    ),
  },
];

/**
 * The startup step that owns the screen, or null when the shell may render.
 *
 * Also sets the authoritative language for this render, in the one place where it
 * is correct to do so: after settings are known and before anything — a guard or
 * the shell — calls `t()`.
 */
export function resolveStartupGate(state: StartupState): ReactNode | null {
  for (const guard of UNSETTLED_GUARDS) {
    if (guard.when(state)) return guard.render(state);
  }
  const settled = state as SettledState;
  setActiveLang(settled.settings.uiLanguage);
  for (const guard of SETTLED_GUARDS) {
    if (guard.when(settled)) return guard.render(settled);
  }
  return null;
}

/** Guard ids in order, for the contract test. */
export const STARTUP_GUARD_ORDER = [
  ...UNSETTLED_GUARDS.map((guard) => guard.id),
  ...SETTLED_GUARDS.map((guard) => guard.id),
] as const;
