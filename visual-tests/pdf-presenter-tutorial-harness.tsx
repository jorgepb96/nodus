import { useState } from 'react';
import ReactDOM from 'react-dom/client';
import { PdfPresenterTutorialAnnouncement } from '../archive/startup-announcements/PdfPresenterTutorialAnnouncement';
import type { TutorialLanguage } from '../shared/tutorialPreferences';
window.nodus = {
  getSettings: async () => ({ tutorialVideosWatched: [] }),
  updateSettings: async () => undefined,
} as unknown as typeof window.nodus;
function Harness() {
  const [settled, setSettled] = useState(false);
  const language = (new URLSearchParams(location.search).get('lang') ?? 'en') as TutorialLanguage;
  return <div style={{ minHeight: '100vh', background: '#080c15' }}>
    {!settled ? <PdfPresenterTutorialAnnouncement language={language} onSettled={() => setSettled(true)} /> : <div data-testid="settled" />}
  </div>;
}
ReactDOM.createRoot(document.getElementById('root')!).render(<Harness />);
