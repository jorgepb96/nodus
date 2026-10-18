import type { ModelRef, PromptLanguage } from "./types";

export type DictionaryDetailLevel = "concise" | "standard" | "detailed";
export type DictionaryEntryStatus = "draft" | "active" | "archived";
export type DictionaryEvidenceKind = "idea" | "passage";
export type DictionaryEvidenceDecision = "included" | "unused" | "excluded";
export type DictionaryVersionTrigger =
  "creation" | "update" | "regeneration" | "manual_edit" | "restore";
export type DictionaryVersionState = "applied" | "proposed" | "degraded";
export type DictionaryGenerationOutcome =
  | "synthesis"
  | "insufficient"
  | "degraded";
export type DictionaryDegradationReason =
  | "output_truncated"
  | "malformed_output"
  | "schema_error"
  | "invalid_evidence_refs"
  | "missing_citations"
  | "semantic_rejection"
  | "grounding_failure"
  | "legacy_extractive_fallback";
export type DictionaryRelationType =
  | "related"
  | "broader"
  | "narrower"
  | "synonym"
  | "opposing"
  | "historically_related"
  | "frequently_co_occurring";

export type DictionaryScope =
  | { kind: "vault" }
  | { kind: "authors"; authorIds: string[] }
  | { kind: "works"; workIds: string[] }
  | {
      kind: "tags_collections";
      zoteroTags: string[];
      collectionKeys: string[];
    };

export interface DictionaryEntryInput {
  name: string;
  aliases: string[];
  focusPrompt: string;
  scope: DictionaryScope;
  outputLanguage: PromptLanguage;
  detailLevel: DictionaryDetailLevel;
  tags?: string[];
}

export interface DictionaryEntryPatch {
  name?: string;
  aliases?: string[];
  focusPrompt?: string;
  scope?: DictionaryScope;
  outputLanguage?: PromptLanguage;
  detailLevel?: DictionaryDetailLevel;
  tags?: string[];
  contentMarkdown?: string;
  notes?: string;
  status?: DictionaryEntryStatus;
}

export interface DictionaryEntrySummary {
  id: string;
  name: string;
  aliases: string[];
  shortDescription: string;
  tags: string[];
  authorCount: number;
  workCount: number;
  evidenceCount: number;
  status: DictionaryEntryStatus;
  insufficientEvidence: boolean;
  newEvidenceCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface DictionaryEntry extends DictionaryEntrySummary {
  focusPrompt: string;
  scope: DictionaryScope;
  outputLanguage: PromptLanguage;
  detailLevel: DictionaryDetailLevel;
  contentMarkdown: string;
  notes: string;
  currentVersionId: string | null;
  proposedVersionId: string | null;
  lastEvidenceScanAt: string | null;
}

export type DictionarySortKey =
  "name" | "created" | "updated" | "authors" | "works" | "evidence";

export interface DictionaryListRequest {
  query?: string;
  letter?: string;
  tags?: string[];
  authorIds?: string[];
  workIds?: string[];
  statuses?: DictionaryEntryStatus[];
  hasNewEvidence?: boolean;
  insufficientEvidence?: boolean;
  sort?: { key: DictionarySortKey; dir: "asc" | "desc" };
  offset: number;
  limit: number;
}

export interface DictionaryEntryPage {
  items: DictionaryEntrySummary[];
  total: number;
  offset: number;
  limit: number;
}

export interface DictionaryFacets {
  letters: string[];
  tags: { label: string; count: number }[];
  authors: { id: string; name: string; count: number }[];
  works: { id: string; title: string; count: number }[];
}

export interface DictionaryEvidenceRef {
  kind: DictionaryEvidenceKind;
  id: string;
}

export interface DictionaryEvidenceItem extends DictionaryEvidenceRef {
  entryId: string;
  label: string;
  text: string;
  score: number;
  reason: string;
  decision: DictionaryEvidenceDecision;
  isNew: boolean;
  usedInCurrentVersion: boolean;
  citedInCurrentVersion: boolean;
  unavailable: boolean;
  sourceRevision: string | null;
  workId: string;
  workTitle: string;
  zoteroKey: string | null;
  works: {
    id: string;
    title: string;
    zoteroKey: string | null;
    authors: string[];
    year: number | null;
  }[];
  pageLabel: string | null;
  authors: {
    id: string | null;
    name: string;
    attributionBasis?: "author" | "editor_only";
  }[];
  tags: string[];
}

export interface DictionaryEvidenceRequest {
  entryId: string;
  query?: string;
  kinds?: DictionaryEvidenceKind[];
  decisions?: DictionaryEvidenceDecision[];
  newOnly?: boolean;
  authorIds?: string[];
  workIds?: string[];
  tags?: string[];
  offset: number;
  limit: number;
}

export interface DictionaryEvidencePage {
  items: DictionaryEvidenceItem[];
  total: number;
  offset: number;
  limit: number;
}

export interface DictionaryAuthorView {
  id: string;
  name: string;
  ideaCount: number;
  workCount: number;
  summaryMarkdown: string;
  attributionBasis?: "author" | "editor_only";
}

export interface DictionaryWorkView {
  id: string;
  title: string;
  authors: string[];
  evidenceCount: number;
  tags: string[];
  zoteroKey: string | null;
}

export interface DictionaryCitationRecord extends DictionaryEvidenceRef {
  label: string;
  tags: string[];
}

export interface DictionaryVersion {
  id: string;
  entryId: string;
  contentMarkdown: string;
  evidence: DictionaryEvidenceRef[];
  citations: DictionaryCitationRecord[];
  authorSummaries: DictionaryAuthorView[];
  focusPrompt: string;
  scope: DictionaryScope;
  outputLanguage: PromptLanguage;
  detailLevel: DictionaryDetailLevel;
  model: ModelRef | null;
  generatedAt: string;
  trigger: DictionaryVersionTrigger;
  state: DictionaryVersionState;
  outcome: DictionaryGenerationOutcome;
  degradationReason: DictionaryDegradationReason | null;
  generationAttempts: number;
  generationProblems: string[];
  insufficientEvidence: boolean;
}

export interface DictionaryEntryDetail {
  entry: DictionaryEntry;
  coverage: {
    included: number;
    cited: number;
    unused: number;
    excluded: number;
    newEvidence: number;
    unavailable: number;
  };
  authors: DictionaryAuthorView[];
  works: DictionaryWorkView[];
  currentVersion: DictionaryVersion | null;
  proposedVersion: DictionaryVersion | null;
  /** Present only when the latest generation attempt degraded. It is never current. */
  latestDegradedVersion: DictionaryVersion | null;
  relations?: Array<DictionaryRelation & {entry: Pick<DictionaryEntrySummary, 'id' | 'name'>; direction: 'incoming' | 'outgoing'}>;
}

export interface DictionaryDuplicateMatch {
  entry: DictionaryEntrySummary;
  match: "exact" | "alias" | "semantic";
  similarity?: number;
}

export interface DictionaryProgress {
  entryId: string;
  /** The action that owns this progress, so the matching control stays visibly busy. */
  mode?: DictionaryGenerationRequest["mode"];
  phase:
    | "queued"
    | "retrieving"
    | "generating"
    | "validating"
    | "saving"
    | "done"
    | "degraded"
    | "failed";
  message: string;
  error?: string;
  degradationReason?: DictionaryDegradationReason;
  attempts?: number;
  activity?: import('./researchActivity').ResearchActivity;
}

export interface DictionaryGenerationRequest {
  entryId: string;
  mode: "creation" | "update" | "regeneration";
  model?: ModelRef | null;
  language?: import('./types').PromptLanguage;
  thinkingEffort?: import('./researchReasoning').ResearchEffort;
  webSearch?: import('./types').ResearchWebSearchMode;
}

export type DictionaryResearchOptions = Pick<DictionaryGenerationRequest, 'model' | 'thinkingEffort' | 'webSearch'>;

export interface DictionaryRelation {
  id: string;
  fromEntryId: string;
  toEntryId: string;
  type: DictionaryRelationType;
  origin: "manual" | "ai";
  status: "suggested" | "confirmed" | "dismissed";
  createdAt: string;
  updatedAt: string;
}

export function normalizeDictionaryTerm(value: string): string {
  return value.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ').trim().replace(/\s+/g, ' ');
}
