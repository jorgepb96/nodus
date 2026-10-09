import { AsyncLocalStorage } from 'node:async_hooks';
export { researchPromptUpperBound } from '@shared/researchRetrievalBudget';

/** A report's async calls share the same request envelope. No global setting can
 * leak a notebook's restriction into another vault or concurrent conversation. */
const active = new AsyncLocalStorage<{ window: number; onOverflow: () => void }>();
export const withResearchRequestBudget = <T>(window: number, onOverflow: () => void, run: () => T): T => active.run({ window, onOverflow }, run);
export const currentResearchRequestBudget = () => active.getStore();
