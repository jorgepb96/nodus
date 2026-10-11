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
export interface MobileChatOrganisation {
  version:1;kind:MobileChatKind;
  projects:Array<{id:string;name:string;instructions:string}>;
  folders:Array<{id:string;projectId:string;parentId:string|null;name:string;position:number}>;
  notebooks:Array<{id:string;name:string}>;
}
export interface MobileChatPlacement {projectId:string|null;folderId:string|null;notebookId:string|null;pinned:boolean}
export interface MobileChatEdit {
  version: 1;
  id: string;
  conversationId: string;
  expectedRevision: string | null;
  action: 'save' | 'delete';
  draft?: { title: string; archived: boolean; messages: Array<Record<string, unknown>>; databaseIds?: string[];
    study?:import('./mobileStudyChat').MobileStudyChatOptions;
    world?:{selection:import('./types').WorldChatSelection;focus:import('./worldChatContext').WorldChatRef[]};
    placement?:MobileChatPlacement;
    studyEvidence?:Record<string,Record<string,import('./mobileStudyChat').MobileStudyChatEvidence>> };
  companion?: Record<string, unknown> | null;
}
