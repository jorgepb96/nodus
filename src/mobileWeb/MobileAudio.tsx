import {useEffect, useRef, useState} from 'react';
import type {AudioClip, AudioEntityKind} from '@shared/types';
import {t} from '../i18n';

/** Saved narration is consulted through Swift's verified private file download.
 * Desktop's downloadable synthesis runtimes stay outside this bundle. */
export function AudioPanel({entityKind, entityId, localOnly = false}: {
  entityKind: AudioEntityKind; entityId: string; localOnly?: boolean;
  compact?: boolean; sourceMarkdown?: string; selectionText?: string; cursorOffset?: number;
  title?: string; subjectId?: string | null;
}) {
  const [clips, setClips] = useState<AudioClip[]>([]);
  const [loading, setLoading] = useState(false);
  const [issue, setIssue] = useState('');
  const [opening, setOpening] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  const generation = useRef(0);
  const native = window as unknown as {nodusMobileConfig:{live:boolean}; nodusMobileCall(method:string,...args:unknown[]):Promise<unknown>};
  useEffect(() => {
    const current = ++generation.current;
    setClips([]); setIssue(''); setOpening(null);
    if (localOnly || !native.nodusMobileConfig.live) return;
    setLoading(true);
    void window.nodus.listAudioClips(entityKind, entityId).then(value => {
      if (generation.current === current) setClips(value);
    }).catch(error => { if (generation.current === current) setIssue(String(error)); })
      .finally(() => { if (generation.current === current) setLoading(false); });
    return () => { generation.current++; };
  }, [entityKind, entityId, localOnly, revision]);
  if (localOnly) return null;
  if (!native.nodusMobileConfig.live) return <p className="mobile-unavailable-audio">{t('Las pistas guardadas se consultan con una conexión al Mac.')}</p>;
  const open = async (clip: AudioClip) => {
    const current = generation.current; setOpening(clip.id); setIssue('');
    try { await native.nodusMobileCall('openSavedAudioClip', clip.id, clip.segmentLabel); }
    catch (error) { if (generation.current === current) setIssue(String(error)); }
    finally { if (generation.current === current) setOpening(null); }
  };
  const duration = (seconds:number) => `${Math.floor(seconds / 60)}:${Math.floor(seconds % 60).toString().padStart(2,'0')}`;
  return <section className="mobile-saved-audio" aria-label={t('Narración guardada')}>
    <h3>{t('Narración guardada')}</h3>
    {loading && <p role="status">{t('Cargando…')}</p>}
    {issue && <div role="alert"><p>{issue}</p><button className="btn btn-ghost" onClick={() => setRevision(value => value + 1)}>{t('Reintentar')}</button></div>}
    {!loading && !issue && !clips.length && <p>{t('Este contenido no tiene pistas guardadas en el Mac.')}</p>}
    <ul>{clips.map(clip => <li key={clip.id}>
      <button className="btn btn-ghost" disabled={opening !== null || clip.missing} onClick={() => void open(clip)} aria-label={`${t('Escuchar')} ${clip.segmentLabel}`}>
        <span aria-hidden="true">▶</span><span>{clip.segmentLabel}</span><span>{duration(clip.durationSec)}</span>
      </button>
      {opening === clip.id && <p role="status">{t('Descargando audio…')}</p>}
      {clip.missing && <p>{t('El archivo de esta pista no está disponible en el Mac.')}</p>}
    </li>)}</ul>
  </section>;
}
export function StudyDictation(_props: unknown) { return <p className="mobile-unavailable-audio" role="status">Dictado · Próximamente</p>; }
