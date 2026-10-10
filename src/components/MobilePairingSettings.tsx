import { useEffect, useRef, useState } from 'react';
import QRCode from 'qrcode';
import type { DesktopBridgeDomain, DesktopBridgeOffer, DesktopBridgePairingSummary, DesktopBridgeStatus, VaultSummary } from '@shared/types';
import { getActiveLang, t, tx } from '../i18n';
import { ConfirmModal } from './ConfirmModal';

const DOMAIN_LABELS: Record<DesktopBridgeDomain, string> = { corpus: 'Consulta del corpus', writing: 'Escritura e ideas', 'research-generation': 'Generación de investigación', testimonies: 'Entrevistas y participantes', 'teaching-roster': 'Alumnado', 'teaching-grades': 'Calificaciones', 'study-recordings': 'Grabaciones', 'primary-source-files': 'Archivos de fuentes primarias', 'prosopography-private': 'Datos privados de prosopografía' };
const WORKSPACE_DOMAINS: DesktopBridgeDomain[] = ['corpus', 'writing', 'research-generation', 'testimonies', 'teaching-roster', 'teaching-grades', 'study-recordings', 'primary-source-files', 'prosopography-private'];

export function MobilePairingSettings() {
  const [vaults, setVaults] = useState<VaultSummary[]>([]);
  const [offer, setOffer] = useState<DesktopBridgeOffer | null>(null);
  const [qr, setQr] = useState('');
  const [status, setStatus] = useState<DesktopBridgeStatus | null>(null);
  const [issue, setIssue] = useState('');
  const [refreshIssue, setRefreshIssue] = useState('');
  const [busy, setBusy] = useState(false);
  const [deviceSearch, setDeviceSearch] = useState('');
  const [revoking, setRevoking] = useState<DesktopBridgePairingSummary | null>(null);
  const [linkedDevice, setLinkedDevice] = useState<DesktopBridgePairingSummary | null>(null);
  const [now, setNow] = useState(Date.now());
  const pairingPanel = useRef<HTMLElement>(null);
  const offerIssuedAt = useRef(0);
  const refresh = async () => setStatus(await window.nodus.getDesktopBridgeStatus());
  useEffect(() => {
    let disposed = false;
    let refreshing = false;
    const update = async () => {
      if (disposed || refreshing || document.visibilityState === 'hidden') return;
      refreshing = true;
      try {
        const [list, next] = await Promise.all([window.nodus.listVaults(), window.nodus.getDesktopBridgeStatus()]);
        if (!disposed) { setVaults(list); setStatus(next); setRefreshIssue(''); }
      } catch (error) {
        if (!disposed) setRefreshIssue(String(error));
      } finally { refreshing = false; }
    };
    void update();
    const timer = window.setInterval(() => void update(), 3_000);
    const resume = () => void update();
    window.addEventListener('focus', resume);
    document.addEventListener('visibilitychange', resume);
    return () => {
      disposed = true; window.clearInterval(timer);
      window.removeEventListener('focus', resume);
      document.removeEventListener('visibilitychange', resume);
    };
  }, []);
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, []);
  useEffect(() => {
    if (offer) pairingPanel.current?.scrollIntoView({ block: 'start', behavior: 'smooth' });
  }, [offer]);
  useEffect(() => {
    if (!offer) return;
    const linked = status?.pairings.find(p => !p.revokedAt && (offer.renewalPairingId
      ? p.id === offer.renewalPairingId && Date.parse(p.renewedAt ?? '') >= offerIssuedAt.current
      : p.id === offer.id));
    if (linked) { setLinkedDevice(linked); setOffer(null); setQr(''); }
  }, [offer, status]);
  const expired = (p: DesktopBridgePairingSummary) => !!p.expiresAt && Date.parse(p.expiresAt) <= now;
  const activity = (p: DesktopBridgePairingSummary) => Date.parse(p.lastSeenAt ?? p.renewedAt ?? p.createdAt) || 0;
  const pairings = (status?.pairings ?? []).filter(p => !p.revokedAt).sort((a, b) => activity(b) - activity(a));
  const search = deviceSearch.trim().toLocaleLowerCase();
  const visiblePairings = pairings.filter(p => !search ||
    [p.deviceName, p.id, ...p.vaultIds.map(id => vaults.find(v => v.id === id)?.name ?? id)].join(' ').toLocaleLowerCase().includes(search));
  const renewalDevice = pairings.find(p => p.id === offer?.renewalPairingId);
  const dateLabel = (value: string) => Number.isFinite(Date.parse(value)) ? new Date(value).toLocaleString(getActiveLang()) : '—';
  async function create(renewalPairingId?: string) {
    setBusy(true); setIssue(''); setLinkedDevice(null); offerIssuedAt.current = Date.now();
    try {
      const next = await window.nodus.createDesktopBridgeOffer(vaults.map(v => v.id), WORKSPACE_DOMAINS, renewalPairingId, 'direct');
      setOffer(next); setQr(await QRCode.toDataURL(next.qrURL ?? next.pairingURL, { margin: 4, width: 720, errorCorrectionLevel: 'M' }));
      await refresh();
    } catch (error) { setIssue(String(error)); } finally { setBusy(false); }
  }
  async function revoke() {
    if (!revoking) return;
    setBusy(true); setIssue('');
    try {
      await window.nodus.revokeDesktopBridgePairing(revoking.id);
      if (linkedDevice?.id === revoking.id) setLinkedDevice(null);
      if (offer?.renewalPairingId === revoking.id) { setOffer(null); setQr(''); }
      setRevoking(null);
      await refresh();
    } catch (error) { setIssue(String(error)); setRevoking(null); }
    finally { setBusy(false); }
  }
  return <section ref={pairingPanel} aria-label={t('Vincular móvil')} className="space-y-3 rounded-xl border border-neutral-200 p-4 dark:border-neutral-800 scroll-mt-4">
    <h3 className="font-semibold">{t('Vincular con mi Nodus')}</h3>
    <p className="text-sm text-neutral-500">{t('Escanea el QR o introduce el código en Nodus móvil para conectar todo tu workspace.')}</p>
    <p className="text-sm text-neutral-500">{t('Mantén Nodus abierto y ambos dispositivos en la misma red o VPN, como Tailscale. En live se usan los modelos de este Mac.')}</p>
    {linkedDevice && <p role="status" className="rounded-lg border border-green-600/30 bg-green-600/10 p-3 text-sm text-green-700 dark:text-green-300">{tx('{device} se ha vinculado. Ya puedes usar tu workspace desde el móvil.', { device: linkedDevice.deviceName })}</p>}
    {offer?.renewalPairingId && <div role="status" className="space-y-1 text-sm"><p className="font-medium">{tx('Renovar conexión de {device}', { device: renewalDevice?.deviceName ?? offer.renewalPairingId })}</p><p>{t('Renovación de la conexión existente. Se conservan sus bóvedas, permisos y datos locales.')}</p></div>}
    <details className="text-sm"><summary className="cursor-pointer">{t(offer?.renewalPairingId ? 'Bóvedas' : 'Todo tu workspace')} · {(offer?.vaultIds ?? vaults).length}</summary><p className="mt-2">{(offer?.vaultIds ?? vaults.map(v => v.id)).map(id => vaults.find(v => v.id === id)?.name ?? id).join(', ')}</p></details>
    <button className="btn btn-primary" disabled={busy || !vaults.length} onClick={() => void create(offer?.renewalPairingId)}>{t(offer ? 'Renovar código' : 'Generar código y QR')}</button>
    {offer?.renewalPairingId && <button className="btn btn-ghost" disabled={busy} onClick={() => { setOffer(null); setQr(''); }}>{t('Nueva vinculación')}</button>}
    {offer && <div className="flex flex-wrap items-start gap-4"><img src={qr} width={320} height={320} style={{imageRendering:'pixelated'}} alt={t('Código QR para vincular Nodus')}/><div className="space-y-2"><p className="text-xl font-mono tracking-widest">{offer.code}</p><p className="text-xs text-neutral-500">{t('Caduca')}: {new Date(offer.expiresAt).toLocaleTimeString()}</p><a className="btn btn-ghost" href={offer.pairingURL}>{t('Abrir enlace de vinculación')}</a><button className="btn btn-ghost" onClick={() => void navigator.clipboard.writeText(offer.pairingURL)}>{t('Copiar enlace')}</button></div></div>}
    {(issue || refreshIssue || status?.error) && <p role="alert" className="text-sm text-red-600">{issue || refreshIssue || status?.error}</p>}
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2"><h4 className="text-sm font-medium">{t('Dispositivos vinculados')} · {pairings.filter(p => !expired(p)).length}</h4><button className="btn btn-ghost" disabled={busy} onClick={() => void refresh().catch(error => setIssue(String(error)))}>{t('Actualizar')}</button></div>
      <label className="block text-sm"><span>{t('Buscar dispositivos')}</span><input type="search" className="input mt-1 w-full" value={deviceSearch} onChange={e => setDeviceSearch(e.target.value)} /></label>
      {visiblePairings.length === 0 && <p role="status" className="text-sm text-neutral-500">{t(search ? 'No hay dispositivos que coincidan con la búsqueda.' : 'Todavía no hay dispositivos vinculados.')}</p>}
      <ul className="max-h-96 space-y-3 overflow-y-auto pr-1" aria-label={t('Dispositivos vinculados')}>
        {visiblePairings.map(p => <li key={p.id} className="rounded-lg border border-neutral-200 p-3 text-sm dark:border-neutral-800">
          <div className="flex flex-wrap items-center justify-between gap-2"><strong>{p.deviceName}</strong><span className="font-mono text-xs text-neutral-500">{p.id.slice(0, 8)}</span></div>
          <p className="mt-1 text-xs text-neutral-500">{t('Vinculado')}: {dateLabel(p.createdAt)}{p.lastSeenAt && <> · {t('Última actividad')}: {dateLabel(p.lastSeenAt)}</>}</p>
          {p.expiresAt && <p className={expired(p) ? 'text-red-600 dark:text-red-400' : 'text-neutral-500'}>{t(expired(p) ? 'Conexión caducada' : 'Caduca')}: {dateLabel(p.expiresAt)}</p>}
          <details className="mt-2"><summary className="cursor-pointer">{t('Bóvedas')} · {p.vaultIds.length} · {t('Permisos')}</summary><p className="mt-1">{p.vaultIds.map(id => vaults.find(v => v.id === id)?.name ?? id).join(', ')}</p><p className="mt-1 text-neutral-500">{p.domains.map(domain => t(DOMAIN_LABELS[domain])).join(' · ')}</p></details>
          <div className="mt-2 flex flex-wrap justify-end gap-2"><button className="btn btn-ghost" disabled={busy || expired(p)} aria-label={tx('Renovar conexión de {device}', { device: `${p.deviceName} · ${p.id.slice(0, 8)}` })} onClick={() => void create(p.id)}>{t('Renovar conexión')}</button><button className="btn btn-ghost" disabled={busy} aria-label={tx('Revocar conexión de {device}', { device: `${p.deviceName} · ${p.id.slice(0, 8)}` })} onClick={() => setRevoking(p)}>{t('Revocar')}</button></div>
        </li>)}
      </ul>
    </div>
    {revoking && <ConfirmModal title={tx('Revocar conexión de {device}', { device: revoking.deviceName })} message={t('Este dispositivo perderá acceso a todas las bóvedas y permisos de esta conexión. Podrás vincularlo de nuevo desde Nodus.')} confirmLabel={t('Revocar')} danger autoFocusConfirm={false} onCancel={() => { if (!busy) setRevoking(null); }} onConfirm={() => { if (!busy) void revoke(); }} />}
  </section>;
}
