import { useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { VaultType } from '@shared/types';
import { isPreviewVaultType, VAULT_TYPE_COLORS, VAULT_TYPES } from '@shared/vaultTypes';
import { t, tx } from '../i18n';
import { ConfirmModal } from './ConfirmModal';
import { Icon } from './ui';

/**
 * Everything the app needs to *offer* a vault type: its label, glyph, colour, release
 * phase, and the grid the user picks from.
 *
 * This lives apart from `VaultSwitcher` because two screens now ask the same question —
 * the switcher's "Añadir bóveda" modal and the first-run chooser that follows the
 * cinematic guide — and they must never drift. Which types are selectable, which are
 * "Pronto", which carry a PRE-ALPHA/ALPHA/BETA or PREVIEW tag and what each one
 * promises are decided
 * ONCE, here, so a type that graduates in `shared/vaultTypes.ts` graduates in both
 * places at the same time.
 */

/** Vault types offered when creating a vault. */
export const NEW_VAULT_TYPES: VaultType[] = VAULT_TYPES.filter((type) => type.available).map((type) => type.id);
/** Shown in the create grid but not yet selectable — flagged "Próximamente". */
export const COMING_SOON_VAULT_TYPES: VaultType[] = VAULT_TYPES.filter((type) => !type.available).map((type) => type.id);
/** Product order in the three-column creation grid, read row by row. */
export const CREATE_VAULT_TYPES: VaultType[] = [
  'academic', 'primary_sources', 'testimonios',
  'databases', 'docencia', 'estudio',
  'genealogy', 'prosopography', 'worldbuilding',
];
export const isComingSoonVaultType = (type: VaultType) => COMING_SOON_VAULT_TYPES.includes(type);
export const VAULT_TYPE_COLOR = VAULT_TYPE_COLORS;

export type VaultPhase = 'pre-alpha' | 'alpha' | 'beta';

/** Human label for a vault type. Literal t() calls keep the strings extractable. */
export function vaultTypeLabel(type: VaultType): string {
  switch (type) {
    case 'estudio':
      return t('Estudio');
    case 'primary_sources':
      return t('Fuentes primarias');
    case 'genealogy':
      return t('Genealogía');
    case 'prosopography':
      return t('Prosopografía');
    case 'databases':
      return t('Bases de datos');
    case 'testimonios':
      return t('Testimonios');
    case 'worldbuilding':
      return t('Worldbuilding');
    case 'docencia':
      return t('Docencia');
    case 'academic':
    default:
      return t('Académico');
  }
}

/** A stable, recognisable glyph for each workspace mode. */
export function vaultTypeIcon(type: VaultType): string {
  switch (type) {
    case 'estudio': return 'graduation';
    case 'primary_sources': return 'archive';
    case 'genealogy': return 'tree';
    case 'prosopography': return 'users';
    case 'databases': return 'table';
    case 'testimonios': return 'microphone';
    case 'worldbuilding': return 'globe';
    case 'docencia': return 'presentation';
    case 'academic':
    default: return 'network';
  }
}

export function vaultTypePhase(type: VaultType): VaultPhase | null {
  if (type === 'primary_sources' || type === 'prosopography' || type === 'testimonios') return 'pre-alpha';
  if (type === 'worldbuilding') return 'alpha';
  if (type === 'estudio' || type === 'genealogy' || type === 'databases' || type === 'docencia') return 'beta';
  return null;
}

export function isPreAlphaVaultType(type: VaultType): boolean {
  return vaultTypePhase(type) === 'pre-alpha';
}

export function vaultTypeDescription(type: VaultType): string {
  switch (type) {
    case 'academic': return t('Investigación, análisis y escritura.');
    case 'genealogy': return t('Historia familiar y archivos.');
    case 'prosopography': return t('Personas, relaciones, identidades y evidencias biográficas para investigación histórica.');
    case 'estudio': return t('Aprendizaje y materiales de estudio.');
    case 'databases': return t('Tablas, datos y análisis.');
    case 'primary_sources': return t('Archivos y fuentes históricas.');
    case 'testimonios': return t('Entrevistas, historia oral y periodismo.');
    case 'worldbuilding': return t('Mundos, personajes y narrativas.');
    case 'docencia': return t('Cursos, evaluación y materiales.');
  }
}

export function PreviewBadge({ compact = false }: { compact?: boolean }) {
  const description = t('Vista previa navegable. Puedes crear el vault y consultar sus secciones, pero todavía no contienen funciones.');
  return <span className={`${compact ? '' : 'absolute right-1 top-1'} shrink-0 rounded border border-violet-500/50 bg-violet-500/10 px-1 text-[9px] font-semibold uppercase tracking-wide text-violet-300`} title={description} aria-label={`PREVIEW. ${description}`}>PREVIEW</span>;
}

export function PreviewNotice() {
  return <div className="mt-3 flex items-start gap-2 rounded-lg border border-violet-700/50 bg-violet-500/10 px-3 py-2 text-xs text-violet-200" data-testid="vault-preview-notice"><Icon name="info" size={14} className="mt-0.5 shrink-0" /><span>{t('Este vault es una preview navegable: se creará normalmente, pero por ahora sus secciones son solo una muestra y no permiten realizar acciones.')}</span></div>;
}

export function VaultPhaseBadge({ phase, compact = false }: { phase: VaultPhase; compact?: boolean }) {
  const [tooltipOpen, setTooltipOpen] = useState(false);
  const [tooltipPos, setTooltipPos] = useState<{ left: number; top: number; width: number } | null>(null);
  const triggerRef = useRef<HTMLSpanElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const label = phase === 'pre-alpha' ? 'PRE-ALPHA' : phase === 'alpha' ? 'ALPHA' : 'BETA';
  const summary = phase === 'pre-alpha'
    ? t('No utilizable para trabajo real; solo para colaboradores que prueben funciones incompletas y reporten errores y mejoras.')
    : phase === 'alpha'
      ? t('Funciones principales aún en prueba; solo recomendable para testers.')
      : t('Funcional, pero aún necesita feedback y corrección de errores.');

  useLayoutEffect(() => {
    if (!tooltipOpen) {
      setTooltipPos(null);
      return;
    }
    const update = () => {
      const trigger = triggerRef.current;
      if (!trigger) return;
      const rect = trigger.getBoundingClientRect();
      const width = Math.min(272, window.innerWidth - 16);
      const height = tooltipRef.current?.offsetHeight ?? 124;
      const left = Math.max(8, Math.min(rect.right - width, window.innerWidth - width - 8));
      const below = rect.bottom + 6;
      const top = below + height <= window.innerHeight - 8
        ? below
        : Math.max(8, rect.top - height - 6);
      setTooltipPos({ left, top, width });
    };
    update();
    const frame = window.requestAnimationFrame(update);
    window.addEventListener('resize', update);
    window.addEventListener('scroll', update, true);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener('resize', update);
      window.removeEventListener('scroll', update, true);
    };
  }, [tooltipOpen]);

  return (
    <span
      ref={triggerRef}
      className={`${compact ? 'relative' : 'absolute right-1 top-1'} z-10 shrink-0`}
      tabIndex={compact ? 0 : undefined}
      aria-label={`${label}. ${summary}`}
      onMouseEnter={() => setTooltipOpen(true)}
      onMouseLeave={() => setTooltipOpen(false)}
      onFocus={() => setTooltipOpen(true)}
      onBlur={() => setTooltipOpen(false)}
    >
      <span className="block rounded border border-amber-600/50 bg-amber-500/10 px-1 text-[9px] font-semibold uppercase tracking-wide text-amber-400">{label}</span>
      {tooltipOpen && createPortal(
        <div
          ref={tooltipRef}
          role="tooltip"
          data-testid="vault-phase-tooltip"
          className="pointer-events-none fixed z-[90] rounded-lg border border-neutral-700 bg-neutral-950 p-2 text-left text-[10px] font-normal normal-case leading-snug tracking-normal text-neutral-300 opacity-100 shadow-xl"
          style={tooltipPos ? { left: tooltipPos.left, top: tooltipPos.top, width: tooltipPos.width } : { left: -9999, top: -9999, width: 272 }}
        >
          <strong className="text-neutral-100">{label}</strong> · {summary}<br />
          {t('La fase avanzará cuando haya suficiente feedback y pulido.')}<br />
          <span className="mt-1 flex items-center gap-1 text-amber-300"><Icon name="bug" size={11} />{t('Reporta los errores desde el botón superior.')}</span>
        </div>,
        document.body
      )}
    </span>
  );
}

export function VaultPhaseNotice({ phase }: { phase: VaultPhase }) {
  const preAlpha = phase === 'pre-alpha';
  const early = preAlpha || phase === 'alpha';
  return (
    <div className="mt-3 flex items-start gap-2 rounded-lg border border-amber-700/50 bg-amber-500/10 px-3 py-2 text-xs text-amber-300" data-testid="vault-phase-notice">
      <Icon name={early ? 'alert' : 'bug'} size={14} className="mt-0.5 shrink-0" />
      <span>{preAlpha
        ? t('PRE-ALPHA: este vault no es utilizable para trabajo real. Está disponible exclusivamente para personas que quieran colaborar probando funciones incompletas y reportando errores y propuestas de mejora.')
        : phase === 'alpha'
          ? t('Versión experimental recomendada solo para testers. Guarda copias de seguridad y reporta cualquier error desde el botón superior.')
          : t('Versión beta: ayúdanos con sugerencias y reportando errores desde el botón superior.')}</span>
    </div>
  );
}

/** Shared gate shown immediately before either creation flow accepts a PRE-ALPHA type. */
export function PreAlphaVaultConfirmation({
  type,
  onConfirm,
  onCancel,
}: {
  type: VaultType;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <ConfirmModal
      zIndex={240}
      danger
      title={t('¿Crear un vault PRE-ALPHA?')}
      confirmLabel={t('Sí, crear solo para pruebas')}
      onConfirm={onConfirm}
      onCancel={onCancel}
      message={(
        <div className="space-y-3" data-testid="pre-alpha-vault-confirmation">
          <p className="font-semibold text-amber-300">{vaultTypeLabel(type)} · PRE-ALPHA</p>
          <p>{t('Este vault todavía no es utilizable para trabajo real.')}</p>
          <p>{t('Continúa únicamente si quieres colaborar probando funciones incompletas y reportando errores y propuestas de mejora. Puede fallar, cambiar sin aviso o perder datos.')}</p>
        </div>
      )}
    />
  );
}

/**
 * The grid of vault modes, plus the notice the chosen one carries.
 *
 * Shared verbatim by the switcher's creation modal and the first-run chooser, testids
 * included, so an e2e assertion about the picker holds wherever it is rendered.
 */
/** Vault types still in alpha or pre-alpha: real, but not where a first impression belongs. */
export function isEarlyPhaseVaultType(type: VaultType): boolean {
  const phase = vaultTypePhase(type);
  return phase === 'alpha' || phase === 'pre-alpha';
}

export function VaultTypePicker({
  value,
  onChange,
  disabled = false,
  foldEarlyPhases = false,
}: {
  value: VaultType;
  onChange: (type: VaultType) => void;
  disabled?: boolean;
  /**
   * Keep alpha and pre-alpha types behind one "more types" button. The first-run
   * screen uses it: someone meeting Nodus for the first time should not have to read
   * four PRE-ALPHA badges before they have seen anything work. The type in use is
   * always shown, and the button reveals the rest without hiding anything for good.
   */
  foldEarlyPhases?: boolean;
}) {
  const [showEarly, setShowEarly] = useState(false);
  const early = foldEarlyPhases ? CREATE_VAULT_TYPES.filter(isEarlyPhaseVaultType) : [];
  const visible = foldEarlyPhases && !showEarly
    ? CREATE_VAULT_TYPES.filter((type) => !isEarlyPhaseVaultType(type) || type === value)
    : CREATE_VAULT_TYPES;
  return (
    <>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3" data-testid="vault-type-picker">
        {visible.map((tp) => {
          const soon = isComingSoonVaultType(tp);
          return (
            <button
              key={tp}
              type="button"
              disabled={soon || disabled}
              title={soon ? `${t('Próximamente')}: ${vaultTypeDescription(tp)}` : undefined}
              className={`relative flex h-28 flex-col items-center justify-center gap-1.5 rounded-lg border p-3 text-center transition-colors ${
                soon
                  ? 'cursor-not-allowed border-neutral-800/70 opacity-50'
                  : value === tp
                    ? 'border-transparent ring-2'
                    : 'border-neutral-800 hover:border-neutral-600'
              }`}
              style={!soon && value === tp ? { boxShadow: `inset 0 0 0 1px ${VAULT_TYPE_COLOR[tp]}`, ['--tw-ring-color' as string]: VAULT_TYPE_COLOR[tp] } : undefined}
              onClick={() => !soon && onChange(tp)}
            >
              {soon ? (
                <span className="absolute right-1 top-1 rounded border border-neutral-600/60 bg-neutral-500/10 px-1 text-[9px] font-semibold uppercase text-neutral-400">
                  {t('Pronto')}
                </span>
              ) : isPreviewVaultType(tp) ? (
                <PreviewBadge />
              ) : (
                vaultTypePhase(tp) && <VaultPhaseBadge phase={vaultTypePhase(tp)!} />
              )}
              <span data-testid={`new-vault-type-icon-${tp}`} className="grid h-8 w-8 place-items-center rounded-lg text-white" style={{ backgroundColor: VAULT_TYPE_COLOR[tp] }}>
                <Icon name={vaultTypeIcon(tp)} size={18} />
              </span>
              <span className="text-xs font-medium text-neutral-200">{vaultTypeLabel(tp)}</span>
              <span className="line-clamp-2 min-h-[2.5em] max-w-44 text-[10px] leading-tight text-neutral-500">{vaultTypeDescription(tp)}</span>
            </button>
          );
        })}
      </div>
      {early.length > 0 && !showEarly && (
        <button type="button" className="mt-2 inline-flex items-center gap-1 text-xs text-neutral-500 hover:text-neutral-300" data-testid="vault-type-more" disabled={disabled} onClick={() => setShowEarly(true)}>
          <Icon name="chevronDown" size={12} /> {tx('Ver {n} tipos más, todavía en desarrollo', { n: early.filter((type) => type !== value).length })}
        </button>
      )}
      {vaultTypePhase(value) && <VaultPhaseNotice phase={vaultTypePhase(value)!} />}
      {isPreviewVaultType(value) && <PreviewNotice />}
    </>
  );
}
