import type { LocalizedText } from './localized';
import type { ViewDocumentV1 } from './views';
import type { WorkerArtifactV1 } from './artifacts';
import type { ChatAstNode, FinalMutation, PrepareMutation } from './chat';
import type { SettingsActionInput, SettingsStateV1, SettingsSubmissionV1 } from './settings';
import type { ModelAssetInfo } from './models';
import type { MediaAssetInfo } from './media';
import type { VisionCandidateInput, PreparedVisionCandidate, VisionReviewRequest, VisionReviewResult } from './vision';
import type { MapQuery, MapDataset, MapRenderRequest, MapResult } from './maps';

/** The interface a trusted worker module default-exports. The host calls nothing else.
 *
 *  The signature is the security boundary: this is first-party code with roughly the
 *  privilege of an application update. The separate process buys fault isolation,
 *  cancellation and hard limits — not a security sandbox, and it is not sold as one. */
export interface CapabilityWorkerV2 {
  health(context: HealthContext): Promise<HealthResult>;
  prepareChat?(input: PrepareChatInput): Promise<PrepareMutation[]>;
  invoke(input: ToolInvocationV2): Promise<WorkerInvocationResultV1>;
  finalizeChat?(input: FinalizeChatInput): Promise<FinalMutation[]>;
  renderArtifact(input: RenderArtifactInput): Promise<ViewDocumentV1>;
  projectArtifactForModel?(input: ArtifactProjectionInput): Promise<string>;
  getSettings?(): Promise<SettingsStateV1>;
  applySettings?(input: SettingsSubmissionV1): Promise<SettingsStateV1>;
  runAction?(input: SettingsActionInput): Promise<SettingsStateV1>;
  /** Renders a result saved by a version of this discipline that predates capability API
   *  v2, so an old conversation still shows its answer instead of a broken placeholder.
   *  The package knows those formats; the application only knows which fence claimed them. */
  renderLegacyResult?(input: RenderLegacyInput): Promise<ViewDocumentV1>;
  shutdown(): Promise<void>;
}

export interface HealthContext {
  nodusVersion: string;
  locale: string;
  platform: NodeJS.Platform | string;
  arch: string;
  /** Data version currently on disk, so a worker can report that it needs a migration. */
  dataVersion: number;
}

export interface HealthResult {
  status: 'ready' | 'degraded' | 'needs-setup' | 'needs-migration';
  detail?: LocalizedText;
  /** Data version this build writes. A higher number than on disk requests a migration. */
  dataVersion: number;
}

/** What the turn's model can hold, so a capability can size its own limits against it instead of
 *  hardwiring them.
 *
 *  Both fields are optional and a capability must work without them: an older host does not send
 *  them, and a model with no documented window leaves `contextWindowTokens` absent rather than
 *  guessed. Absent means "use your own floor", never "unlimited".
 *
 *  Why a capability needs this at all: Chemistry Studio's text and count limits were fixed numbers
 *  chosen when a large window was 32k. On a 1,000,000-token model the same numbers silently
 *  truncate the thing the window was bought for — a 48-name ceiling stops verifying the names in a
 *  40-step route, and an 8,000-character ceiling on the chat question refused every drawing on a
 *  fix round once the correction prompt grew past it.
 *
 *  `charsPerToken` is the HOST's own estimate, passed so that every consumer converts with one
 *  ratio rather than inventing its own. It is an estimate, not a guarantee. */
export interface ChatModelBudgetV1 {
  contextWindowTokens?: number;
  charsPerToken?: number;
}

export interface ToolInvocationV2 {
  invocationId: string;
  toolId: string;
  input: unknown;
  locale: string;
  /** Present only when the invocation came from a chat reply. */
  chat?: { question?: string; nodeId?: string; budget?: ChatModelBudgetV1 };
}

export interface WorkerInvocationResultV1 {
  artifacts?: WorkerArtifactV1[];
  /** Rendered directly when the tool produced no artifact worth persisting. */
  view?: ViewDocumentV1;
  notices?: ViewDocumentV1[];
}

export interface PrepareChatInput { nodes: ChatAstNode[]; question?: string; locale: string; budget?: ChatModelBudgetV1 }
export interface FinalizeChatInput { nodes: ChatAstNode[]; locale: string }
export interface RenderArtifactInput { artifactType: string; artifactVersion: number; data: unknown; locale: string }
export interface ArtifactProjectionInput { artifactType: string; artifactVersion: number; data: unknown }
export interface RenderLegacyInput {
  fence: string;
  artifactType: string;
  artifactVersion: number;
  /** The block exactly as the old reply saved it, plus the asset it pointed at when the
   *  package declared one. Neither is trusted: it is data the package parses. */
  payload: string;
  asset?: string;
  locale: string;
}

export interface MigrationInputV1 {
  fromDataVersion: number;
  toDataVersion: number;
  /** What the built-in left behind in the profile, handed over once. */
  legacy?: unknown;
  /** Absolute paths to the migration scripts the manifest declared, in ladder order,
   *  resolved by the host inside the installed package. The nth entry raises the data
   *  version to n. */
  scripts: string[];
}

export interface MigrationResultV1 {
  /** The version actually reached. A failed script leaves this at the last one that
   *  finished, so a retry resumes rather than repeating work that already succeeded. */
  dataVersion: number;
  notes?: string;
  /** Why the ladder stopped, when it did. The host records it and keeps the old state. */
  failed?: string;
}

/** What a `migrations/NNN-name.js` file exports. It runs inside the package's own worker
 *  process, with the same host it has at runtime and nothing more. */
export type MigrationScriptV1 = (context: {
  host: CapabilityHostV2;
  legacy: unknown;
  fromDataVersion: number;
  toDataVersion: number;
}) => Promise<{ dataVersion?: number; notes?: string } | void> | { dataVersion?: number; notes?: string } | void;

/** What the host offers back. Every method is permission-gated by the capability manifest;
 *  calling one the manifest did not declare is an error, not a silent no-op. */
export interface CapabilityHostV2 {
  /** Turn-scoped public/generated thumbnails; no paths, arbitrary URLs or general model prompts. */
  vision: {
    prepareImages(candidates: VisionCandidateInput[]): Promise<PreparedVisionCandidate[]>;
    reviewImages(request: VisionReviewRequest): Promise<VisionReviewResult>;
  };
  /** `nodus:maps`. Bounded native tools; no model calls, tiles or arbitrary URLs. */
  maps: {
    retrieve(query: MapQuery): Promise<MapDataset>;
    render(request: MapRenderRequest): Promise<MapResult>;
  };
  network: {
    fetch(endpointId: string, request: { path: string; method?: string; headers?: Record<string, string>; body?: string | Uint8Array }): Promise<{ status: number; headers: Record<string, string>; body: Uint8Array }>;
    /** Streams to a temp file instead of buffering, for archives too large to hold. */
    downloadToTemp(endpointId: string, request: { path: string; method?: string; headers?: Record<string, string> }): Promise<{ status: number; path: string; bytes: number }>;
  };
  storage: {
    state: KeyValueStore;
    cache: KeyValueStore;
    temp: { dir(): Promise<string>; clear(): Promise<void> };
  };
  secrets: {
    has(id: string): Promise<boolean>;
    store(id: string, value: string): Promise<void>;
    delete(id: string): Promise<void>;
  };
  model: {
    complete(request: { system?: string; prompt: string; maxTokens?: number }): Promise<string>;
  };
  svg: {
    validate(svg: string): Promise<{ ok: boolean; errors: string[] }>;
    inspect(svg: string): Promise<{ width?: number; height?: number; elements: number }>;
    refine(request: { svg: string; instruction: string }): Promise<string>;
  };
  /** `nodus:3d`. A capability hands over a glTF or GLB asset and gets back the
   *  attachment id to put in a `model` view node; the core validates it, stores it and
   *  draws it. There is no renderer on this side of the boundary. */
  models: {
    /** Checks an asset without storing it: format, version, self-containment, size. */
    validate(asset: { bytes: Uint8Array; mimeType: string }): Promise<ModelAssetInfo>;
    /** Validates and stores in one step, returning what a `model` node needs. */
    store(asset: { bytes: Uint8Array; mimeType: string; name: string }): Promise<{ attachmentId: string; bytes: number; info: ModelAssetInfo }>;
  };
  /** `nodus:media`. A raster or a sound file: handed over, checked, stored, and shown by
   *  the core. The capability gets back the attachment id its view node refers to. */
  media: {
    validate(asset: { bytes: Uint8Array; mimeType: string }): Promise<MediaAssetInfo>;
    store(asset: { bytes: Uint8Array; mimeType: string; name: string }): Promise<{ attachmentId: string; bytes: number; info: MediaAssetInfo }>;
  };
  subworker: {
    run(request: { entry: string; input: unknown; timeoutMs: number }): Promise<unknown>;
  };
  python: {
    ensureRuntime(runtimeId: string): Promise<{ ready: boolean; detail?: string }>;
    run(request: { runtimeId: string; args: string[]; stdin?: string; secretId?: string; timeoutMs: number }): Promise<{ code: number; stdout: string; stderr: string }>;
  };
  attachments: {
    /** Stores bytes and returns the id a `download` view node refers to. */
    store(request: { bytes: Uint8Array; name: string; mimeType: string }): Promise<{ attachmentId: string; bytes: number }>;
  };
  log(level: 'debug' | 'info' | 'warn' | 'error', message: string, detail?: Record<string, string | number | boolean>): void;
  /** Aborts when the host cancels or the chat the invocation belongs to goes away. */
  readonly signal: AbortSignal;
}

export interface KeyValueStore {
  get(key: string): Promise<unknown>;
  set(key: string, value: unknown): Promise<void>;
  delete(key: string): Promise<void>;
  keys(): Promise<string[]>;
}

/** Modules export their worker through this, so the host has one shape to look for. */
export type CapabilityWorkerFactory = (host: CapabilityHostV2) => CapabilityWorkerV2 | Promise<CapabilityWorkerV2>;
