import type {
  EdgeDetail,
  GraphData,
  IdeaConnection,
  IdeaDetail,
  IdeaPage,
  IdeaPageRequest,
} from '@shared/types';

export interface KnowledgeViewCapabilities {
  authors: boolean;
  readingState: boolean;
  tutor: boolean;
  manageThemes: boolean;
  audit: boolean;
  duplicates: boolean;
}

export interface KnowledgeViewSource {
  key: string;
  capabilities: KnowledgeViewCapabilities;
  listIdeasPage(request: IdeaPageRequest): Promise<IdeaPage>;
  getIdeaDetail(id: string): Promise<IdeaDetail | null>;
  listIdeaConnections(id: string): Promise<IdeaConnection[]>;
  getEdgeDetail(id: string): Promise<EdgeDetail | null>;
  getGraph(lens: 'ideas' | 'authors'): Promise<GraphData>;
  deleteIdea(id: string): Promise<void>;
  subscribe?(refresh: () => void): () => void;
  openEvidence?(sourceRef: string, location: string | null, quote?: string): void;
  saveIdea?(detail: IdeaDetail): Promise<void>;
  saveEdge?(detail: EdgeDetail): Promise<void>;
}

export const academicKnowledgeViewSource: KnowledgeViewSource = {
  key: 'academic',
  capabilities: {
    authors: true,
    readingState: true,
    tutor: true,
    manageThemes: true,
    audit: true,
    duplicates: true,
  },
  listIdeasPage: (request) => window.nodus.listIdeasPage(request),
  getIdeaDetail: (id) => window.nodus.getIdeaDetail(id),
  listIdeaConnections: (id) => window.nodus.listIdeaConnections(id),
  getEdgeDetail: (id) => window.nodus.getEdgeDetail(id),
  getGraph: (lens) => window.nodus.getGraph(lens),
  deleteIdea: (id) => window.nodus.deleteIdea(id),
};
