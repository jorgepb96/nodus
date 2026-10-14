import { useEffect, useRef, useState } from 'react';
import type { VaultType } from '@shared/types';
import { tutorialVideoCopy, tutorialVideoForVault, type TutorialVideo } from '@shared/tutorialVideos';
import { TutorialVideoPlayer } from '../components/TutorialVideos';
import { Icon } from '../components/ui';
import { AcademicLearningSpotlight as GuidedPopover } from '../learning/AcademicLearningSpotlight';
import { getActiveLang, t } from '../i18n';

export interface TourStep {
  /** A live data-tour control; an omitted target leaves a small floating invitation. */
  target?: string;
  stage?: string;
  title: string;
  body: string;
  view?: string;
}

/** All vault tours share the academic guide's non-modal card, arrow, and tracking. */
export function TourOverlay({ steps, label = 'Tutorial', vaultType, showUnavailableVideo = true, onClose, onNavigate }: {
  steps: TourStep[]; label?: string; accent?: string; vaultType?: VaultType;
  showUnavailableVideo?: boolean; onClose: () => void; onNavigate: (view: string) => void;
}) {
  const [i, setI] = useState(0);
  const [started, setStarted] = useState(false);
  const [watchingVideo, setWatchingVideo] = useState(false);
  const [video, setVideo] = useState<TutorialVideo | undefined>(() => tutorialVideoForVault(vaultType));
  const previousFocus = useRef<HTMLElement | null>(null);
  const navigate = useRef(onNavigate); navigate.current = onNavigate;
  const step = steps[i], isFirst = i === 0, isLast = i === steps.length - 1;
  const isInvitation = isFirst && !started;

  // Opening an invitation never changes the current view. Navigate only on a new step.
  useEffect(() => { if (!isInvitation && step.view) navigate.current(step.view); }, [i, isInvitation, step.view]);
  useEffect(() => {
    previousFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    return () => { if (previousFocus.current?.isConnected) previousFocus.current.focus({ preventScroll: true }); };
  }, []);
  useEffect(() => {
    if (!vaultType) return;
    let active = true;
    void window.nodus.getTutorialCatalogue().then(catalogue => {
      if (active && Array.isArray(catalogue)) setVideo(tutorialVideoForVault(vaultType, catalogue));
    }).catch(() => {});
    return () => { active = false; };
  }, [vaultType]);

  return <>
    {!watchingVideo && <GuidedPopover guided={!isInvitation} targets={isInvitation ? [] : step.target ? [`[data-tour="${step.target}"]`] : step.view ? [`[data-tour="nav-${step.view}"]`] : []}
      stepKey={`tour:${vaultType ?? label}:${i}:${started}`} label={t(label)} onPause={onClose} testId="tour-card">
      <div onKeyDown={event => {
        if (isInvitation || (event.target as HTMLElement).closest('input,textarea,select,[contenteditable="true"],[role="textbox"]')) return;
        if (event.key === 'ArrowRight') { event.preventDefault(); setI(n => Math.min(steps.length - 1, n + 1)); }
        else if (event.key === 'ArrowLeft') { event.preventDefault(); setI(n => Math.max(0, n - 1)); }
      }}>
        <div className="learning-coach-head"><span className="learning-eyebrow" aria-live="polite">{t(label)} · {i + 1}/{steps.length}</span>
          <button className="btn btn-ghost" onClick={onClose} aria-label={t('Cerrar tutorial')}>{t('Saltar')} <Icon name="x" size={13}/></button>
        </div>
        {step.stage && <p className="learning-muted">{t(step.stage)}</p>}
        <h2 id="nodus-tour-title">{t(step.title)}</h2>
        <p id="nodus-tour-body">{t(step.body)}</p>
        <div className={`learning-coach-actions ${isInvitation ? 'learning-tour-invitation' : ''}`}>
          {!isInvitation && !isFirst && <button className="btn btn-ghost" onClick={() => setI(n => Math.max(0, n - 1))}>{t('Atrás')}</button>}
          {isInvitation ? <>
            {(video || showUnavailableVideo) && <button className={video ? 'btn btn-secondary' : 'btn btn-ghost'} data-testid="tour-watch-video" disabled={!video} onClick={() => setWatchingVideo(true)}>
              <Icon name="play" size={14}/>{tutorialVideoCopy(getActiveLang()).tourVideo}{!video && ` (${t('Próximamente')})`}
            </button>}
            <button data-testid="tour-start-walkthrough" className="btn btn-primary" onClick={() => { setStarted(true); if (!step.target && !step.view && steps.length > 1) setI(1); }}>{t('Sí, enséñame')}</button>
            <button className="btn btn-ghost" onClick={onClose}>{t('Ahora no')}</button>
          </> : <button data-testid={isLast ? 'tour-finish' : 'tour-next'} className="btn btn-primary" onClick={() => isLast ? onClose() : setI(n => n + 1)}>{t(isLast ? 'Empezar' : 'Siguiente')}</button>}
        </div>
      </div>
    </GuidedPopover>}
    {watchingVideo && video && <TutorialVideoPlayer video={video} language={getActiveLang()} onClose={() => { setWatchingVideo(false); onClose(); }}/>}
  </>;
}
