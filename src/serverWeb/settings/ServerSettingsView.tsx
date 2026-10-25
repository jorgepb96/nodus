import {
  cloneElement,
  isValidElement,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useState,
  type FormEvent,
  type ReactElement,
  type ReactNode,
} from "react";
import { AI_PROVIDERS, PROVIDER_LABELS } from "@shared/providers";
import type { AppLanguage, CustomAppTheme } from "@shared/types";
import { APP_THEME_IDS } from "@shared/appThemes";
import { contrast, deriveThemeTokens, THEMES } from "../../theme/themes.mjs";
import { Icon } from "../../components/ui";
import { ThemeColourPicker } from "../../components/ThemeColourPicker";
import { api, ApiError } from "../api";
import { setActiveLang, t, tx } from "../i18nShim";
import { SERVER_MODEL_CATALOG } from "../modelCatalog";
import type {
  AIPreferences,
  AIProviderStatus,
  MeResponse,
  PortableModelRef,
  PortableProfileValues,
  ServerAdminOverview,
  ServerUserProfile,
} from "../types";
import "./ServerSettings.css";

export type TabId =
  | "providers"
  | "models"
  | "library"
  | "extraction"
  | "interface"
  | "integrations"
  | "browser"
  | "server"
  | "system"
  | "data"
  | "about"
  | "updates";

const TABS: Array<{
  id: TabId;
  label: string;
  icon: string;
  keywords: string;
}> = [
  {
    id: "server",
    label: "Servidor",
    icon: "globe",
    keywords: "server vault usuarios dispositivos cuenta administración",
  },
  {
    id: "providers",
    label: "Proveedores",
    icon: "key",
    keywords:
      "api claves modelos favoritos openai anthropic gemini codex local",
  },
  {
    id: "models",
    label: "Modelos IA",
    icon: "wand",
    keywords:
      "modelo extracción síntesis resumen asistente investigación escritura",
  },
  {
    id: "library",
    label: "Biblioteca",
    icon: "book",
    keywords: "zotero publicación documentos sincronización",
  },
  {
    id: "extraction",
    label: "Texto y OCR",
    icon: "search",
    keywords: "pdf texto ocr tesseract extracción",
  },
  {
    id: "interface",
    label: "Interfaz",
    icon: "palette",
    keywords: "idioma tema claro oscuro accesibilidad escala contraste",
  },
  {
    id: "integrations",
    label: "Integraciones",
    icon: "link",
    keywords: "mcp chatgpt claude oauth connected vault",
  },
  {
    id: "browser",
    label: "Nodus Browser",
    icon: "compass",
    keywords: "browser navegador extensión chrome",
  },
  {
    id: "system",
    label: "Tutoriales",
    icon: "graduation",
    keywords: "tutorial ayuda aprender",
  },
  {
    id: "data",
    label: "Copia de seguridad",
    icon: "download",
    keywords: "backup copia seguridad recuperar exportar",
  },
  {
    id: "about",
    label: "Acerca de",
    icon: "info",
    keywords: "versión licencia privacidad nodus research",
  },
  {
    id: "updates",
    label: "Actualizaciones",
    icon: "sync",
    keywords: "actualizar novedades versión",
  },
];

const MODEL_TASKS: Array<{ id: string; label: string }> = [
  { id: "extraction", label: "Extracción" },
  { id: "vision", label: "Visión" },
  { id: "synthesis", label: "Síntesis general" },
  { id: "summary", label: "Resúmenes" },
  { id: "documentProfile", label: "Perfil documental" },
  { id: "documentAudit", label: "Auditoría documental" },
  { id: "fusion", label: "Fusión" },
  { id: "assistant", label: "Asistente" },
  { id: "nodi", label: "Nodi" },
  { id: "deepResearch", label: "Deep Research" },
  { id: "immersion", label: "Inmersión" },
  { id: "writing", label: "Nodus Scriptor" },
  { id: "argumentMap", label: "Mapa de argumentos" },
  { id: "author", label: "Autores" },
  { id: "dictionary", label: "Diccionario" },
  { id: "study", label: "Estudio" },
  { id: "tutor", label: "Tutor" },
  { id: "hypothesis", label: "Hipótesis" },
  { id: "improve", label: "Mejorar texto" },
  { id: "questions", label: "Preguntas" },
  { id: "grading", label: "Calificación" },
  { id: "flashcards", label: "Tarjetas" },
  { id: "transcription", label: "Transcripción" },
];

const LANGUAGE_LABELS: Record<string, string> = {
  es: "Español",
  en: "English",
  fr: "Français",
  de: "Deutsch",
  pt: "Português",
  "pt-BR": "Português (Brasil)",
  it: "Italiano",
  tr: "Türkçe",
  "zh-CN": "简体中文",
  "zh-TW": "繁體中文",
  ja: "日本語",
  ko: "한국어",
};
const SERVER_EXECUTION_PROVIDERS = new Set([
  "openai",
  "openrouter",
  "anthropic",
  "gemini",
  "mistral",
  "cohere",
]);

const HEX_COLOUR = /^#[0-9a-f]{6}$/i;

function normalizeThemeColour(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  return HEX_COLOUR.test(normalized) ? normalized : null;
}

const emptyThemeDraft = (): Omit<CustomAppTheme, "id"> => ({
  label: "", accent: "#6366f1", deep: "#1e1b4b", pale: "#eef2ff",
  appBackground: { light: "#f8fafc", dark: "#080a12" },
  lightText: "#171717", darkText: "#f5f5f5", tint: 0.05,
});
const themeDraftFrom = (theme?: CustomAppTheme): Omit<CustomAppTheme, "id"> => {
  const defaults = emptyThemeDraft();
  if (!theme) return defaults;
  return {
    label: theme.label,
    accent: normalizeThemeColour(theme.accent) ?? defaults.accent,
    deep: normalizeThemeColour(theme.deep) ?? defaults.deep,
    pale: normalizeThemeColour(theme.pale) ?? defaults.pale,
    appBackground: {
      light: normalizeThemeColour(theme.appBackground?.light) ?? defaults.appBackground.light,
      dark: normalizeThemeColour(theme.appBackground?.dark) ?? defaults.appBackground.dark,
    },
    lightText: normalizeThemeColour(theme.lightText) ?? defaults.lightText,
    darkText: normalizeThemeColour(theme.darkText) ?? defaults.darkText,
    tint: Number.isFinite(theme.tint) ? theme.tint : defaults.tint,
  };
};
const themeSlug = (label: string) => `custom-${label.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "theme"}`;

export function blankProfile(
  theme: "dark" | "light",
  preferences: AIPreferences = {},
): PortableProfileValues {
  // A new Desktop profile starts without an invented provider/model. Preserve a
  // legacy Server AI preference when one exists, but do not make OpenAI look chosen
  // merely because this account has never saved the portable profile before.
  const preferred = preferences.defaultProvider;
  const preferredModel = preferred
    ? preferences.chatModels?.[preferred]
    : undefined;
  const assistant: PortableModelRef | null =
    preferred && preferredModel
      ? { provider: preferred, model: preferredModel }
      : null;
  return {
    schemaVersion: 1,
    appearance: {
      theme,
      appTheme: "default",
      customThemes: [],
      uiLanguage: "en",
      promptLanguage: "en",
      animationSpeed: 1,
      interfaceScale: 1,
      accessibleFont: false,
      highContrast: false,
      reduceMotion: false,
      readingFocusMode: false,
      mascot: {
        enabled: true,
        scale: 1,
        vaultCostumes: true,
        style: "classic",
        orbColorMode: "auto",
        orbColor: "#6366f1",
      },
    },
    ai: {
      favorites: preferences.favorites || (assistant ? [assistant] : []),
      modelSettingsMode: preferences.modelSettingsMode || "basic",
      modelSettingsVersion: 0,
      models: Object.fromEntries(
        MODEL_TASKS.map(({ id }) => [
          id,
          preferences.featureModels?.[id] ||
            (id === "assistant" || id === "synthesis" ? assistant : null),
        ]),
      ),
      pendingAssignments: [],
      chatReasoning: "medium",
      codexReasoningEfforts: {},
      preferFastOpenRouter: true,
      providerFreeTier: {},
      image: {
        provider: "google",
        model: "gemini-3.1-flash-lite-image",
        quality: "balanced",
        style: "antique_book",
      },
      audio: { provider: "ming", voice: "", speed: 1 },
      studyPolicy: {
        enabled: true,
        privacyMode: "hybrid",
        confirmExternal: true,
        monthlyBudgetUsd: 0,
        budgetWarningPercent: 80,
        maxInputChars: 120000,
        maxOutputTokens: 4000,
        temperature: 0.15,
        retryCount: 1,
        studentPseudonyms: true,
      },
    },
    workspace: {
      sidebarOrder: [],
      sidebarHidden: [],
      sidebarCustomized: false,
      scriptorSidebarVersion: 1,
      toolkitPinnedPages: [],
      aiConcurrencyMode: "automatic",
      aiConcurrencyVersion: 1,
      concurrency: 2,
      deepContextMode: "standard",
      standardChunkWords: 1800,
      longChunkWords: 30000,
    },
  };
}

// Desktop treats a favourite as the provider/model pair. Reasoning belongs to the
// task selection, not to a second copy of the same favourite model.
function modelKey(model: PortableModelRef): string {
  return `${model.provider}::${model.model}`;
}
function sameModel(a: PortableModelRef, b: PortableModelRef): boolean {
  return a.provider === b.provider && a.model === b.model;
}
function providerLabel(provider: string): string {
  return (PROVIDER_LABELS as Record<string, string>)[provider] || provider;
}
const GRANULAR_PROFILE_TASKS = MODEL_TASKS.map(({ id }) => id).filter(
  (id) => id !== "synthesis",
);

/** Desktop's basic mode is an actual routing mode, not merely a collapsed form.
 * Keep the same invariant in the portable profile so a preference edited in Web
 * has the same effect when pulled back into Desktop. Pending local assignments
 * stay unresolved and are never replaced by a paid Server model. */
function profileForModelMode(
  profile: PortableProfileValues,
  mode: "basic" | "advanced",
): PortableProfileValues {
  const next = structuredClone(profile);
  next.ai.modelSettingsMode = mode;
  const general =
    next.ai.models.synthesis ||
    next.ai.models.assistant ||
    next.ai.favorites[0] ||
    null;
  if (mode === "basic" && general) {
    for (const task of GRANULAR_PROFILE_TASKS) {
      if (!next.ai.pendingAssignments.includes(task))
        next.ai.models[task] = general;
    }
  } else if (mode === "advanced" && next.ai.models.synthesis) {
    for (const task of GRANULAR_PROFILE_TASKS) {
      if (!next.ai.pendingAssignments.includes(task) && !next.ai.models[task])
        next.ai.models[task] = next.ai.models.synthesis;
    }
  }
  return next;
}

function modelCandidatesForProvider(
  profile: PortableProfileValues,
  provider: string,
  liveCatalog?: string[],
): PortableModelRef[] {
  const catalog = liveCatalog?.length
    ? liveCatalog
    : SERVER_MODEL_CATALOG[provider] || [];
  const current = Object.values(profile.ai.models).filter(
    (entry): entry is PortableModelRef => entry?.provider === provider,
  );
  const favorites = profile.ai.favorites.filter(
    (entry) => entry.provider === provider,
  );
  return [
    ...new Map(
      [
        ...favorites,
        ...current,
        ...catalog.map((model) => ({ provider, model })),
      ].map((entry) => [modelKey(entry), entry]),
    ).values(),
  ];
}
function errorMessage(error: unknown): string {
  if (error instanceof ApiError) return t(error.message);
  return error instanceof Error
    ? t(error.message)
    : t(String(error || "No se ha podido completar la operación."));
}

function translateSettingsNode(node: ReactNode): ReactNode {
  if (typeof node === "string") return t(node);
  if (Array.isArray(node)) return node.map(translateSettingsNode);
  if (!isValidElement(node)) return node;
  const element = node as ReactElement<Record<string, unknown>>;
  const translated: Record<string, unknown> = {};
  for (const key of ["placeholder", "title", "aria-label"]) {
    if (typeof element.props[key] === "string")
      translated[key] = t(element.props[key] as string);
  }
  if ("children" in element.props)
    translated.children = translateSettingsNode(
      element.props.children as ReactNode,
    );
  return cloneElement(element, translated);
}

function Section({
  title,
  description,
  help,
  children,
  testId,
  focusId,
}: {
  title: string;
  description?: string;
  help?: string;
  children: React.ReactNode;
  testId?: string;
  focusId?: string;
}) {
  const [helpOpen, setHelpOpen] = useState(false);
  const helpId = useId();
  const helpLabel = tx("Ayuda sobre {section}", { section: t(title) });
  return (
    <section
      className="ss-card"
      data-testid={testId}
      id={focusId}
      tabIndex={focusId ? -1 : undefined}
    >
      <header className="ss-section-head">
        <div className="ss-section-title-line">
          <h2>{t(title)}</h2>
          {help && (
            <button
              type="button"
              className="ss-help-button"
              aria-label={helpLabel}
              title={helpLabel}
              aria-expanded={helpOpen}
              aria-controls={helpId}
              onClick={() => setHelpOpen((current) => !current)}
            >
              <Icon name="help" size={12} />
            </button>
          )}
        </div>
        {description && <p>{t(description)}</p>}
        {helpOpen && help && (
          <p className="ss-section-help" id={helpId} role="status">
            {t(help)}
          </p>
        )}
      </header>
      {translateSettingsNode(children)}
    </section>
  );
}

function Row({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="ss-row">
      <div>
        <strong>{t(label)}</strong>
        {hint && <p>{t(hint)}</p>}
      </div>
      <div className="ss-control">{children}</div>
    </div>
  );
}

function Switch({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={t(label)}
      className="ss-switch"
      data-on={checked}
      onClick={() => onChange(!checked)}
    >
      <span />
    </button>
  );
}

function ModelSelect({
  value,
  favorites,
  onChange,
  id,
}: {
  value: PortableModelRef | null;
  favorites: PortableModelRef[];
  onChange: (next: PortableModelRef) => void;
  id?: string;
}) {
  const candidates = useMemo(() => {
    // Desktop's native picker is a projection of the portable favorites list plus
    // the current value (so a retired/remote model never disappears silently).
    // Keep the Server picker on that same contract; the provider panel is where
    // a user adds a catalog model to the shared favorites list.
    const all: PortableModelRef[] = [...(value ? [value] : []), ...favorites];
    return [...new Map(all.map((entry) => [modelKey(entry), entry])).values()];
  }, [favorites, value]);
  const providers = [
    ...new Set([
      ...AI_PROVIDERS,
      "nodus",
      ...candidates.map((entry) => entry.provider),
    ]),
  ];
  const selected = value ? modelKey(value) : "";
  return (
    <select
      className="ss-select"
      value={selected}
      onChange={(event) => {
        const next = candidates.find(
          (entry) => modelKey(entry) === event.target.value,
        );
        if (next) onChange(next);
      }}
      data-testid={id}
    >
      {!value && <option value="">{t("Sin asignar")}</option>}
      {providers.map((provider) => {
        const models = candidates.filter(
          (entry) => entry.provider === provider,
        );
        return models.length ? (
          <optgroup key={provider} label={providerLabel(provider)}>
            {models.map((entry) => (
              <option key={modelKey(entry)} value={modelKey(entry)}>
                {entry.model}
                {entry.reasoningEffort ? ` · ${entry.reasoningEffort}` : ""}
                {entry.pending ? ` · ${t("pendiente")}` : ""}
              </option>
            ))}
          </optgroup>
        ) : null;
      })}
    </select>
  );
}

export type ServerSettingsViewProps = {
  csrfToken?: string;
  isAdmin: boolean;
  theme: "dark" | "light";
  initialTab?: TabId;
  onThemeChange?: (theme: "dark" | "light") => void;
  onAppThemeChange?: (appTheme: string) => void;
  onLanguageChange?: (language: AppLanguage) => void;
};

export function ServerSettingsView({
  csrfToken,
  isAdmin,
  theme,
  initialTab,
  onThemeChange,
  onAppThemeChange,
  onLanguageChange,
}: ServerSettingsViewProps) {
  const requested =
    initialTab || new URLSearchParams(location.search).get("tab") || "server";
  const requestedFocus = new URLSearchParams(location.search).get("focus");
  const [tab, setTab] = useState<TabId>(
    TABS.some((entry) => entry.id === requested)
      ? (requested as TabId)
      : "server",
  );
  const [query, setQuery] = useState("");
  const [me, setMe] = useState<MeResponse>();
  const [providers, setProviders] = useState<AIProviderStatus[]>([]);
  const [credentialsAvailable, setCredentialsAvailable] = useState(true);
  const [profileMeta, setProfileMeta] = useState<ServerUserProfile>();
  // Render the Settings shell immediately. The persisted profile and the
  // optional legacy AI preferences are hydrated independently below; neither
  // should be able to strand the whole Settings view on a loading screen.
  const [profile, setProfile] = useState<PortableProfileValues>(() =>
    blankProfile(theme),
  );
  const [themeEditorOpen, setThemeEditorOpen] = useState(false);
  const [editingThemeId, setEditingThemeId] = useState<string | null>(null);
  const [themeDraft, setThemeDraft] = useState<Omit<CustomAppTheme, "id">>(emptyThemeDraft);
  const [themeError, setThemeError] = useState<string | null>(null);
  const [admin, setAdmin] = useState<ServerAdminOverview>();
  const [expandedProvider, setExpandedProvider] = useState<string | null>(null);
  const [providerModelQuery, setProviderModelQuery] = useState("");
  const [liveModelCatalogs, setLiveModelCatalogs] = useState<
    Record<string, string[]>
  >({});
  const [modelCatalogState, setModelCatalogState] = useState<
    Record<string, "loading" | "live" | "fallback">
  >({});
  const [keys, setKeys] = useState<Record<string, string>>({});
  const [newSpace, setNewSpace] = useState({
    name: "",
    description: "",
    vaultType: "academic",
  });
  const [newUser, setNewUser] = useState({
    email: "",
    password: "",
    spaceId: "",
    role: "reader",
  });
  const [pairing, setPairing] = useState<{ code: string; expiresAt: string }>();
  const [passwords, setPasswords] = useState({
    currentPassword: "",
    newPassword: "",
    confirmPassword: "",
  });
  const [busy, setBusy] = useState("");
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  const load = useCallback(() => {
    setError("");
    void api
      .me()
      .then(setMe)
      .catch((next) => setError((prev) => prev || errorMessage(next)));

    // Server AI is optional in basic deployments, so a stalled/unavailable
    // legacy endpoint must not block Settings from loading. It is only
    // consulted below, to seed a brand-new profile from an existing legacy
    // selection.
    const legacyAiPreferences = api.aiPreferences().catch(() => undefined);

    // The portable profile is authoritative when it exists. A new account
    // starts from a blank profile seeded with any legacy Server AI
    // preference, recomputed on every load so a theme correction that
    // arrives after mount (or after the legacy fetch resolves) is not lost.
    void api
      .profilePreferences()
      .then(async (profileResponse) => {
        setProfileMeta(profileResponse.profile);
        if (profileResponse.profile.values) {
          setProfile(profileResponse.profile.values);
        } else {
          const legacy = await legacyAiPreferences;
          setProfile(blankProfile(theme, legacy?.preferences));
        }
      })
      .catch((next) => setError((prev) => prev || errorMessage(next)));

    if (isAdmin)
      void api
        .adminOverview()
        .then(setAdmin)
        .catch(() => undefined);

    // Provider metadata is only needed by the provider panel. An unavailable
    // keyring must not block navigation to the other Settings sections.
    void api
      .aiProviders()
      .then((providerResponse) => {
        setProviders(providerResponse.providers);
        setCredentialsAvailable(providerResponse.credentialsAvailable);
      })
      .catch(() => undefined);
  }, [isAdmin, theme]);

  useEffect(() => {
    void load();
  }, [load]);

  // Settings tabs are real deep links in Server. Keep the selected panel in
  // sync when the user uses browser Back/Forward (Desktop keeps this state in
  // the native view; the web shell must mirror the URL explicitly).
  useEffect(() => {
    const onPopState = () => {
      const next = new URLSearchParams(location.search).get("tab") || "server";
      if (TABS.some((entry) => entry.id === next)) setTab(next as TabId);
      setQuery("");
    };
    addEventListener("popstate", onPopState);
    return () => removeEventListener("popstate", onPopState);
  }, []);

  useEffect(() => {
    if (tab !== "server" || !requestedFocus || !profile) return undefined;
    const frame = requestAnimationFrame(() => {
      const section = document.getElementById(`server-${requestedFocus}`);
      if (!section) return;
      const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
      section.scrollIntoView({
        behavior: reduceMotion ? "auto" : "smooth",
        block: "start",
      });
      section.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(frame);
  }, [profile, requestedFocus, tab]);

  const selectTab = (next: TabId) => {
    setTab(next);
    setQuery("");
    history.pushState({}, "", `/view/settings?tab=${next}`);
  };

  const saveProfile = async (
    next = profile,
    message = t("Preferencias guardadas para todos tus vaults y dispositivos."),
  ): Promise<boolean> => {
    if (!next) return false;
    next = profileForModelMode(next, next.ai.modelSettingsMode);
    setBusy("profile");
    setError("");
    setNotice("");
    try {
      const result = await api.updateProfilePreferences(next, csrfToken);
      const saved = result.profile.values || next;
      setProfileMeta(result.profile);
      setProfile(saved);
      setNotice(message);
      // The portable profile is authoritative across Desktop and Web. Apply its
      // theme immediately after an explicit save, including the system option,
      // instead of leaving the shell in the previous mode until a reload.
      const savedTheme = saved.appearance.theme;
      onThemeChange?.(
        savedTheme === "system"
          ? matchMedia("(prefers-color-scheme: dark)").matches
            ? "dark"
            : "light"
          : savedTheme,
      );
      onAppThemeChange?.(saved.appearance.appTheme || "default");
      dispatchEvent(
        new CustomEvent("nodus-profile-updated", { detail: saved }),
      );
      return true;
    } catch (nextError) {
      setError(errorMessage(nextError));
      return false;
    } finally {
      setBusy("");
    }
  };

  const changeProfile = (mutator: (draft: PortableProfileValues) => void) => {
    setProfile((current) => {
      if (!current) return current;
      const next = structuredClone(current);
      mutator(next);
      return next;
    });
  };

  const openThemeEditor = (theme?: CustomAppTheme) => {
    setEditingThemeId(theme?.id ?? null);
    setThemeDraft(themeDraftFrom(theme));
    setThemeError(null);
    setThemeEditorOpen(true);
  };

  const saveCustomTheme = async () => {
    if (!profile) return;
    const label = themeDraft.label.trim();
    if (!label) return setThemeError(t("Escribe un nombre para el tema."));
    const accent = normalizeThemeColour(themeDraft.accent);
    const deep = normalizeThemeColour(themeDraft.deep);
    const pale = normalizeThemeColour(themeDraft.pale);
    const appBackgroundLight = normalizeThemeColour(themeDraft.appBackground.light);
    const appBackgroundDark = normalizeThemeColour(themeDraft.appBackground.dark);
    const lightText = normalizeThemeColour(themeDraft.lightText);
    const darkText = normalizeThemeColour(themeDraft.darkText);
    if (!accent || !deep || !pale || !appBackgroundLight || !appBackgroundDark || !lightText || !darkText) {
      return setThemeError(t("Usa colores hexadecimales completos, por ejemplo #6366f1."));
    }
    const id = editingThemeId ?? themeSlug(label);
    const customThemes = profile.appearance.customThemes ?? [];
    if (customThemes.some((theme) => theme.id !== editingThemeId && theme.id === id)) {
      return setThemeError(t("Ya existe un tema con ese nombre."));
    }
    const normalizedDraft = {
      ...themeDraft,
      label,
      accent,
      deep,
      pale,
      appBackground: { light: appBackgroundLight, dark: appBackgroundDark },
      lightText,
      darkText,
    };
    const tokens = deriveThemeTokens({ anchors: normalizedDraft });
    if (contrast(tokens.text.dark, tokens.n[950]) < 4.5 || contrast(tokens.text.light, tokens.n[50]) < 4.5 || contrast(tokens.text.dark, tokens.appBackground.dark) < 4.5 || contrast(tokens.text.light, tokens.appBackground.light) < 4.5 || contrast(tokens.a.light[300], "#ffffff") < 4.5 || contrast(tokens.a.dark[300], tokens.n[950]) < 4.5) {
      return setThemeError(t("Ajusta los colores para alcanzar el contraste mínimo de lectura."));
    }
    const next = structuredClone(profile);
    const savedTheme: CustomAppTheme = { id, ...normalizedDraft };
    next.appearance.customThemes = customThemes.some((theme) => theme.id === id)
      ? customThemes.map((theme) => theme.id === id ? savedTheme : theme)
      : [...customThemes, savedTheme];
    next.appearance.appTheme = id;
    if (!await saveProfile(next)) return;
    setThemeEditorOpen(false);
    setEditingThemeId(null);
    setThemeError(null);
  };

  const deleteCustomTheme = async (id: string) => {
    if (!profile) return;
    const next = structuredClone(profile);
    next.appearance.customThemes = (next.appearance.customThemes ?? []).filter((theme) => theme.id !== id);
    if (next.appearance.appTheme === id) next.appearance.appTheme = "default";
    if (!await saveProfile(next)) return;
    if (editingThemeId === id) setThemeEditorOpen(false);
  };

  const toggleFavorite = async (model: PortableModelRef) => {
    if (!profile) return;
    const next = structuredClone(profile);
    next.ai.favorites = next.ai.favorites.some((entry) =>
      sameModel(entry, model),
    )
      ? next.ai.favorites.filter((entry) => !sameModel(entry, model))
      : [...next.ai.favorites, model];
    setProfile(next);
    await saveProfile(
      next,
      t("Modelos favoritos actualizados transversalmente."),
    );
  };

  const saveCredential = async (provider: string, event: FormEvent) => {
    event.preventDefault();
    const key = keys[provider]?.trim();
    if (!key) return;
    setBusy(provider);
    setError("");
    setNotice("");
    try {
      await api.saveAICredential(provider, key, csrfToken);
      setKeys((current) => ({ ...current, [provider]: "" }));
      setLiveModelCatalogs((current) => {
        const next = { ...current };
        delete next[provider];
        return next;
      });
      setModelCatalogState((current) => {
        const next = { ...current };
        delete next[provider];
        return next;
      });
      setNotice(`${providerLabel(provider)}: ${t("Credencial guardada.")}`);
      await load();
    } catch (next) {
      setError(errorMessage(next));
    } finally {
      setBusy("");
    }
  };

  const removeCredential = async (provider: string) => {
    setBusy(provider);
    setError("");
    try {
      await api.removeAICredential(provider, csrfToken);
      setLiveModelCatalogs((current) => {
        const next = { ...current };
        delete next[provider];
        return next;
      });
      setModelCatalogState((current) => ({
        ...current,
        [provider]: "fallback",
      }));
      setNotice(`${providerLabel(provider)}: ${t("Credencial eliminada.")}`);
      await load();
    } catch (next) {
      setError(errorMessage(next));
    } finally {
      setBusy("");
    }
  };

  const adminCsrf = admin?.csrfToken || csrfToken;
  const runAdmin = async (
    operation: () => Promise<unknown>,
    success: string,
  ) => {
    setBusy("admin");
    setError("");
    setNotice("");
    try {
      await operation();
      setNotice(success);
      if (isAdmin) setAdmin(await api.adminOverview());
      else setMe(await api.me());
    } catch (next) {
      setError(errorMessage(next));
    } finally {
      setBusy("");
    }
  };

  const createSpace = async (event: FormEvent) => {
    event.preventDefault();
    setBusy("admin");
    setError("");
    setNotice("");
    try {
      const result = await api.createVault(
        { ...newSpace, storageKind: "server_native", authority: "server" },
        adminCsrf,
      );
      setNotice(t("Vault nativo creado y listo para usar."));
      setNewSpace({ name: "", description: "", vaultType: "academic" });
      if (isAdmin) setAdmin(await api.adminOverview());
      setMe(await api.me());
      dispatchEvent(
        new CustomEvent("nodus-vaults-updated", {
          detail: { activeId: result.vault.id },
        }),
      );
    } catch (next) {
      setError(errorMessage(next));
    } finally {
      setBusy("");
    }
  };

  const createUser = async (event: FormEvent) => {
    event.preventDefault();
    const memberships = newUser.spaceId
      ? [{ spaceId: newUser.spaceId, role: newUser.role }]
      : [];
    await runAdmin(
      () =>
        api.createAdminUser(
          { email: newUser.email, password: newUser.password, memberships },
          adminCsrf,
        ),
      t("Cuenta creada y permisos aplicados."),
    );
    setNewUser({ email: "", password: "", spaceId: "", role: "reader" });
  };

  const changePassword = async (event: FormEvent) => {
    event.preventDefault();
    if (passwords.newPassword !== passwords.confirmPassword) {
      setError(t("Las contraseñas nuevas no coinciden."));
      return;
    }
    await runAdmin(
      () => api.changeAccountPassword(passwords, adminCsrf),
      t("Contraseña actualizada. Las demás sesiones se han cerrado."),
    );
    setPasswords({ currentPassword: "", newPassword: "", confirmPassword: "" });
  };

  const providerStatus = useMemo(
    () => new Map(providers.map((entry) => [entry.provider, entry])),
    [providers],
  );
  useEffect(() => {
    const provider = expandedProvider;
    if (!provider || liveModelCatalogs[provider] || modelCatalogState[provider])
      return;
    const configured = providerStatus.get(provider)?.configured;
    if (provider !== "openrouter" && !configured) {
      setModelCatalogState((current) =>
        current[provider] ? current : { ...current, [provider]: "fallback" },
      );
      return;
    }
    let cancelled = false;
    setModelCatalogState((current) => ({ ...current, [provider]: "loading" }));
    api
      .aiProviderModels(provider)
      .then((response) => {
        if (cancelled) return;
        const ids = [
          ...new Set(
            (response.models || [])
              .map((entry) => entry.id?.trim())
              .filter((entry): entry is string => Boolean(entry)),
          ),
        ];
        if (ids.length)
          setLiveModelCatalogs((current) => ({ ...current, [provider]: ids }));
        setModelCatalogState((current) => ({
          ...current,
          [provider]: ids.length ? "live" : "fallback",
        }));
      })
      .catch(() => {
        if (!cancelled)
          setModelCatalogState((current) => ({
            ...current,
            [provider]: "fallback",
          }));
      });
    return () => {
      cancelled = true;
    };
  }, [expandedProvider, liveModelCatalogs, modelCatalogState, providerStatus]);
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const visibleTabs = normalizedQuery
    ? TABS.filter((entry) =>
        `${entry.label} ${t(entry.label)} ${entry.keywords}`
          .toLocaleLowerCase()
          .includes(normalizedQuery),
      )
    : TABS.filter((entry) => entry.id === tab);
  if (!profile)
    return (
      <div className="server-settings-native ss-loading">
        {t("Cargando ajustes…")}
      </div>
    );

  const providersPanel = (
    <Section
      title="Proveedores de IA y modelos"
      description="Las claves y los modelos configurados se comparten entre todas tus bóvedas. Las credenciales siguen siendo privadas de esta cuenta."
      testId="server-native-providers"
    >
      {!credentialsAvailable && (
        <div className="ss-warning">
          El operador debe configurar la keyring cifrada del servidor para
          guardar credenciales.
        </div>
      )}
      <div className="ss-favorites">
        <span>Modelos favoritos para los selectores independientes</span>
        <div>
          {profile.ai.favorites.map((model) => (
            <span className="ss-chip" key={modelKey(model)}>
              <Icon name="star" size={12} />
              {providerLabel(model.provider)} · {model.model}
              <button
                type="button"
                aria-label={tx("Quitar {provider} · {model} de favoritos", {
                  provider: providerLabel(model.provider),
                  model: model.model,
                })}
                onClick={() => void toggleFavorite(model)}
              >
                <Icon name="x" size={10} />
              </button>
            </span>
          ))}
        </div>
        {profile.ai.favorites.length === 0 && (
          <p className="ss-muted">
            Abre un proveedor y marca con una estrella los modelos que quieras
            usar en los selectores.
          </p>
        )}
      </div>
      <div className="ss-provider-list">
        {AI_PROVIDERS.map((provider) => {
          const status = providerStatus.get(provider);
          const expanded = expandedProvider === provider;
          const canExecute = SERVER_EXECUTION_PROVIDERS.has(provider);
          const candidates = modelCandidatesForProvider(
            profile,
            provider,
            liveModelCatalogs[provider],
          );
          const normalizedModelQuery = expanded
            ? providerModelQuery.trim().toLocaleLowerCase()
            : "";
          const visibleModels = candidates.filter(
            (entry) =>
              !normalizedModelQuery ||
              entry.model.toLocaleLowerCase().includes(normalizedModelQuery),
          );
          return (
            <article
              className="ss-provider"
              key={provider}
              data-expanded={expanded}
            >
              <button
                type="button"
                className="ss-provider-summary"
                onClick={() => {
                  setExpandedProvider(expanded ? null : provider);
                  setProviderModelQuery("");
                }}
              >
                <span className="ss-provider-mark">
                  {providerLabel(provider).slice(0, 1)}
                </span>
                <span>
                  <strong>{providerLabel(provider)}</strong>
                  <small className={status?.configured ? "is-ready" : ""}>
                    {status?.configured
                      ? "Configurado en Server"
                      : canExecute
                        ? "Sin credencial en Server"
                        : "Disponible mediante Desktop"}
                  </small>
                </span>
                <Icon
                  name={expanded ? "chevronDown" : "chevronRight"}
                  size={15}
                />
              </button>
              {expanded && (
                <div className="ss-provider-body">
                  {canExecute && (
                    <form
                      className="ss-credential"
                      onSubmit={(event) => void saveCredential(provider, event)}
                    >
                      <label>
                        Clave API
                        <input
                          type="password"
                          autoComplete="new-password"
                          value={keys[provider] || ""}
                          onChange={(event) =>
                            setKeys((current) => ({
                              ...current,
                              [provider]: event.target.value,
                            }))
                          }
                          placeholder={
                            status?.configured
                              ? t("Introducir una clave nueva para sustituirla")
                              : t("Clave API")
                          }
                          disabled={!credentialsAvailable}
                        />
                      </label>
                      <button
                        className="ss-button"
                        disabled={!keys[provider]?.trim() || busy === provider}
                      >
                        {busy === provider
                          ? "Guardando…"
                          : status?.configured
                            ? "Sustituir"
                            : "Guardar"}
                      </button>
                      {status?.configured && (
                        <button
                          className="ss-button secondary"
                          type="button"
                          onClick={() => void removeCredential(provider)}
                        >
                          Eliminar
                        </button>
                      )}
                    </form>
                  )}{" "}
                  {!canExecute && (
                    <p className="ss-muted">
                      Este proveedor requiere el runtime o la red local de Nodus
                      Desktop; sus favoritos se conservan, pero Server no
                      intenta ejecutarlo.
                    </p>
                  )}
                  <div
                    className="ss-model-catalog-status"
                    data-source={modelCatalogState[provider] || "fallback"}
                  >
                    {modelCatalogState[provider] === "loading"
                      ? "Actualizando catálogo…"
                      : modelCatalogState[provider] === "live"
                        ? "Catálogo en vivo del proveedor"
                        : "Catálogo compatible integrado"}
                  </div>
                  <label className="ss-model-search">
                    <Icon name="search" size={13} />
                    <input
                      type="search"
                      value={providerModelQuery}
                      onChange={(event) =>
                        setProviderModelQuery(event.target.value)
                      }
                      placeholder={t("Buscar modelo…")}
                      aria-label={tx("Buscar modelos de {provider}", {
                        provider: providerLabel(provider),
                      })}
                    />
                    <span>{visibleModels.length}</span>
                  </label>
                  <div
                    className="ss-provider-models"
                    data-testid={`provider-model-list-${provider}`}
                  >
                    {visibleModels.map((model) => {
                      const favorite = profile.ai.favorites.some((entry) =>
                        sameModel(entry, model),
                      );
                      return (
                        <div
                          className="ss-provider-model-row"
                          data-favorite={favorite}
                          key={modelKey(model)}
                        >
                          <span className="ss-model-dot" aria-hidden="true" />
                          <span>
                            <strong>{model.model}</strong>
                            {model.reasoningEffort && (
                              <small>{model.reasoningEffort}</small>
                            )}
                          </span>
                          <button
                            type="button"
                            className="ss-favorite-button"
                            aria-pressed={favorite}
                            aria-label={tx(
                              favorite
                                ? "Quitar {provider} · {model} de favoritos"
                                : "Añadir {provider} · {model} a favoritos",
                              {
                                provider: providerLabel(provider),
                                model: model.model,
                              },
                            )}
                            title={
                              favorite
                                ? "Quitar de favoritos"
                                : "Añadir a favoritos"
                            }
                            onClick={() => void toggleFavorite(model)}
                          >
                            <Icon name="star" size={15} />
                          </button>
                        </div>
                      );
                    })}
                    {visibleModels.length === 0 && (
                      <p className="ss-provider-model-empty">
                        Ningún modelo coincide con la búsqueda.
                      </p>
                    )}
                  </div>
                </div>
              )}
            </article>
          );
        })}
      </div>
    </Section>
  );

  const modelsPanel = (
    <Section
      title="Modelos de IA"
      description="Modo básico para un modelo general; modo avanzado para elegir cada tarea de forma independiente."
      testId="server-native-models"
    >
      {profile.ai.pendingAssignments.length > 0 && (
        <div className="ss-warning" data-testid="server-pending-models">
          {tx(
            "Hay asignaciones heredadas pendientes ({assignments}). Los modelos locales descargables no se ejecutan en Server ni se sustituyen por un modelo de pago.",
            { assignments: profile.ai.pendingAssignments.join(", ") },
          )}
        </div>
      )}
      <Row label="Configuración">
        <select
          className="ss-select"
          value={profile.ai.modelSettingsMode}
          onChange={(event) =>
            changeProfile((current) =>
              profileForModelMode(
                current,
                event.target.value as "basic" | "advanced",
              ),
            )
          }
          data-testid="model-settings-mode"
        >
          <option value="basic">{t("Básica")}</option>
          <option value="advanced">Avanzada</option>
        </select>
      </Row>
      <p className="ss-model-mode-help">
        {profile.ai.modelSettingsMode === "basic"
          ? "Un modelo general atiende las tareas de texto compatibles."
          : "Cada tarea usa su modelo seleccionado de forma independiente."}
      </p>
      <Row
        label="Llamadas simultáneas"
        hint={t("Automático se adapta en los proveedores certificados; Manual conserva un límite fijo entre 1 y 8.")}
      >
        <div className="ss-actions">
          <select
            className="ss-select"
            value={profile.workspace.aiConcurrencyMode}
            onChange={(event) =>
              changeProfile((next) => {
                next.workspace.aiConcurrencyMode = event.target.value as "automatic" | "manual";
                next.workspace.aiConcurrencyVersion = 1;
              })
            }
            data-testid="ai-concurrency-mode"
          >
            <option value="automatic">Automático</option>
            <option value="manual">Manual</option>
          </select>
          {profile.workspace.aiConcurrencyMode === "manual" && (
            <input
              className="ss-input"
              type="number"
              min={1}
              max={8}
              value={profile.workspace.concurrency}
              onChange={(event) =>
                changeProfile((next) => {
                  next.workspace.concurrency = Math.max(
                    1,
                    Math.min(8, Number.parseInt(event.target.value, 10) || 1),
                  );
                  next.workspace.aiConcurrencyVersion = 1;
                })
              }
              data-testid="ai-concurrency-manual-limit"
            />
          )}
        </div>
      </Row>
      <div className="ss-model-grid">
        {MODEL_TASKS.filter(
          ({ id }) =>
            profile.ai.modelSettingsMode === "advanced" ||
            ["synthesis", "assistant"].includes(id),
        ).map((task) => (
          <label className="ss-model-field" key={task.id}>
            <span>
              {task.id === "synthesis" &&
              profile.ai.modelSettingsMode === "basic"
                ? "Modelo general de texto"
                : task.label}
            </span>
            <ModelSelect
              id={`settings-model-${task.id}`}
              value={profile.ai.models[task.id] || null}
              favorites={profile.ai.favorites}
              onChange={(model) =>
                changeProfile((next) => {
                  next.ai.models[task.id] = model;
                  next.ai.pendingAssignments =
                    next.ai.pendingAssignments.filter(
                      (entry) => entry !== task.id,
                    );
                })
              }
            />
          </label>
        ))}
      </div>
      <div className="ss-actions">
        <button
          type="button"
          className="ss-button primary"
          onClick={() => void saveProfile()}
          disabled={busy === "profile"}
        >
          {busy === "profile" ? "Guardando…" : "Guardar modelos"}
        </button>
      </div>
    </Section>
  );

  const libraryPanel = (
    <>
      <Section
        title="Biblioteca publicada"
        description="Server muestra la misma biblioteca tabular de Desktop usando únicamente los documentos que el propietario decidió publicar."
      >
        <Row
          label="Vaults disponibles"
          hint="La publicación es independiente para cada vault."
        >
          <span className="ss-value">{me?.spaces?.length || 0}</span>
        </Row>
        <Row
          label="Privacidad"
          hint="PDF, rutas locales y credenciales no se incluyen salvo publicación explícita del contenido permitido."
        >
          <span className="ss-status good">Protegida</span>
        </Row>
      </Section>
      <Section
        title="Sincronización Zotero"
        description="La cuenta Server conserva la vista publicada. La conexión, storage y sincronización de Zotero se ejecutan en Desktop."
      >
        <div className="ss-info">
          Abre Ajustes → Biblioteca en Desktop para cambiar la fuente Zotero.
          Server aplicará la siguiente publicación a todos los vaults conectados
          sin inventar una biblioteca distinta.
        </div>
      </Section>
    </>
  );
  const extractionPanel = (
    <Section
      title="Extracción de texto y OCR"
      description="Estos ajustes dependen de archivos locales y permanecen en Desktop."
    >
      <Row
        label="Texto publicado"
        hint="Server consume el texto limpio incluido por el publicador."
      >
        <span className="ss-status good">Lectura nativa</span>
      </Row>
      <Row
        label="OCR de PDF"
        hint="Tesseract, idiomas y límites de páginas se ejecutan donde reside el documento."
      >
        <span className="ss-status">Gestionado por Desktop</span>
      </Row>
    </Section>
  );
  const interfacePanel = (
    <Section
      title="Interfaz"
      description="Apariencia y accesibilidad forman parte del perfil portable y se comparten transversalmente."
    >
      <Row label={t("Modo de color")}>
        <select
          className="ss-select"
          value={profile.appearance.theme}
          onChange={(event) => {
            const value = event.target.value as "dark" | "light" | "system";
            changeProfile((next) => {
              next.appearance.theme = value;
            });
            if (value !== "system") onThemeChange?.(value);
          }}
        >
          <option value="system">{t("Sistema")}</option>
          <option value="dark">{t("Oscuro")}</option>
          <option value="light">{t("Claro")}</option>
        </select>
      </Row>
      <Row label={t("Tema")}>
        <div className="ss-theme-control">
          <select
            className="ss-select"
            data-testid="app-theme"
            value={profile.appearance.appTheme || "default"}
            onChange={(event) => {
              const value = event.target.value;
              changeProfile((next) => {
                next.appearance.appTheme = value as PortableProfileValues["appearance"]["appTheme"];
              });
              onAppThemeChange?.(value);
            }}
          >
            {APP_THEME_IDS.map((id) => (
              <option key={id} value={id}>
                {id === "default" ? t("Predeterminado") : THEMES.find((theme) => theme.id === id)?.label || id}
              </option>
            ))}
            {(profile.appearance.customThemes ?? []).map((theme) => <option key={theme.id} value={theme.id}>{theme.label}</option>)}
          </select>
          <button type="button" className="ss-button" onClick={() => openThemeEditor()}>{t("Crear tema")}</button>
          {(profile.appearance.customThemes ?? []).map((theme) => (
            <span className="ss-theme-actions" key={theme.id}>
              <button type="button" className="ss-button" onClick={() => openThemeEditor(theme)}>{t("Editar")}: {theme.label}</button>
              <button type="button" className="ss-button" onClick={() => void deleteCustomTheme(theme.id)}>{t("Eliminar")}</button>
            </span>
          ))}
          {themeEditorOpen && <div className="ss-theme-editor" data-testid="theme-editor">
            <strong>{editingThemeId ? t("Editar tema") : t("Crear tema")}</strong>
            <input aria-label={t("Nombre del tema personalizado")} value={themeDraft.label} onChange={(event) => setThemeDraft((draft) => ({ ...draft, label: event.target.value }))} placeholder={t("Mi tema")} />
            <div className="ss-theme-colours">
              {[
                { key: 'accent', label: 'Acento', value: themeDraft.accent, update: (value: string) => setThemeDraft((draft) => ({ ...draft, accent: value })) },
                { key: 'app-background-light', label: 'Fondo de la aplicación (modo claro)', value: themeDraft.appBackground.light, update: (value: string) => setThemeDraft((draft) => ({ ...draft, appBackground: { ...draft.appBackground, light: value } })) },
                { key: 'app-background-dark', label: 'Fondo de la aplicación (modo oscuro)', value: themeDraft.appBackground.dark, update: (value: string) => setThemeDraft((draft) => ({ ...draft, appBackground: { ...draft.appBackground, dark: value } })) },
                { key: 'pale', label: 'Superficie clara', value: themeDraft.pale, update: (value: string) => setThemeDraft((draft) => ({ ...draft, pale: value })) },
                { key: 'deep', label: 'Superficie oscura', value: themeDraft.deep, update: (value: string) => setThemeDraft((draft) => ({ ...draft, deep: value })) },
                { key: 'light-text', label: 'Texto en modo claro', value: themeDraft.lightText, update: (value: string) => setThemeDraft((draft) => ({ ...draft, lightText: value })) },
                { key: 'dark-text', label: 'Texto en modo oscuro', value: themeDraft.darkText, update: (value: string) => setThemeDraft((draft) => ({ ...draft, darkText: value })) },
              ].map(({ key, label, value, update }) => (
                <ThemeColourPicker key={key} labelText={t(label)} hexLabel={t("Hexadecimal")} value={value} onChange={update} />
              ))}
            </div>
            <label>
              {t("Tintado de superficies")}
              <input aria-label={t("Tintado de superficies")} type="range" min="0" max="0.2" step="0.01" value={themeDraft.tint} onChange={(event) => setThemeDraft((draft) => ({ ...draft, tint: Number(event.target.value) }))} />
            </label>
            {themeError && <span className="ss-error">{themeError}</span>}
            <div className="ss-actions">
              <button type="button" className="ss-button" onClick={() => setThemeEditorOpen(false)}>{t("Cancelar")}</button>
              <button type="button" className="ss-button primary" onClick={() => void saveCustomTheme()}>{t("Guardar tema")}</button>
            </div>
          </div>}
        </div>
      </Row>
      <Row label="Idioma de interfaz">
        <select
          className="ss-select"
          data-testid="interface-language"
          value={profile.appearance.uiLanguage}
          onChange={(event) => {
            const value = event.target.value as AppLanguage;
            changeProfile((next) => {
              next.appearance.uiLanguage = value;
            });
            setActiveLang(value);
            onLanguageChange?.(value);
          }}
        >
          {Object.entries(LANGUAGE_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </Row>
      <Row label="Idioma de prompts">
        <select
          className="ss-select"
          value={profile.appearance.promptLanguage}
          onChange={(event) =>
            changeProfile((next) => {
              next.appearance.promptLanguage = event.target
                .value as PortableProfileValues["appearance"]["promptLanguage"];
            })
          }
        >
          {Object.entries(LANGUAGE_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </Row>
      <Row
        label="Escala de interfaz"
        hint={`${Math.round(profile.appearance.interfaceScale * 100)} %`}
      >
        <input
          type="range"
          min="0.75"
          max="1.5"
          step="0.05"
          value={profile.appearance.interfaceScale}
          onChange={(event) =>
            changeProfile((next) => {
              next.appearance.interfaceScale = Number(event.target.value);
            })
          }
        />
      </Row>
      <Row label="Fuente accesible">
        <Switch
          label="Fuente accesible"
          checked={profile.appearance.accessibleFont}
          onChange={(value) =>
            changeProfile((next) => {
              next.appearance.accessibleFont = value;
            })
          }
        />
      </Row>
      <Row label="Alto contraste">
        <Switch
          label="Alto contraste"
          checked={profile.appearance.highContrast}
          onChange={(value) =>
            changeProfile((next) => {
              next.appearance.highContrast = value;
            })
          }
        />
      </Row>
      <Row label="Reducir movimiento">
        <Switch
          label="Reducir movimiento"
          checked={profile.appearance.reduceMotion}
          onChange={(value) =>
            changeProfile((next) => {
              next.appearance.reduceMotion = value;
            })
          }
        />
      </Row>
      <Row label="Modo de lectura enfocada">
        <Switch
          label="Modo de lectura enfocada"
          checked={profile.appearance.readingFocusMode}
          onChange={(value) =>
            changeProfile((next) => {
              next.appearance.readingFocusMode = value;
            })
          }
        />
      </Row>
      <div className="ss-actions">
        <button
          type="button"
          className="ss-button primary"
          onClick={() => void saveProfile()}
          disabled={busy === "profile"}
        >
          {t("Guardar interfaz")}
        </button>
      </div>
    </Section>
  );
  const integrationsPanel = (
    <Section title="Integraciones">
      <Row
        label="Servidor MCP"
        hint="Conecta ChatGPT, Claude y clientes compatibles con este usuario y sus vaults asignados."
      >
        <code className="ss-code">
          {admin?.server.mcpUrl || `${location.origin}/mcp`}
        </code>
      </Row>
      <Row
        label="Connected Vault"
        hint="Sincroniza publicación y perfil portable desde Nodus Desktop."
      >
        <span className="ss-status good">Compatible</span>
      </Row>
      <Row
        label="Nodus para Zotero / Word / LibreOffice"
        hint="Los complementos de escritorio conservan su configuración local."
      >
        <span className="ss-status">Desktop</span>
      </Row>
    </Section>
  );
  const browserPanel = (
    <Section
      title="Nodus Browser"
      description="El navegador integrado requiere Electron y permanece fuera de la barra lateral de Server."
    >
      <div className="ss-info">
        Cookies, permisos, descargas y almacenamiento web nunca se copian al
        servidor. La extensión y Nodus Browser se configuran en Desktop.
      </div>
    </Section>
  );
  const serverPanel = (
    <>
      <Section
        title="Nodus Server"
        description="Administración integrada, sin iframe ni rutas a puertos auxiliares."
        help="Resume este servidor y muestra cuántos vaults, usuarios y dispositivos administra, junto con sus direcciones de acceso."
        testId="server-native-admin"
      >
        <div className="ss-metrics">
          <div>
            <strong>{admin?.spaces.length ?? me?.spaces?.length ?? 0}</strong>
            <span>Vaults</span>
          </div>
          <div>
            <strong>{admin?.users.length ?? "—"}</strong>
            <span>{t("Usuarios")}</span>
          </div>
          <div>
            <strong>{admin?.devices.length ?? "—"}</strong>
            <span>{t("Dispositivos")}</span>
          </div>
        </div>
        <Row label="Nombre">
          <span className="ss-value">
            {admin?.server.name || me?.server?.name || t("Nodus Server")}
          </span>
        </Row>
        <Row label="URL">
          <code className="ss-code">
            {admin?.server.publicUrl || location.origin}
          </code>
        </Row>
        <Row label="MCP">
          <code className="ss-code">
            {admin?.server.mcpUrl || `${location.origin}/mcp`}
          </code>
        </Row>
      </Section>
      {isAdmin && (
        <Section
          title="Nuevo vault"
          description="Crea una bóveda nativa administrada íntegramente por Server, sin depender de Nodus Desktop."
          help="Crea un vault editable que vive directamente en Server. Elige su nombre, tipo y descripción inicial."
          focusId="server-new-vault"
        >
          <form
            className="ss-inline-form"
            onSubmit={(event) => void createSpace(event)}
            data-testid="server-native-vault-create"
          >
            <label>
              Nombre
              <input
                required
                value={newSpace.name}
                onChange={(event) =>
                  setNewSpace((current) => ({
                    ...current,
                    name: event.target.value,
                  }))
                }
              />
            </label>
            <label>
              Tipo
              <select
                className="ss-select"
                value={newSpace.vaultType}
                onChange={(event) =>
                  setNewSpace((current) => ({
                    ...current,
                    vaultType: event.target.value,
                  }))
                }
              >
                <option value="academic">Investigación</option>
                <option value="worldbuilding">Worldbuilding</option>
                <option value="genealogy">Genealogía</option>
                <option value="prosopography">Prosopografía</option>
                <option value="testimonios">Testimonios</option>
                <option value="primary_sources">Fuentes primarias</option>
                <option value="estudio">Estudio</option>
                <option value="docencia">Docencia</option>
                <option value="databases">Base de datos</option>
              </select>
            </label>
            <label>
              Descripción
              <input
                value={newSpace.description}
                onChange={(event) =>
                  setNewSpace((current) => ({
                    ...current,
                    description: event.target.value,
                  }))
                }
              />
            </label>
            <button className="ss-button primary" disabled={busy === "admin"}>
              Crear vault
            </button>
          </form>
        </Section>
      )}
      <Section
        title="Vaults del servidor"
        help="Muestra los vaults nativos y los publicados desde Desktop. Aquí puedes revisar su estado, ajustar qué se publica y generar códigos de conexión."
        focusId="server-connected-vault"
      >
        <div className="ss-admin-list">
          {(admin?.spaces || me?.spaces || []).map((space) => {
            const policy = (
              "publicationPolicy" in space && space.publicationPolicy
                ? space.publicationPolicy
                : {}
            ) as Record<string, boolean | string | number | null>;
            const native =
              space.storageKind === "server_native" ||
              space.authorityMode === "server";
            return (
              <article
                className="ss-admin-item"
                key={space.id}
                data-storage-kind={
                  native ? "server_native" : "desktop_published"
                }
              >
                <div className="ss-admin-item-head">
                  <div>
                    <strong>{space.name}</strong>
                    <small>
                      {String(
                        space.vaultType || space.vault?.type || "academic",
                      )}{" "}
                      ·{" "}
                      {native
                        ? t("Nativo del servidor")
                        : space.updatedAt
                          ? new Date(space.updatedAt).toLocaleString(
                              profile.appearance.uiLanguage,
                            )
                          : t("Sin publicar")}
                    </small>
                  </div>
                  {native ? (
                    <span className="ss-status good">Editable</span>
                  ) : (
                    isAdmin && (
                      <button
                        className="ss-button secondary"
                        type="button"
                        onClick={async () => {
                          setBusy("admin");
                          try {
                            const result = await api.createAdminPairing(
                              space.id,
                              adminCsrf,
                            );
                            setPairing(result);
                            setNotice(t("Código de conexión creado."));
                          } catch (next) {
                            setError(errorMessage(next));
                          } finally {
                            setBusy("");
                          }
                        }}
                      >
                        Conectar Desktop
                      </button>
                    )
                  )}
                </div>
                {isAdmin && !native && (
                  <div className="ss-policy-grid">
                    {[
                      ["allowLibraryDocuments", "Biblioteca"],
                      ["allowPassages", "Pasajes"],
                      ["allowUserContent", "Notas y proyectos"],
                      ["allowVectors", "Índice semántico"],
                      ["allowPrimarySources", "Fuentes primarias"],
                      ["allowTestimonies", "Testimonios"],
                      ["allowPersonalImports", "Anotaciones privadas"],
                    ].map(([field, label]) => (
                      <label key={field}>
                        <Switch
                          label={label}
                          checked={policy[field] === true}
                          onChange={(value) =>
                            void runAdmin(
                              () =>
                                api.updateAdminSpace(
                                  space.id,
                                  { publicationPolicy: { [field]: value } },
                                  adminCsrf,
                                ),
                              tx("Política de {space} actualizada.", {
                                space: space.name,
                              }),
                            )
                          }
                        />
                        {label}
                      </label>
                    ))}
                  </div>
                )}
              </article>
            );
          })}
        </div>
        {pairing && (
          <div className="ss-pairing">
            <span>{t("Código de conexión")}</span>
            <strong>{pairing.code}</strong>
            <small>
              {t("Caduca")}:{" "}
              {new Date(pairing.expiresAt).toLocaleString(
                profile.appearance.uiLanguage,
              )}
            </small>
          </div>
        )}
      </Section>
      {isAdmin && (
        <Section
          title="Usuarios y acceso"
          help="Crea cuentas y decide qué puede hacer cada usuario en cada vault: leer, escribir o administrarlo como propietario."
        >
          <form
            className="ss-inline-form"
            onSubmit={(event) => void createUser(event)}
          >
            <label>
              Correo
              <input
                type="email"
                required
                value={newUser.email}
                onChange={(event) =>
                  setNewUser((current) => ({
                    ...current,
                    email: event.target.value,
                  }))
                }
              />
            </label>
            <label>
              Contraseña temporal
              <input
                type="password"
                minLength={12}
                required
                value={newUser.password}
                onChange={(event) =>
                  setNewUser((current) => ({
                    ...current,
                    password: event.target.value,
                  }))
                }
              />
            </label>
            <label>
              Vault inicial
              <select
                className="ss-select"
                value={newUser.spaceId}
                onChange={(event) =>
                  setNewUser((current) => ({
                    ...current,
                    spaceId: event.target.value,
                  }))
                }
              >
                <option value="">Sin acceso inicial</option>
                {admin?.spaces.map((space) => (
                  <option key={space.id} value={space.id}>
                    {space.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Rol
              <select
                className="ss-select"
                value={newUser.role}
                onChange={(event) =>
                  setNewUser((current) => ({
                    ...current,
                    role: event.target.value,
                  }))
                }
              >
                <option value="reader">Lectura</option>
                <option value="writer">Escritura</option>
                <option value="owner">Propietario</option>
              </select>
            </label>
            <button className="ss-button primary" disabled={busy === "admin"}>
              Crear cuenta
            </button>
          </form>
          <div className="ss-user-grid">
            {admin?.users.map((user) => (
              <article className="ss-user-card" key={user.id}>
                <div>
                  <span className="ss-avatar">
                    {user.email.slice(0, 1).toUpperCase()}
                  </span>
                  <div>
                    <strong>{user.email}</strong>
                    <small>{user.role}</small>
                  </div>
                </div>
                <div className="ss-access-list">
                  {admin.spaces.map((space) => {
                    const membership = user.memberships.find(
                      (entry) => entry.spaceId === space.id,
                    );
                    return (
                      <label key={space.id}>
                        {space.name}
                        <select
                          className="ss-select"
                          value={membership?.role || ""}
                          onChange={(event) => {
                            const role = event.target.value;
                            const memberships = user.memberships.filter(
                              (entry) => entry.spaceId !== space.id,
                            );
                            if (role)
                              memberships.push({ spaceId: space.id, role });
                            void runAdmin(
                              () =>
                                api.updateAdminUserAccess(
                                  user.id,
                                  memberships,
                                  adminCsrf,
                                ),
                              tx("Acceso de {user} actualizado.", {
                                user: user.email,
                              }),
                            );
                          }}
                        >
                          <option value="">Sin acceso</option>
                          <option value="reader">Lectura</option>
                          <option value="writer">Escritura</option>
                          <option value="owner">Propietario</option>
                        </select>
                      </label>
                    );
                  })}
                </div>
              </article>
            ))}
          </div>
        </Section>
      )}
      {isAdmin && (
        <Section
          title="Dispositivos publicadores"
          help="Enumera los dispositivos Desktop autorizados para publicar vaults en este servidor. Puedes revocar un dispositivo que ya no deba sincronizar."
        >
          <div className="ss-table">
            <div className="ss-table-head">
              <span>{t("Dispositivo")}</span>
              <span>Vault</span>
              <span>Último uso</span>
              <span />
            </div>
            {admin?.devices.map((device) => (
              <div className="ss-table-row ss-device-row" key={device.id}>
                <strong>{device.deviceName}</strong>
                <span>
                  {admin.spaces.find((space) => space.id === device.spaceId)
                    ?.name || device.spaceId}
                </span>
                <span>
                  {device.lastUsedAt
                    ? new Date(device.lastUsedAt).toLocaleString(
                        profile.appearance.uiLanguage,
                      )
                    : "Nunca"}
                </span>
                <button
                  className="ss-button secondary"
                  type="button"
                  onClick={() =>
                    void runAdmin(
                      () => api.revokeAdminDevice(device.id, adminCsrf),
                      t("Dispositivo revocado."),
                    )
                  }
                >
                  Revocar
                </button>
              </div>
            ))}
          </div>
        </Section>
      )}
      <Section
        title="Mi cuenta"
        description="La cuenta se administra dentro de Ajustes; nunca se abre un puerto ni una página externa."
        help="Muestra la cuenta y el rol con los que has iniciado sesión. También permite cambiar la contraseña o cerrar la sesión actual."
      >
        <Row label="Cuenta activa">
          <span className="ss-value">{me?.user?.email || "—"}</span>
        </Row>
        <Row label="Rol">
          <span className="ss-status">
            {me?.user?.role || (isAdmin ? "admin" : "member")}
          </span>
        </Row>
        <form
          className="ss-password-form"
          onSubmit={(event) => void changePassword(event)}
        >
          <label>
            Contraseña actual
            <input
              type="password"
              autoComplete="current-password"
              required
              value={passwords.currentPassword}
              onChange={(event) =>
                setPasswords((current) => ({
                  ...current,
                  currentPassword: event.target.value,
                }))
              }
            />
          </label>
          <label>
            Nueva contraseña
            <input
              type="password"
              autoComplete="new-password"
              minLength={12}
              required
              value={passwords.newPassword}
              onChange={(event) =>
                setPasswords((current) => ({
                  ...current,
                  newPassword: event.target.value,
                }))
              }
            />
          </label>
          <label>
            Repetir contraseña
            <input
              type="password"
              autoComplete="new-password"
              minLength={12}
              required
              value={passwords.confirmPassword}
              onChange={(event) =>
                setPasswords((current) => ({
                  ...current,
                  confirmPassword: event.target.value,
                }))
              }
            />
          </label>
          <button className="ss-button primary" disabled={busy === "admin"}>
            Cambiar contraseña
          </button>
        </form>
        <form
          className="ss-actions ss-account-signout"
          method="post"
          action="/logout"
        >
          <input type="hidden" name="csrf" value={csrfToken || ""} />
          <button
            className="ss-button secondary"
            type="submit"
            disabled={!csrfToken}
            data-testid="account-signout"
          >
            Cerrar sesión
          </button>
        </form>
      </Section>
    </>
  );
  const tutorialsPanel = (
    <Section title="Tutoriales">
      <div className="ss-resource-grid">
        <article>
          <Icon name="book" size={20} />
          <strong>Primeros pasos</strong>
          <p>Publicar un vault, asignar acceso y consultar la réplica.</p>
        </article>
        <article>
          <Icon name="key" size={20} />
          <strong>IA privada</strong>
          <p>Credenciales por usuario, modelos favoritos y privacidad.</p>
        </article>
        <article>
          <Icon name="link" size={20} />
          <strong>Integraciones</strong>
          <p>Connected Vault, MCP y clientes compatibles.</p>
        </article>
      </div>
    </Section>
  );
  const backupPanel = (
    <Section title="Backup / copia de seguridad">
      <div className="ss-info">
        Las copias contienen datos locales, rutas y secretos que nunca cruzan el
        perfil portable. Se crean y restauran exclusivamente en Desktop o
        mediante la política de copias del operador de Server.
      </div>
      <Row
        label="Perfil portable"
        hint="Favoritos, modelos, interfaz y políticas compatibles."
      >
        <span className="ss-status good">Sincronizado</span>
      </Row>
      <Row label="Última sincronización">
        <span className="ss-value">
          {profileMeta?.updatedAt
            ? new Date(profileMeta.updatedAt).toLocaleString(
                profile.appearance.uiLanguage,
              )
            : "Pendiente"}
        </span>
      </Row>
    </Section>
  );
  const aboutPanel = (
    <Section title="Acerca de Nodus Research">
      <Row label="Versión Server">
        <span className="ss-value">
          {admin?.server.version || me?.server?.version || "—"}
        </span>
      </Row>
      <Row label="Privacidad">
        <span className="ss-value">
          Local-first · publicación explícita · credenciales aisladas
        </span>
      </Row>
      <div className="ss-actions">
        <a
          className="ss-button secondary"
          href="https://github.com/jorgepb96/nodus"
          target="_blank"
          rel="noreferrer"
        >
          Código fuente
        </a>
        <a
          className="ss-button secondary"
          href="https://github.com/jorgepb96/nodus/blob/main/PRIVACY.md"
          target="_blank"
          rel="noreferrer"
        >
          Privacidad
        </a>
      </div>
    </Section>
  );
  const updatesPanel = (
    <Section title="Actualizaciones y novedades">
      <Row label="Canal">
        <span className="ss-status">Servidor administrado</span>
      </Row>
      <Row label="Versión instalada">
        <span className="ss-value">
          {admin?.server.version || me?.server?.version || "—"}
        </span>
      </Row>
      <div className="ss-info">
        Las actualizaciones se aplican en el host de Server. Esta vista no
        simula descargas ni reinicios que el navegador no puede ejecutar.
      </div>
    </Section>
  );
  const panels: Record<TabId, React.ReactNode> = {
    providers: providersPanel,
    models: modelsPanel,
    library: libraryPanel,
    extraction: extractionPanel,
    interface: interfacePanel,
    integrations: integrationsPanel,
    browser: browserPanel,
    server: serverPanel,
    system: tutorialsPanel,
    data: backupPanel,
    about: aboutPanel,
    updates: updatesPanel,
  };

  return (
    <div
      className="server-settings-native"
      data-theme={theme}
      data-language={profile.appearance.uiLanguage}
      data-testid="settings-view"
    >
      <header className="ss-page-head">
        <div>
          <h1>{t("Ajustes")}</h1>
          <p>{t("Busca un ajuste o entra por una sección temática.")}</p>
          <small>
            {t("Nodus")} v{admin?.server.version || me?.server?.version || "—"}
          </small>
        </div>
        <label className="ss-search">
          <Icon name="search" size={15} />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t("Buscar en ajustes…")}
          />
        </label>
      </header>
      <nav className="ss-tabs" aria-label={t("Secciones de ajustes")}>
        {TABS.map((entry) => (
          <button
            type="button"
            key={entry.id}
            data-testid={`settings-tab-${entry.id}`}
            className={`${entry.id === "server" ? "server-priority " : ""}${tab === entry.id && !normalizedQuery ? "active" : ""}`.trim()}
            onClick={() => selectTab(entry.id)}
          >
            <Icon name={entry.icon} size={14} />
            {t(entry.label)}
          </button>
        ))}
      </nav>
      {error && (
        <div className="ss-error" role="alert">
          {error}
        </div>
      )}
      {notice && (
        <div className="ss-notice" role="status">
          {notice}
        </div>
      )}
      <main className="ss-panels">
        {visibleTabs.length ? (
          visibleTabs.map((entry) => (
            <div key={entry.id}>
              {normalizedQuery && (
                <h2 className="ss-result-title">{t(entry.label)}</h2>
              )}
              {panels[entry.id]}
            </div>
          ))
        ) : (
          <div className="ss-empty">
            {t("No hay ajustes que coincidan con la búsqueda.")}
          </div>
        )}
      </main>
    </div>
  );
}

export default ServerSettingsView;
