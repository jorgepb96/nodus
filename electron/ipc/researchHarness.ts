import { BrowserWindow } from 'electron';
import type { IpcContext } from './context';
import { getResearchRun, listResearchRuns } from '../db/researchRunsRepo';
import { interruptResearchRun, onResearchRunUpdate, researchRunIsActive } from '../ai/researchHarnessRuntime';
import { resumeResearchRun } from '../ai/researchHarnessControls';
import type { ResearchRunSummary } from '@shared/researchHarness';

export function broadcastResearchRun(run: ResearchRunSummary): void {
  for (const window of BrowserWindow.getAllWindows()) if (!window.isDestroyed() && !window.webContents.isDestroyed()) window.webContents.send('research:run:update', run);
}
let releaseUpdates: (() => void) | undefined;
export function registerResearchHarnessIpc({ h }: IpcContext): void {
  releaseUpdates?.(); releaseUpdates = onResearchRunUpdate(broadcastResearchRun);
  h('research:run:list', (_e, conversationId?: string, entryId?: string) => listResearchRuns(conversationId, entryId).map(run => run.status === 'running' && !researchRunIsActive(run.id) ? { ...run, status: 'paused', stopReason: 'interrupted' } : run));
  h('research:run:get', (_e, id: string) => getResearchRun(id)?.summary ?? null);
  h('research:run:pause', (_e, id: string) => interruptResearchRun(id));
  h('research:run:cancel', (_e, id: string) => interruptResearchRun(id, true));
  h('research:run:resume', async (_e, id: string) => resumeResearchRun(id));
}
