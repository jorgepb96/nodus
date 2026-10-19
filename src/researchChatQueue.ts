import type { ResearchChatRequest } from '@shared/types';
import type { ResearchAttachment } from '@shared/researchAttachments';

/** A copy of the choices made when queued, independent of later composer changes. */
export type ResearchTurnSettings = Pick<ResearchChatRequest, 'model' | 'selection' | 'thinkingEffort' | 'webSearch' | 'harnessVersion' | 'explorationMode' | 'systemPromptId' | 'systemPromptSnapshot' | 'answerVerification' | 'concilium'>;
export interface QueuedResearchTurn {
  id: string;
  content: string;
  attachments: ResearchAttachment[];
  skills: { id: string; name: string }[];
  settings: ResearchTurnSettings;
}
interface QueueState {
  items: QueuedResearchTurn[];
  paused: boolean;
  editingId: string | null;
  deletingId: string | null;
  draggingId: string | null;
  error: string;
}
const empty: QueueState = { items: [], paused: false, editingId: null, deletingId: null, draggingId: null, error: '' };
const states = new Map<string, QueueState>();
const listeners = new Set<() => void>();
const running = new Set<string>();
const storageKey = (key: string) => `nodus.researchChatQueue.v1:${key}`;

export const researchChatQueue = {
  isRunning: (key: string | null) => !!key && running.has(key),
  subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
  get(key: string | null): QueueState {
    if (!key) return empty;
    if (!states.has(key)) {
      let restored = empty;
      try {
        const saved = JSON.parse(localStorage.getItem(storageKey(key)) ?? 'null');
        if (Array.isArray(saved?.items)) restored = { ...empty, items: saved.items, paused: true };
      } catch { /* Memory remains usable when storage is unavailable. */ }
      states.set(key, restored);
    }
    return states.get(key)!;
  },
  change(key: string, patch: Partial<QueueState>) {
    const next = { ...this.get(key), ...patch };
    states.set(key, next);
    try { localStorage.setItem(storageKey(key), JSON.stringify({ items: next.items, paused: next.paused })); } catch { /* Preserve in memory. */ }
    for (const listener of [...listeners]) listener();
  },
  add(key: string, item: QueuedResearchTurn) {
    this.change(key, { items: [...this.get(key).items, structuredClone(item)] });
  },
  edit(key: string, id: string) { this.change(key, { editingId: id }); },
  save(key: string, id: string, content: string) {
    this.change(key, { items: this.get(key).items.map(item => item.id === id ? { ...item, content } : item), editingId: null });
  },
  remove(key: string, id: string) {
    const state = this.get(key);
    this.change(key, { items: state.items.filter(item => item.id !== id), deletingId: null, editingId: state.editingId === id ? null : state.editingId });
  },
  move(key: string, id: string, targetId: string) {
    const items = [...this.get(key).items];
    const from = items.findIndex(item => item.id === id), to = items.findIndex(item => item.id === targetId);
    if (from < 0 || to < 0) return;
    const [item] = items.splice(from, 1);
    items.splice(to, 0, item);
    this.change(key, { items, draggingId: null });
  },
  clear(key: string) { this.change(key, { ...empty }); },
  /** One worker per conversation, retained when its React view unmounts. */
  async run(key: string, execute: (item: QueuedResearchTurn) => Promise<'completed' | 'cancelled' | 'failed'>) {
    if (running.has(key)) return;
    running.add(key);
    try {
      while (this.get(key).items.length) {
        const state = this.get(key);
        if (state.paused || state.editingId || state.deletingId || state.draggingId) break;
        const [item, ...rest] = state.items;
        this.change(key, { items: rest, error: '' });
        try {
          if (await execute(item) !== 'completed') { this.change(key, { paused: true }); break; }
        } catch (error) {
          this.change(key, { items: [item, ...this.get(key).items], paused: true, error: error instanceof Error ? error.message : String(error) });
          break;
        }
      }
    } finally { running.delete(key); }
  },
};
