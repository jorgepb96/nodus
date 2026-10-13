import { useEffect, useRef, useState } from 'react';
import type { TutorialLanguage } from '@shared/tutorialPreferences';
import { tutorialVideo, tutorialVideoCopy, videoCopyFor, youtubeEmbedUrl } from '@shared/tutorialVideos';
import { Icon, ModalBackdrop } from '../../src/components/ui';
import './pdfPresenterTutorialAnnouncement.css';

export const PDF_PRESENTER_TUTORIAL_SEEN_KEY = 'nodus.pdfPresenterTutorialSeen.e2js_u-05OA';

export function PdfPresenterTutorialAnnouncement({ language, onSettled }: {
  language: TutorialLanguage;
  onSettled: () => void;
}) {
  const [eligible] = useState(() => {
    try { return localStorage.getItem(PDF_PRESENTER_TUTORIAL_SEEN_KEY) !== '1'; }
    catch { return true; }
  });
  const closeButton = useRef<HTMLButtonElement>(null);
  const copy = tutorialVideoCopy(language);
  const video = tutorialVideo('pdf-presenter')!;
  const meta = videoCopyFor(video, language);
  useEffect(() => { if (!eligible) onSettled(); }, [eligible, onSettled]);
  useEffect(() => {
    if (!eligible) return;
    const previous = document.activeElement as HTMLElement | null;
    closeButton.current?.focus({ preventScroll: true });
    return () => previous?.focus();
  }, [eligible]);
  if (!eligible) return null;
  const finish = () => {
    try { localStorage.setItem(PDF_PRESENTER_TUTORIAL_SEEN_KEY, '1'); } catch { /* Session still settles. */ }
    onSettled();
  };
  return <>
    <ModalBackdrop onClose={finish} zIndex={190}>
      <section className="pdf-tutorial-announcement" role="dialog" aria-modal="true"
        aria-labelledby="pdf-tutorial-title" aria-describedby="pdf-tutorial-description"
        data-testid="pdf-presenter-tutorial-announcement"
        onKeyDown={(event) => {
          if (event.key !== 'Tab') return;
          const buttons = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('iframe, button'));
          const first = buttons[0], last = buttons[buttons.length - 1];
          if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
          else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
        }}>
        <div className="pdf-tutorial-art" aria-hidden="true">
          <div className="pdf-tutorial-screen"><span>NODUS / TOOLKIT</span><strong>Nodus<br />Presenter<span>.</span></strong><div className="pdf-tutorial-screen-line" /></div>
          <div className="pdf-tutorial-play-symbol"><Icon name="play" size={28} /></div>
          <div className="pdf-tutorial-phone"><div /><i /><i /><span>← &nbsp; →</span></div>
        </div>
        <div className="pdf-tutorial-copy">
          <div className="pdf-tutorial-eyebrow"><Icon name="play" size={14} />{copy.gridTitle} <span> / {copy.categories.features}</span></div>
          <h2 id="pdf-tutorial-title">{meta.title}</h2>
          <p id="pdf-tutorial-description">{meta.body}</p>
          <div className="pdf-tutorial-embed">
            <iframe
              src={youtubeEmbedUrl(video, language).replace('autoplay=1', 'autoplay=0')}
              title={meta.title}
              allow="autoplay; encrypted-media; fullscreen; picture-in-picture"
              referrerPolicy="strict-origin-when-cross-origin"
              allowFullScreen
            />
          </div>

          <div className="pdf-tutorial-location"><Icon name="settings" size={19} /><div><b>{copy.whereSettings.title}</b><p>{copy.whereSettings.body}</p></div></div>
          <footer><button ref={closeButton} className="btn btn-primary" onClick={finish}>{copy.close}</button></footer>
        </div>
      </section>
    </ModalBackdrop>
  </>;
}
