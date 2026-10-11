/** Private companion history. This protocol transfers authored turns, never runs
 * a model and never changes the explicitly selected AI execution mode. */
export type MobileChatKind = 'research' | 'world' | 'database' | 'study';
export const MOBILE_CHAT_MAX_BYTES = 20 * 1024 * 1024;
export interface MobileChatDocument {
  version: 1;
  kind: MobileChatKind;
  id: string;
  revision: string;
  data: Record<string, unknown>;
  companion: Record<string, unknown> | null;
}
export interface MobileChatEdit {
  version: 1;
  id: string;
  conversationId: string;
  expectedRevision: string | null;
  action: 'save' | 'delete';
  draft?: { title: string; archived: boolean; messages: Array<Record<string, unknown>>; databaseIds?: string[];
    study?:import('./mobileStudyChat').MobileStudyChatOptions;
    studyEvidence?:Record<string,Record<string,import('./mobileStudyChat').MobileStudyChatEvidence>> };
  companion?: Record<string, unknown> | null;
}
