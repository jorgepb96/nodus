import {assertAcademicSupplement} from '@shared/academicProjection';
import { AcademicTools, AcademicPanel, type AcademicToolsHandle } from '../components/editor/AcademicTools';
import { normalizeAcademicMetadata, cloneAcademicDocument, type AcademicMetadata } from '@shared/academicDocument';
import { documentReferences, parseEditorReference, type EditorReference } from '@shared/editorReferences';
import { EditorialReferences } from '../components/editor/EditorReferences';
import { WorkspaceTabStrip } from "../components/library/LibraryWorkspaceTabs";
import { useEditorialFocus } from "../components/workspace/editorialFocus";
import { readEditorialDraft, retainEditorialDraft, clearEditorialDraft, downloadEditorialDraft } from '../components/workspace/editorialDrafts';
import { flushEditorialDraft } from '../components/workspace/flushEditorialDraft';
import { BlockNoteCanvas, type BlockNoteCanvasHandle } from '../components/editor/BlockNoteCanvas';
import { EditorialActionBar, EditorialActionMenu, type EditorialAction } from '../components/workspace/EditorialActions';
import { EditorialHeader, EditorialTitle, EditorialNavigator, EditorialCards, CatalogViewControl, EditorialCreateTrigger, EditorialCatalogRow, EditorialInspector } from '../components/workspace/EditorialChrome';
import { markdownToBlockNote, parseNativeDocument, type BlockNoteDocument } from '@shared/blockNoteDocument';
import { readViewSnapshot, patchViewSnapshot } from '../app/viewSnapshots';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import { HoverLabelButton, Icon } from "../components/ui";
import { SectionHeader, SectionToolbar } from "../components/SectionHeader";
import { ReaderHighlighterControl } from "../components/ReaderSelectionActions";
import {
  ReaderSelectionActions,
  type ReaderSelectionActionsHandle,
} from "../components/ReaderSelectionActions";
import { FindInPage } from "../components/FindInPage";
import { NodiViewContextSource } from "../components/NodiViewContextSource";
import { api, ApiError } from "./api";
import { registerServerEditorFlush } from "./editorNavigation";
import { MarkdownReader, serverHrefForNodus } from "./readers";
import {
  parseServerCitation,
  ServerCitationModal,
  type ServerCitationTarget,
} from "./ServerCitationModal";
import type {
  AIConversation,
  AIJob,
  AIMessage,
  AIPreferences,
  JsonRecord,
  PageResponse,
  UserArtifact,
  UserArtifactKind,
} from "./types";
import type {
  WritingDraftAnnotation,
  WritingDraftAnnotationColor,
} from "@shared/types";
import { SERVER_DEFAULT_MODELS, serverModelsFor } from "./modelCatalog";
import { AI_PROVIDERS, PROVIDER_LABELS } from "@shared/providers";
import { errorText, getActiveLang, t, tx } from "./i18nShim";
import { conversationSystem, serverLabel, serverPrompt, translationPrompt } from "./serverAiPrompts";

function valueText(value: unknown, fallback = ""): string {
  const result =
    typeof value === "string"
      ? value
      : value == null
        ? ""
        : JSON.stringify(value);
  return result || t(fallback);
}

function plainReading(markdown: string): string {
  return markdown
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/[*_`>~]/g, "")
    .replace(/^\s*[-*+]\s+/gm, "• ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// Catalog previews show prose, without the generated footnote definitions.
function workspaceExcerpt(markdown: string): string {
  return plainReading(markdown.replace(/^\[\^[^\]]+\]:.*(?:\n[ \t]+.*)*/gm, "").replace(/\[\^[^\]]+\]/g, ""));
}

function formatReportDate(value: unknown): string {
  const raw = valueText(value);
  if (!raw) return "";
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return raw;
  return date.toLocaleDateString(getActiveLang(), {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function formatPublicationStatus(value: unknown): string {
  const status = valueText(value, "published").toLocaleLowerCase();
  if (status === "active" || status === "published" || status === "ready")
    return t("Publicado");
  if (status === "draft") return t("Borrador");
  if (status === "archived") return t("Archivado");
  return valueText(value, "Publicado");
}

/** Keep the compact report metadata row visually aligned with Desktop's reader.
 * Server reports can be published by older clients, so every field is optional. */
function ServerReportTags({ entry }: { entry: JsonRecord }) {
  const model =
    entry.model && typeof entry.model === "object"
      ? (entry.model as JsonRecord)
      : null;
  const generationModel =
    entry.generationModel && typeof entry.generationModel === "object"
      ? (entry.generationModel as JsonRecord)
      : null;
  const selected = model || generationModel;
  const modelName = valueText(
    selected?.model || entry.model_id || entry.modelId,
  );
  const provider = valueText(selected?.provider || entry.provider);
  const approach = valueText(entry.deepResearchApproach || entry.approach);
  const version = valueText(entry.deepResearchVersion || entry.version);
  return (
    <div
      className="deep-research-server-tags"
      data-testid="deep-research-generation-tags"
    >
      {modelName && (
        <span title={provider ? `${provider}/${modelName}` : modelName}>
          {provider ? `${provider} · ` : ""}
          {modelName}
        </span>
      )}
      {approach && (
        <span className="deep-research-server-tag-indigo">{approach}</span>
      )}
      {version && (
        <span className="deep-research-server-tag-cyan">
          {version.toUpperCase()}
        </span>
      )}
    </div>
  );
}

function DeepResearchServerTutorial() {
  const steps = [
    [
      "edit",
      t("1. Plantea la idea"),
      t(
        "Crea un informe privado y escribe la pregunta o idea. Se redactará solo con el corpus publicado.",
      ),
    ],
    [
      "layers",
      t("2. Encola los que quieras"),
      t(
        "Puedes mantener varios trabajos privados en cola y seguir trabajando mientras se procesan.",
      ),
    ],
    [
      "compass",
      t("3. Cobertura del corpus"),
      t(
        "Nodus recupera la evidencia publicada, organiza el informe y conserva sus referencias y limitaciones.",
      ),
    ],
    [
      "book",
      t("4. Lee a pantalla completa"),
      t(
        "Abre un informe para revisar su cinta de opciones, subrayar, añadir marcadores y exportar a PDF.",
      ),
    ],
  ] as const;
  return (
    <section
      className="deep-research-server-tutorial"
      data-testid="deep-research-tutorial"
      aria-label={t("Cómo funciona Deep Research")}
    >
      {steps.map(([icon, title, body]) => (
        <article key={title}>
          <Icon name={icon} size={17} className="text-indigo-400" />
          <div>
            <h2>{title}</h2>
            <p>{body}</p>
          </div>
        </article>
      ))}
    </section>
  );
}

export function extractAIText(result: unknown): string {
  const root = result as Record<string, unknown> | null;
  if (!root) return "";
  if (typeof root.text === "string") return root.text;
  if (typeof root.answer === "string") return root.answer;
  const output = Array.isArray(root.output)
    ? (root.output as Array<Record<string, unknown>>)
    : [];
  const openAI = output
    .flatMap((entry) =>
      Array.isArray(entry.content)
        ? (entry.content as Array<Record<string, unknown>>)
        : [],
    )
    .map((entry) => valueText(entry.text))
    .filter(Boolean)
    .join("\n");
  if (openAI) return openAI;
  const anthropic = (
    Array.isArray(root.content)
      ? (root.content as Array<Record<string, unknown>>)
      : []
  )
    .map((entry) => valueText(entry.text))
    .filter(Boolean)
    .join("\n");
  if (anthropic) return anthropic;
  const choices = Array.isArray(root.choices)
    ? (root.choices as Array<Record<string, unknown>>)
    : [];
  const choice = choices
    .map((entry) =>
      valueText(
        (entry.message as Record<string, unknown> | undefined)?.content,
      ),
    )
    .filter(Boolean)
    .join("\n");
  if (choice) return choice;
  const candidates = Array.isArray(root.candidates)
    ? (root.candidates as Array<Record<string, unknown>>)
    : [];
  const gemini = candidates
    .flatMap((entry) => {
      const content = entry.content as Record<string, unknown> | undefined;
      return Array.isArray(content?.parts)
        ? (content.parts as Array<Record<string, unknown>>)
        : [];
    })
    .map((entry) => valueText(entry.text))
    .filter(Boolean)
    .join("\n");
  if (gemini) return gemini;
  const cohere = root.message as Record<string, unknown> | undefined;
  const cohereText = (
    Array.isArray(cohere?.content)
      ? (cohere.content as Array<Record<string, unknown>>)
      : []
  )
    .map((entry) => valueText(entry.text))
    .filter(Boolean)
    .join("\n");
  return (
    cohereText ||
    t(
      "El proveedor completó el trabajo, pero su respuesta no contiene texto compatible.",
    )
  );
}

async function awaitJob(id: string, signal: AbortSignal): Promise<AIJob> {
  for (let attempt = 0; attempt < 180; attempt += 1) {
    if (signal.aborted) throw new DOMException("Cancelled", "AbortError");
    const { job } = await api.aiJob(id);
    if (["completed", "failed", "cancelled"].includes(job.status)) return job;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(
    t(
      "El trabajo sigue activo; puedes consultarlo desde el historial de jobs.",
    ),
  );
}

function ErrorNotice({ error }: { error: unknown }) {
  if (!error) return null;
  const credential =
    error instanceof ApiError && error.code === "credential_required";
  return (
    <div
      className="rounded-lg border border-red-800/70 bg-red-950/30 p-3 text-xs text-red-300"
      role="alert"
    >
      {credential
        ? t("Configura en tu perfil la API key de este proveedor.")
        : errorText(error)}
    </div>
  );
}

function ProviderControls({
  preferences,
  provider,
  model,
  onProvider,
  onModel,
}: {
  preferences: AIPreferences;
  provider: string;
  model: string;
  onProvider: (value: string) => void;
  onModel: (value: string) => void;
}) {
  // Keep the provider menu in the same order and vocabulary as Desktop.  Server
  // can execute only its gateway providers; the remaining entries stay visible
  // (and are explicitly disabled) so a portable favorite never disappears when
  // a user moves between Desktop and Web.
  const executable = new Set([
    "openai",
    "openrouter",
    "anthropic",
    "gemini",
    "mistral",
    "cohere",
  ]);
  const providers = [...AI_PROVIDERS];
  const selectedProviderAvailable = providers.includes(
    provider as (typeof AI_PROVIDERS)[number],
  );
  const visibleProviders = selectedProviderAvailable
    ? providers
    : [provider, ...providers];
  return (
    <div className="server-ai-controls">
      <label>
        {t("Proveedor")}
        <select
          className="input text-xs"
          value={provider}
          onChange={(event) => {
            const next = event.target.value;
            onProvider(next);
            onModel(
              preferences.chatModels?.[next] ||
                SERVER_DEFAULT_MODELS[next] ||
                "",
            );
          }}
        >
          {visibleProviders.map((entry) => (
            <option key={entry} value={entry} disabled={!executable.has(entry)}>
              {PROVIDER_LABELS[entry as keyof typeof PROVIDER_LABELS] || entry}
              {executable.has(entry) ? "" : ` · ${t("Desktop")}`}
            </option>
          ))}
        </select>
      </label>
      <label>
        {t("Modelo")}
        <select
          className="input text-xs"
          value={model}
          onChange={(event) => onModel(event.target.value)}
          data-testid="server-model-picker"
        >
          {serverModelsFor(preferences, provider, model).map((entry) => (
            <option key={entry} value={entry}>
              {entry}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}

function useAIProfile() {
  const [preferences, setPreferences] = useState<AIPreferences>({});
  const [promptLanguage, setPromptLanguage] = useState("en");
  const [provider, setProvider] = useState("openai");
  const [model, setModel] = useState(SERVER_DEFAULT_MODELS.openai);
  useEffect(() => {
    Promise.all([api.aiPreferences(), api.profilePreferences()]).then(([ai, profile]) => {
        const next = ai.preferences;
        setPreferences(next);
        setPromptLanguage(profile.profile.values?.appearance?.promptLanguage || profile.profile.values?.appearance?.uiLanguage || "en");
        const executable = new Set([
          "openai",
          "openrouter",
          "anthropic",
          "gemini",
          "mistral",
          "cohere",
        ]);
        const requested = next.defaultProvider || "openai";
        const chosen = executable.has(requested) ? requested : "openai";
        setProvider(chosen);
        setModel(
          next.chatModels?.[chosen] || SERVER_DEFAULT_MODELS[chosen] || "",
        );
      })
      .catch(() => undefined);
  }, []);
  return { preferences, provider, setProvider, model, setModel, promptLanguage };
}

type ConversationMode = "assistant" | "nodi" | "study" | "database" | "world";
const CONVERSATION_MODE: Record<
  ConversationMode,
  {
    prefix: string;
    capability: string;
    title: string;
    emptyTitle: string;
    icon: string;
  }
> = {
  assistant: {
    prefix: "[Assistant]",
    capability: "assistant",
    title: "Assistant",
    emptyTitle: "Pregunta sobre el vault",
    icon: "chat",
  },
  nodi: {
    prefix: "[Nodi]",
    capability: "nodi",
    title: "Nodi",
    emptyTitle: "Piensa con Nodi",
    icon: "sparkles",
  },
  study: {
    prefix: "[Study]",
    capability: "study",
    title: "Chat de estudio",
    emptyTitle: "Pregunta a tus materiales",
    icon: "book",
  },
  database: {
    prefix: "[Database]",
    capability: "database",
    title: "Chat de datos",
    emptyTitle: "Pregunta a tus datos",
    icon: "table",
  },
  world: {
    prefix: "[World]",
    capability: "content-query",
    title: "Chat del mundo",
    emptyTitle: "Explora el mundo",
    icon: "sparkles",
  },
};

export function ConversationServerView({
  spaceId,
  csrfToken,
  mode,
}: {
  spaceId: string;
  csrfToken?: string;
  mode: ConversationMode;
}) {
  const profile = useAIProfile();
  const copy = CONVERSATION_MODE[mode];
  const prefix = copy.prefix;
  const [conversations, setConversations] = useState<AIConversation[]>([]);
  const [active, setActive] = useState<AIConversation | null>(null);
  const [prompt, setPrompt] = useState("");
  const [error, setError] = useState<unknown>();
  const [job, setJob] = useState<AIJob | null>(null);
  const abort = useRef<AbortController | null>(null);
  const load = useCallback(
    () =>
      api.conversations().then(({ conversations: items }) => {
        const own = items.filter(
          (entry) =>
            entry.vaultId === spaceId && entry.title.startsWith(prefix),
        );
        setConversations(own);
        setActive(
          (current) =>
            own.find((entry) => entry.id === current?.id) || own[0] || null,
        );
      }),
    [prefix, spaceId],
  );
  useEffect(() => {
    void load();
    return () => abort.current?.abort();
  }, [load]);
  const create = async (title = t("Nueva conversación")) => {
    const response = await api.createConversation(
      spaceId,
      `${prefix} ${title}`,
      csrfToken,
    );
    setConversations((items) => [response.conversation, ...items]);
    setActive(response.conversation);
    return response.conversation;
  };
  const send = async (event: FormEvent) => {
    event.preventDefault();
    const content = prompt.trim();
    if (!content || (job && ["queued", "running"].includes(job.status))) return;
    setPrompt("");
    setError(undefined);
    const controller = new AbortController();
    abort.current = controller;
    try {
      let conversation = active || (await create(content.slice(0, 60)));
      conversation = (
        await api.appendConversationMessage(
          conversation.id,
          { role: "user", content },
          csrfToken,
        )
      ).conversation;
      setActive(conversation);
      setConversations((items) =>
        items.map((entry) =>
          entry.id === conversation.id ? conversation : entry,
        ),
      );
      const context = await api
        .contextPackage(spaceId, content, csrfToken)
        .catch(() => ({ sections: [] }));
      const system = conversationSystem(mode, profile.promptLanguage);
      const messages: AIMessage[] = [
        {
          role: "system",
          content: `${system}\n\n${serverLabel(profile.promptLanguage, "context")}:\n${JSON.stringify(context.sections || []).slice(0, 32_000)}`,
        },
        ...conversation.messages.map(({ role, content: message }) => ({
          role,
          content: message,
        })),
      ];
      const created = await api.runAI(
        spaceId,
        copy.capability,
        { provider: profile.provider, model: profile.model, messages },
        csrfToken,
      );
      setJob(created.job);
      const completed = await awaitJob(created.job.id, controller.signal);
      setJob(completed);
      if (completed.status !== "completed")
        throw new Error(
          completed.error?.message ||
            tx("Trabajo {status}.", { status: completed.status }),
        );
      conversation = (
        await api.appendConversationMessage(
          conversation.id,
          { role: "assistant", content: extractAIText(completed.result) },
          csrfToken,
        )
      ).conversation;
      setActive(conversation);
      setConversations((items) =>
        items.map((entry) =>
          entry.id === conversation.id ? conversation : entry,
        ),
      );
    } catch (cause) {
      if (!(cause instanceof DOMException && cause.name === "AbortError"))
        setError(cause);
    }
  };
  const cancel = async () => {
    abort.current?.abort();
    if (job && ["queued", "running"].includes(job.status))
      await api.cancelAIJob(job.id, csrfToken).catch(() => undefined);
    setJob(null);
  };
  return (
    <div className="server-personal-layout" data-testid={`${mode}-view`}>
      <aside className="server-personal-list">
        <div className="flex items-center justify-between gap-2 p-3">
          <div>
            <h1 className="text-sm font-semibold">{t(copy.title)}</h1>
            <p className="text-[10px] text-teal-400">
              {t("Conversaciones privadas")}
            </p>
          </div>
          <button className="btn text-xs" onClick={() => void create()}>
            {t("Nueva")}
          </button>
        </div>
        <div className="space-y-1 p-2">
          {conversations.map((entry) => (
            <button
              key={entry.id}
              className={`w-full rounded-lg p-2 text-left text-xs ${active?.id === entry.id ? "bg-indigo-600 text-white" : "text-neutral-400 hover:bg-neutral-900"}`}
              onClick={() => setActive(entry)}
            >
              {entry.title.replace(prefix, "").trim() || t("Conversación")}
              <span className="mt-1 block text-[10px] opacity-60">
                {tx("{n} mensajes", { n: entry.messages.length })}
              </span>
            </button>
          ))}
        </div>
      </aside>
      <section className="server-personal-main">
        <header className="border-b border-neutral-800 p-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <strong className="text-sm">{t(copy.title)}</strong>
              <p className="text-[11px] text-neutral-500">
                {t(
                  "Tu historial y tus credenciales no se comparten con otros miembros.",
                )}
              </p>
            </div>
            <ProviderControls
              {...profile}
              onProvider={profile.setProvider}
              onModel={profile.setModel}
            />
          </div>
        </header>
        <div className="server-chat-scroll">
          {active?.messages.length ? (
            active.messages.map((message) => (
              <article
                key={message.id || `${message.role}-${message.createdAt}`}
                className={`server-chat-message ${message.role}`}
              >
                <span>
                  {message.role === "assistant" ? t(copy.title) : t("Tú")}
                </span>
                <MarkdownReader value={message.content} />
              </article>
            ))
          ) : (
            <div className="server-chat-empty">
              <Icon name={copy.icon} size={34} />
              <h2>{t(copy.emptyTitle)}</h2>
              <p>
                {t(
                  "El contexto se recupera del corpus publicado; la conversación permanece privada.",
                )}
              </p>
            </div>
          )}
          {job && ["queued", "running"].includes(job.status) && (
            <div className="p-3 text-xs text-indigo-300" role="status">
              {tx("Procesando · intento {n}…", { n: job.attempt })}
            </div>
          )}
          <ErrorNotice error={error} />
        </div>
        <form className="server-chat-composer" onSubmit={send}>
          <textarea
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            placeholder={t("Escribe tu pregunta…")}
            rows={3}
          />
          <div className="flex justify-between gap-2">
            <span className="text-[10px] text-neutral-600">
              {t("Las citas deben resolver a nodus://")}
            </span>
            {job && ["queued", "running"].includes(job.status) ? (
              <button
                type="button"
                className="btn btn-ghost text-xs"
                onClick={() => void cancel()}
              >
                {t("Cancelar")}
              </button>
            ) : (
              <button className="btn text-xs" disabled={!prompt.trim()}>
                {t("Enviar")}
              </button>
            )}
          </div>
        </form>
      </section>
    </div>
  );
}

function artifactLabel(kind: UserArtifactKind): string {
  return kind === "workspace-note"
    ? "Workspace"
    : kind === "nodi-note"
      ? "Nodi"
      : kind === "deep-research"
        ? "Deep Research"
        : kind === "dictionary-entry"
          ? "Dictionary"
          : "Síntesis";
}

export function LegacyPrivateNotesServerView({
  spaceId,
  csrfToken,
  kind = "workspace-note",
}: {
  spaceId: string;
  csrfToken?: string;
  kind?: "workspace-note" | "nodi-note";
}) {
  const [items, setItems] = useState<UserArtifact[]>([]);
  const [folders, setFolders] = useState<JsonRecord[]>([]);
  const [folderFilter, setFolderFilter] = useState("");
  const [openIds, setOpenIds] = useState<string[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [query, setQuery] = useState("");
  const [error, setError] = useState<unknown>();
  const [busy, setBusy] = useState(false);
  const active = items.find((entry) => entry.id === activeId) || null;
  const load = useCallback(async () => {
    const [{ artifacts }, notes] = await Promise.all([
      api.artifacts(spaceId, kind),
      kind === "workspace-note"
        ? api.collection(spaceId, "notes", { limit: "500" })
        : Promise.resolve(undefined),
    ]);
    const published =
      kind === "workspace-note"
        ? pageItems(notes, "notes").map(
            (note) =>
              ({
                id: valueText(note.id),
                ownerUserId: "",
                vaultId: spaceId,
                kind: "workspace-note" as const,
                title: valueText(note.title, "Sin título"),
                content: valueText(note.snippet),
                metadata: {
                  tags: Array.isArray(note.tags) ? note.tags : [],
                  folderId: note.folder_id,
                  published: true,
                },
                sourceJobId: null,
                publication: null,
                revision: 0,
                createdAt: valueText(note.created_at),
                updatedAt: valueText(note.updated_at || note.created_at),
              }) satisfies UserArtifact,
          )
        : [];
    setFolders(
      kind === "workspace-note" && notes && Array.isArray(notes.folders)
        ? (notes.folders as JsonRecord[])
        : [],
    );
    setItems([...artifacts, ...published]);
  }, [kind, spaceId]);
  useEffect(() => {
    void load().catch(setError);
  }, [load]);
  useEffect(() => {
    if (!active?.metadata?.published || !active.id || active.content) return;
    api
      .detail(spaceId, "notes", active.id)
      .then((response) => {
        const note = (
          response.note && typeof response.note === "object"
            ? response.note
            : response
        ) as JsonRecord;
        setItems((current) =>
          current.map((entry) =>
            entry.id === active.id
              ? { ...entry, content: valueText(note.content) }
              : entry,
          ),
        );
      })
      .catch(() => undefined);
  }, [active?.id, active?.metadata?.published, active?.content, spaceId]);
  useEffect(() => {
    setTitle(active?.title || "");
    setContent(active?.content || "");
  }, [active?.id]);
  const openItem = (entry: UserArtifact) => {
    setOpenIds((current) =>
      current.includes(entry.id) ? current : [...current, entry.id],
    );
    setActiveId(entry.id);
  };
  const closeItem = (id: string) => {
    setOpenIds((current) => current.filter((entry) => entry !== id));
    if (activeId === id) setActiveId(null);
  };
  const create = async () => {
    try {
      const { artifact } = await api.createArtifact(
        { vaultId: spaceId, kind, title: t("Sin título"), content: "" },
        csrfToken,
      );
      setItems((current) => [artifact, ...current]);
      openItem(artifact);
    } catch (cause) {
      setError(cause);
    }
  };
  const save = async () => {
    if (!active || active.metadata?.published) return;
    setBusy(true);
    try {
      const { artifact } = await api.updateArtifact(
        active.id,
        { title, content },
        csrfToken,
      );
      setItems((current) =>
        current.map((entry) => (entry.id === artifact.id ? artifact : entry)),
      );
    } catch (cause) {
      setError(cause);
    } finally {
      setBusy(false);
    }
  };
  const remove = async () => {
    if (!active) return;
    try {
      await api.deleteArtifact(active.id, csrfToken);
      setItems((current) => current.filter((entry) => entry.id !== active.id));
      closeItem(active.id);
    } catch (cause) {
      setError(cause);
    }
  };
  const visible = items
    .filter(
      (entry) =>
        !folderFilter || valueText(entry.metadata?.folderId) === folderFilter,
    )
    .filter(
      (entry) =>
        !query.trim() ||
        `${entry.title} ${entry.content}`
          .toLocaleLowerCase()
          .includes(query.trim().toLocaleLowerCase()),
    );
  return (
    <div
      className="library-theme flex h-full min-h-0 flex-col bg-white text-neutral-900 dark:bg-neutral-950 dark:text-neutral-100"
      data-testid="private-notes-view"
    >
      <nav
        className="flex min-w-0 shrink-0 items-end gap-1 overflow-x-auto border-b border-neutral-200 px-3 pt-2 dark:border-neutral-800"
        aria-label={t("Pestañas del espacio de trabajo")}
      >
        <button
          className={`flex h-9 shrink-0 items-center gap-2 rounded-t-lg border border-b-0 px-3 text-xs ${!active ? "border-neutral-300 bg-white dark:border-neutral-700 dark:bg-neutral-900" : "border-transparent text-neutral-500"}`}
          onClick={() => setActiveId(null)}
        >
          <Icon name="notebook" size={13} />
          {artifactLabel(kind)}
        </button>
        {openIds.map((id) => {
          const entry = items.find((item) => item.id === id);
          if (!entry) return null;
          return (
            <div
              key={id}
              className={`flex h-9 shrink-0 items-center rounded-t-lg border border-b-0 ${activeId === id ? "border-neutral-300 bg-white dark:border-neutral-700 dark:bg-neutral-900" : "border-transparent text-neutral-500"}`}
            >
              <button
                className="flex h-full max-w-64 items-center gap-2 px-3 text-xs"
                onClick={() => setActiveId(id)}
              >
                <Icon name="notebook" size={13} />
                <span className="truncate">
                  {entry.title || t("Sin título")}
                </span>
              </button>
              <button
                className="mr-1 grid h-6 w-6 place-items-center rounded hover:bg-neutral-200 dark:hover:bg-neutral-800"
                onClick={() => closeItem(id)}
                aria-label={tx("Cerrar {title}", { title: entry.title })}
              >
                <Icon name="x" size={11} />
              </button>
            </div>
          );
        })}
      </nav>
      {!active ? (
        <div className="flex min-h-0 flex-1">
          <aside className="w-64 shrink-0 border-r border-neutral-200 dark:border-neutral-800">
            <div className="flex items-center justify-between border-b border-neutral-200 p-3 dark:border-neutral-800">
              <div>
                <h1 className="text-sm font-semibold">{t("Colecciones")}</h1>
                <p className="text-[10px] text-neutral-500">
                  {t("Privado para ti")}
                </p>
              </div>
              <button className="btn h-8 text-xs" onClick={() => void create()}>
                <Icon name="plus" size={12} />
                {t("Nueva")}
              </button>
            </div>
            <button
              className={`m-2 flex w-[calc(100%-1rem)] items-center gap-2 rounded-lg px-3 py-2 text-left text-xs ${!folderFilter ? "bg-indigo-600 text-white" : "hover:bg-neutral-100 dark:hover:bg-neutral-900"}`}
              onClick={() => setFolderFilter("")}
            >
              <Icon name="notebook" size={14} />
              <span className="flex-1">{t("Todas las notas")}</span>
              <span className="text-[10px] opacity-70">{items.length}</span>
            </button>
            <div className="space-y-1 px-2">
              {folders.map((folder) => (
                <button
                  key={valueText(folder.id)}
                  className={`flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-xs ${folderFilter === valueText(folder.id) ? "bg-indigo-600 text-white" : "text-neutral-500 hover:bg-neutral-100 dark:hover:bg-neutral-900"}`}
                  onClick={() => setFolderFilter(valueText(folder.id))}
                >
                  <Icon name="folder" size={13} />
                  <span className="flex-1 truncate">
                    {valueText(folder.name, "Colección")}
                  </span>
                  <span className="text-[10px] opacity-70">
                    {
                      items.filter(
                        (item) =>
                          valueText(item.metadata?.folderId) ===
                          valueText(folder.id),
                      ).length
                    }
                  </span>
                </button>
              ))}
            </div>
          </aside>
          <section className="flex min-w-0 flex-1 flex-col">
            <div className="flex items-center gap-2 border-b border-neutral-200 p-3 dark:border-neutral-800">
              <div className="relative flex-1">
                <Icon
                  name="search"
                  size={14}
                  className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-neutral-500"
                />
                <input
                  className="input input-with-leading-icon h-8 w-full text-xs"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder={t("Buscar en notas e ideas…")}
                />
              </div>
              <button className="btn h-8 text-xs" onClick={() => void create()}>
                <Icon name="plus" size={12} />
                {t("Nueva nota")}
              </button>
            </div>
            <div className="grid h-9 shrink-0 grid-cols-[22px_minmax(0,1fr)_minmax(120px,.45fr)_90px] items-center border-b border-neutral-200 px-4 text-[10px] font-semibold uppercase tracking-wider text-neutral-500 dark:border-neutral-800">
              <span />
              <span>{t("Título")}</span>
              <span>{t("Etiquetas")}</span>
              <span className="text-right">{t("Modificado")}</span>
            </div>
            <div className="min-h-0 flex-1 overflow-auto">
              {visible.length ? (
                visible.map((entry) => (
                  <button
                    key={entry.id}
                    className="grid min-h-[62px] w-full grid-cols-[22px_minmax(0,1fr)_minmax(120px,.45fr)_90px] items-center border-b border-neutral-100 px-4 text-left text-xs hover:bg-neutral-50 dark:border-neutral-900 dark:hover:bg-neutral-900/60"
                    onClick={() => openItem(entry)}
                  >
                    <Icon
                      name="notebook"
                      size={14}
                      className="text-neutral-500"
                    />
                    <span className="min-w-0 pr-3">
                      <strong className="block truncate text-sm font-normal">
                        {entry.title || t("Sin título")}
                      </strong>
                      <small className="mt-1 block truncate text-[11px] text-neutral-500">
                        {entry.content.replace(/[#*_`]/g, "").slice(0, 150) ||
                          t("Sin contenido")}
                      </small>
                    </span>
                    <span className="text-neutral-500">
                      {Array.isArray(entry.metadata?.tags)
                        ? (entry.metadata.tags as string[])
                            .slice(0, 3)
                            .join(" · ")
                        : "—"}
                    </span>
                    <span className="text-right text-[10px] text-neutral-500">
                      {new Date(entry.updatedAt).toLocaleDateString(
                        getActiveLang(),
                      )}
                    </span>
                  </button>
                ))
              ) : (
                <div className="grid h-48 place-items-center text-sm text-neutral-500">
                  {t("Todavía no hay nada aquí. Crea una nota para empezar.")}
                </div>
              )}
            </div>
          </section>
        </div>
      ) : (
        <section className="flex min-h-0 flex-1 flex-col">
          <header className="flex shrink-0 items-center gap-2 border-b border-neutral-200 px-4 py-2 dark:border-neutral-800">
            <button
              className="btn btn-ghost h-8 text-xs"
              onClick={() => setActiveId(null)}
            >
              <Icon name="chevronLeft" size={13} />
              Nodus Scriptor
            </button>
            <span className="flex-1" />
            {!active.metadata?.published && (
              <button
                className="btn btn-ghost h-8 text-xs text-red-500"
                onClick={() => void remove()}
              >
                <Icon name="trash" size={12} />
                {t("Eliminar")}
              </button>
            )}
            <button
              className="btn h-8 text-xs"
              disabled={busy || Boolean(active.metadata?.published)}
              onClick={() => void save()}
            >
              <Icon name="save" size={12} />
              {active.metadata?.published
                ? t("Solo lectura")
                : busy
                  ? t("Guardando…")
                  : t("Guardar")}
            </button>
          </header>
          <div className="min-h-0 flex-1 overflow-auto bg-neutral-50 p-5 dark:bg-neutral-950">
            <div className="mx-auto flex min-h-full max-w-5xl flex-col rounded-xl border border-neutral-200 bg-white p-6 shadow-sm dark:border-neutral-800 dark:bg-neutral-900">
              <input
                className="server-note-title text-neutral-900 dark:text-neutral-100"
                readOnly={Boolean(active.metadata?.published)}
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                placeholder={t("Título")}
              />
              <textarea
                className="server-note-editor min-h-[55vh] text-neutral-800 dark:text-neutral-200"
                readOnly={Boolean(active.metadata?.published)}
                value={content}
                onChange={(event) => setContent(event.target.value)}
                placeholder={t("Escribe en Markdown…")}
              />
            </div>
          </div>
        </section>
      )}
      <ErrorNotice error={error} />
    </div>
  );
}

function serverWorkspaceMeta(entry: UserArtifact): JsonRecord {
  return entry.metadata && typeof entry.metadata === "object"
    ? (entry.metadata as JsonRecord)
    : {};
}
function serverWorkspaceTags(entry: UserArtifact): string[] {
  const tags = serverWorkspaceMeta(entry).tags;
  return Array.isArray(tags)
    ? tags.map((tag) => valueText(tag)).filter(Boolean)
    : [];
}
function serverWorkspacePublished(entry: UserArtifact): boolean {
  return serverWorkspaceMeta(entry).published === true;
}
function serverWorkspaceTrashed(entry: UserArtifact): boolean {
  return Boolean(valueText(serverWorkspaceMeta(entry).trashedAt));
}

function ServerWorkspaceCollections({
  folders,
  selected,
  expanded,
  counts,
  onSelect,
  onToggle,
  onRename,
  onDelete = () => undefined,
  onDrop,
}: {
  folders: UserArtifact[];
  selected: string;
  expanded: Set<string>;
  counts: Map<string, number>;
  onSelect: (id: string) => void;
  onToggle: (id: string) => void;
  onRename: (folder: UserArtifact) => void;
  onDelete?: (folder: UserArtifact) => void;
  onDrop?: (folder: UserArtifact, transfer: DataTransfer) => void;
}): ReactNode {
  const children = (parentId: string | null) =>
    folders
      .filter(
        (folder) =>
          valueText(serverWorkspaceMeta(folder).parentId) === (parentId || ""),
      )
      .sort((a, b) => a.title.localeCompare(b.title));
  const render = (folder: UserArtifact, depth: number): ReactNode => {
    const nested = children(folder.id);
    const open = expanded.has(folder.id);
    const meta = serverWorkspaceMeta(folder);
    return (
      <div key={folder.id} draggable={Boolean(onDrop && !meta.published)} onDragStart={event => { event.stopPropagation(); event.dataTransfer.setData('application/x-nodus-workspace-collection',folder.id); }} onDragOver={event => { if (onDrop && !meta.published && [...event.dataTransfer.types].some(type=>type.startsWith('application/x-nodus-workspace-'))) event.preventDefault(); }} onDrop={event => { if (onDrop && !meta.published) {event.preventDefault();event.stopPropagation();onDrop(folder,event.dataTransfer);} }}>
        <div
          className="group flex items-center gap-1"
          style={{ paddingLeft: `${8 + depth * 13}px` }}
        >
          <button
            type="button"
            className="grid h-7 w-6 place-items-center text-neutral-500"
            aria-label={`${open ? t("Contraer") : t("Expandir")} ${folder.title}`}
            onClick={() => onToggle(folder.id)}
          >
            {nested.length > 0 && (
              <Icon name={open ? "chevronDown" : "chevronRight"} size={11} />
            )}
          </button>
          <button
            type="button"
            data-testid={`workspace-server-collection-${folder.id}`}
            className={`flex min-w-0 flex-1 items-center gap-2 rounded-lg px-2 py-2 text-left text-xs ${selected === folder.id ? "bg-indigo-600 text-white" : "text-neutral-500 hover:bg-neutral-100 dark:hover:bg-neutral-900"}`}
            onClick={() => onSelect(folder.id)}
          >
            <Icon name="folder" size={13} />
            <span className="min-w-0 flex-1 truncate">{folder.title}</span>
            <span className="text-[10px] opacity-70">
              {counts.get(folder.id) || 0}
            </span>
          </button>
          {!meta.published && (
            <>
              <button
                type="button"
                className="hidden h-7 w-7 place-items-center rounded text-neutral-500 group-hover:grid hover:text-neutral-900 dark:hover:text-white"
                aria-label={tx("Renombrar {title}", { title: folder.title })}
                onClick={() => onRename(folder)}
              >
                <Icon name="edit" size={11} />
              </button>
              <button
                type="button"
                className="hidden h-7 w-7 place-items-center rounded text-neutral-500 group-hover:grid hover:text-red-500"
                aria-label={tx("Eliminar {title}", { title: folder.title })}
                onClick={() => onDelete(folder)}
              >
                <Icon name="trash" size={11} />
              </button>
            </>
          )}
        </div>
        {open && nested.map((child) => render(child, depth + 1))}
      </div>
    );
  };
  return children(null).map((folder) => render(folder, 0));
}

/** Workspace parity surface for the browser. Publications are deliberately projected as
 * read-only rows; all edits, folders and trash live in the authenticated artifact store. */
export function PrivateNotesServerView({
  spaceId,
  userId = 'authenticated',
  csrfToken,
  kind = "workspace-note",
}: {
  spaceId: string;
  userId?: string;
  csrfToken?: string;
  kind?: "workspace-note" | "nodi-note";
}) {
  const snapshotKey = `server:${userId}:${spaceId}`;
  const initialSnapshot = useMemo(() => readViewSnapshot(snapshotKey, 'workspace'), [snapshotKey]);
  const [pinnedActionIds, setPinnedActionIds] = useState<string[]>(initialSnapshot?.pinnedActionIds ?? []);
  const [layout, setLayout] = useState(initialSnapshot?.layout ?? 'editorial');
  const [catalogView, setCatalogView] = useState<'list' | 'cards'>(initialSnapshot?.catalogView ?? 'list');
  const [contextOpen, setContextOpen] = useState(initialSnapshot?.contextOpen ?? false);
  const [focus, setFocus] = useState(false);
  const editorialFocus = useEditorialFocus(focus, active => { setFocus(active); if (active) { setLayout('editorial'); setContextOpen(false); } });
  const [raw, setRaw] = useState(false);
  const hydratedId = useRef('');
  const draftRevision = useRef<number | null>(null);
  const [editorKey, setEditorKey] = useState(0);
  const [collectionsOpen, setCollectionsOpen] = useState(false);
  const [split, setSplit] = useState(false);
  const [contextTab, setContextTab] = useState<'sources' | 'details' | 'history' | 'checks' | 'structure'>('sources');
  const [nativeDocument, setNativeDocument] = useState<BlockNoteDocument | null>(null);
  const [academicMetadata,setAcademicMetadata] = useState<AcademicMetadata>(()=>normalizeAcademicMetadata(null));
  const academicRef=useRef(academicMetadata);academicRef.current=academicMetadata;
  const academicTools=useRef<AcademicToolsHandle>(null);
  const nativeRef = useRef<BlockNoteDocument | null>(null);
  const baseline = useRef('');
  const latestSignature = useRef('');
  const saveQueue = useRef<Promise<boolean>>(Promise.resolve(true));
  const savedSignatures = useRef(new Map<string,string>());
  const saveLatest = useRef<() => Promise<boolean>>(async () => true);
  const flushLatest = useCallback(() => flushEditorialDraft(() => saveLatest.current(), () => !hydratedId.current || latestSignature.current === baseline.current), []);
  const listReferences = useCallback(async (): Promise<EditorReference[]> => {
    const response = await api.editorReferences(spaceId);
    return [...response.items, ...itemsRef.current.filter(entry => !serverWorkspaceTrashed(entry)).map(entry => ({ id: entry.id, kind: 'note' as const, title: entry.title, href: `nodus://note/${encodeURIComponent(entry.id)}` }))];
  }, [spaceId]);
  const navigateReference = async (href: string) => {
    if (!await flushLatest()) return;
    const reference = parseEditorReference(href);
    const entry = reference?.kind === 'note' && itemsRef.current.find(item => item.id === reference.id);
    if (entry) void openItem(entry);
    else if (/^https?:\/\//i.test(href)) window.open(href, '_blank', 'noopener,noreferrer');
    else { const target = serverHrefForNodus(href); if (target) window.location.assign(target); }
  };

  const itemsRef = useRef<UserArtifact[]>([]);
  const canvasRef = useRef<BlockNoteCanvasHandle>(null);
  const rawEditorRef = useRef<HTMLTextAreaElement>(null);
  const rawSelection = useRef<{id:string;content:string;from:number;to:number}|null>(null);
  const [historyState,setHistoryState] = useState({canUndo:false,canRedo:false});
  const [items, setItems] = useState<UserArtifact[]>([]);
  const [folders, setFolders] = useState<UserArtifact[]>([]);
  const [folderFilter, setFolderFilter] = useState("");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [openIds, setOpenIds] = useState<string[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [query, setQuery] = useState("");
  const [sortOrder,setSortOrder] = useState("recent");
  const [kindFilter,setKindFilter] = useState("");
  const [tagFilter,setTagFilter] = useState("");
  const [showFind,setShowFind] = useState(false);
  const [find,setFind] = useState("");
  const [replace,setReplace] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [tagDraft, setTagDraft] = useState("");
  const [error, setError] = useState<unknown>();
  const [busy, setBusy] = useState(false);
  const active = items.find((entry) => entry.id === activeId) || null;
  itemsRef.current = items;
  useEffect(() => { patchViewSnapshot(snapshotKey, 'workspace', { layout, catalogView, contextOpen, focusMode: focus, pinnedActionIds }); }, [snapshotKey,layout,catalogView,contextOpen,focus,pinnedActionIds]);
  const trashMode = folderFilter === "__trash__";
  const load = useCallback(async () => {
    const [{ artifacts }, notes, privateFolders] = await Promise.all([
      api.artifacts(spaceId, kind),
      kind === "workspace-note"
        ? api.collection(spaceId, "notes", { limit: "500" })
        : Promise.resolve(undefined),
      kind === "workspace-note"
        ? api.artifacts(spaceId, "workspace-collection")
        : Promise.resolve({ artifacts: [] as UserArtifact[] }),
    ]);
    const published =
      kind === "workspace-note"
        ? pageItems(notes, "notes").map(
            (note) =>
              ({
                id: valueText(note.id),
                ownerUserId: "",
                vaultId: spaceId,
                kind: "workspace-note" as const,
                title: valueText(note.title, "Sin título"),
                content: valueText(note.snippet),
                metadata: {
                  tags: Array.isArray(note.tags) ? note.tags : [],
                  folderId: note.folder_id,
                  published: true,
                },
                sourceJobId: null,
                publication: null,
                revision: 0,
                createdAt: valueText(note.created_at),
                updatedAt: valueText(note.updated_at || note.created_at),
              }) satisfies UserArtifact,
          )
        : [];
    const publishedFolders =
      kind === "workspace-note" && notes && Array.isArray(notes.folders)
        ? (notes.folders as JsonRecord[]).map(
            (folder) =>
              ({
                id: valueText(folder.id),
                ownerUserId: "",
                vaultId: spaceId,
                kind: "workspace-collection" as const,
                title: valueText(folder.name, "Colección"),
                content: "",
                metadata: {
                  published: true,
                  parentId: folder.parent_id ?? folder.parentId,
                },
                sourceJobId: null,
                publication: null,
                revision: 0,
                createdAt: "",
                updatedAt: "",
              }) satisfies UserArtifact,
          )
        : [];
    const workspaceArtifacts = artifacts.filter((entry) => {
      const meta = serverWorkspaceMeta(entry);
      return (
        (!meta.surface || meta.surface === "workspace") &&
        meta.source !== "deep-research" &&
        !meta.deepResearchId
      );
    });
    setFolders([
      ...publishedFolders,
      ...privateFolders.artifacts.filter(
        (entry) => serverWorkspaceMeta(entry).entity === "collection",
      ),
    ]);
    setItems([...workspaceArtifacts, ...published]);
  }, [kind, spaceId]);
  useEffect(() => {
    void load().catch(setError);
  }, [load]);
  useEffect(() => {
    if (!active?.metadata?.published || !active.id || active.metadata?.detailLoaded) return;
    api
      .detail(spaceId, "notes", active.id)
      .then((response) => {
        const note = (
          response.note && typeof response.note === "object"
            ? response.note
            : response
        ) as JsonRecord;
        setItems((current) =>
          current.map((entry) =>
            entry.id === active.id
              ? { ...entry, content: valueText(note.content), metadata: { ...entry.metadata, detailLoaded: true } }
              : entry,
          ),
        );
      })
      .catch(() => undefined);
  }, [active?.id, active?.metadata?.published, active?.content, spaceId]);
  useEffect(() => {
    const native = active ? parseNativeDocument(active.metadata?.nativeDocument) ?? markdownToBlockNote(active.content) : null;
    const academic=normalizeAcademicMetadata(active?.metadata?.academicMetadata);setAcademicMetadata(academic);
    nativeRef.current = native; setNativeDocument(native);
    setTitle(active?.title || ''); setContent(active?.content || '');
    baseline.current = JSON.stringify({ title: active?.title || '', content: active?.content || '', native, academicMetadata:academic });
    if (active) savedSignatures.current.set(active.id,baseline.current);
    setTagDraft(""); setError(undefined);
    draftRevision.current = active?.revision ?? null;
    hydratedId.current = active?.id ?? '';
    if (active && !serverWorkspacePublished(active)) {
      const recovered = readEditorialDraft(snapshotKey,active.id);
      if (recovered) { if(recovered.academicMetadata)setAcademicMetadata(normalizeAcademicMetadata(recovered.academicMetadata));setTitle(recovered.title); setContent(recovered.contentMarkdown); nativeRef.current = recovered.nativeDocument ?? markdownToBlockNote(recovered.contentMarkdown); setNativeDocument(nativeRef.current); draftRevision.current = recovered.revision; if (recovered.revision !== active.revision) setError(new Error(t('La versión guardada ha cambiado. El borrador se conserva.'))); }
    }
  }, [active?.id]);
  const openItem = async (entry: UserArtifact) => {
    if (!await flushLatest()) return;
    setOpenIds((current) =>
      current.includes(entry.id) ? current : [...current, entry.id],
    );
    setActiveId(entry.id);
  };
  const closeItem = async (id: string) => {
    if (activeId === id && !await flushLatest()) return;
    setOpenIds((current) => current.filter((entry) => entry !== id));
    if (activeId === id) setActiveId(null);
  };
  const updateMeta = async (entry: UserArtifact, patch: JsonRecord) => {
    if (entry.id === activeId && !await flushLatest()) throw new Error(t('No se han podido guardar los cambios.'));
    entry = itemsRef.current.find(item => item.id === entry.id) ?? entry;
    const { artifact } = await api.updateArtifact(
      entry.id,
      { expectedRevision: entry.revision, metadata: { ...serverWorkspaceMeta(entry), ...patch } },
      csrfToken,
    );
    setItems((current) =>
      current.map((item) => (item.id === artifact.id ? artifact : item)),
    );
    return artifact;
  };
  const create = async (entity: 'note' | 'idea' = 'note') => {
    try {
      const { artifact } = await api.createArtifact(
        {
          vaultId: spaceId,
          kind,
          title: t("Sin título"),
          content: "",
          metadata: {
            surface: "workspace",
            entity,
            private: true,
            tags: [],
            folderId: null,
          },
        },
        csrfToken,
      );
      setItems((current) => [artifact, ...current]);
      openItem(artifact);
    } catch (cause) {
      setError(cause);
    }
  };
  const duplicate = async (entry = active) => {
    if (!entry || !await flushLatest()) return;
    const current=itemsRef.current.find(item=>item.id===entry.id) ?? entry; const native=parseNativeDocument(current.metadata?.nativeDocument);
    const cloned=native?cloneAcademicDocument(native,current.metadata?.academicMetadata):null;const {artifact}=await api.createArtifact({vaultId:spaceId,kind,title:current.title+' · '+t('Copia'),content:current.content,metadata:{...serverWorkspaceMeta(current),nativeDocument:cloned?.document??null,academicMetadata:cloned?.metadata,editorVersions:[]}},csrfToken);setItems(items=>[artifact,...items]);void openItem(artifact);
  };
  const createManuscript = async () => {
    const folderId=folderFilter&&!folderFilter.startsWith('__')?folderFilter:null;
    const metadata=normalizeAcademicMetadata(null);metadata.manuscript={kind:'paper',chapters:itemsRef.current.filter(entry=>!serverWorkspacePublished(entry)&&folderId&&serverWorkspaceMeta(entry).folderId===folderId).map(entry=>({documentId:entry.id,kind:'note' as const,title:entry.title,included:true})),authors:'',abstract:'',keywords:'',includeContents:false,paper:'A4',marginMm:25};
    const {artifact}=await api.createArtifact({vaultId:spaceId,kind,title:t('Nuevo manuscrito'),content:'',metadata:{entity:'note',folderId,nativeDocument:[],schemaVersion:2,academicMetadata:metadata}},csrfToken);
    setItems(items=>[artifact,...items]);void openItem(artifact);
  };
  const createFolder = async () => {
    try {
      const { artifact } = await api.createArtifact(
        {
          vaultId: spaceId,
          kind: "workspace-collection",
          title: t("Nueva colección"),
          content: "",
          metadata: {
            surface: "workspace",
            entity: "collection",
            private: true,
            parentId: folderFilter && !trashMode ? folderFilter : null,
          },
        },
        csrfToken,
      );
      setFolders((current) => [...current, artifact]);
    } catch (cause) {
      setError(cause);
    }
  };
  const signature = JSON.stringify({ title, content, native: nativeDocument, academicMetadata });
  latestSignature.current = signature;
  const dirty = signature !== baseline.current;
  const save = async (): Promise<boolean> => {
    if (!active || hydratedId.current !== active.id || serverWorkspacePublished(active) || signature === baseline.current) return true;
    const snapshot = { id: active.id, title, content, native: nativeRef.current, academicMetadata:academicRef.current, signature };
    const operation = saveQueue.current.then(async () => {
      if (savedSignatures.current.get(snapshot.id) === snapshot.signature) return true;
      setBusy(true);
      try {
        const current = itemsRef.current.find(entry => entry.id === snapshot.id);
        if (!current) return false;
        const { artifact } = await api.updateArtifact(snapshot.id, { title: snapshot.title, content: snapshot.content, expectedRevision: draftRevision.current ?? current.revision, metadata: { ...serverWorkspaceMeta(current), nativeDocument: snapshot.native, schemaVersion: 2, academicMetadata:snapshot.academicMetadata } }, csrfToken);
        itemsRef.current = itemsRef.current.map(entry => entry.id === artifact.id ? artifact : entry);
        savedSignatures.current.set(snapshot.id,snapshot.signature);
        setItems(itemsRef.current); draftRevision.current = artifact.revision; baseline.current = snapshot.signature; setError(undefined);
        if (latestSignature.current === snapshot.signature) clearEditorialDraft(snapshotKey,snapshot.id);
        return true;
      } catch (cause) { setError(cause); return false; }
      finally { setBusy(false); }
    });
    saveQueue.current = operation;
    return await operation;
  };
  saveLatest.current = save;
  useEffect(() => registerServerEditorFlush(flushLatest), [flushLatest]);
  useEffect(() => {
    if (!active || hydratedId.current !== active.id || serverWorkspacePublished(active) || !dirty) return;
    retainEditorialDraft(snapshotKey,active.id,{title,contentMarkdown:content,nativeDocument:nativeRef.current,academicMetadata:academicRef.current,revision:draftRevision.current ?? active.revision});
    if (error) return;
    const timer = window.setTimeout(() => void saveLatest.current(), 800);
    return () => window.clearTimeout(timer);
  }, [signature,active?.id,active?.revision,dirty,error]);
  useEffect(() => () => { void saveLatest.current(); }, []);
  useEffect(() => {
    if (active && serverWorkspacePublished(active) && active.metadata?.detailLoaded) { setContent(active.content); setNativeDocument(null); }
  }, [active?.id,active?.metadata?.detailLoaded]);
  useEffect(() => { const handler = (event: KeyboardEvent) => { if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase()==='s') {event.preventDefault();void saveLatest.current();} if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase()==='f' && activeId) {event.preventDefault();setShowFind(true);} }; document.addEventListener('keydown',handler); return () => document.removeEventListener('keydown',handler); }, [activeId]);
  const home = async () => { if (await flushLatest()) setActiveId(null); };
  const remove = async (ids: string[]) => {
    try {
      await Promise.all(ids.map((id) => api.deleteArtifact(id, csrfToken)));
      setItems((current) => current.filter((entry) => !ids.includes(entry.id)));
      ids.forEach(closeItem);
      setSelected(new Set());
    } catch (cause) {
      setError(cause);
    }
  };
  const trash = async (ids: string[]) => {
    try {
      await Promise.all(
        ids.map((id) => {
          const entry = items.find((item) => item.id === id);
          return entry && !serverWorkspacePublished(entry)
            ? updateMeta(entry, { trashedAt: new Date().toISOString() })
            : Promise.resolve();
        }),
      );
      setSelected(new Set());
      ids.forEach(closeItem);
    } catch (cause) {
      setError(cause);
    }
  };
  const restore = async (ids: string[]) => {
    try {
      await Promise.all(
        ids.map((id) => {
          const entry = items.find((item) => item.id === id);
          return entry
            ? updateMeta(entry, { trashedAt: null })
            : Promise.resolve();
        }),
      );
      setSelected(new Set());
    } catch (cause) {
      setError(cause);
    }
  };
  const addTag = async () => {
    const tag = tagDraft.trim();
    if (!tag || !selected.size) return;
    try {
      await Promise.all(
        [...selected].map((id) => {
          const entry = items.find((item) => item.id === id);
          return entry && !serverWorkspacePublished(entry)
            ? updateMeta(entry, {
                tags: [...new Set([...serverWorkspaceTags(entry), tag])],
              })
            : Promise.resolve();
        }),
      );
      setTagDraft("");
      setSelected(new Set());
    } catch (cause) {
      setError(cause);
    }
  };
  const moveSelected = async (folderId: string) => {
    try {
      await Promise.all(
        [...selected].map((id) => {
          const entry = items.find((item) => item.id === id);
          return entry && !serverWorkspacePublished(entry)
            ? updateMeta(entry, { folderId: folderId || null })
            : Promise.resolve();
        }),
      );
      setSelected(new Set());
    } catch (cause) {
      setError(cause);
    }
  };
  const renameFolder = async (folder: UserArtifact) => {
    const name = window.prompt(t("Nombre de la colección"), folder.title);
    if (!name?.trim() || serverWorkspacePublished(folder)) return;
    try {
      const { artifact } = await api.updateArtifact(
        folder.id,
        { title: name.trim() },
        csrfToken,
      );
      setFolders((current) =>
        current.map((entry) => (entry.id === artifact.id ? artifact : entry)),
      );
    } catch (cause) {
      setError(cause);
    }
  };
  const dropIntoFolder = async (folder: UserArtifact, transfer: DataTransfer) => {
    try {
      const collectionId=transfer.getData('application/x-nodus-workspace-collection');
      if(collectionId) {
        const moving=folders.find(item=>item.id===collectionId);if(!moving || serverWorkspacePublished(moving)) return;
        let parent: UserArtifact | undefined=folder;const visited=new Set<string>();
        while(parent && !visited.has(parent.id)) {if(parent.id===collectionId) return;visited.add(parent.id);parent=folders.find(item=>item.id===serverWorkspaceMeta(parent!).parentId);}
        const {artifact}=await api.updateArtifact(moving.id,{expectedRevision:moving.revision,metadata:{...serverWorkspaceMeta(moving),parentId:folder.id}},csrfToken);setFolders(current=>current.map(item=>item.id===artifact.id?artifact:item));
      } else {
        const ids=JSON.parse(transfer.getData('application/x-nodus-workspace-notes') || '[]') as string[];
        await Promise.all(ids.map(id=>{const entry=itemsRef.current.find(item=>item.id===id);return entry && !serverWorkspacePublished(entry)?updateMeta(entry,{folderId:folder.id}):Promise.resolve();}));
      }
    } catch(cause) {setError(cause);}
  };
  const deleteFolder = async (folder: UserArtifact) => {
    if(serverWorkspacePublished(folder) || !window.confirm(t('Eliminar colección')+' · '+folder.title)) return;
    try {
      const parentId=serverWorkspaceMeta(folder).parentId ?? null;
      await Promise.all(itemsRef.current.filter(item=>serverWorkspaceMeta(item).folderId===folder.id && !serverWorkspacePublished(item)).map(item=>updateMeta(item,{folderId:parentId})));
      const children=folders.filter(item=>serverWorkspaceMeta(item).parentId===folder.id && !serverWorkspacePublished(item));
      const changed=await Promise.all(children.map(item=>api.updateArtifact(item.id,{expectedRevision:item.revision,metadata:{...serverWorkspaceMeta(item),parentId}},csrfToken)));
      await api.deleteArtifact(folder.id,csrfToken);setFolders(current=>current.filter(item=>item.id!==folder.id).map(item=>changed.find(result=>result.artifact.id===item.id)?.artifact ?? item));if(folderFilter===folder.id) setFolderFilter('');
    } catch(cause) {setError(cause);}
  };
  const visible = useMemo(() => {
    const scopeFolders = new Set<string>(
      folderFilter && !trashMode ? [folderFilter] : [],
    );
    let changed = true;
    while (changed) {
      changed = false;
      folders.forEach((folder) => {
        const parent = valueText(serverWorkspaceMeta(folder).parentId);
        if (
          parent &&
          scopeFolders.has(parent) &&
          !scopeFolders.has(folder.id)
        ) {
          scopeFolders.add(folder.id);
          changed = true;
        }
      });
    }
    return items
      .filter((entry) => {
        const trashed = serverWorkspaceTrashed(entry);
        if (trashMode ? !trashed : trashed) return false;
        if (folderFilter === "__unfiled__" && serverWorkspaceMeta(entry).folderId) return false;
        if (
          scopeFolders.size && folderFilter !== "__unfiled__" &&
          !scopeFolders.has(valueText(serverWorkspaceMeta(entry).folderId))
        )
          return false;
        if (kindFilter && (serverWorkspaceMeta(entry).entity ?? "note") !== kindFilter) return false;
        if (tagFilter && !serverWorkspaceTags(entry).includes(tagFilter)) return false;
        const needle = query.trim().toLocaleLowerCase();
        return (
          !needle ||
          `${entry.title} ${entry.content} ${serverWorkspaceTags(entry).join(" ")}`
            .toLocaleLowerCase()
            .includes(needle)
        );
      })
      .sort((a,b)=>sortOrder === "title" ? a.title.localeCompare(b.title) : (sortOrder === "oldest" ? 1 : -1)*b.updatedAt.localeCompare(a.updatedAt));
  }, [items, folders, folderFilter, query, trashMode, sortOrder,kindFilter,tagFilter]);
  const counts = useMemo(
    () =>
      new Map(
        folders.map((folder) => {
          const ids = new Set([folder.id]);
          let changed = true;
          while (changed) {
            changed = false;
            folders.forEach((candidate) => {
              const parent = valueText(serverWorkspaceMeta(candidate).parentId);
              if (parent && ids.has(parent) && !ids.has(candidate.id)) {
                ids.add(candidate.id);
                changed = true;
              }
            });
          }
          return [
            folder.id,
            items.filter(
              (entry) =>
                !serverWorkspaceTrashed(entry) &&
                ids.has(valueText(serverWorkspaceMeta(entry).folderId)),
            ).length,
          ];
        }),
      ),
    [folders, items],
  );
  const tabs = <WorkspaceTabStrip
    alwaysShowHome homeLabel="Nodus Scriptor" homeIcon="notebook" homeTestId="workspace-server-tab-home"
    tabTestId={tab => 'workspace-server-tab-' + tab.key} closeTestId={tab => 'workspace-server-tab-close-' + tab.key}
    tabs={openIds.flatMap(id => { const entry = items.find(item => item.id === id); return entry ? [{ key: id, title: entry.title || t('Sin título'), icon: serverWorkspacePublished(entry) ? 'book' : 'notebook' }] : []; })}
    activeKey={active?.id ?? null} onActivateHome={() => void home()}
    onActivateTab={id => { const entry = items.find(item => item.id === id); if (entry) void openItem(entry); }}
    onCloseTab={id => void closeItem(id)}
  />;
  const preserveSelection = () => {
    if (raw && active && rawEditorRef.current) rawSelection.current = {id:active.id,content,from:rawEditorRef.current.selectionStart,to:rawEditorRef.current.selectionEnd};
    else canvasRef.current?.preserveSelection();
  };
  const restoreSelection = () => {
    const checkpoint=rawSelection.current;
    if(raw && checkpoint?.id===active?.id && checkpoint?.content===content) {rawEditorRef.current?.focus();rawEditorRef.current?.setSelectionRange(checkpoint!.from,checkpoint!.to);}
    else if(!raw) canvasRef.current?.restoreSelection();
  };
  const published = !active || serverWorkspacePublished(active);
  const editorActions: EditorialAction[] = [
    {id:'undo',label:t('Deshacer'),icon:'undo',group:t('Edición'),essential:true,disabled:published||raw||!historyState.canUndo,shortcut:'Ctrl/⌘+Z',keyShortcuts:'Control+Z Meta+Z',onSelect:()=>canvasRef.current?.undo()},
    {id:'redo',label:t('Rehacer'),icon:'redo',group:t('Edición'),essential:true,disabled:published||raw||!historyState.canRedo,shortcut:'Ctrl+Y / Ctrl/⌘+Shift+Z',keyShortcuts:'Control+Y Control+Shift+Z Meta+Shift+Z',onSelect:()=>canvasRef.current?.redo()},
    ...(!published ? [
      {id:'link',label:t('Enlazar con Nodus'),icon:'link',group:t('Fuentes'),essential:true,disabled:raw,shortcut:'[[',onSelect:()=>canvasRef.current?.openReferenceMenu()},
      {id:'cite',label:t('Citar fuente'),icon:'quote',group:t('Fuentes'),essential:true,disabled:raw,testId:'academic-cite',onSelect:()=>academicTools.current?.open('cite')},
    ] : []),
    {id:'find',label:t('Buscar y reemplazar'),icon:'search',group:t('Búsqueda'),essential:true,pressed:showFind,onSelect:()=>setShowFind(!showFind)},
    {id:'save',label:t('Guardar'),icon:'save',group:t('Documento'),disabled:published,onSelect:()=>void save()},
    ...(!published ? [
      {id:'note',label:t('Nota al pie'),icon:'notebook',group:t('Escritura académica'),testId:'academic-note',disabled:raw,onSelect:()=>academicTools.current?.open('note')},
      {id:'crossref',label:t('Referencia cruzada'),icon:'link',group:t('Escritura académica'),testId:'academic-crossref',disabled:raw,onSelect:()=>academicTools.current?.open('crossref')},
      {id:'evidence',label:t('Vincular evidencia'),icon:'link',group:t('Escritura académica'),testId:'academic-evidence',disabled:raw,onSelect:()=>academicTools.current?.open('evidence')},
      {id:'manuscript',label:t('Manuscrito y citas'),icon:'settings',group:t('Escritura académica'),testId:'academic-settings',onSelect:()=>academicTools.current?.open('settings')},
      {id:'delivery',label:t('Preparar entrega'),icon:'external',group:t('Escritura académica'),testId:'academic-delivery',onSelect:()=>academicTools.current?.open('delivery')},
    ] : []),
    {id:'markdown',label:t('Markdown'),icon:'code',group:t('Vistas'),pressed:raw,onSelect:()=>setRaw(!raw)},
    {id:'split',label:t('Dividir vista'),icon:'columns',group:t('Vistas'),pressed:split,onSelect:()=>setSplit(!split)},
    {id:'history',label:t('Historial'),icon:'clock',group:t('Vistas'),onSelect:()=>{setContextOpen(true);setContextTab('history');}},
    {id:'print',label:t('Imprimir'),icon:'external',group:t('Gestión'),onSelect:()=>window.print()},
    {id:'duplicate',label:t('Duplicar'),icon:'copy',group:t('Gestión'),disabled:published,onSelect:()=>void duplicate().catch(setError)},
    {id:'trash',label:t('Papelera'),icon:'trash',group:t('Gestión'),pinnable:false,disabled:published,onSelect:()=>{if(active)void trash([active.id]);}},
  ];

  return (
    <div
      className="editorial-workspace library-theme relative flex h-full min-h-0 flex-col bg-white text-neutral-900 dark:bg-neutral-950 dark:text-neutral-100"
      data-testid="private-notes-view"
    >
      {tabs}
      {!active && <header className="library-header-bar"><div className="library-header-title"><h1>Nodus Scriptor</h1><p>{items.length} {t('documentos')} · {t('Privado para ti')}</p></div><div className="library-header-actions"><button className="editorial-header-action editorial-collection-toggle" onClick={() => setCollectionsOpen(!collectionsOpen)}>{t('Colecciones')}</button><CatalogViewControl value={catalogView} onChange={setCatalogView} /><details className="editorial-options editorial-create-options"><EditorialCreateTrigger /><div className="editorial-create-menu"><button data-testid="workspace-server-create-note" onClick={() => void create()}>{t('Nota')}</button><button onClick={() => void create('idea')}>{t('Idea')}</button><button data-testid="workspace-server-create-manuscript" onClick={()=>void createManuscript()}>{t('Manuscrito')}</button><button onClick={() => void createFolder()}>{t('Colección')}</button></div></details></div></header>}
      {!active ? (
        <div className="flex min-h-0 flex-1">
          <aside className={`editorial-collections w-64 shrink-0 border-r border-neutral-200 dark:border-neutral-800 ${collectionsOpen ? 'is-open' : ''}`}>
            <div className="flex items-center justify-between border-b border-neutral-200 p-3 dark:border-neutral-800">
              <div>
                <h1 className="text-sm font-semibold">{t("Colecciones")}</h1>
                <p className="text-[10px] text-teal-500">
                  {t("Privado para ti")}
                </p>
              </div>
              <div className="flex gap-1">
                <button
                  data-testid="workspace-server-create-collection"
                  className="btn btn-ghost h-8 w-8 p-0"
                  onClick={() => void createFolder()}
                  aria-label={t("Nueva colección")}
                >
                  <Icon name="folderPlus" size={13} />
                </button>

              </div>
            </div>
            <button
              data-testid="workspace-server-scope-all"
              className={`m-2 flex w-[calc(100%-1rem)] items-center gap-2 rounded-lg px-3 py-2 text-left text-xs ${!folderFilter ? "bg-indigo-600 text-white" : "hover:bg-neutral-100 dark:hover:bg-neutral-900"}`}
              onClick={() => {
                setFolderFilter("");
                setSelected(new Set());
              }}
            >
              <Icon name="library" size={14} />
              <span className="flex-1">{t("Todas las notas")}</span>
              <span className="text-[10px] opacity-70">
                {items.filter((entry) => !serverWorkspaceTrashed(entry)).length}
              </span>
            </button>
            <div className="space-y-1 px-2 flex-1 overflow-auto">
              <ServerWorkspaceCollections
                folders={folders}
                selected={folderFilter}
                expanded={expanded}
                counts={counts}
                onSelect={(id) => {
                  setFolderFilter(id);
                  setSelected(new Set());
                }}
                onToggle={(id) =>
                  setExpanded((current) => {
                    const next = new Set(current);
                    if (next.has(id)) next.delete(id);
                    else next.add(id);
                    return next;
                  })
                }
                onRename={(folder) => void renameFolder(folder)}
                onDelete={folder=>void deleteFolder(folder)} onDrop={(folder,transfer)=>void dropIntoFolder(folder,transfer)}
              />
            </div>
            <div className="mt-2 border-t border-neutral-200 px-2 py-2 dark:border-neutral-800"><button className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-xs" onClick={()=>{setFolderFilter("__unfiled__");setSelected(new Set());}}><Icon name="folder" size={14} />{t("Sin colección")}</button>
              <button
                data-testid="workspace-server-scope-trash"
                className={`flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-xs ${trashMode ? "bg-red-500/15 text-red-500" : "text-neutral-500 hover:bg-neutral-100 dark:hover:bg-neutral-900"}`}
                onClick={() => {
                  setFolderFilter("__trash__");
                  setSelected(new Set());
                }}
              >
                <Icon name="trash" size={14} />
                <span className="flex-1">{t("Papelera")}</span>
                <span className="text-[10px] opacity-70">
                  {items.filter(serverWorkspaceTrashed).length}
                </span>
              </button>
            </div>
          </aside>
          <section className="flex min-w-0 flex-1 flex-col">
            <div className="flex flex-wrap items-center gap-2 border-b border-neutral-200 p-3 dark:border-neutral-800">
              <div className="relative min-w-48 flex-1">
                <Icon
                  name="search"
                  size={14}
                  className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-neutral-500"
                />
                <input
                  data-testid="workspace-server-search"
                  className="input input-with-leading-icon h-8 w-full text-xs"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder={t("Buscar en notas e ideas…")}
                />
              </div>
              <select aria-label={t('Tipo')} className="input h-8 text-xs" value={kindFilter} onChange={event=>setKindFilter(event.target.value)}><option value="">{t('Todo')}</option><option value="note">{t('Notas')}</option><option value="idea">{t('Ideas')}</option></select><select aria-label={t('Ordenar documentos')} className="input h-8 text-xs" value={sortOrder} onChange={event=>setSortOrder(event.target.value)}><option value="recent">{t('Recientes')}</option><option value="oldest">{t('Más antiguos')}</option><option value="title">{t('Título')}</option></select><select aria-label={t('Etiquetas')} className="input h-8 text-xs" value={tagFilter} onChange={event=>setTagFilter(event.target.value)}><option value="">{t('Etiquetas')}</option>{[...new Set(items.flatMap(serverWorkspaceTags))].sort().map(tag=><option key={tag}>{tag}</option>)}</select>
            </div>
            {selected.size > 0 && (
              <div
                data-testid="workspace-server-bulk-actions"
                className="flex flex-wrap items-center gap-2 border-b border-indigo-500/20 bg-indigo-500/5 px-3 py-2 text-xs"
              >
                <b>
                  {selected.size} {t("seleccionados")}
                </b>
                {trashMode ? (
                  <>
                    <button
                      data-testid="workspace-server-restore"
                      className="btn btn-secondary h-8 text-xs"
                      onClick={() => void restore([...selected])}
                    >
                      <Icon name="refresh" size={12} />
                      {t("Restaurar")}
                    </button>
                    <button
                      className="btn btn-ghost h-8 text-xs text-red-500"
                      onClick={() => void remove([...selected])}
                    >
                      <Icon name="trash" size={12} />
                      {t("Eliminar definitivamente")}
                    </button>
                  </>
                ) : (
                  <>
                    <input
                      data-testid="workspace-server-tag-input"
                      className="input h-8 w-32 text-xs"
                      value={tagDraft}
                      onChange={(event) => setTagDraft(event.target.value)}
                      placeholder={t("Etiqueta…")}
                    />
                    <button
                      className="btn btn-ghost h-8 text-xs"
                      onClick={() => void addTag()}
                      disabled={!tagDraft.trim()}
                    >
                      {t("Etiquetar")}
                    </button>
                    <select
                      data-testid="workspace-server-move"
                      className="input h-8 text-xs"
                      defaultValue=""
                      onChange={(event) =>
                        void moveSelected(event.target.value)
                      }
                    >
                      <option value="">{t("Mover a colección…")}</option>
                      {folders.map((folder) => (
                        <option key={folder.id} value={folder.id}>
                          {folder.title}
                        </option>
                      ))}
                    </select>
                    <button
                      data-testid="workspace-server-trash"
                      className="btn btn-ghost h-8 text-xs text-red-500"
                      onClick={() => void trash([...selected])}
                    >
                      <Icon name="trash" size={12} />
                      {t("Papelera")}
                    </button>
                  </>
                )}
                <button
                  className="ml-auto text-neutral-500"
                  onClick={() => setSelected(new Set())}
                >
                  {t("Limpiar")}
                </button>
              </div>
            )}
            <div className="grid h-9 shrink-0 grid-cols-[28px_22px_minmax(0,1fr)_minmax(120px,.45fr)_90px] items-center border-b border-neutral-200 px-4 text-[10px] font-semibold uppercase tracking-wider text-neutral-500 dark:border-neutral-800">
              <input
                data-testid="workspace-server-select-all"
                type="checkbox"
                checked={
                  visible.length > 0 &&
                  visible.every((entry) => selected.has(entry.id))
                }
                onChange={(event) =>
                  setSelected(
                    event.target.checked
                      ? new Set(visible.map((entry) => entry.id))
                      : new Set(),
                  )
                }
                aria-label={t("Seleccionar todos")}
              />
              <span />
              <span>{t("Título")}</span>
              <span>{t("Etiquetas")}</span>
              <span className="text-right">{t("Modificado")}</span>
            </div>
            <div className="min-h-0 flex-1 overflow-auto">
              {catalogView === 'cards' && !trashMode && <EditorialCards items={visible.slice(0,3).map(entry => ({ id: entry.id, title: entry.title, snippet: workspaceExcerpt(entry.content), collection: folders.find(folder => folder.id === serverWorkspaceMeta(entry).folderId)?.title }))} onOpen={id => { const entry = items.find(item => item.id === id); if (entry) void openItem(entry); }} />}
              {visible.length ? (
                (catalogView === 'cards' && !trashMode ? visible.slice(3) : visible).map((entry) => (
                  <EditorialCatalogRow data-selected={selected.has(entry.id)}
                    key={entry.id}
                    draggable={!serverWorkspacePublished(entry)} onDragStart={event=>event.dataTransfer.setData('application/x-nodus-workspace-notes',JSON.stringify(selected.has(entry.id)?[...selected]:[entry.id]))}
                    data-testid={`workspace-server-item-${entry.id}`}
                    className={`grid min-h-[62px] grid-cols-[28px_22px_minmax(0,1fr)_minmax(120px,.45fr)_90px] items-center border-b border-neutral-100 px-4 text-left text-xs hover:bg-neutral-50 dark:border-neutral-900 dark:hover:bg-neutral-900/60 ${selected.has(entry.id) ? "bg-indigo-500/10" : ""}`}
                  >
                    <input
                      type="checkbox"
                      checked={selected.has(entry.id)}
                      onChange={(event) => {
                        const next = new Set(selected);
                        if (event.target.checked) next.add(entry.id);
                        else next.delete(entry.id);
                        setSelected(next);
                      }}
                      aria-label={`${t("Seleccionar")} ${entry.title || t("Sin título")}`}
                    />
                    <Icon
                      name={
                        serverWorkspacePublished(entry) ? "book" : "notebook"
                      }
                      size={14}
                      className="text-neutral-500"
                    />
                    <button
                      className="min-w-0 text-left"
                      onClick={() => openItem(entry)}
                    >
                      <strong className="block truncate text-sm font-normal">
                        {entry.title || t("Sin título")}
                      </strong>
                      <small className="block truncate text-[10px] text-neutral-500">{folders.find(folder=>folder.id===serverWorkspaceMeta(entry).folderId)?.title ?? t("Sin colección")}</small>
                      <small className="mt-1 block truncate text-[11px] text-neutral-500">
                        {workspaceExcerpt(entry.content).slice(0, 150) ||
                          t("Sin contenido")}
                      </small>
                    </button>
                    <span className="flex flex-wrap gap-1 text-neutral-500">
                      {serverWorkspaceTags(entry)
                        .slice(0, 3)
                        .map((tag) => (
                          <span
                            key={tag}
                            className="rounded-full bg-neutral-100 px-2 py-1 text-[10px] dark:bg-neutral-900"
                          >
                            {tag}
                          </span>
                        ))}
                    </span>
                    <span className="text-right text-[10px] text-neutral-500">
                      {entry.updatedAt
                        ? new Date(entry.updatedAt).toLocaleDateString(
                            getActiveLang(),
                          )
                        : "—"}<span className="editorial-row-actions"><details className="editorial-options"><summary aria-label={t('Opciones del documento')}>···</summary><div className="study-editor-toolbar"><button className="btn" onClick={()=>void openItem(entry)}>{t('Abrir')}</button>{!serverWorkspacePublished(entry) && <><button className="btn" onClick={()=>void duplicate(entry).catch(setError)}>{t('Duplicar')}</button><button className="btn" onClick={()=>void trash([entry.id])}>{t('Papelera')}</button></>}</div></details></span>
                    </span>
                  </EditorialCatalogRow>
                ))
              ) : (
                <div className="grid h-48 place-items-center text-sm text-neutral-500">
                  {trashMode
                    ? t("La papelera está vacía.")
                    : t(
                        "Todavía no hay nada aquí. Crea una nota para empezar.",
                      )}
                </div>
              )}
            </div>
          </section>
        </div>
      ) : (
        <section className="editorial-editor flex min-h-0 flex-1 flex-col">
          {nativeDocument&&!serverWorkspacePublished(active)&&<AcademicTools ref={academicTools} id={active.id} title={title} document={nativeDocument} metadata={academicMetadata} onChange={setAcademicMetadata} canvas={canvasRef} adapter={{inspect:async()=>(await api.inspectAcademicArtifact(active.id,itemsRef.current.find(item=>item.id===active.id)?.revision??active.revision,csrfToken)).issues,flush:flushLatest,loadChapter:async id=>{const item=itemsRef.current.find(item=>item.id===id);if(!item)throw new Error(t('Documento no disponible.'));return parseNativeDocument(item.metadata?.nativeDocument)??markdownToBlockNote(item.content);},searchEvidence:async query=>(await api.editorReferences(spaceId,{includePassages:true,search:query})).items.filter(ref=>['idea','work','passage'].includes(ref.kind)&&ref.title.toLowerCase().includes(query.toLowerCase())).slice(0,50).map(ref=>({href:ref.href,title:ref.title,pageLabel:ref.pageLabel,physicalPage:ref.physicalPage})),listChapters:async()=>itemsRef.current.filter(entry=>!serverWorkspacePublished(entry)&&entry.vaultId===spaceId).map(entry=>({documentId:entry.id,title:entry.title,kind:'note' as const})),searchSources:async query=>(await api.editorReferences(spaceId)).items.filter(ref=>ref.bibliography&&ref.title.toLowerCase().includes(query.toLowerCase())).map(ref=>({id:'vault:'+ref.id,refId:ref.id,scope:'vault' as const,metadata:ref.bibliography!,citationKey:null,href:ref.href})),export:(format,acceptWarnings)=>api.exportAcademicArtifact(active.id,format,itemsRef.current.find(item=>item.id===active.id)?.revision??active.revision,acceptWarnings,csrfToken)}} />}
          <EditorialHeader title={title} location={folders.find(folder=>folder.id===serverWorkspaceMeta(active).folderId)?.title ?? t('Sin colección')} status={serverWorkspacePublished(active) ? t('Solo lectura') : error ? t('Error al guardar') : busy ? t('Guardando…') : dirty ? t('Sin guardar') : t('Guardado')} contextOpen={contextOpen} focus={focus} onContext={() => setContextOpen(!contextOpen)} onFocus={() => void editorialFocus.toggleFocus()} navigationOpen={editorialFocus.navigationOpen} onNavigation={editorialFocus.toggleNavigation} leading={<><button className="editorial-header-action" aria-label={t('Navegador de documentos')} onClick={() => setLayout(layout === 'navigator' ? 'editorial' : 'navigator')}><Icon name="list" size={14} /></button></>} onPreserveSelection={preserveSelection} options={<EditorialActionMenu actions={editorActions} pins={pinnedActionIds} onPinsChange={setPinnedActionIds} beforeAction={restoreSelection} />} />
          <EditorialActionBar actions={editorActions} pins={pinnedActionIds} beforeAction={restoreSelection} onPreserveSelection={preserveSelection} />
          {showFind && <div className="editorial-searchbar flex flex-wrap gap-2 p-3 border-b" role="search"><input className="input text-xs" aria-label={t('Buscar')} value={find} onChange={event=>setFind(event.target.value)} /><input className="input text-xs" aria-label={t('Reemplazar')} value={replace} onChange={event=>setReplace(event.target.value)} /><button className="btn text-xs" disabled={!find || serverWorkspacePublished(active)} onClick={()=>{const next=content.split(find).join(replace); if(raw) {setContent(next);const native=markdownToBlockNote(next,nativeRef.current);nativeRef.current=native;setNativeDocument(native);} else canvasRef.current?.replaceAllMarkdown(next,{closeHistory:true});}}>{t('Reemplazar todo')}</button><button aria-label={t('Cerrar')} onClick={()=>setShowFind(false)}><Icon name="x" size={14} /></button></div>}
          <div className="editorial-editor-body flex min-h-0 flex-1">
            {layout === 'navigator' && <EditorialNavigator collectionControl={<select className="input" aria-label={t('Colección')} value={folderFilter} onChange={event=>setFolderFilter(event.target.value)}><option value="">{t('Todo')}</option><option value="__unfiled__">{t('Sin colección')}</option>{folders.map(folder=><option key={folder.id} value={folder.id}>{folder.title}</option>)}</select>} items={visible.map(entry => ({ id: entry.id,title: entry.title,snippet: workspaceExcerpt(entry.content) }))} activeId={active.id} search={query} onSearch={setQuery} onOpen={id => { const entry = items.find(item => item.id === id); if (entry) void openItem(entry); }} onClose={() => setLayout('editorial')} />}
            <div className={`min-w-0 flex-1 overflow-auto ${split ? 'grid grid-cols-2' : ''}`}><div className="editorial-document-scroll"><EditorialTitle testId="workspace-server-title" value={title} readOnly={serverWorkspacePublished(active)} onChange={setTitle} />
              {serverWorkspacePublished(active) ? <MarkdownReader value={content} /> : raw ? <textarea ref={rawEditorRef} data-testid="workspace-server-markdown-editor" className="server-note-editor" value={content} onChange={event => { try {assertAcademicSupplement(content,event.target.value);const native = markdownToBlockNote(event.target.value,nativeRef.current);setContent(event.target.value);setNativeDocument(native);nativeRef.current=native;} catch(err){setError(err instanceof Error?err:new Error(String(err)));} }} /> : nativeDocument && <BlockNoteCanvas key={`${active.id}-${editorKey}`} documentId={`${active.id}-${editorKey}`} ref={canvasRef} onHistoryChange={setHistoryState} value={content} nativeDocument={nativeDocument} academicMetadata={academicMetadata} onAcademicAction={(action,payload)=>academicTools.current?.open(action,payload)} listReferences={listReferences} onNavigateLink={href => void navigateReference(href)} onWikiLink={reference => { const entry=items.find(item=>item.id===reference||item.title===reference);if(entry) void openItem(entry); }} onChange={(markdown,native) => { setContent(markdown); setNativeDocument(native); nativeRef.current = native; }} />}
            </div>{split && <article className="p-8" data-testid="workspace-server-markdown-preview"><MarkdownReader value={content} /></article>}</div>
            {contextOpen && <EditorialInspector activeTab={contextTab} tabs={[{id:'sources',label:t('Fuentes')},{id:'details',label:t('Detalles')},{id:'history',label:t('Historial')}]} onTabChange={id=>setContextTab(id as typeof contextTab)} onClose={()=>setContextOpen(false)}><div className="editorial-context-views"><button aria-pressed={contextTab==='structure'} onClick={()=>setContextTab('structure')}>{t('Estructura')}</button><button aria-pressed={contextTab==='checks'} onClick={()=>setContextTab('checks')}>{t('Comprobaciones')}</button></div>{(contextTab==='checks'||contextTab==='structure') ? <AcademicPanel document={nativeDocument??[]} metadata={academicMetadata} onChange={value=>{if(!serverWorkspacePublished(active))setAcademicMetadata(value);}} canvas={serverWorkspacePublished(active)?null:canvasRef.current} view={contextTab} onOpenSource={href=>void navigateReference(href)} onSettings={()=>{if(!serverWorkspacePublished(active))academicTools.current?.open('settings');}} /> : contextTab === 'sources' ? <><AcademicPanel document={nativeDocument??[]} metadata={academicMetadata} onChange={value=>{if(!serverWorkspacePublished(active))setAcademicMetadata(value);}} canvas={serverWorkspacePublished(active)?null:canvasRef.current} view="sources" onOpenSource={href=>void navigateReference(href)} onSettings={()=>{if(!serverWorkspacePublished(active))academicTools.current?.open('settings');}} /><EditorialReferences items={documentReferences(nativeDocument)} onOpen={href => void navigateReference(href)} /></> : contextTab === 'details' ? <div className="p-4"><p className="text-xs mb-4">{serverWorkspacePublished(active) ? t('Publicado · solo lectura') : t('Privado para ti')}</p><label className="text-xs">{t('Colección')}<select className="input w-full mt-2" value={valueText(serverWorkspaceMeta(active).folderId)} disabled={serverWorkspacePublished(active)} onChange={event => void updateMeta(active,{folderId:event.target.value || null})}><option value="">{t('Sin colección')}</option>{folders.filter(folder => !serverWorkspacePublished(folder)).map(folder => <option key={folder.id} value={folder.id}>{folder.title}</option>)}</select></label><p className="mt-4 text-xs">{serverWorkspaceTags(active).join(' · ') || t('Sin etiquetas')}</p></div> : <div className="p-4">{Array.isArray(active.metadata?.editorVersions) ? (active.metadata.editorVersions as Array<{title: string;content: string;nativeDocument: unknown;savedAt: string}>).slice().reverse().map((version,index) => <button key={index} className="block w-full text-left p-3 text-xs" onClick={() => { if (serverWorkspacePublished(active)) return; setAcademicMetadata(normalizeAcademicMetadata((version as {academicMetadata?:unknown}).academicMetadata));setTitle(version.title); setContent(version.content); const native = parseNativeDocument(version.nativeDocument) ?? markdownToBlockNote(version.content); nativeRef.current = native; setNativeDocument(native); setEditorKey(key=>key+1); }}>{version.title} · {new Date(version.savedAt).toLocaleString()}</button>) : <p className="text-xs">{t('El historial aparecerá después del primer cambio guardado.')}</p>}</div>}</EditorialInspector>}
          </div>
        </section>
      )}
      {Boolean(error) && active && !serverWorkspacePublished(active) && <div className="editorial-save-error"><button onClick={() => void save()}>{t('Reintentar')}</button><button onClick={() => downloadEditorialDraft({ title, contentMarkdown:content, nativeDocument:nativeRef.current, academicMetadata })}>{t('Recuperar borrador')}</button><button onClick={() => void (async () => {
        const response=await api.artifact(active.id); const current=response.artifact;
        const native=parseNativeDocument(current.metadata?.nativeDocument) ?? markdownToBlockNote(current.content);
        itemsRef.current=itemsRef.current.map(entry=>entry.id===current.id?current:entry);setItems(itemsRef.current);setTitle(current.title);setContent(current.content);nativeRef.current=native;setNativeDocument(native);draftRevision.current=current.revision;setAcademicMetadata(normalizeAcademicMetadata(current.metadata?.academicMetadata));baseline.current=JSON.stringify({title:current.title,content:current.content,native,academicMetadata:normalizeAcademicMetadata(current.metadata?.academicMetadata)});savedSignatures.current.set(current.id,baseline.current);clearEditorialDraft(snapshotKey,current.id);setError(undefined);setEditorKey(key=>key+1);
      })().catch(setError)}>{t('Cargar versión actual')}</button></div>}
      <ErrorNotice error={error} />
    </div>
  );
}

function pageItems(page: PageResponse | undefined, key: string): JsonRecord[] {
  const candidate = page?.[key];
  return Array.isArray(candidate)
    ? (candidate as JsonRecord[])
    : Array.isArray(page?.items)
      ? page.items
      : [];
}

function recordArray(value: unknown): JsonRecord[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is JsonRecord =>
        Boolean(entry && typeof entry === "object"),
      )
    : [];
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value
        .map((entry) => (typeof entry === "string" ? entry : valueText(entry)))
        .filter(Boolean)
    : [];
}

function readerAnnotations(items: JsonRecord[]): WritingDraftAnnotation[] {
  // DELETE is authoritative on the private overlay. Older clients used a
  // tombstone (`deletedAt`), so ignore those rows when hydrating the reader;
  // otherwise a deleted highlight stays painted and clickable until reload.
  return items
    .filter(
      (entry) =>
        !entry.deletedAt &&
        ["highlight", "comment", "bookmark"].includes(valueText(entry.kind)),
    )
    .map((entry) => ({
      id: valueText(entry.id),
      draftId: valueText(entry.documentId),
      scope: valueText(entry.scope, "source"),
      kind: (["highlight", "comment", "bookmark"].includes(
        valueText(entry.kind),
      )
        ? valueText(entry.kind)
        : "highlight") as WritingDraftAnnotation["kind"],
      color: (entry.color === null || typeof entry.color === "string"
        ? entry.color
        : null) as WritingDraftAnnotationColor | null,
      startOffset:
        Number(
          (entry.anchor as JsonRecord | undefined)?.startOffset ??
            entry.startOffset,
        ) || 0,
      endOffset:
        Number(
          (entry.anchor as JsonRecord | undefined)?.endOffset ??
            entry.endOffset,
        ) || 0,
      selectedText: valueText(
        (entry.anchor as JsonRecord | undefined)?.selectedText ||
          entry.selectedText ||
          entry.quote,
      ),
      prefix: valueText(
        (entry.anchor as JsonRecord | undefined)?.prefix || entry.prefix,
      ),
      suffix: valueText(
        (entry.anchor as JsonRecord | undefined)?.suffix || entry.suffix,
      ),
      comment:
        entry.comment == null
          ? valueText(entry.content) || null
          : valueText(entry.comment),
      createdAt: valueText(entry.createdAt || entry.created_at),
      updatedAt: valueText(entry.updatedAt || entry.updated_at),
    }));
}

function CitationValue({
  value,
  onCitation,
}: {
  value: unknown;
  onCitation?: (target: ServerCitationTarget) => void;
}) {
  const label = valueText(value);
  if (!label) return null;
  const target = onCitation ? parseServerCitation(label) : null;
  return target ? (
    <button
      type="button"
      className="text-left text-indigo-600 underline decoration-indigo-300 underline-offset-2 hover:text-indigo-500 dark:text-indigo-300 dark:decoration-indigo-700"
      onClick={() => onCitation?.(target)}
    >
      {label}
    </button>
  ) : (
    <span>{label}</span>
  );
}

function DeepResearchMatrix({
  draft,
  onCitation,
}: {
  draft: JsonRecord;
  onCitation?: (target: ServerCitationTarget) => void;
}) {
  const matrix = recordArray(draft.matrix);
  const stats =
    recordArray(draft.stats)[0] ||
    (draft.stats && typeof draft.stats === "object"
      ? (draft.stats as JsonRecord)
      : {});
  const statItems = [
    [t("Ideas"), stats.selectedIdeas],
    [t("Huecos"), stats.selectedGaps],
    [t("Obras"), stats.selectedWorks],
    [t("Pasajes"), stats.selectedPassages],
    [t("Contexto"), stats.contextChars],
  ].filter(
    ([, value]) => value !== undefined && value !== null && value !== "",
  ) as Array<[string, unknown]>;
  const listPanel = (title: string, value: unknown) => {
    const items = stringArray(value);
    return items.length ? (
      <section className="deep-research-support-list">
        <h3>{title}</h3>
        <ul>
          {items.map((item, index) => (
            <li key={`${index}-${item}`}>{item}</li>
          ))}
        </ul>
      </section>
    ) : null;
  };
  if (!matrix.length && !statItems.length)
    return (
      <p className="text-xs text-neutral-500">
        {t("Este informe no incluye matriz de trazabilidad.")}
      </p>
    );
  return (
    <div className="deep-research-support-matrix">
      {statItems.length > 0 && (
        <div className="deep-research-support-metrics">
          {statItems.map(([label, value]) => (
            <div key={label} className="deep-research-support-metric">
              <span>{label}</span>
              <strong>{valueText(value)}</strong>
            </div>
          ))}
        </div>
      )}
      {matrix.map((entry, index) => (
        <article
          key={`${index}-${valueText(entry.claim)}`}
          className="deep-research-support-card"
        >
          <div className="flex items-center gap-2">
            <span className="deep-research-support-role">
              {valueText(entry.role, "Evidencia")}
            </span>
            <span className="truncate text-[11px] text-neutral-500">
              {valueText(
                entry.sourceLabel || entry.source,
                t("Fuente no especificada"),
              )}
            </span>
          </div>
          <p className="mt-2 text-sm leading-5 text-neutral-800 dark:text-neutral-200">
            {valueText(entry.claim, t("Afirmación sin texto"))}
          </p>
          {valueText(entry.evidence) && (
            <p className="mt-1 text-xs leading-5 text-neutral-500">
              {valueText(entry.evidence)}
            </p>
          )}
          <div className="mt-2 flex flex-wrap gap-2 text-[11px] text-neutral-500">
            {valueText(entry.citation) && (
              <span>
                {t("Referencia")}:{" "}
                <CitationValue value={entry.citation} onCitation={onCitation} />
              </span>
            )}
            {valueText(entry.notes) && <span>{valueText(entry.notes)}</span>}
          </div>
        </article>
      ))}
      {listPanel(t("Siguientes pasos"), draft.nextSteps)}
      {listPanel(t("Limitaciones"), draft.limitations)}
      {listPanel(t("Bibliografía"), draft.bibliography)}
    </div>
  );
}

/** The same report structure used by the desktop reader, kept as real sections on web. */
function DeepResearchDocument({
  draft,
  imageBaseUrl,
  onSelection,
  onNodusLink,
  onCitation,
  showMatrix = true,
}: {
  draft: JsonRecord;
  imageBaseUrl?: string;
  onSelection?: (quote: string) => void;
  onNodusLink?: (href: string) => void;
  onCitation?: (target: ServerCitationTarget) => void;
  showMatrix?: boolean;
}) {
  const outline = recordArray(draft.outline);
  const matrix = recordArray(draft.matrix);
  const nextSteps = stringArray(draft.nextSteps);
  const limitations = stringArray(draft.limitations);
  const body = valueText(
    draft.draftMarkdown || draft.markdown || draft.content,
    valueText(draft.abstract),
  );
  return (
    <div className="deep-research-document space-y-8">
      {outline.length > 0 && (
        <section
          id="deep-research-outline"
          className="deep-research-document-section"
        >
          <p className="deep-research-eyebrow">
            {t("ARQUITECTURA DEL INFORME")}
          </p>
          <h2>{t("Esquema de investigación")}</h2>
          <ol className="deep-research-outline-list">
            {outline.map((entry, index) => (
              <li key={`${index}-${valueText(entry.title)}`}>
                <strong>
                  {valueText(entry.title, tx("Sección {n}", { n: index + 1 }))}
                </strong>
                {valueText(entry.focus) && (
                  <span>{valueText(entry.focus)}</span>
                )}
              </li>
            ))}
          </ol>
        </section>
      )}
      <section
        id="deep-research-report"
        className="deep-research-document-section"
      >
        <p className="deep-research-eyebrow">{t("DESARROLLO")}</p>
        <h2>{t("Informe")}</h2>
        <MarkdownReader
          value={body}
          onSelection={onSelection}
          onNodusLink={onNodusLink}
          assetBaseUrl={imageBaseUrl}
        />
      </section>
      {nextSteps.length > 0 && (
        <section
          id="deep-research-next-steps"
          className="deep-research-document-section"
        >
          <p className="deep-research-eyebrow">{t("RECOMENDACIONES")}</p>
          <h2>{t("Siguientes pasos")}</h2>
          <ul>
            {nextSteps.map((step, index) => (
              <li key={`${index}-${step}`}>{step}</li>
            ))}
          </ul>
        </section>
      )}
      {limitations.length > 0 && (
        <section
          id="deep-research-limitations"
          className="deep-research-document-section"
        >
          <p className="deep-research-eyebrow">{t("LÍMITES")}</p>
          <h2>{t("Limitaciones")}</h2>
          <ul>
            {limitations.map((item, index) => (
              <li key={`${index}-${item}`}>{item}</li>
            ))}
          </ul>
        </section>
      )}
      {showMatrix && matrix.length > 0 && (
        <section
          id="deep-research-matrix"
          className="deep-research-document-section"
        >
          <p className="deep-research-eyebrow">{t("EVIDENCIA Y ENLACES")}</p>
          <h2>{t("Matriz de trazabilidad")}</h2>
          <DeepResearchMatrix draft={draft} onCitation={onCitation} />
        </section>
      )}
    </div>
  );
}

/** Browser-safe counterpart of Desktop's AudioPanel. The Server cannot create or
 * persist local audio clips, but it can expose the same visible reading affordance
 * through the browser voice engine without mutating the published snapshot. */
function ServerAudioPanel({
  speaking,
  disabled,
  onToggle,
}: {
  speaking: boolean;
  disabled: boolean;
  onToggle: () => void;
}) {
  return (
    <section
      className="deep-research-server-audio rounded-lg border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900/40"
      data-testid="deep-research-audio-panel"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-sm font-medium">
          <span aria-hidden>🎧</span>
          <span>{t("Audio")}</span>
          <span className="text-[11px] font-normal text-neutral-500">
            {t("Lectura en voz alta")}
          </span>
        </div>
        <button
          type="button"
          className={`btn ${speaking ? "btn-primary" : "btn-ghost border border-neutral-300 dark:border-neutral-700"} h-8 text-xs`}
          disabled={disabled}
          onClick={onToggle}
          data-testid="deep-research-audio-panel-toggle"
          aria-pressed={speaking}
        >
          {speaking ? t("Detener lectura") : t("Escuchar informe")}
        </button>
      </div>
      <p className="mt-2 text-[11px] text-neutral-500">
        {t(
          "La voz se reproduce en este navegador y no se guarda ni se publica en el vault.",
        )}
      </p>
    </section>
  );
}

export function DictionaryServerView({
  spaceId,
  csrfToken,
}: {
  spaceId: string;
  csrfToken?: string;
}) {
  const profile = useAIProfile();
  const [published, setPublished] = useState<JsonRecord[]>([]);
  const [drafts, setDrafts] = useState<UserArtifact[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [activePrivate, setActivePrivate] = useState(false);
  const [detail, setDetail] = useState<JsonRecord | null>(null);
  const [query, setQuery] = useState("");
  const [term, setTerm] = useState("");
  const [focus, setFocus] = useState("");
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>();

  const load = useCallback(async () => {
    const [page, privateItems] = await Promise.all([
      api.collection(spaceId, "dictionary", { limit: "500" }),
      api.artifacts(spaceId, "dictionary-entry"),
    ]);
    setPublished(pageItems(page, "entries"));
    setDrafts(privateItems.artifacts);
  }, [spaceId]);
  useEffect(() => {
    void load().catch(setError);
  }, [load]);

  const openPublished = async (entry: JsonRecord) => {
    const id = valueText(entry.id);
    setActiveId(id);
    setActivePrivate(false);
    setDetail(null);
    try {
      setDetail(await api.detail(spaceId, "dictionary", id));
    } catch (cause) {
      setError(cause);
    }
  };
  const openDraft = (entry: UserArtifact) => {
    setActiveId(entry.id);
    setActivePrivate(true);
    setDetail(null);
    setTitle(entry.title);
    setContent(entry.content);
  };
  const close = () => {
    setActiveId(null);
    setActivePrivate(false);
    setDetail(null);
    setError(undefined);
  };
  const createManual = async () => {
    if (busy) return;
    setBusy(true);
    setError(undefined);
    try {
      const response = await api.createArtifact(
        {
          vaultId: spaceId,
          kind: "dictionary-entry",
          title: t("Nueva entrada"),
          content: "",
          metadata: { private: true, surface: "dictionary", focus: "" },
        },
        csrfToken,
      );
      setDrafts((items) => [response.artifact, ...items]);
      openDraft(response.artifact);
    } catch (cause) {
      setError(cause);
    } finally {
      setBusy(false);
    }
  };
  const generate = async (event: FormEvent) => {
    event.preventDefault();
    if (!term.trim() || busy) return;
    setBusy(true);
    setError(undefined);
    try {
      const messages: AIMessage[] = [
        {
          role: "system",
          content: serverPrompt(profile.promptLanguage, "dictionary"),
        },
        {
          role: "user",
          content: `${serverLabel(profile.promptLanguage, "concept")}: ${term.trim()}\n${serverLabel(profile.promptLanguage, "focus")}: ${focus.trim() || "general"}`,
        },
      ];
      const created = await api.runAI(
        spaceId,
        "dictionary",
        {
          provider: profile.provider,
          model: profile.model,
          messages,
          maxTokens: 3000,
        },
        csrfToken,
      );
      const completed = await awaitJob(
        created.job.id,
        new AbortController().signal,
      );
      if (completed.status !== "completed")
        throw new Error(
          completed.error?.message || t("No se pudo generar la respuesta."),
        );
      const response = await api.createArtifact(
        {
          vaultId: spaceId,
          kind: "dictionary-entry",
          title: term.trim(),
          content: extractAIText(completed.result),
          metadata: {
            private: true,
            surface: "dictionary",
            focus: focus.trim(),
          },
          sourceJobId: completed.id,
        },
        csrfToken,
      );
      setDrafts((items) => [response.artifact, ...items]);
      setTerm("");
      setFocus("");
      openDraft(response.artifact);
    } catch (cause) {
      setError(cause);
    } finally {
      setBusy(false);
    }
  };
  const saveDraft = async () => {
    if (!activeId || !activePrivate || busy) return;
    setBusy(true);
    setError(undefined);
    try {
      const response = await api.updateArtifact(
        activeId,
        {
          title: title.trim() || t("Nueva entrada"),
          content,
          metadata: { private: true, surface: "dictionary", focus },
        },
        csrfToken,
      );
      setDrafts((items) =>
        items.map((entry) =>
          entry.id === activeId ? response.artifact : entry,
        ),
      );
      setTitle(response.artifact.title);
      setContent(response.artifact.content);
    } catch (cause) {
      setError(cause);
    } finally {
      setBusy(false);
    }
  };
  const deleteDraft = async () => {
    if (
      !activeId ||
      !activePrivate ||
      busy ||
      !window.confirm("¿Eliminar esta entrada privada?")
    )
      return;
    setBusy(true);
    setError(undefined);
    try {
      await api.deleteArtifact(activeId, csrfToken);
      setDrafts((items) => items.filter((entry) => entry.id !== activeId));
      close();
    } catch (cause) {
      setError(cause);
    } finally {
      setBusy(false);
    }
  };
  const visible = [
    ...drafts.map((entry) => ({ ...entry, privateEntry: true }) as JsonRecord),
    ...published.map(
      (entry) => ({ ...entry, privateEntry: false }) as JsonRecord,
    ),
  ].filter(
    (entry) =>
      !query.trim() ||
      `${valueText(entry.title || entry.name)} ${valueText(entry.content || entry.content_markdown || entry.short_description)}`
        .toLocaleLowerCase()
        .includes(query.trim().toLocaleLowerCase()),
  );
  const publicEntry = (
    detail?.entry && typeof detail.entry === "object" ? detail.entry : null
  ) as JsonRecord | null;
  const evidence = recordArray(detail?.evidence);
  const relations = recordArray(detail?.relations);
  const versions = recordArray(detail?.versions);
  return (
    <div
      className="library-theme flex h-full min-h-0 flex-col bg-white text-neutral-900 dark:bg-neutral-950 dark:text-neutral-100"
      data-testid="dictionary-view"
    >
      <header className="shrink-0 border-b border-neutral-200 px-5 pt-4 dark:border-neutral-800">
        <div className="mb-3 flex flex-wrap items-center gap-3">
          <span className="grid h-9 w-9 place-items-center rounded-xl bg-indigo-100 text-indigo-600 dark:bg-indigo-500/15 dark:text-indigo-300">
            <Icon name="thesaurus" size={18} />
          </span>
          <div>
            <h1 className="text-base font-semibold">{t("Diccionario")}</h1>
            <p className="text-[11px] text-neutral-500">
              {tx("{n} publicadas · {m} borradores privados", {
                n: published.length,
                m: drafts.length,
              })}
            </p>
          </div>
          <span className="flex-1" />
          <ProviderControls
            {...profile}
            onProvider={profile.setProvider}
            onModel={profile.setModel}
          />
          <button
            className="btn btn-primary !text-white"
            onClick={() => void createManual()}
            data-testid="dictionary-new"
          >
            <Icon name="plus" /> {t("Nueva entrada")}
          </button>
        </div>
        <nav
          className="flex min-w-0 items-end gap-1 overflow-x-auto"
          aria-label={t("Pestañas del diccionario")}
        >
          <button
            className={`flex h-9 shrink-0 items-center gap-2 rounded-t-lg border border-b-0 px-3 text-xs ${!activeId ? "border-neutral-300 bg-white dark:border-neutral-700 dark:bg-neutral-900" : "border-transparent text-neutral-500"}`}
            onClick={close}
            data-testid="dictionary-tab-home"
          >
            <Icon name="list" size={13} />
            {tx("Entradas ({n})", { n: visible.length })}
          </button>
          {activeId && (
            <button
              className="flex h-9 shrink-0 items-center gap-2 rounded-t-lg border border-b-0 border-neutral-300 bg-white px-3 text-xs dark:border-neutral-700 dark:bg-neutral-900"
              onClick={() => undefined}
            >
              <Icon name="thesaurus" size={13} />
              {activePrivate
                ? title || t("Nueva entrada")
                : valueText(publicEntry?.name || publicEntry?.title, "Entrada")}
            </button>
          )}
        </nav>
      </header>
      <ErrorNotice error={error} />
      {activeId ? (
        <main className="min-h-0 flex-1 overflow-auto p-5">
          <div className="mx-auto max-w-6xl space-y-4">
            <div className="flex items-center gap-2">
              <button className="btn btn-ghost h-8 text-xs" onClick={close}>
                <Icon name="chevronLeft" size={13} />
                {t("Diccionario")}
              </button>
              <span className="flex-1" />
              {activePrivate && (
                <>
                  <button
                    className="btn h-8 text-xs"
                    onClick={() => void saveDraft()}
                    disabled={busy}
                  >
                    <Icon name="save" size={12} />
                    {busy ? t("Guardando…") : t("Guardar")}
                  </button>
                  <button
                    className="btn btn-ghost h-8 text-xs text-red-600"
                    onClick={() => void deleteDraft()}
                    disabled={busy}
                  >
                    <Icon name="trash" size={12} />
                    {t("Eliminar")}
                  </button>
                </>
              )}
            </div>
            {activePrivate ? (
              <section className="grid min-h-[60vh] gap-5 rounded-2xl border border-neutral-200 bg-white p-5 shadow-sm dark:border-neutral-800 dark:bg-neutral-900 lg:grid-cols-2">
                <div>
                  <p className="mb-3 text-[10px] font-semibold uppercase tracking-wider text-teal-600">
                    {t("Privado para ti")}
                  </p>
                  <input
                    className="server-note-title w-full"
                    value={title}
                    onChange={(event) => setTitle(event.target.value)}
                    placeholder={t("Nombre del concepto")}
                  />
                  <textarea
                    className="server-note-editor mt-4 min-h-[48vh] w-full"
                    value={content}
                    onChange={(event) => setContent(event.target.value)}
                    placeholder={t("Escribe la entrada en Markdown…")}
                  />
                </div>
                <article className="min-w-0 border-l border-neutral-100 pl-5 dark:border-neutral-800">
                  <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-neutral-500">
                    {t("Vista previa")}
                  </h2>
                  <MarkdownReader
                    value={content || `*${t("Sin contenido")}*`}
                  />
                </article>
              </section>
            ) : (
              <section className="space-y-4">
                <article className="rounded-2xl border border-indigo-100 bg-indigo-50/80 p-5 dark:border-neutral-800 dark:bg-neutral-900/35">
                  <p className="text-[10px] font-semibold uppercase tracking-[.18em] text-indigo-600 dark:text-indigo-300">
                    {t("Publicado · solo lectura")}
                  </p>
                  <h2 className="mt-2 text-xl font-semibold">
                    {valueText(
                      publicEntry?.name || publicEntry?.title,
                      "Entrada",
                    )}
                  </h2>
                  <p className="mt-2 text-sm text-neutral-500">
                    {valueText(
                      publicEntry?.focus_prompt,
                      "Sin foco adicional.",
                    )}
                  </p>
                  <div className="mt-4">
                    <MarkdownReader
                      value={valueText(
                        publicEntry?.content_markdown ||
                          publicEntry?.short_description,
                        "Sin definición publicada.",
                      )}
                    />
                  </div>
                </article>
                <div className="grid gap-4 lg:grid-cols-3">
                  <section className="rounded-xl border border-neutral-200 p-4 dark:border-neutral-800">
                    <h3 className="text-xs font-semibold uppercase tracking-wider text-neutral-500">
                      {tx("Evidencia ({n})", { n: evidence.length })}
                    </h3>
                    {evidence.length ? (
                      evidence.map((entry, index) => (
                        <blockquote
                          key={`${index}-${entry.ref_id}`}
                          className="mt-3 border-l-2 border-indigo-400 pl-3 text-xs leading-5"
                        >
                          {valueText(
                            entry.evidence_text || entry.label,
                            "Sin texto",
                          )}
                        </blockquote>
                      ))
                    ) : (
                      <p className="mt-3 text-xs text-neutral-500">
                        {t("No hay evidencia publicada.")}
                      </p>
                    )}
                  </section>
                  <section className="rounded-xl border border-neutral-200 p-4 dark:border-neutral-800">
                    <h3 className="text-xs font-semibold uppercase tracking-wider text-neutral-500">
                      {tx("Relaciones ({n})", { n: relations.length })}
                    </h3>
                    {relations.length ? (
                      relations.map((entry, index) => (
                        <div
                          key={`${index}-${entry.id}`}
                          className="mt-3 text-xs"
                        >
                          <strong>
                            {valueText(
                              (entry.other_entry as JsonRecord | undefined)
                                ?.name || entry.other_entry_id,
                              "Entrada relacionada",
                            )}
                          </strong>
                          <span className="ml-2 text-neutral-500">
                            {valueText(entry.type, "relacionada")}
                          </span>
                        </div>
                      ))
                    ) : (
                      <p className="mt-3 text-xs text-neutral-500">
                        {t("No hay relaciones publicadas.")}
                      </p>
                    )}
                  </section>
                  <section className="rounded-xl border border-neutral-200 p-4 dark:border-neutral-800">
                    <h3 className="text-xs font-semibold uppercase tracking-wider text-neutral-500">
                      {tx("Versiones ({n})", { n: versions.length })}
                    </h3>
                    {versions.length ? (
                      versions.slice(0, 5).map((entry, index) => (
                        <div
                          key={`${index}-${entry.id}`}
                          className="mt-3 text-xs text-neutral-500"
                        >
                          {valueText(entry.trigger, t("Generación"))} ·{" "}
                          {valueText(entry.generated_at || entry.created_at)}
                        </div>
                      ))
                    ) : (
                      <p className="mt-3 text-xs text-neutral-500">
                        {t("No hay versiones publicadas.")}
                      </p>
                    )}
                  </section>
                </div>
              </section>
            )}
          </div>
        </main>
      ) : (
        <main className="min-h-0 flex-1 overflow-auto p-5">
          <div className="mx-auto max-w-[110rem]">
            <form
              onSubmit={generate}
              className="mb-4 rounded-xl border border-indigo-200 bg-indigo-50/70 p-4 dark:border-indigo-900/60 dark:bg-indigo-950/20"
            >
              <div className="grid gap-2 md:grid-cols-[minmax(180px,.4fr)_minmax(240px,1fr)_auto]">
                <input
                  className="input text-xs"
                  value={term}
                  onChange={(event) => setTerm(event.target.value)}
                  placeholder={t("Concepto")}
                />
                <input
                  className="input text-xs"
                  value={focus}
                  onChange={(event) => setFocus(event.target.value)}
                  placeholder={t("Foco opcional")}
                />
                <button
                  className="btn btn-primary text-xs"
                  disabled={busy || !term.trim()}
                >
                  {busy ? t("Generando…") : t("Crear borrador con IA")}
                </button>
              </div>
              <p className="mt-2 text-[10px] text-teal-600 dark:text-teal-300">
                {t(
                  "Los borradores y la generación permanecen privados en tu cuenta.",
                )}
              </p>
            </form>
            <div className="mb-3 flex items-center gap-2">
              <div className="relative min-w-60 flex-1">
                <Icon
                  name="search"
                  size={13}
                  className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400"
                />
                <input
                  className="input input-with-leading-icon w-full"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder={t("Buscar concepto, alias o evidencia…")}
                />
              </div>
            </div>
            <div className="overflow-hidden rounded-xl border border-neutral-200 dark:border-neutral-800">
              <div className="grid grid-cols-[minmax(0,1.35fr)_minmax(0,2fr)_8rem_9rem] border-b border-neutral-200 bg-neutral-50 px-4 py-2 text-[10px] font-semibold uppercase tracking-wider text-neutral-500 dark:border-neutral-800 dark:bg-neutral-900">
                <span>{t("Concepto")}</span>
                <span>{t("Definición / vista previa")}</span>
                <span>{t("Estado")}</span>
                <span className="text-right">{t("Actualizado")}</span>
              </div>
              {visible.length ? (
                visible.map((entry, index) => (
                  <button
                    key={String(entry.id || index)}
                    className="grid min-h-[64px] w-full grid-cols-[minmax(0,1.35fr)_minmax(0,2fr)_8rem_9rem] items-center border-b border-neutral-100 px-4 text-left text-xs hover:bg-neutral-50 dark:border-neutral-900 dark:hover:bg-neutral-900/60"
                    onClick={() =>
                      entry.privateEntry
                        ? openDraft(entry as unknown as UserArtifact)
                        : void openPublished(entry)
                    }
                  >
                    <span className="min-w-0 truncate font-medium">
                      {valueText(entry.title || entry.name, "Sin título")}
                    </span>
                    <span className="min-w-0 truncate pr-4 text-neutral-500">
                      {plainReading(
                        valueText(
                          entry.content ||
                            entry.content_markdown ||
                            entry.short_description,
                          "Sin contenido",
                        ),
                      ).slice(0, 180)}
                    </span>
                    <span
                      className={
                        entry.privateEntry
                          ? "text-teal-600 dark:text-teal-300"
                          : "text-indigo-600 dark:text-indigo-300"
                      }
                    >
                      {entry.privateEntry
                        ? t("Privado")
                        : formatPublicationStatus(entry.status)}
                    </span>
                    <span className="text-right text-[10px] text-neutral-500">
                      {formatReportDate(
                        entry.updatedAt ||
                          entry.updated_at ||
                          entry.createdAt ||
                          entry.created_at,
                      ) || "—"}
                    </span>
                  </button>
                ))
              ) : (
                <div className="p-8 text-center text-sm text-neutral-500">
                  {t("Todavía no hay entradas.")}
                </div>
              )}
            </div>
          </div>
        </main>
      )}
    </div>
  );
}

export function DeepResearchServerView({
  spaceId,
  csrfToken,
  initialReportId,
}: {
  spaceId: string;
  csrfToken?: string;
  initialReportId?: string;
}) {
  const profile = useAIProfile();
  const [published, setPublished] = useState<JsonRecord[]>([]);
  // Reading state is a private tri-state overlay: absent means "use the published
  // snapshot", while read/unread explicitly overrides that snapshot.
  const [readOverlay, setReadOverlay] = useState<
    Map<string, "read" | "unread">
  >(new Map());
  const [query, setQuery] = useState("");
  const [viewMode, setViewMode] = useState<"grid" | "list">("grid");
  const [error, setError] = useState<unknown>();
  const [open, setOpen] = useState<JsonRecord | null>(null);
  const [report, setReport] = useState<JsonRecord | null>(null);
  const [reportImage, setReportImage] = useState<JsonRecord | null>(null);
  const [translations, setTranslations] = useState<JsonRecord[]>([]);
  const [privateTranslations, setPrivateTranslations] = useState<
    UserArtifact[]
  >([]);
  const [activeTranslation, setActiveTranslation] = useState<JsonRecord | null>(
    null,
  );
  const [translationOpen, setTranslationOpen] = useState(false);
  const [translationComposerOpen, setTranslationComposerOpen] = useState(false);
  const [translationLanguage, setTranslationLanguage] = useState("en");
  const [translationBusy, setTranslationBusy] = useState(false);
  const [readerLoading, setReaderLoading] = useState(false);
  const [readFilter, setReadFilter] = useState<"all" | "read" | "unread">(
    "all",
  );
  const [sort, setSort] = useState<"recent" | "oldest" | "title">("recent");
  const [showTutorial, setShowTutorial] = useState(false);
  const [fontSize, setFontSize] = useState(16);
  const [highlighterColor, setHighlighterColor] =
    useState<WritingDraftAnnotationColor | null>(null);
  const [readerAnnotationsState, setReaderAnnotationsState] = useState<
    WritingDraftAnnotation[]
  >([]);
  const [showMatrix, setShowMatrix] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [activeSection, setActiveSection] = useState(0);
  const [scrollProgress, setScrollProgress] = useState(0);
  const [readerFeedback, setReaderFeedback] = useState("");
  const [notes, setNotes] = useState<
    Array<{ id: string; kind: string; quote?: string; content?: string }>
  >([]);
  const [domHeadings, setDomHeadings] = useState<
    Array<{ id: string; label: string; level: number; sectionId: string }>
  >([]);
  const [, setAnnotationVersion] = useState(0);
  const annotationVersionRef = useRef(0);
  const [hasReaderMark, setHasReaderMark] = useState(false);
  const [composerOpen, setComposerOpen] = useState(false);
  const [composerTitle, setComposerTitle] = useState("");
  const [composerObjective, setComposerObjective] = useState("");
  const [briefEditing, setBriefEditing] = useState(false);
  const [briefTitle, setBriefTitle] = useState("");
  const [briefObjective, setBriefObjective] = useState("");
  const [briefSaving, setBriefSaving] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [citation, setCitation] = useState<ServerCitationTarget | null>(null);
  const [generationJob, setGenerationJob] = useState<AIJob | null>(null);
  const [jobHistory, setJobHistory] = useState<AIJob[]>([]);
  const readerRef = useRef<HTMLElement | null>(null);
  const readerDocumentRef = useRef<HTMLDivElement | null>(null);
  const markActionsRef = useRef<ReaderSelectionActionsHandle | null>(null);
  const initialReportApplied = useRef(false);
  const generationAbort = useRef<AbortController | null>(null);
  const annotationScope = activeTranslation
    ? `translation:${valueText(activeTranslation.id)}`
    : "source";

  const refreshPrivateJobs = useCallback(async () => {
    const response = await api.aiJobs().catch(() => ({ jobs: [] as AIJob[] }));
    const jobs = response.jobs.filter(
      (entry) =>
        entry.vaultId === spaceId && entry.capability === "deep-research",
    );
    setJobHistory(jobs);
    return jobs;
  }, [spaceId]);

  const load = useCallback(async () => {
    const [page, overlay, privatePage] = await Promise.all([
      api.collection(spaceId, "deep-research", { limit: "200" }),
      api.annotations(spaceId, "deep-research", ""),
      api.artifacts(spaceId, "deep-research"),
    ]);
    void refreshPrivateJobs();
    const privateTranslationsNext = privatePage.artifacts.filter(
      (artifact) =>
        artifact.metadata?.surface === "translation" &&
        typeof artifact.metadata?.reportId === "string",
    );
    setPrivateTranslations(privateTranslationsNext);
    const privateEntries = privatePage.artifacts
      .filter((artifact) => !privateTranslationsNext.includes(artifact))
      .map((artifact) => ({
        id: artifact.id,
        title: artifact.title,
        objective:
          artifact.metadata?.objective || artifact.content.slice(0, 160),
        content: artifact.content,
        metadata: artifact.metadata,
        privateArtifact: true,
        updated_at: artifact.updatedAt,
        created_at: artifact.createdAt,
      }));
    const next = [...privateEntries, ...pageItems(page, "reports")];
    setPublished(next);
    setReadOverlay(
      new Map(
        overlay.annotations
          .filter(
            (entry) =>
              entry.kind === "note" &&
              (entry.content === "read" || entry.content === "unread") &&
              !entry.deletedAt,
          )
          .map((entry) => [
            valueText(entry.documentId),
            valueText(entry.content) as "read" | "unread",
          ]),
      ),
    );
    if (!initialReportApplied.current && initialReportId) {
      const matching = next.find(
        (entry) => valueText(entry.id) === initialReportId,
      );
      if (matching) {
        setOpen(matching);
        initialReportApplied.current = true;
      }
    }
  }, [refreshPrivateJobs, spaceId]);
  useEffect(() => {
    void load().catch(setError);
  }, [load]);
  useEffect(() => {
    void refreshPrivateJobs();
  }, [refreshPrivateJobs]);
  useEffect(() => {
    if (
      !jobHistory.some((entry) => ["queued", "running"].includes(entry.status))
    )
      return;
    const timer = window.setInterval(() => {
      void refreshPrivateJobs();
    }, 1200);
    return () => window.clearInterval(timer);
  }, [jobHistory, refreshPrivateJobs]);

  useEffect(() => {
    if (!open) {
      setReport(null);
      setReportImage(null);
      setTranslations([]);
      setActiveTranslation(null);
      setTranslationOpen(false);
      setTranslationComposerOpen(false);
      setHasReaderMark(false);
      setReaderAnnotationsState([]);
      setHighlighterColor(null);
      setShowMatrix(false);
      setFullscreen(false);
      setActiveSection(0);
      setScrollProgress(0);
      setReaderFeedback("");
      setBriefEditing(false);
      setSpeaking(false);
      return;
    }
    setBriefTitle(valueText(open.title));
    setBriefObjective(
      valueText(
        open.objective ||
          (open.metadata && typeof open.metadata === "object"
            ? (open.metadata as JsonRecord).objective
            : ""),
      ),
    );
    let alive = true;
    setReaderLoading(true);
    const reportRequest =
      open.privateArtifact === true
        ? Promise.resolve({
            report: {
              draft: {
                title: valueText(open.title, "Informe privado"),
                draftMarkdown: valueText(open.content),
              },
            },
            image: null,
            translations: [] as JsonRecord[],
          })
        : api.deepResearchReport(spaceId, valueText(open.id));
    Promise.all([
      reportRequest,
      api.annotations(spaceId, "deep-research", valueText(open.id)),
    ])
      .then(([response, personal]) => {
        if (!alive) return;
        setReport(response.report || null);
        setReportImage(response.image || null);
        const nextTranslations = (response.translations || []).filter(
          (entry) => valueText(entry.status, "ready") === "ready",
        );
        const ownTranslations = privateTranslations
          .filter(
            (entry) =>
              valueText(entry.metadata?.reportId) === valueText(open.id),
          )
          .map((entry) => ({
            id: entry.id,
            title: entry.title,
            content: entry.content,
            language: entry.metadata?.language,
            language_label:
              entry.metadata?.languageLabel || entry.metadata?.language,
            privateArtifact: true,
          }));
        setTranslations([...nextTranslations, ...ownTranslations]);
        const requestedTranslation = new URLSearchParams(location.search).get(
          "translation",
        );
        // Include account-private translations in the same reader switcher as
        // published translations.  The previous implementation only searched
        // `nextTranslations`, so a deep link copied from a private translation
        // silently opened the original report after reload.
        const allTranslations = [...nextTranslations, ...ownTranslations];
        setActiveTranslation(
          requestedTranslation
            ? allTranslations.find(
                (entry) => valueText(entry.id) === requestedTranslation,
              ) || null
            : null,
        );
        annotationVersionRef.current = personal.version;
        setAnnotationVersion(personal.version);
        const scopedAnnotations = personal.annotations.filter(
          (entry) =>
            valueText(entry.scope, "source") ===
            (requestedTranslation
              ? `translation:${requestedTranslation}`
              : "source"),
        );
        setReaderAnnotationsState(
          readerAnnotations(scopedAnnotations as unknown as JsonRecord[]),
        );
        setNotes(
          scopedAnnotations
            .filter(
              (entry) =>
                !entry.deletedAt &&
                ["highlight", "comment", "bookmark"].includes(
                  valueText(entry.kind),
                ),
            )
            .map((entry) => ({
              id: entry.id,
              kind: valueText(entry.kind),
              quote: entry.quote,
              content: entry.content,
            })),
        );
      })
      .catch(setError)
      .finally(() => {
        if (alive) setReaderLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [activeTranslation?.id, open?.id, privateTranslations, spaceId]);

  // The desktop reader hands narration to its local audio player. In the browser
  // there is no Electron audio bridge, so use the platform voice as a faithful,
  // private fallback instead of silently omitting the reader action.
  useEffect(
    () => () => {
      window.speechSynthesis?.cancel();
    },
    [],
  );

  useEffect(() => {
    if (!published.length) return;
    const requested = new URLSearchParams(location.search).get("report");
    if (requested) {
      const matching = published.find(
        (entry) => valueText(entry.id) === requested,
      );
      if (matching && valueText(open?.id) !== requested) setOpen(matching);
    } else if (open) setOpen(null);
  }, [published, open?.id]);

  const isRead = (entry: JsonRecord | null) => {
    if (!entry) return false;
    const override = readOverlay.get(valueText(entry.id));
    return override ? override === "read" : Boolean(entry.read_at);
  };
  const filtered = published
    .filter(
      (entry) =>
        (!query.trim() ||
          valueText(entry.title)
            .toLowerCase()
            .includes(query.trim().toLowerCase()) ||
          valueText(entry.objective)
            .toLowerCase()
            .includes(query.trim().toLowerCase())) &&
        (readFilter === "all" || (readFilter === "read") === isRead(entry)),
    )
    .sort((a, b) =>
      sort === "title"
        ? valueText(a.title).localeCompare(valueText(b.title), getActiveLang())
        : (sort === "oldest" ? 1 : -1) *
          valueText(a.updated_at || a.created_at).localeCompare(
            valueText(b.updated_at || b.created_at),
          ),
    );
  const imageUrl = (entry: JsonRecord) => {
    const image = entry.image as Record<string, unknown> | undefined;
    const hash = valueText(image?.thumbHash || image?.hash);
    return hash ? api.assetUrl(spaceId, hash) : "";
  };
  const reportDraft = (
    report?.draft && typeof report.draft === "object" ? report.draft : {}
  ) as JsonRecord;
  const markdown = valueText(
    reportDraft.draftMarkdown || reportDraft.markdown || reportDraft.content,
    valueText(reportDraft.abstract || open?.objective),
  );
  const isPrivateReport = open?.privateArtifact === true;
  const translationMarkdown = valueText(
    activeTranslation?.markdown ||
      activeTranslation?.content_markdown ||
      activeTranslation?.content,
  );
  const visibleMarkdown = activeTranslation
    ? translationMarkdown || markdown
    : `# ${valueText(open?.title, "Informe")}\n\n${markdown}`;
  const fullImageHash = valueText(reportImage?.hash || reportImage?.thumbHash);
  const toggleSpeech = () => {
    if (!("speechSynthesis" in window)) {
      setReaderFeedback(
        t("La lectura en voz alta no está disponible en este navegador"),
      );
      return;
    }
    if (speaking) {
      window.speechSynthesis.cancel();
      setSpeaking(false);
      return;
    }
    const utterance = new SpeechSynthesisUtterance(
      plainReading(visibleMarkdown),
    );
    utterance.lang = document.documentElement.lang || getActiveLang();
    utterance.onend = () => setSpeaking(false);
    utterance.onerror = () => setSpeaking(false);
    setSpeaking(true);
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(utterance);
  };

  const savePrivateBrief = async (event: FormEvent) => {
    event.preventDefault();
    if (!open || !isPrivateReport || briefSaving) return;
    setBriefSaving(true);
    try {
      const metadata =
        open.metadata && typeof open.metadata === "object"
          ? {
              ...(open.metadata as JsonRecord),
              objective: briefObjective.trim(),
            }
          : { objective: briefObjective.trim() };
      const response = await api.updateArtifact(
        valueText(open.id),
        { title: briefTitle.trim() || "Informe privado", metadata },
        csrfToken,
      );
      const artifact = response.artifact as unknown as JsonRecord;
      setOpen((current) =>
        current
          ? {
              ...current,
              ...artifact,
              title: valueText(
                artifact.title,
                briefTitle.trim() || "Informe privado",
              ),
              objective: briefObjective.trim(),
              metadata,
            }
          : current,
      );
      setPublished((current) =>
        current.map((entry) =>
          valueText(entry.id) === valueText(open.id)
            ? {
                ...entry,
                ...artifact,
                title: valueText(
                  artifact.title,
                  briefTitle.trim() || "Informe privado",
                ),
                objective: briefObjective.trim(),
                metadata,
              }
            : entry,
        ),
      );
      setBriefEditing(false);
      setReaderFeedback(t("Brief privado actualizado"));
    } catch (cause) {
      setError(cause);
    } finally {
      setBriefSaving(false);
    }
  };
  const syncReaderAnnotation = async (patch: JsonRecord) => {
    if (!open) return;
    const now = new Date().toISOString();
    const id = valueText(
      patch.id,
      crypto.randomUUID?.() || `annotation-${Date.now()}`,
    );
    if (patch.deletedAt) {
      const response = await api.deleteAnnotation(
        spaceId,
        id,
        annotationVersionRef.current,
        csrfToken,
      );
      annotationVersionRef.current = response.version;
      setAnnotationVersion(response.version);
      const scopedAnnotations = response.annotations
        .filter(
          (entry) =>
            entry.resource === "deep-research" &&
            entry.documentId === valueText(open.id),
        )
        .filter(
          (entry) => valueText(entry.scope, "source") === annotationScope,
        );
      setReaderAnnotationsState(
        readerAnnotations(scopedAnnotations as unknown as JsonRecord[]),
      );
      setNotes(
        scopedAnnotations
          .filter(
            (entry) =>
              !entry.deletedAt &&
              ["highlight", "comment", "bookmark"].includes(
                valueText(entry.kind),
              ),
          )
          .map((entry) => ({
            id: entry.id,
            kind: valueText(entry.kind),
            quote: entry.quote,
            content: entry.content,
          })),
      );
      return;
    }
    const existing = readerAnnotationsState.find((entry) => entry.id === id);
    const anchorInput =
      patch.anchor && typeof patch.anchor === "object"
        ? (patch.anchor as JsonRecord)
        : null;
    const anchor =
      anchorInput ||
      (patch.startOffset !== undefined || patch.endOffset !== undefined
        ? {
            startOffset: Number(patch.startOffset) || 0,
            endOffset: Number(patch.endOffset) || 0,
            selectedText: valueText(patch.selectedText || patch.quote),
            prefix: valueText(patch.prefix),
            suffix: valueText(patch.suffix),
          }
        : existing
          ? {
              startOffset: existing.startOffset,
              endOffset: existing.endOffset,
              selectedText: existing.selectedText,
              prefix: existing.prefix,
              suffix: existing.suffix,
            }
          : null);
    const response = await api.addAnnotation(
      spaceId,
      {
        ...(existing
          ? {
              kind: existing.kind,
              color: existing.color,
              content: existing.comment || "",
              quote: existing.selectedText,
              anchor,
            }
          : {}),
        ...patch,
        id,
        resource: "deep-research",
        documentId: valueText(open.id),
        scope: annotationScope,
        quote: valueText(
          patch.quote || patch.selectedText || existing?.selectedText,
        ),
        anchor,
        baseVersion: annotationVersionRef.current,
        createdAt: valueText(patch.createdAt, now),
        updatedAt: now,
      },
      csrfToken,
    );
    annotationVersionRef.current = response.version;
    setAnnotationVersion(response.version);
    const openAnnotations = response.annotations.filter(
      (entry) =>
        entry.resource === "deep-research" &&
        entry.documentId === valueText(open.id),
    );
    const scopedAnnotations = openAnnotations.filter(
      (entry) => valueText(entry.scope, "source") === annotationScope,
    );
    setReaderAnnotationsState(
      readerAnnotations(scopedAnnotations as unknown as JsonRecord[]),
    );
    setNotes(
      scopedAnnotations
        .filter(
          (entry) =>
            !entry.deletedAt &&
            ["highlight", "comment", "bookmark"].includes(
              valueText(entry.kind),
            ),
        )
        .map((entry) => ({
          id: entry.id,
          kind: valueText(entry.kind),
          quote: entry.quote,
          content: entry.content,
        })),
    );
  };

  const toggleRead = async (entry: JsonRecord) => {
    const id = valueText(entry.id);
    try {
      const current = await api.annotations(spaceId, "deep-research", "");
      annotationVersionRef.current = current.version;
      const existing = current.annotations.find(
        (item) =>
          item.kind === "note" &&
          item.documentId === id &&
          (item.content === "read" || item.content === "unread"),
      );
      const next = !isRead(entry);
      const response = await api.addAnnotation(
        spaceId,
        {
          id: existing?.id || `deep-read-${id}`,
          resource: "deep-research",
          documentId: id,
          kind: "note",
          title: "Estado de lectura",
          content: next ? "read" : "unread",
          // Keep the row as an explicit override. Deleting it would make an unread
          // report fall back to a published read_at value after the next reload.
          deletedAt: null,
          baseVersion: current.version,
        },
        csrfToken,
      );
      annotationVersionRef.current = response.version;
      setAnnotationVersion(response.version);
      const updatedOverlay = new Map<string, "read" | "unread">();
      response.annotations
        .filter(
          (item) =>
            item.kind === "note" &&
            (item.content === "read" || item.content === "unread") &&
            !item.deletedAt,
        )
        .forEach((item) =>
          updatedOverlay.set(
            valueText(item.documentId),
            item.content as "read" | "unread",
          ),
        );
      setReadOverlay(updatedOverlay);
      setPublished((previous) =>
        previous.map((item) =>
          valueText(item.id) === id
            ? { ...item, read_at: next ? new Date().toISOString() : null }
            : item,
        ),
      );
      setReaderFeedback(
        next ? t("Marcado como leído") : t("Marcado como no leído"),
      );
      if (open && valueText(open.id) === id) {
        setOpen((previous) =>
          previous
            ? { ...previous, read_at: next ? new Date().toISOString() : null }
            : previous,
        );
        // The POST returns the authoritative version and complete private set.
        // Refreshing the open reader here prevents the next highlight from using
        // the stale version that existed before the read toggle.
        const openAnnotations = response.annotations.filter(
          (item) =>
            item.resource === "deep-research" &&
            item.documentId === id &&
            valueText(item.scope, "source") === annotationScope,
        );
        setReaderAnnotationsState(
          readerAnnotations(openAnnotations as unknown as JsonRecord[]),
        );
        setNotes(
          openAnnotations
            .filter(
              (item) =>
                !item.deletedAt &&
                ["highlight", "comment", "bookmark"].includes(
                  valueText(item.kind),
                ) &&
                item.documentId === id,
            )
            .map((item) => ({
              id: item.id,
              kind: valueText(item.kind),
              quote: item.quote,
              content: item.content,
            })),
        );
      }
    } catch (cause) {
      setReaderFeedback(t("No se pudo actualizar el estado de lectura"));
      setError(cause);
    }
  };

  const copyReading = async () => {
    try {
      await navigator.clipboard.writeText(plainReading(visibleMarkdown));
      setReaderFeedback(t("Lectura copiada"));
    } catch (cause) {
      setReaderFeedback(t("No se pudo copiar la lectura"));
      setError(cause);
    }
  };

  const copySource = async () => {
    try {
      await navigator.clipboard.writeText(
        `# ${valueText(open?.title)}\n\n${markdown}`,
      );
      setReaderFeedback(t("Contenido copiado"));
    } catch (cause) {
      setReaderFeedback(t("No se pudo copiar el contenido"));
      setError(cause);
    }
  };

  const saveToNotes = async () => {
    try {
      await api.createArtifact(
        {
          vaultId: spaceId,
          kind: "workspace-note",
          title: valueText(open?.title, "Informe"),
          content: visibleMarkdown,
          metadata: {
            source: "deep-research",
            deepResearchId: valueText(open?.id),
          },
        },
        csrfToken,
      );
      setReaderFeedback(t("Guardado en notas privadas"));
    } catch (cause) {
      setReaderFeedback(t("No se pudo guardar en notas privadas"));
      setError(cause);
    }
  };

  const saveCompletedPrivateJob = async (
    completed: AIJob,
    title: string,
    objective = "",
  ) => {
    if (completed.status !== "completed")
      throw new Error(
        completed.error?.message || `Trabajo ${completed.status}.`,
      );
    const existing = (
      await api.artifacts(spaceId, "deep-research")
    ).artifacts.find((entry) => entry.sourceJobId === completed.id);
    if (!existing) {
      await api.createArtifact(
        {
          vaultId: spaceId,
          kind: "deep-research",
          title:
            title.trim() ||
            `${t("Informe privado")} · ${formatReportDate(completed.updatedAt)}`,
          content: extractAIText(completed.result),
          metadata: { objective, source: "server-web-private" },
          sourceJobId: completed.id,
        },
        csrfToken,
      );
    }
    await load();
    await refreshPrivateJobs();
  };

  const generatePrivateReport = async (event: FormEvent) => {
    event.preventDefault();
    const objective = composerObjective.trim();
    if (!objective || generationJob) return;
    const controller = new AbortController();
    generationAbort.current = controller;
    try {
      const context = await api
        .contextPackage(spaceId, objective, csrfToken)
        .catch(() => ({ sections: [] }));
      const created = await api.runAI(
        spaceId,
        "deep-research",
        {
          provider: profile.provider,
          model: profile.model,
          maxTokens: 8000,
          messages: [
            {
              role: "system",
              content: serverPrompt(profile.promptLanguage, "deepResearch"),
            },
            {
              role: "user",
              content: `${serverLabel(profile.promptLanguage, "title")}: ${composerTitle.trim() || objective.slice(0, 80)}\n${serverLabel(profile.promptLanguage, "objective")}: ${objective}\n\n${serverLabel(profile.promptLanguage, "context")}:\n${JSON.stringify(context.sections || []).slice(0, 32000)}`,
            },
          ],
        },
        csrfToken,
      );
      setGenerationJob(created.job);
      setJobHistory((current) => [
        created.job,
        ...current.filter((entry) => entry.id !== created.job.id),
      ]);
      const completed = await awaitJob(created.job.id, controller.signal);
      await saveCompletedPrivateJob(
        completed,
        composerTitle.trim() || objective.slice(0, 80),
        objective,
      );
      setComposerTitle("");
      setComposerObjective("");
      setComposerOpen(false);
    } catch (cause) {
      if (!(cause instanceof DOMException && cause.name === "AbortError"))
        setError(cause);
      await refreshPrivateJobs();
    } finally {
      generationAbort.current = null;
      setGenerationJob(null);
    }
  };
  const cancelPrivateGeneration = async () => {
    const job = generationJob;
    generationAbort.current?.abort();
    if (job && ["queued", "running"].includes(job.status)) {
      await api.cancelAIJob(job.id, csrfToken).catch(() => undefined);
    }
    await refreshPrivateJobs();
    setGenerationJob(null);
  };
  const retryPrivateJob = async (job: AIJob) => {
    if (!["failed", "cancelled"].includes(job.status) || generationJob) return;
    setError(undefined);
    const controller = new AbortController();
    generationAbort.current = controller;
    try {
      const response = await api.retryAIJob(job.id, csrfToken);
      setGenerationJob(response.job);
      setJobHistory((current) =>
        current.map((entry) => (entry.id === job.id ? response.job : entry)),
      );
      const completed = await awaitJob(response.job.id, controller.signal);
      await saveCompletedPrivateJob(completed, "Informe privado");
    } catch (cause) {
      if (!(cause instanceof DOMException && cause.name === "AbortError"))
        setError(cause);
    } finally {
      generationAbort.current = null;
      setGenerationJob(null);
      await refreshPrivateJobs();
    }
  };
  const deletePrivateReport = async () => {
    if (
      !open?.privateArtifact ||
      !window.confirm(
        t("¿Eliminar este informe privado? No se puede deshacer."),
      )
    )
      return;
    try {
      const reportId = valueText(open.id);
      const children = privateTranslations.filter(
        (entry) => valueText(entry.metadata?.reportId) === reportId,
      );
      await Promise.all([
        ...children.map((entry) => api.deleteArtifact(entry.id, csrfToken)),
        api.deleteArtifact(reportId, csrfToken),
      ]);
      setPrivateTranslations((items) =>
        items.filter(
          (entry) => valueText(entry.metadata?.reportId) !== reportId,
        ),
      );
      closeReport();
      await load();
      setReaderFeedback(t("Informe privado eliminado"));
    } catch (cause) {
      setError(cause);
    }
  };

  const openReport = (entry: JsonRecord) => {
    setOpen(entry);
    history.replaceState(
      {},
      "",
      `/view/deepResearch?report=${encodeURIComponent(valueText(entry.id))}`,
    );
  };
  const closeReport = () => {
    setOpen(null);
    history.replaceState({}, "", "/view/deepResearch");
  };
  const applyTranslation = (entry: JsonRecord | null) => {
    setActiveTranslation(entry);
    setTranslationOpen(false);
    if (open) {
      const suffix = entry
        ? `&translation=${encodeURIComponent(valueText(entry.id))}`
        : "";
      history.replaceState(
        {},
        "",
        `/view/deepResearch?report=${encodeURIComponent(valueText(open.id))}${suffix}`,
      );
    }
  };

  const generatePrivateTranslation = async (event: FormEvent) => {
    event.preventDefault();
    if (!open || translationBusy || !translationLanguage.trim()) return;
    setTranslationBusy(true);
    setError(undefined);
    try {
      const source = plainReading(markdown).slice(0, 80_000);
      const created = await api.runAI(
        spaceId,
        "deep-research",
        {
          provider: profile.provider,
          model: profile.model,
          maxTokens: 8_000,
          messages: [
            {
              role: "system",
              content: translationPrompt(profile.promptLanguage, translationLanguage.trim()),
            },
            {
              role: "user",
              content: `${serverLabel(profile.promptLanguage, "title")}: ${valueText(open.title, "Informe")}\n\n${serverLabel(profile.promptLanguage, "originalReport")}:\n${source}`,
            },
          ],
        },
        csrfToken,
      );
      const completed = await awaitJob(
        created.job.id,
        new AbortController().signal,
      );
      if (completed.status !== "completed")
        throw new Error(
          completed.error?.message || t("No se pudo generar la traducción."),
        );
      const artifactResponse = await api.createArtifact(
        {
          vaultId: spaceId,
          kind: "deep-research",
          title: `${valueText(open.title, "Informe")} · ${translationLanguage.trim()}`,
          content: extractAIText(completed.result),
          metadata: {
            surface: "translation",
            private: true,
            reportId: valueText(open.id),
            language: translationLanguage.trim(),
            languageLabel: translationLanguage.trim(),
          },
          sourceJobId: completed.id,
        },
        csrfToken,
      );
      const artifact = artifactResponse.artifact;
      setPrivateTranslations((items) => [...items, artifact]);
      const translated = {
        id: artifact.id,
        title: artifact.title,
        content: artifact.content,
        language: artifact.metadata.language,
        language_label: artifact.metadata.languageLabel,
        privateArtifact: true,
      } as JsonRecord;
      setTranslations((items) => [...items, translated]);
      applyTranslation(translated);
      setTranslationComposerOpen(false);
      setReaderFeedback(t("Traducción privada guardada"));
    } catch (cause) {
      setError(cause);
    } finally {
      setTranslationBusy(false);
    }
  };

  // Build the reader rail from the headings that actually rendered. Parsing the
  // source Markdown diverges as soon as a translation or renderer normalization
  // changes the heading tree.
  useEffect(() => {
    if (!open || readerLoading) {
      setDomHeadings([]);
      return;
    }
    const root = readerDocumentRef.current;
    if (!root) return;
    const headings = [...root.querySelectorAll("h1, h2, h3, h4")]
      .map((element, index) => {
        const sectionId =
          element.closest<HTMLElement>("section[id]")?.id ||
          "deep-research-report";
        const id = element.id || `deep-research-heading-${index + 1}`;
        element.id = id;
        return {
          id,
          label: (element.textContent || "").trim(),
          level: Number(element.tagName.slice(1)),
          sectionId,
        };
      })
      .filter((heading) => heading.label);
    setDomHeadings(headings);
  }, [
    open?.id,
    activeTranslation?.id,
    readerLoading,
    markdown,
    translationMarkdown,
  ]);

  useEffect(() => {
    if (!open || !domHeadings.length) return;
    const node = readerRef.current;
    if (!node) return;
    const update = () => {
      const root = readerDocumentRef.current;
      const positions = domHeadings.map(
        (heading) =>
          Array.from(root?.querySelectorAll<HTMLElement>("[id]") || [])
            .find((element) => element.id === heading.id)
            ?.getBoundingClientRect().top ?? Number.POSITIVE_INFINITY,
      );
      const threshold = node.getBoundingClientRect().top + 72;
      const current = positions.reduce(
        (found, position, index) => (position <= threshold ? index : found),
        0,
      );
      setActiveSection(current);
      const maximum = Math.max(0, node.scrollHeight - node.clientHeight);
      setScrollProgress(
        maximum
          ? Math.min(
              100,
              Math.max(0, Math.round((node.scrollTop / maximum) * 100)),
            )
          : 100,
      );
    };
    update();
    node.addEventListener("scroll", update, { passive: true });
    const resize = new ResizeObserver(update);
    resize.observe(node);
    if (readerDocumentRef.current) resize.observe(readerDocumentRef.current);
    return () => {
      node.removeEventListener("scroll", update);
      resize.disconnect();
    };
  }, [domHeadings, open?.id, showMatrix, report?.id]);

  const goToHeading = (heading: { id: string }) => {
    const scroller = readerRef.current;
    const root = readerDocumentRef.current;
    const target = Array.from(
      root?.querySelectorAll<HTMLElement>("[id]") || [],
    ).find((element) => element.id === heading.id);
    if (!scroller || !target) return;
    const top =
      scroller.scrollTop +
      target.getBoundingClientRect().top -
      scroller.getBoundingClientRect().top -
      24;
    scroller.scrollTo({ top: Math.max(0, top), behavior: "smooth" });
  };

  if (open)
    return (
      <div
        className={`deep-research-server-reader flex h-full min-h-0 flex-col bg-white text-neutral-900 dark:bg-neutral-950 dark:text-neutral-100 ${fullscreen ? "deep-research-reader-fullscreen" : ""}`}
        data-testid="deep-research-reader"
      >
        <NodiViewContextSource
          title={valueText(
            activeTranslation?.title || reportDraft.title || open.title,
            "Informe",
          )}
          text={visibleMarkdown}
        />
        <header
          className="deep-research-reader-toolbar flex shrink-0 flex-wrap items-center gap-2 border-b border-neutral-200 px-4 py-2.5 dark:border-neutral-800"
          data-testid="deep-research-reader-toolbar"
        >
          <button
            className="btn btn-ghost h-9 gap-1.5 text-xs"
            onClick={closeReport}
          >
            <Icon name="chevronLeft" size={13} />
            {t("Volver a la galería")}
          </button>
          <div className="min-w-[12rem] flex-[1_1_14rem] overflow-hidden">
            <strong
              className="block truncate text-sm"
              title={valueText(
                activeTranslation?.title || open.title,
                "Informe",
              )}
            >
              {valueText(activeTranslation?.title || open.title, "Informe")}
            </strong>
            <div className="mt-0.5 flex items-center gap-2">
              <small className="whitespace-nowrap text-[11px] text-neutral-500">
                {formatReportDate(open.updated_at || open.created_at)}
              </small>
              <span className="deep-research-published-pill">
                {isPrivateReport ? t("Privado") : t("Publicado")}
              </span>
            </div>
          </div>
          <div
            className="deep-research-reader-actions flex shrink-0 flex-wrap items-center gap-1.5"
            aria-label={t("Acciones del lector")}
          >
            <div
              className="deep-research-draft-actions flex items-center gap-1"
              data-testid="deep-research-draft-actions"
              role="group"
              aria-label={t("Copiar y exportar")}
            >
              <HoverLabelButton
                icon="copy"
                label={t("Copiar")}
                onClick={() => void copySource()}
                className="btn-ghost h-9 min-h-9 border border-neutral-300 dark:border-neutral-700"
                data-testid="deep-research-copy"
              />
              <HoverLabelButton
                icon="copyText"
                label={t("Copiar lectura")}
                onClick={() => void copyReading()}
                className="btn-ghost h-9 min-h-9 border border-neutral-300 dark:border-neutral-700"
                data-testid="deep-research-copy-reading"
              />
              <HoverLabelButton
                icon="save"
                label={t("Guardar en notas")}
                onClick={() => void saveToNotes()}
                className="btn-ghost h-9 min-h-9 border border-neutral-300 dark:border-neutral-700"
                data-testid="deep-research-save-note"
              />
              <HoverLabelButton
                icon="download"
                label={t("Exportar PDF")}
                onClick={() =>
                  window.open(
                    api.deepResearchPdfUrl(
                      spaceId,
                      valueText(open.id),
                      isPrivateReport,
                    ),
                    "_blank",
                    "noopener,noreferrer",
                  )
                }
                className="btn-ghost h-9 min-h-9 border border-neutral-300 dark:border-neutral-700"
                data-testid="deep-research-pdf"
              />
              {!isPrivateReport && (
                <HoverLabelButton
                  icon="download"
                  label={t("Imprimir / exportar")}
                  onClick={() =>
                    window.open(
                      api.deepResearchDocumentUrl(spaceId, valueText(open.id)),
                      "_blank",
                      "noopener,noreferrer",
                    )
                  }
                  className="btn-ghost h-9 min-h-9 border border-neutral-300 dark:border-neutral-700"
                  data-testid="deep-research-print"
                />
              )}
            </div>
            <HoverLabelButton
              icon="languages"
              label={
                translations.length
                  ? tx("Traducciones ({n})", { n: translations.length })
                  : t("Traducciones")
              }
              onClick={() => setTranslationOpen((value) => !value)}
              className="btn-ghost h-9 min-h-9 border border-neutral-300 dark:border-neutral-700"
              data-testid="deep-research-translations-toggle"
            />
            <HoverLabelButton
              icon="plus"
              label={t("Nueva traducción privada")}
              onClick={() => setTranslationComposerOpen((value) => !value)}
              className={`btn-ghost h-9 min-h-9 border ${translationComposerOpen ? "border-indigo-500 text-indigo-600 dark:text-indigo-300" : "border-neutral-300 dark:border-neutral-700"}`}
              data-testid="deep-research-private-translation"
            />
            <div
              className="deep-research-font-controls flex h-9 items-stretch overflow-hidden rounded-lg border border-neutral-300 dark:border-neutral-700"
              data-testid="deep-research-font-controls"
              role="group"
              aria-label={t("Tipografía")}
            >
              <button
                className="grid w-8 place-items-center text-xs text-neutral-500 hover:bg-neutral-100 dark:hover:bg-neutral-800"
                onClick={() => setFontSize((size) => Math.max(12, size - 1))}
                aria-label={t("Reducir texto")}
              >
                a
              </button>
              <output className="grid min-w-9 place-items-center border-x border-neutral-300 px-1 text-[10px] tabular-nums text-neutral-500 dark:border-neutral-700">
                {fontSize}
              </output>
              <button
                className="grid w-8 place-items-center text-[17px] font-semibold text-neutral-600 hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-800"
                onClick={() => setFontSize((size) => Math.min(24, size + 1))}
                aria-label={t("Aumentar texto")}
              >
                A
              </button>
            </div>
            <ReaderHighlighterControl
              value={highlighterColor}
              onChange={setHighlighterColor}
            />
            <HoverLabelButton
              icon={speaking ? "stop" : "audio"}
              label={speaking ? t("Detener lectura") : t("Escuchar informe")}
              onClick={toggleSpeech}
              showLabel={speaking}
              className={`btn-ghost h-9 min-h-9 border ${speaking ? "border-indigo-500 text-indigo-600 dark:text-indigo-300" : "border-neutral-300 dark:border-neutral-700"}`}
              data-testid="deep-research-audio"
            />
            <button
              data-testid="deep-research-bookmark"
              aria-pressed={hasReaderMark}
              className={`btn btn-ghost h-9 border text-xs ${hasReaderMark ? "border-amber-500 text-amber-600" : "border-neutral-300 dark:border-neutral-700"}`}
              onClick={() => {
                if (hasReaderMark) markActionsRef.current?.goToMark();
              }}
              disabled={!hasReaderMark}
              title={
                hasReaderMark
                  ? t("Ir al marcador de lectura")
                  : t("Selecciona texto para añadir un marcador")
              }
              aria-label={
                hasReaderMark
                  ? t("Ir al marcador de lectura")
                  : t("Añadir marcador de lectura")
              }
            >
              <Icon
                name={hasReaderMark ? "bookmarkFill" : "bookmark"}
                size={13}
              />
            </button>
            <button
              className="deep-research-reader-state"
              data-testid="deep-research-read-state"
              aria-pressed={isRead(open)}
              onClick={() => void toggleRead(open)}
              aria-label={
                isRead(open)
                  ? t("Marcar como no leído")
                  : t("Marcar como leído")
              }
              title={
                isRead(open)
                  ? t("Marcar como no leído")
                  : t("Marcar como leído")
              }
            >
              <Icon name={isRead(open) ? "check" : "book"} size={12} />
              {isRead(open) ? t("Leído") : t("No leído")}
            </button>
            {recordArray(reportDraft.matrix).length > 0 && (
              <HoverLabelButton
                icon="layers"
                label={t("Matriz")}
                showLabel={showMatrix}
                onClick={() => setShowMatrix((value) => !value)}
                className={`btn-ghost h-9 min-h-9 border ${showMatrix ? "border-indigo-500 text-indigo-600 dark:text-indigo-300" : "border-neutral-300 dark:border-neutral-700"}`}
                data-testid="deep-research-matrix-toggle"
              />
            )}
            <button
              className={`btn btn-ghost h-9 border text-xs ${fullscreen ? "border-indigo-500 text-indigo-600 dark:text-indigo-300" : "border-neutral-300 dark:border-neutral-700"}`}
              onClick={() => setFullscreen((value) => !value)}
              aria-pressed={fullscreen}
              data-testid="deep-research-fullscreen-toggle"
              title={
                fullscreen
                  ? t("Salir de pantalla completa")
                  : t("Lectura a pantalla completa")
              }
              aria-label={
                fullscreen
                  ? t("Salir de pantalla completa")
                  : t("Lectura a pantalla completa")
              }
            >
              <Icon name={fullscreen ? "minimize" : "maximize"} size={13} />
            </button>
            {!isPrivateReport && (
              <HoverLabelButton
                icon="external"
                label={t("Nueva pestaña")}
                onClick={() =>
                  window.open(
                    `/view/deepResearch?report=${encodeURIComponent(valueText(open.id))}`,
                    "_blank",
                    "noopener,noreferrer",
                  )
                }
                className="btn-ghost h-9 min-h-9 border border-neutral-300 dark:border-neutral-700"
                data-testid="deep-research-new-tab"
              />
            )}
            {isPrivateReport && (
              <HoverLabelButton
                icon="edit"
                label={t("Editar brief")}
                onClick={() => setBriefEditing((value) => !value)}
                showLabel={briefEditing}
                className={`btn-ghost h-9 min-h-9 border ${briefEditing ? "border-indigo-500 text-indigo-600 dark:text-indigo-300" : "border-neutral-300 dark:border-neutral-700"}`}
                data-testid="deep-research-edit-brief"
              />
            )}
            {isPrivateReport && (
              <HoverLabelButton
                icon="trash"
                label={t("Eliminar informe privado")}
                onClick={() => void deletePrivateReport()}
                className="btn-ghost h-9 min-h-9 border border-red-300 text-red-600 dark:border-red-900 dark:text-red-300"
                data-testid="deep-research-private-delete"
              />
            )}
          </div>
        </header>
        {briefEditing && isPrivateReport && (
          <form
            className="deep-research-brief-editor flex shrink-0 flex-wrap items-end gap-2 border-b border-indigo-200 bg-indigo-50 px-4 py-3 dark:border-indigo-900 dark:bg-indigo-950/25"
            onSubmit={(event) => void savePrivateBrief(event)}
            data-testid="deep-research-brief-editor"
          >
            <label className="min-w-48 flex-1 text-xs text-indigo-900 dark:text-indigo-100">
              {t("Título")}
              <input
                className="input mt-1 w-full text-xs"
                value={briefTitle}
                onChange={(event) => setBriefTitle(event.target.value)}
              />
            </label>
            <label className="min-w-64 flex-[2] text-xs text-indigo-900 dark:text-indigo-100">
              {t("Objetivo")}
              <input
                className="input mt-1 w-full text-xs"
                value={briefObjective}
                onChange={(event) => setBriefObjective(event.target.value)}
              />
            </label>
            <button
              className="btn btn-primary h-9 text-xs"
              disabled={briefSaving}
            >
              {briefSaving ? t("Guardando…") : t("Guardar brief")}
            </button>
            <button
              type="button"
              className="btn btn-ghost h-9 text-xs"
              onClick={() => setBriefEditing(false)}
            >
              {t("Cancelar")}
            </button>
          </form>
        )}
        {translationOpen && (
          <section
            className="flex shrink-0 flex-wrap items-center gap-2 border-b border-indigo-200 bg-indigo-50 px-4 py-2.5 text-xs text-indigo-900 dark:border-indigo-900 dark:bg-indigo-950/30 dark:text-indigo-100"
            data-testid="deep-research-translations"
          >
            <strong className="mr-1">{t("Traducciones")}</strong>
            <button
              className={`btn h-8 text-xs ${!activeTranslation ? "bg-indigo-600 text-white" : "btn-ghost"}`}
              onClick={() => applyTranslation(null)}
            >
              {t("Original")}
            </button>
            {translations.length ? (
              translations.map((entry, index) => (
                <button
                  key={valueText(entry.id, String(index))}
                  className={`btn h-8 text-xs ${valueText(activeTranslation?.id) === valueText(entry.id) ? "bg-indigo-600 text-white" : "btn-ghost"}`}
                  onClick={() => applyTranslation(entry)}
                >
                  {valueText(
                    entry.language_label ||
                      entry.languageLabel ||
                      entry.language,
                    "Idioma",
                  )}{" "}
                  · {valueText(entry.title, t("traducción"))}
                  {entry.privateArtifact === true && (
                    <span className="ml-1 text-teal-600 dark:text-teal-300">
                      · {t("privada")}
                    </span>
                  )}
                </button>
              ))
            ) : (
              <span className="text-indigo-700/70 dark:text-indigo-300/70">
                {t("No hay traducciones para este informe.")}
              </span>
            )}
          </section>
        )}
        {translationComposerOpen && (
          <form
            className="flex shrink-0 flex-wrap items-end gap-2 border-b border-teal-200 bg-teal-50 px-4 py-2.5 text-xs text-teal-950 dark:border-teal-900 dark:bg-teal-950/25 dark:text-teal-100"
            onSubmit={(event) => void generatePrivateTranslation(event)}
            data-testid="deep-research-private-translation-composer"
          >
            <label>
              {t("Idioma")}
              <input
                className="input ml-2 h-8 w-32 text-xs"
                value={translationLanguage}
                onChange={(event) => setTranslationLanguage(event.target.value)}
                placeholder="en"
              />
            </label>
            <span className="flex-1 text-[11px] text-teal-700/80 dark:text-teal-300/80">
              {t(
                "Se traducirá el informe visible y se guardará solo en tu cuenta.",
              )}
            </span>
            <button
              className="btn btn-primary h-8 text-xs"
              disabled={translationBusy}
            >
              {translationBusy ? t("Generando…") : t("Generar traducción")}
            </button>
          </form>
        )}
        {readerFeedback && (
          <div
            className="deep-research-reader-feedback"
            role="status"
            data-testid="deep-research-reader-feedback"
          >
            {readerFeedback}
          </div>
        )}
        <div className="flex min-h-0 flex-1">
          <aside
            className="deep-research-reader-rail hidden w-60 shrink-0 overflow-auto border-r border-neutral-200 p-3 xl:block dark:border-neutral-800"
            data-testid="deep-research-reader-rail"
          >
            <h2 className="mb-4 text-[10px] font-semibold uppercase tracking-wider text-neutral-500">
              {t("Contenido")}
            </h2>
            <div
              className="deep-research-report-headings"
              data-testid="deep-research-report-headings"
            >
              {domHeadings.length ? (
                domHeadings.map((heading, index) => (
                  <button
                    key={heading.id}
                    className={`deep-research-rail-item mb-1 block w-full truncate rounded px-2 py-1.5 text-left text-xs ${activeSection === index ? "bg-indigo-500/10 font-medium text-indigo-700 dark:text-indigo-200" : "text-neutral-600 hover:bg-neutral-100 dark:text-neutral-400 dark:hover:bg-neutral-900"}`}
                    style={{
                      paddingLeft: `${8 + Math.max(0, heading.level - 1) * 10}px`,
                    }}
                    aria-current={
                      activeSection === index ? "location" : undefined
                    }
                    onClick={() => goToHeading(heading)}
                  >
                    {heading.label}
                  </button>
                ))
              ) : (
                <p className="px-2 text-xs leading-5 text-neutral-500">
                  {t("Este informe no tiene encabezados publicados.")}
                </p>
              )}
            </div>
            <div
              className="deep-research-reader-progress mt-4 border-t border-neutral-200 pt-3 text-[10px] leading-4 text-neutral-500 dark:border-neutral-800"
              data-testid="deep-research-reader-progress"
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={scrollProgress}
              aria-label={t("Progreso de lectura")}
            >
              <div className="deep-research-reader-progress-track">
                <span style={{ width: `${scrollProgress}%` }} />
              </div>
              <span>{tx("{n}% leído", { n: scrollProgress })}</span>
            </div>
            <h2 className="mb-3 mt-6 text-[10px] font-semibold uppercase tracking-wider text-neutral-500">
              {t("Marcadores y subrayados")}
            </h2>
            {notes.length ? (
              notes.map((note) => (
                <div
                  key={note.id}
                  data-testid={`deep-research-annotation-${note.id}`}
                  data-annotation-kind={note.kind}
                  className="mb-2 flex items-start gap-1 rounded-r border-l-2 border-amber-400 bg-amber-50 px-2 py-1.5 text-[11px] leading-4 text-neutral-600 hover:bg-amber-100 dark:bg-amber-950/20 dark:text-neutral-400 dark:hover:bg-amber-950/40"
                >
                  <button
                    type="button"
                    className="min-w-0 flex-1 text-left"
                    onClick={() =>
                      markActionsRef.current?.goToAnnotation(note.id)
                    }
                  >
                    {note.quote || note.content}
                  </button>
                  <button
                    type="button"
                    data-testid={`deep-research-annotation-delete-${note.id}`}
                    className="shrink-0 rounded p-1 text-neutral-500 hover:bg-red-100 hover:text-red-600 dark:hover:bg-red-950/50 dark:hover:text-red-300"
                    aria-label={t("Eliminar anotación")}
                    title={t("Eliminar anotación")}
                    onClick={(event) => {
                      event.stopPropagation();
                      if (
                        window.confirm(
                          t("¿Eliminar esta anotación? No se puede deshacer."),
                        )
                      )
                        void syncReaderAnnotation({
                          id: note.id,
                          deletedAt: new Date().toISOString(),
                        }).catch((cause) => setError(cause));
                    }}
                  >
                    <Icon name="trash" size={12} />
                  </button>
                </div>
              ))
            ) : (
              <p className="text-xs leading-5 text-neutral-500">
                {t("Selecciona texto del informe para subrayarlo.")}
              </p>
            )}
          </aside>
          <main
            ref={readerRef}
            data-testid="deep-research-reader-scroll"
            className="deep-research-reader-scroll min-w-0 flex-1 overflow-y-auto px-6 py-6"
          >
            {readerLoading ? (
              <div className="grid h-64 place-items-center text-sm text-neutral-500">
                {t("Cargando informe…")}
              </div>
            ) : error ? (
              <div className="mx-auto max-w-5xl">
                <ErrorNotice error={error} />
              </div>
            ) : (
              <article className="mx-auto max-w-5xl space-y-6">
                {fullImageHash && (
                  <figure className="deep-research-report-cover overflow-hidden rounded-xl border border-neutral-200 bg-neutral-100 dark:border-neutral-800 dark:bg-neutral-900">
                    <img
                      src={api.assetUrl(spaceId, fullImageHash)}
                      alt={t("Imagen del informe")}
                      className="max-h-[32rem] w-full object-cover"
                      data-testid="deep-research-report-image"
                    />
                    <figcaption className="px-3 py-2 text-[10px] uppercase tracking-wide text-neutral-500">
                      {t("Imagen del informe")}
                    </figcaption>
                  </figure>
                )}
                <ServerAudioPanel
                  speaking={speaking}
                  disabled={!plainReading(visibleMarkdown)}
                  onToggle={toggleSpeech}
                />
                <header>
                  <h1 className="text-3xl font-semibold leading-tight">
                    {valueText(
                      activeTranslation?.title ||
                        reportDraft.title ||
                        open.title,
                      "Informe",
                    )}
                  </h1>
                  <ServerReportTags entry={open} />
                  {!activeTranslation && Boolean(reportDraft.abstract) && (
                    <p className="mt-4 text-base leading-7 text-neutral-600 dark:text-neutral-400">
                      {valueText(reportDraft.abstract)}
                    </p>
                  )}
                </header>
                <div
                  ref={readerDocumentRef}
                  className="deep-research-reader-document"
                  data-testid="deep-research-reader-document"
                  style={{ fontSize }}
                >
                  {activeTranslation ? (
                    <MarkdownReader
                      value={translationMarkdown || markdown}
                      onNodusLink={(href) => {
                        const next = parseServerCitation(href);
                        if (!next) return false;
                        setCitation(next);
                        return true;
                      }}
                      assetBaseUrl={api.assetUrl(spaceId, "")}
                    />
                  ) : (
                    <DeepResearchDocument
                      draft={reportDraft}
                      showMatrix={false}
                      onNodusLink={(href) => {
                        const next = parseServerCitation(href);
                        if (!next) return false;
                        setCitation(next);
                        return true;
                      }}
                      imageBaseUrl={api.assetUrl(spaceId, "")}
                    />
                  )}
                </div>
              </article>
            )}
          </main>
          {showMatrix && (
            <aside
              className="deep-research-support-rail"
              data-testid="deep-research-matrix-rail"
            >
              <h2>{t("Matriz de trazabilidad")}</h2>
              <DeepResearchMatrix
                draft={reportDraft}
                onCitation={setCitation}
              />
            </aside>
          )}
          <div data-testid="deep-research-selection-actions">
            <ReaderSelectionActions
              ref={markActionsRef}
              targetRef={readerDocumentRef}
              scrollRef={readerRef}
              contextId={`deep-research:${valueText(open.id)}:${activeTranslation?.id || "source"}`}
              annotations={readerAnnotationsState}
              highlighterColor={highlighterColor}
              onCreateAnnotation={async (input) =>
                syncReaderAnnotation({
                  ...input,
                  color: input.color ?? highlighterColor,
                })
              }
              onUpdateComment={async (id, comment) => {
                const existing = readerAnnotationsState.find(
                  (entry) => entry.id === id,
                );
                await syncReaderAnnotation({
                  id,
                  kind: existing?.kind || "comment",
                  color: existing?.color,
                  quote: existing?.selectedText,
                  anchor: existing
                    ? {
                        startOffset: existing.startOffset,
                        endOffset: existing.endOffset,
                        selectedText: existing.selectedText,
                        prefix: existing.prefix,
                        suffix: existing.suffix,
                      }
                    : null,
                  comment,
                  content: comment,
                });
              }}
              onDeleteAnnotation={async (id) =>
                syncReaderAnnotation({
                  id,
                  deletedAt: new Date().toISOString(),
                })
              }
              onAnnotationError={(message) => setError(new Error(message))}
              onMarkChange={setHasReaderMark}
            />
          </div>
        </div>
        <FindInPage targetRef={readerRef} placement="reader" />
        {citation && (
          <ServerCitationModal
            spaceId={spaceId}
            target={citation}
            onClose={() => setCitation(null)}
          />
        )}
      </div>
    );

  return (
    <div
      className="deep-research-server-view flex h-full min-h-0 flex-col bg-white text-neutral-900 dark:bg-neutral-950 dark:text-neutral-100"
      data-testid="deep-research-view"
    >
      <SectionHeader
        icon="telescope"
        title={t("Deep Research")}
        subtitle={t(
          "Informes extensos guardados con sus fuentes y trazabilidad.",
        )}
        testId="deep-research-section-header"
        actions={
          <div className="flex items-center gap-2">
            <span
              className="deep-research-readonly-pill"
              data-testid="deep-research-published-count"
            >
              {tx("{n} informes", { n: published.length })}
            </span>
            <button
              className="btn btn-ghost h-8 gap-1.5 border border-neutral-300 text-xs dark:border-neutral-700"
              onClick={() => setShowTutorial((value) => !value)}
              data-testid="deep-research-tutorial-toggle"
            >
              <Icon name="help" size={13} />
              {showTutorial ? t("Ocultar tutorial") : t("Tutorial")}
            </button>
            <button
              className="btn btn-primary h-8 gap-1.5 text-xs"
              onClick={() => setComposerOpen((value) => !value)}
              data-testid="deep-research-new-private"
            >
              <Icon name="plus" size={12} />
              {t("Nuevo privado")}
            </button>
          </div>
        }
      />
      {showTutorial && <DeepResearchServerTutorial />}
      {composerOpen && (
        <form
          className="flex shrink-0 flex-wrap items-end gap-2 border-b border-indigo-200 bg-indigo-50 p-3 dark:border-indigo-900 dark:bg-indigo-950/25"
          onSubmit={(event) => void generatePrivateReport(event)}
          data-testid="deep-research-private-composer"
        >
          <label className="min-w-48 flex-1 text-xs text-indigo-900 dark:text-indigo-100">
            {t("Título")}
            <input
              className="input mt-1 w-full text-xs"
              value={composerTitle}
              onChange={(event) => setComposerTitle(event.target.value)}
              placeholder={t("Título opcional")}
            />
          </label>
          <label className="min-w-64 flex-[2] text-xs text-indigo-900 dark:text-indigo-100">
            {t("Objetivo")}
            <input
              className="input mt-1 w-full text-xs"
              value={composerObjective}
              onChange={(event) => setComposerObjective(event.target.value)}
              placeholder={t("Pregunta u objetivo de investigación")}
              required
            />
          </label>
          {generationJob ? (
            <button
              type="button"
              className="btn btn-ghost h-9 text-xs"
              onClick={() => void cancelPrivateGeneration()}
              data-testid="deep-research-private-cancel"
            >
              {t("Cancelar")}
            </button>
          ) : (
            <button
              className="btn btn-primary h-9 text-xs"
              disabled={!composerObjective.trim()}
            >
              {t("Generar borrador privado")}
            </button>
          )}
          <span className="w-full text-[11px] text-indigo-700/80 dark:text-indigo-300/80">
            {t(
              "Se usará el corpus publicado; el resultado se guarda solo en tu cuenta.",
            )}
          </span>
        </form>
      )}
      {jobHistory.length > 0 && (
        <section
          className="deep-research-private-jobs shrink-0 border-b border-neutral-200 bg-neutral-50 px-4 py-3 dark:border-neutral-800 dark:bg-neutral-950/40"
          data-testid="deep-research-private-jobs"
        >
          <div className="mb-2 flex items-center justify-between gap-2">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-neutral-500">
              {t("Cola e historial privados")}
            </h2>
            <button
              className="btn btn-ghost h-7 text-[11px]"
              onClick={() => void refreshPrivateJobs()}
            >
              {t("Actualizar")}
            </button>
          </div>
          <div className="flex flex-wrap gap-2">
            {jobHistory.slice(0, 12).map((job) => {
              const activeJob = ["queued", "running"].includes(job.status);
              const terminal = job.status === "completed";
              const label =
                job.status === "queued"
                  ? t("En cola")
                  : job.status === "running"
                    ? t("Procesando")
                    : job.status === "completed"
                      ? t("Completado")
                      : job.status === "cancelled"
                        ? t("Cancelado")
                        : t("Fallido");
              return (
                <article
                  key={job.id}
                  className="flex min-w-64 items-center gap-2 rounded-lg border border-neutral-200 bg-white px-2.5 py-2 text-xs dark:border-neutral-800 dark:bg-neutral-900"
                >
                  <span
                    className={`h-2 w-2 rounded-full ${activeJob ? "bg-indigo-500" : terminal ? "bg-emerald-500" : "bg-red-400"}`}
                  />
                  <span className="min-w-0 flex-1">
                    <strong className="block">
                      {tx("{status} · intento {n}", {
                        status: label,
                        n: job.attempt,
                      })}
                    </strong>
                    <small className="block truncate text-[10px] text-neutral-500">
                      {formatReportDate(job.updatedAt)}
                    </small>
                  </span>
                  {activeJob && (
                    <button
                      className="btn btn-ghost !px-2 !py-1 text-[10px]"
                      onClick={() => {
                        if (generationJob?.id === job.id)
                          void cancelPrivateGeneration();
                        else
                          void api
                            .cancelAIJob(job.id, csrfToken)
                            .then(() => refreshPrivateJobs());
                      }}
                      data-testid={`deep-research-job-cancel-${job.id}`}
                    >
                      {t("Cancelar")}
                    </button>
                  )}
                  {!activeJob && !terminal && (
                    <button
                      className="btn btn-ghost !px-2 !py-1 text-[10px]"
                      disabled={Boolean(generationJob)}
                      onClick={() => void retryPrivateJob(job)}
                      data-testid={`deep-research-job-retry-${job.id}`}
                    >
                      {t("Reintentar")}
                    </button>
                  )}
                </article>
              );
            })}
          </div>
        </section>
      )}
      <SectionToolbar testId="deep-research-gallery-toolbar">
        <div className="relative min-w-[14rem] max-w-md flex-1">
          <Icon
            name="search"
            size={14}
            className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-neutral-500"
          />
          <input
            className="input input-with-leading-icon w-full !py-1.5 text-sm"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t("Buscar informes…")}
            data-testid="deep-research-search"
          />
        </div>
        <select
          className="input !py-1.5 text-xs"
          value={readFilter}
          onChange={(event) =>
            setReadFilter(event.target.value as typeof readFilter)
          }
          aria-label={t("Filtrar por estado")}
        >
          <option value="all">{t("Leído + no leído")}</option>
          <option value="read">{t("Solo leído")}</option>
          <option value="unread">{t("Solo no leído")}</option>
        </select>
        <select
          className="input !py-1.5 text-xs"
          value={sort}
          onChange={(event) => setSort(event.target.value as typeof sort)}
          aria-label={t("Ordenar informes")}
        >
          <option value="recent">{t("Más recientes")}</option>
          <option value="oldest">{t("Más antiguos")}</option>
          <option value="title">{t("Por título (A–Z)")}</option>
        </select>
        <div
          className="flex overflow-hidden rounded-lg border border-neutral-300 dark:border-neutral-700"
          role="group"
          aria-label={t("Modo de vista")}
        >
          <button
            className={`px-2.5 py-1.5 text-xs ${viewMode === "grid" ? "bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-200" : "text-neutral-500 hover:bg-neutral-100 dark:hover:bg-neutral-900"}`}
            onClick={() => setViewMode("grid")}
            title={t("Vista mosaico")}
            aria-label={t("Vista mosaico")}
            aria-pressed={viewMode === "grid"}
          >
            <Icon name="grid" size={14} />
          </button>
          <button
            className={`px-2.5 py-1.5 text-xs ${viewMode === "list" ? "bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-200" : "text-neutral-500 hover:bg-neutral-100 dark:hover:bg-neutral-900"}`}
            onClick={() => setViewMode("list")}
            title={t("Vista lista")}
            aria-label={t("Vista lista")}
            aria-pressed={viewMode === "list"}
          >
            <Icon name="list" size={14} />
          </button>
        </div>
      </SectionToolbar>
      <div
        className="deep-research-gallery min-h-0 flex-1 overflow-auto p-4"
        data-testid="deep-research-gallery"
      >
        {error ? (
          <ErrorNotice error={error} />
        ) : filtered.length === 0 ? (
          <div className="grid h-full place-items-center text-sm text-neutral-500">
            {t("No hay informes publicados.")}
          </div>
        ) : viewMode === "grid" ? (
          <div className="grid grid-cols-3 gap-4 max-2xl:grid-cols-2 max-lg:grid-cols-1">
            {filtered.map((entry, index) => {
              const src = imageUrl(entry);
              const privateEntry = entry.privateArtifact === true;
              return (
                <article
                  key={valueText(entry.id, String(index))}
                  data-testid="deep-research-gallery-card"
                  className="deep-research-gallery-card card group flex flex-col overflow-hidden p-0 transition-colors hover:border-indigo-700/60"
                >
                  <button
                    className="relative block h-40 w-full overflow-hidden bg-gradient-to-br from-indigo-950/30 to-neutral-900"
                    onClick={() => openReport(entry)}
                    title={t("Abrir informe")}
                  >
                    {src ? (
                      <img
                        src={src}
                        alt={t("Imagen del informe")}
                        className="absolute inset-0 h-full w-full object-cover"
                      />
                    ) : (
                      <span className="absolute inset-0 grid place-items-center text-neutral-500">
                        <Icon name="compass" size={30} />
                      </span>
                    )}
                    {privateEntry && (
                      <span className="absolute left-2 top-2 rounded-full bg-teal-100/90 px-2 py-1 text-[10px] text-teal-700 dark:bg-teal-950/85 dark:text-teal-300">
                        {t("Privado")}
                      </span>
                    )}
                    {isRead(entry) && (
                      <span className="deep-research-read-pill absolute right-2 top-2 rounded-full bg-emerald-100/90 px-2 py-1 text-[10px] text-emerald-700 dark:bg-emerald-950/85 dark:text-emerald-300">
                        {t("Leído")}
                      </span>
                    )}
                  </button>
                  <div className="flex flex-1 flex-col p-3">
                    <button
                      className="text-left"
                      onClick={() => openReport(entry)}
                    >
                      <h2 className="line-clamp-2 text-sm font-medium text-neutral-900 dark:text-neutral-200">
                        {valueText(entry.title, "Informe")}
                      </h2>
                    </button>
                    <div className="mt-1 flex items-center gap-1.5 text-[11px] text-neutral-500">
                      <Icon name="clock" size={11} />
                      {formatReportDate(entry.updated_at || entry.created_at)}
                    </div>
                    <ServerReportTags entry={entry} />
                    <p className="mt-2 line-clamp-2 text-xs text-neutral-500">
                      {valueText(entry.objective, t("Informe publicado"))}
                    </p>
                    <div className="mt-auto flex items-center gap-2 pt-3">
                      <button
                        className="btn btn-primary !py-1 gap-1 text-xs"
                        onClick={() => openReport(entry)}
                      >
                        <Icon name="book" size={12} /> {t("Leer")}
                      </button>
                      <span className="deep-research-vault-tag">
                        {privateEntry
                          ? t("Privado para ti")
                          : t("Vault publicado")}
                      </span>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        ) : (
          <div className="space-y-2">
            {filtered.map((entry, index) => {
              const src = imageUrl(entry);
              const privateEntry = entry.privateArtifact === true;
              return (
                <button
                  key={valueText(entry.id, String(index))}
                  data-testid="deep-research-gallery-card"
                  className="deep-research-gallery-card card flex w-full items-center gap-3 p-2.5 text-left hover:border-indigo-700/60"
                  onClick={() => openReport(entry)}
                >
                  <span className="relative h-14 w-24 shrink-0 overflow-hidden rounded-md bg-gradient-to-br from-indigo-950/30 to-neutral-900">
                    {src ? (
                      <img
                        src={src}
                        alt={t("Imagen del informe")}
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      <span className="grid h-full place-items-center">
                        <Icon name="compass" size={16} />
                      </span>
                    )}
                  </span>
                  <span className="min-w-0 flex-1">
                    <strong className="block truncate text-sm text-neutral-900 dark:text-neutral-200">
                      {valueText(entry.title, "Informe")}
                    </strong>
                    <small className="mt-1 block truncate text-neutral-500">
                      {valueText(entry.objective, t("Informe publicado"))}
                    </small>
                    <ServerReportTags entry={entry} />
                  </span>
                  {isRead(entry) && (
                    <span className="deep-research-read-pill hidden sm:inline">
                      {t("Leído")}
                    </span>
                  )}
                  <span className="deep-research-vault-tag hidden sm:inline">
                    {privateEntry ? t("Privado para ti") : t("Vault publicado")}
                  </span>
                  <Icon
                    name="chevronRight"
                    size={14}
                    className="text-neutral-400"
                  />
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
