import { useZoteroConnection, type ZoteroConnection } from '../hooks/useZoteroConnection';
import { zoteroPingErrorText } from '../lib/zoteroConnection';
import { t } from '../i18n';
import { Icon } from './ui';

/**
 * What a screen shows instead of an empty Zotero list.
 *
 * "No collections." was the whole message a closed Zotero used to produce, and a user
 * who had just installed the Zotero plugin read it as "the plugin did not connect".
 * So this says three things in order: what is wrong, the two steps that fix it, and
 * that the plugin is not part of it. It retries on its own while it is on screen (see
 * `useZoteroConnection`), which is why the button is a convenience and not the way out.
 */
export function ZoteroConnectionNotice({
  connection,
  loadError = null,
  compact = false,
  quiet = false,
  onRetry,
  testId = 'zotero-connection-notice',
}: {
  connection: ZoteroConnection;
  /** Zotero answered the ping but a later read failed (a group refusing access, say). */
  loadError?: string | null;
  /** Narrow containers: same content, without the outer padding. */
  compact?: boolean;
  /**
   * Where nobody asked for Zotero (Settings, for someone who may not use it at all), a
   * closed Zotero is a state rather than a problem: same steps, no alarm colours.
   */
  quiet?: boolean;
  /**
   * Also run when "Retry" is pressed. A read that failed while Zotero was answering is
   * not fixed by pinging again — the connection was never down — so the screen that
   * owns the read repeats it here.
   */
  onRetry?: () => void;
  testId?: string;
}) {
  const { status, checking, watching, retry } = connection;
  if (!status) {
    return (
      <div className={`flex items-center gap-2 text-sm text-neutral-500 ${compact ? '' : 'p-4'}`} data-testid={`${testId}-checking`} role="status">
        <Icon name="sync" size={14} className="animate-spin" /> {t('Buscando Zotero…')}
      </div>
    );
  }
  if (status.ok && !loadError) return null;

  // Zotero answered with an HTTP error, or answered the ping and then refused a read:
  // it is open and reachable, so the "open Zotero and tick the box" steps would be wrong.
  const reachable = status.ok || status.reason === 'http';

  return (
    <div
      role={quiet ? 'status' : 'alert'}
      data-testid={testId}
      className={`rounded-xl border text-left text-sm ${quiet
        ? 'border-neutral-200 bg-neutral-50 text-neutral-700 dark:border-neutral-800 dark:bg-neutral-950/50 dark:text-neutral-300'
        : 'border-amber-300 bg-amber-50 text-amber-950 dark:border-amber-700/50 dark:bg-amber-950/20 dark:text-amber-100'} ${compact ? 'p-3' : 'm-3 p-4'}`}
    >
      <div className="flex items-start gap-2 font-semibold">
        <Icon name={quiet ? 'info' : 'alert'} size={16} className="mt-0.5 shrink-0" />
        <span>{reachable ? t('Zotero ha respondido con un error') : quiet ? t('Zotero no está conectado ahora mismo') : t('Nodus todavía no puede leer tu Zotero')}</span>
      </div>

      {reachable ? (
        <p className="mt-2 text-xs leading-5" data-testid={`${testId}-detail`}>{loadError ?? zoteroPingErrorText(status)}</p>
      ) : (
        <>
          <ol className="mt-2 list-decimal space-y-1 pl-5 text-xs leading-5" data-testid={`${testId}-steps`}>
            <li>{t('Abre Zotero en este ordenador (versión 7 o posterior).')}</li>
            <li>{t('En Zotero, ve a Ajustes → Avanzado y marca «Permitir que otras aplicaciones de este ordenador se comuniquen con Zotero».')}</li>
          </ol>
          <p className="mt-2 text-xs leading-5 opacity-80" data-testid={`${testId}-plugin-note`}>
            {t('No necesitas el plugin «Nodus for Zotero» para importar tu biblioteca: el plugin es un chat dentro de Zotero y se configura aparte.')}
          </p>
        </>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-3">
        <button type="button" className="btn btn-secondary text-xs" data-testid={`${testId}-retry`} disabled={checking} onClick={() => { retry(); onRetry?.(); }}>
          <Icon name="refresh" size={13} className={checking ? 'animate-spin' : ''} /> {t('Reintentar')}
        </button>
        {!reachable && (
          <span className="text-xs opacity-80" role="status" data-testid={`${testId}-watching`}>
            {watching
              ? (quiet
                ? t('Nodus lo comprueba solo cada pocos segundos y este aviso cambiará en cuanto Zotero responda.')
                : t('Nodus lo comprueba solo cada pocos segundos: en cuanto Zotero responda, tu biblioteca aparecerá aquí.'))
              : t('Cuando lo hayas hecho, pulsa «Reintentar».')}
          </span>
        )}
      </div>
      {!reachable && status.message && (
        <p className="mt-2 text-[11px] opacity-60" data-testid={`${testId}-detail`}>{zoteroPingErrorText(status)}</p>
      )}
    </div>
  );
}

/**
 * The live answer to "is Nodus talking to my Zotero?", for Settings.
 *
 * Settings had every Zotero option except the one fact people came looking for. This
 * shows it, and says next to it that importing does not go through the plugin — the
 * two are separate products that share a name, and the plugin's own section sits a
 * few scrolls further down.
 */
export function ZoteroConnectionStatus() {
  const connection = useZoteroConnection();
  if (!connection.status?.ok) return <ZoteroConnectionNotice connection={connection} compact quiet testId="settings-zotero-notice" />;
  return (
    <div className="rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-2 text-xs leading-5 text-emerald-800 dark:border-emerald-700/40 dark:bg-emerald-500/5 dark:text-emerald-300" data-testid="settings-zotero-connected" role="status">
      <span className="flex items-center gap-1.5 font-semibold"><Icon name="check" size={13} /> {t('Conectado con Zotero')}</span>
      <span className="mt-0.5 block opacity-90">{t('Nodus lee tu biblioteca directamente desde Zotero, en modo solo lectura. Para importar no hace falta el plugin «Nodus for Zotero».')}</span>
    </div>
  );
}
