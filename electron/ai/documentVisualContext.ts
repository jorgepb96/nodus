import { AsyncLocalStorage } from 'node:async_hooks';
import { documentVisualPlanningText } from '../../shared/portableDocumentVisuals';

// Generation jobs can overlap with chats. Their optional visual plans must never
// become a global prompt setting or leak into another conversation.
const planning = new AsyncLocalStorage<string>();
export function withDocumentVisualPlanning<T>(catalog: string, hints: string[], run: () => T): T {
  return planning.run(documentVisualPlanningText(catalog, hints), run);
}
export const documentVisualPlanningPrompt = () => planning.getStore() ?? '';
export const withoutDocumentVisualPlanning = <T>(run: () => T): T => planning.run('', run);
