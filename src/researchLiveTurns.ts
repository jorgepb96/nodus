import type { ResearchActivity, ResearchActivityStatus } from '@shared/researchActivity';
import type { ConciliumResult } from '@shared/researchConcilium';
import type { ResearchUiMessage } from './views/researchChatAdapter';

/**
 * Research Chat turns in progress, outside React. A turn's request keeps running in the
 * main process when the chat view unmounts (the user opens another section), but its
 * state lived in the view, so on return a fresh view showed neither the dots nor the
 * streaming answer, and let the user send again while the first turn was still running.
 * The view that sends writes every update here; any view mounted later reads the turn
 * from here and follows it live until it ends.
 *
 * Turns are kept per conversation, so several chats can answer at once: the composer locks
 * only in the chat whose turn is running, and the user can open or start other chats meanwhile.
 */
export interface LiveResearchTurn {
  key: string;
  /** The view that sent it, which keeps painting the turn itself while it is mounted. */
  owner: string;
  conversationId: string;
  assistantId: string;
  selectionKey: string;
  /** The conversation up to and including the question being answered. */
  base: ResearchUiMessage[];
  content: string;
  /** The main process repainted the turn with its own finished text (skills run, route checks). */
  repainted: boolean;
  reasoning: string;
  concilium?: ConciliumResult;
  activities: ResearchActivity[];
  stopRequested: boolean;
  done: boolean;
  outcome: ResearchActivityStatus;
  /** The settled conversation, once done: what was saved. */
  final: ResearchUiMessage[] | null;
}

type Listener = (turn: LiveResearchTurn) => void;
const turns = new Map<string, LiveResearchTurn>();
const listeners = new Set<Listener>();
const emit = (turn: LiveResearchTurn) => { for (const listener of [...listeners]) listener(turn); };

export const liveResearchTurnKey = (scope: string, conversationId: string) => `${scope}:${conversationId}`;

export const liveResearchTurns = {
  get: (key: string) => turns.get(key) ?? null,
  /** Turns still running, whoever sent them. */
  active: () => [...turns.values()].filter(turn => !turn.done),
  /** Which of a surface's chats are answering, and how: it changes when a turn starts, is
   *  repainted or ends, never with a streamed delta, so views re-render only for those. */
  signature: (scope: string) => [...turns.values()]
    .filter(turn => !turn.done && turn.key.startsWith(`${scope}:`))
    .map(turn => `${turn.conversationId}:${turn.assistantId}:${turn.repainted ? 1 : 0}`)
    .join('|'),
  start(turn: Pick<LiveResearchTurn, 'key' | 'owner' | 'conversationId' | 'assistantId' | 'selectionKey' | 'base'>) {
    const live: LiveResearchTurn = { ...turn, content: '', repainted: false, reasoning: '', activities: [], stopRequested: false, done: false, outcome: 'active', final: null };
    turns.set(turn.key, live);
    emit(live);
  },
  update(key: string, change: (turn: LiveResearchTurn) => Partial<LiveResearchTurn>) {
    const turn = turns.get(key);
    if (!turn || turn.done) return;
    Object.assign(turn, change(turn));
    emit(turn);
  },
  requestStop(key: string) { this.update(key, () => ({ stopRequested: true })); },
  /** The turn settled and was saved: views following it show `final`, then it is forgotten. */
  finish(key: string, final: ResearchUiMessage[] | null, outcome: ResearchActivityStatus) {
    const turn = turns.get(key);
    if (!turn) return;
    Object.assign(turn, { done: true, final, outcome });
    turns.delete(key);
    emit(turn);
  },
  subscribe(listener: Listener) {
    listeners.add(listener);
    return () => { listeners.delete(listener); };
  },
};
