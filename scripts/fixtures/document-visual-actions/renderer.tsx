import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { DocumentVisualActions } from '../../../src/components/DocumentVisualScope';
import { DocumentFigureContext } from '../../../src/components/DocumentFigures';
import { installTooltipLayer } from '../../../src/tooltipLayer';
import type { DocumentVisualManifest } from '../../../shared/documentSkills';

const fixture = window as any;
fixture.actions = [];
fixture.nodus = {
  getSettings: async () => ({ favorites: [] }),
  enrichDocumentVisuals: (...args: unknown[]) => {
    fixture.actions.push(['retry', ...args]);
    return new Promise((resolve, reject) => { fixture.finish = resolve; fixture.fail = reject; });
  },
  cancelDocumentVisuals: async (...args: unknown[]) => { fixture.actions.push(['cancel', ...args]); fixture.finish(); },
  undoDocumentVisuals: async (...args: unknown[]) => { fixture.actions.push(['undo', ...args]); },
};
function Fixture() {
  const [manifest, setManifest] = useState<DocumentVisualManifest>(fixture.initial);
  fixture.setManifest = setManifest;
  return <main style={{ padding: 24 }}>
    <button id="before">Antes</button>
    <DocumentFigureContext.Provider value={{ manifest, target: manifest.target, refresh: () => {}, removeFigure: () => {} }}>
      <DocumentVisualActions />
    </DocumentFigureContext.Provider>
    <button id="after">Después</button>
  </main>;
}
installTooltipLayer();
createRoot(document.getElementById('root')!).render(<Fixture />);
