import { useEffect, useState } from 'react';
import {
  BACKUP_CATEGORIES,
  defaultOpenBackupOptions,
  type BackupCatalog,
  type BackupCatalogEntry,
  type BackupCategory,
  type BackupPreset,
  type OpenBackupOptions,
  type OpenBackupPreview,
  type OpenBackupProgress,
  type OpenBackupResult,
} from '@shared/backups';
import { ToolkitAppHero } from '../components/ToolkitAppHero';
import { Icon, Spinner } from '../components/ui';
import { t, tx, errorText } from '../i18n';
import {
  getBackgroundJob,
  startBackgroundJob,
  subscribeBackgroundJob,
  type BackgroundJob,
} from '../backgroundJobs';

type Request = { jobId: string; options: OpenBackupOptions; directory: string };
type Job = BackgroundJob<Request, OpenBackupProgress, OpenBackupResult>;
const JOB_KEY = 'backups:export';
const labels: Record<string, string> = {
  library_items: 'Biblioteca global',
  works: 'Obras',
  authors: 'Autores',
  ideas: 'Ideas',
  work_summaries: 'Resúmenes',
  notes: 'Notas',
  note_folders: 'Carpetas',
  pages: 'Páginas',
  projects: 'Proyectos',
  project_chapters: 'Capítulos',
  study_docs: 'Documentos',
  study_courses: 'Cursos',
  study_materials: 'Materiales',
  study_questions: 'Preguntas',
  study_flashcards: 'Flashcards',
  study_recordings: 'Grabaciones',
  db_databases: 'Bases de datos',
  db_rows: 'Registros',
  dictionary_entries: 'Entradas',
  chat_conversations: 'Conversaciones',
  writing_saved_drafts: 'Informes y borradores',
  archive_items: 'Fuentes',
  persons: 'Personas',
  events: 'Eventos',
  testimony_interviews: 'Entrevistas',
  world_articles: 'Artículos',
  world_scenes: 'Escenas',
  teaching_groups: 'Grupos',
  teaching_students: 'Estudiantes',
};
function tableLabel(name: string): string {
  return labels[name]
    ? t(labels[name])
    : name
        .replace(/^(study_|teaching_|testimony_|prosop_|world_|archive_|db_|primary_source_)/, '')
        .split('_')
        .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
        .join(' ');
}
const size = (bytes: number) =>
  bytes < 1024
    ? `${bytes} B`
    : bytes < 1024 * 1024
      ? `${(bytes / 1024).toFixed(1)} KB`
      : `${(bytes / 1024 / 1024).toFixed(1)} MB`;

export function ToolkitBackupsView({ onBack }: { onBack: () => void }) {
  const [options, setOptions] = useState<OpenBackupOptions | null>(null);
  const [catalog, setCatalog] = useState<BackupCatalog | null>(null);
  const [advanced, setAdvanced] = useState(false);
  const [directory, setDirectory] = useState<string | null>(null);
  const [preview, setPreview] = useState<OpenBackupPreview | null>(null);
  const [previewBusy, setPreviewBusy] = useState(false);
  const [catalogBusy, setCatalogBusy] = useState(false);
  const [preflightBusy, setPreflightBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [presetId, setPresetId] = useState('all');
  const [presetName, setPresetName] = useState('');
  const [selector, setSelector] = useState<BackupCategory | 'library' | null>(null);
  const [tableKey, setTableKey] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(0);
  const [records, setRecords] = useState<{ entries: BackupCatalogEntry[]; total: number }>({
    entries: [],
    total: 0,
  });
  const [recordsBusy, setRecordsBusy] = useState(false);
  const [job, setJob] = useState<Job | null>(() =>
    getBackgroundJob<Request, OpenBackupProgress, OpenBackupResult>(JOB_KEY),
  );
  const [native, setNative] = useState<{ path: string; password: string; recoveryKey: string } | null>(null);
  const [nativeBusy, setNativeBusy] = useState(false);
  const [preservationConfirm, setPreservationConfirm] = useState(false);
  const busy = job?.status === 'running';
  useEffect(() => subscribeBackgroundJob(JOB_KEY, (next) => setJob(next as Job | null)), []);
  useEffect(() => {
    let disposed = false;
    void window.nodus
      .getActiveVault()
      .then((v) => {
        if (!disposed) setOptions(defaultOpenBackupOptions(v.id));
      })
      .catch((e) => setNotice(errorText(e)));
    return () => {
      disposed = true;
    };
  }, []);
  const vaultIds = options?.vaultIds.join('|') ?? '';
  useEffect(() => {
    if (!options) return;
    let disposed = false;
    setCatalogBusy(true);
    void window.nodus
      .getBackupCatalog(options.vaultIds)
      .then((c) => {
        if (!disposed) setCatalog(c);
      })
      .catch((e) => {
        if (!disposed) setNotice(errorText(e));
      })
      .finally(() => {
        if (!disposed) setCatalogBusy(false);
      });
    return () => {
      disposed = true;
    };
  }, [vaultIds]);
  useEffect(() => {
    if (!selector || !options || !tableKey) return;
    let disposed = false;
    setRecordsBusy(true);
    void window.nodus
      .getBackupCatalogRecords({
        vaultIds: options.vaultIds,
        category: selector === 'library' ? 'research' : selector,
        tableKey,
        query: search,
        offset: page * 60,
        limit: 60,
      })
      .then((r) => {
        if (!disposed) setRecords(r);
      })
      .catch((e) => {
        if (!disposed) setNotice(errorText(e));
      })
      .finally(() => {
        if (!disposed) setRecordsBusy(false);
      });
    return () => {
      disposed = true;
    };
  }, [selector, tableKey, search, page, vaultIds]);
  function patch(next: Partial<OpenBackupOptions>) {
    if (Object.keys(next).some((key) => !['formats', 'organization', 'container'].includes(key)))
      setPresetId('custom');
    setOptions((o) => (o ? { ...o, ...next } : o));
    setPreview(null);
  }
  async function choosePreset(id: string) {
    setPresetId(id);
    if (!options) return;
    if (id === 'custom') {
      setAdvanced(true);
      return;
    }
    const saved = catalog?.presets.find((p) => p.id === id);
    if (saved) {
      setOptions(saved.options);
      setPreview(null);
      return;
    }
    const defaults = {
      ...defaultOpenBackupOptions(options.vaultIds[0]),
      vaultIds: options.vaultIds,
      formats: options.formats,
      container: options.container,
    };
    try {
      const selections: Record<string, string[]> = {};
      const allowed = new Set(
        id === 'summaries'
          ? ['works', 'authors', 'work_authors', 'work_summaries']
          : [
              'works',
              'authors',
              'work_authors',
              'work_summaries',
              'ideas',
              'idea_occurrences',
              'evidence',
              'themes',
              'work_themes',
              'idea_theme_links',
              'edges',
            ],
      );
      if (id !== 'all') {
        for (const tab of catalog?.tables ?? [])
          if (tab.category === 'research' && !allowed.has(tab.name)) selections[tab.key] = [];
        if (id === 'summaries') {
          setPreflightBusy(true);
          for (const tab of catalog?.tables.filter((tab) => tab.name === 'work_summaries') ?? []) {
            const keys: string[] = [];
            for (let offset = 0; ; offset += 200) {
              const records = await window.nodus.getBackupCatalogRecords({
                vaultIds: defaults.vaultIds,
                tableKey: tab.key,
                offset,
                limit: 200,
              });
              keys.push(...records.entries.map((record) => record.key));
              if (offset + records.entries.length >= records.total || !records.entries.length) break;
            }
            selections[`${tab.vaultId}:works`] = keys;
          }
        }
      }
      setOptions(
        id === 'all'
          ? defaults
          : {
              ...defaults,
              categories: ['research'],
              selections,
              includeAttachments: false,
              includeHistory: false,
              includeIdeas: id !== 'summaries',
              includeEvidence: id !== 'summaries',
              includeRelations: id !== 'summaries',
              includeThemes: id !== 'summaries',
              includeSyntheses: false,
            },
      );
    } catch (e) {
      setNotice(errorText(e));
    } finally {
      setPreflightBusy(false);
    }
    setPreview(null);
  }
  async function run(confirmed = false) {
    if (!options || !directory) return;
    setPreflightBusy(true);
    try {
      if (
        !confirmed &&
        catalog?.tables.some(
          (tab) =>
            ['testimony_interviews', 'archive_item_profiles', 'primary_source_note_profiles'].includes(
              tab.name,
            ) && options.vaultIds.includes(tab.vaultId),
        )
      ) {
        const preflight = await window.nodus.previewOpenBackup({ ...options, authorizePreservation: false });
        if (preflight.requiresConfirmation) {
          setPreservationConfirm(true);
          return;
        }
      }
    } catch (e) {
      setNotice(errorText(e));
      return;
    } finally {
      setPreflightBusy(false);
    }
    setPreservationConfirm(false);
    setNotice(null);
    const request = {
      jobId: `backups-${crypto.randomUUID()}`,
      options: { ...options, authorizePreservation: confirmed },
      directory,
    };
    startBackgroundJob(JOB_KEY, request, (r, onProgress) =>
      window.nodus.runOpenBackup(r.jobId, r.options, r.directory, onProgress),
    );
  }
  async function getPreview() {
    if (!options) return;
    setPreviewBusy(true);
    setNotice(null);
    try {
      setPreview(await window.nodus.previewOpenBackup(options));
    } catch (e) {
      setNotice(errorText(e));
    } finally {
      setPreviewBusy(false);
    }
  }
  async function savePreset() {
    if (!options || !catalog) return;
    try {
      const preset: BackupPreset = { id: crypto.randomUUID(), name: presetName, options };
      const presets = await window.nodus.saveBackupPreset(preset);
      setCatalog({ ...catalog, presets });
      setPresetName('');
      setPresetId(preset.id);
    } catch (e) {
      setNotice(errorText(e));
    }
  }
  function openSelector(category: BackupCategory | 'library') {
    setSelector(category);
    setSearch('');
    setPage(0);
    const candidates =
      catalog?.tables.filter((tab) =>
        category === 'library'
          ? tab.vaultId === 'global'
          : tab.category === category && tab.vaultId !== 'global',
      ) ?? [];
    setTableKey(
      (
        candidates.find((tab) => category === 'research' && tab.name === options?.organization) ??
        candidates.find((tab) => labels[tab.name]) ??
        candidates[0]
      )?.key ?? '',
    );
  }
  async function selectAllMatching(checked: boolean) {
    if (!options || !selector || !tableKey) return;
    try {
      const keys: string[] = [];
      let offset = 0;
      let total = 0;
      do {
        const p = await window.nodus.getBackupCatalogRecords({
          vaultIds: options.vaultIds,
          category: selector === 'library' ? 'research' : selector,
          tableKey,
          query: search,
          offset,
          limit: 200,
        });
        keys.push(...p.entries.map((e) => e.key));
        total = p.total;
        offset += p.entries.length;
        if (!p.entries.length) break;
      } while (offset < total);
      const existing = options.selections[tableKey];
      if (!search) {
        const selections = { ...options.selections };
        if (checked) delete selections[tableKey];
        else selections[tableKey] = [];
        patch({ selections });
      } else {
        let selected = existing;
        if (selected === undefined) {
          const all: string[] = [];
          for (let offset = 0; ; offset += 200) {
            const p = await window.nodus.getBackupCatalogRecords({
              vaultIds: options.vaultIds,
              tableKey,
              offset,
              limit: 200,
            });
            all.push(...p.entries.map((e) => e.key));
            if (all.length >= p.total) break;
          }
          selected = all;
        }
        const next = new Set(selected);
        for (const key of keys)
          if (checked) next.add(key);
          else next.delete(key);
        patch({ selections: { ...options.selections, [tableKey]: [...next] } });
      }
    } catch (e) {
      setNotice(errorText(e));
    }
  }
  async function toggleRecord(entry: BackupCatalogEntry) {
    if (!options) return;
    let selected = options.selections[entry.tableKey];
    if (selected === undefined) {
      const all: string[] = [];
      for (let offset = 0; ; offset += 200) {
        const p = await window.nodus.getBackupCatalogRecords({
          vaultIds: options.vaultIds,
          tableKey: entry.tableKey,
          offset,
          limit: 200,
        });
        all.push(...p.entries.map((e) => e.key));
        if (all.length >= p.total) break;
      }
      selected = all;
    }
    const next = selected.includes(entry.key)
      ? selected.filter((k) => k !== entry.key)
      : [...selected, entry.key];
    patch({ selections: { ...options.selections, [entry.tableKey]: next } });
  }
  const panel =
    'rounded-2xl border border-neutral-200 bg-white p-5 dark:border-neutral-800 dark:bg-neutral-900/40';
  return (
    <div data-testid="backups-view" className="mx-auto max-w-4xl space-y-5 pb-10">
      <ToolkitAppHero
        badge="Nodus Tools"
        title="Backups"
        description={t('Conserva tu trabajo y llévalo contigo en formatos abiertos.')}
        icon="download"
        actionLabel={t('Exportar contenido')}
        actionIcon="download"
        onAction={() => void run()}
        onBack={onBack}
        heroTestId="backups-hero"
        actionTestId="backups-export"
        backTestId="backups-back"
        actionDisabled={
          !options ||
          !directory ||
          busy ||
          catalogBusy ||
          preflightBusy ||
          !options.formats.length ||
          (!options.vaultIds.length && !options.includeGlobalLibrary) ||
          (!options.categories.length && !options.includeGlobalLibrary)
        }
        actionBusy={busy || preflightBusy}
        compact
      />
      {notice && (
        <p
          role="alert"
          className="rounded-xl bg-red-50 p-3 text-sm text-red-700 dark:bg-red-950/30 dark:text-red-300"
        >
          {notice}
        </p>
      )}
      {!options || !catalog ? (
        <div className={panel}>
          <Spinner /> {t('Cargando contenido…')}
        </div>
      ) : (
        <>
          <fieldset disabled={busy || catalogBusy || preflightBusy} className="space-y-5 disabled:opacity-70">
            <section className={panel}>
              <h2 className="mb-4 text-sm font-semibold">1. {t('Qué exportar')}</h2>
              <div className="grid gap-4 sm:grid-cols-2">
                <label className="space-y-2 text-xs text-neutral-500">
                  {t('Bóvedas')}
                  <div className="max-h-32 space-y-2 overflow-auto rounded-xl bg-neutral-50 p-3 dark:bg-neutral-950/50">
                    {catalog.vaults.map((v) => (
                      <label
                        key={v.id}
                        className="flex items-center gap-2 text-sm text-neutral-800 dark:text-neutral-200"
                      >
                        <input
                          type="checkbox"
                          data-testid={`backups-vault-${v.id}`}
                          checked={options.vaultIds.includes(v.id)}
                          onChange={() =>
                            patch({
                              vaultIds: options.vaultIds.includes(v.id)
                                ? options.vaultIds.filter((id) => id !== v.id)
                                : [...options.vaultIds, v.id],
                              selections: {},
                            })
                          }
                        />
                        {v.name}
                      </label>
                    ))}
                  </div>
                </label>
                <label className="space-y-2 text-xs text-neutral-500">
                  {t('Selección rápida')}
                  <select
                    data-testid="backups-preset"
                    className="input w-full"
                    value={presetId}
                    onChange={(e) => void choosePreset(e.target.value)}
                  >
                    <option value="all">{t('Toda la bóveda')}</option>
                    <option value="custom">{t('Personalizar')}</option>
                    {catalog.counts.research && (
                      <>
                        <option value="research">{t('Resúmenes e ideas')}</option>
                        <option value="summaries">{t('Solo resúmenes')}</option>
                      </>
                    )}
                    {catalog.presets.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                  <p className="text-xs leading-5">
                    {t('Exporta todo o ajusta la selección a lo que necesitas.')}
                  </p>
                </label>
              </div>
              <button
                data-testid="backups-customize"
                className="btn btn-ghost mt-3 text-xs"
                onClick={() => setAdvanced(!advanced)}
              >
                <Icon name="settings" size={14} />
                {t(advanced ? 'Ocultar opciones' : 'Personalizar')}
              </button>
              {advanced && (
                <div
                  data-testid="backups-categories"
                  className="mt-3 space-y-4 border-t border-neutral-200 pt-4 dark:border-neutral-800"
                >
                  <div className="grid gap-2 sm:grid-cols-2">
                    {BACKUP_CATEGORIES.filter((c) => catalog.counts[c.id]).map((c) => (
                      <div
                        key={c.id}
                        className="flex items-center gap-2 rounded-lg bg-neutral-50 px-3 py-2 dark:bg-neutral-950/40"
                      >
                        <input
                          aria-label={t(c.label)}
                          type="checkbox"
                          checked={options.categories.includes(c.id)}
                          onChange={() =>
                            patch({
                              categories: options.categories.includes(c.id)
                                ? options.categories.filter((id) => id !== c.id)
                                : [...options.categories, c.id],
                            })
                          }
                        />
                        <span className="flex-1 text-sm">
                          {t(c.label)}{' '}
                          <span className="text-xs text-neutral-400">{catalog.counts[c.id]}</span>
                        </span>
                        <button
                          data-testid={`backups-select-${c.id}`}
                          className="text-xs text-amber-700 dark:text-amber-300"
                          onClick={() => openSelector(c.id)}
                        >
                          {t('Elegir elementos')}
                        </button>
                      </div>
                    ))}
                  </div>
                  <div className="flex items-center gap-3">
                    <label className="flex gap-2 text-sm">
                      <input
                        type="checkbox"
                        data-testid="backups-global-library"
                        checked={options.includeGlobalLibrary}
                        onChange={(e) => patch({ includeGlobalLibrary: e.target.checked })}
                      />
                      {t('Incluir toda la biblioteca global')}
                    </label>
                    {options.includeGlobalLibrary &&
                      catalog.tables.some((tab) => tab.vaultId === 'global') && (
                        <button
                          data-testid="backups-select-library"
                          className="text-xs text-amber-700 dark:text-amber-300"
                          onClick={() => openSelector('library')}
                        >
                          {t('Elegir elementos')}
                        </button>
                      )}
                  </div>
                  <div className="flex flex-wrap gap-4">
                    {(
                      [
                        ['includeAttachments', 'Archivos adjuntos'],
                        ['includeHistory', 'Historiales y versiones'],
                      ] as const
                    ).map(([key, label]) => (
                      <label key={key} className="flex gap-2 text-sm">
                        <input
                          data-testid={`backups-${key}`}
                          type="checkbox"
                          checked={options[key]}
                          onChange={(e) => patch({ [key]: e.target.checked })}
                        />
                        {t(label)}
                      </label>
                    ))}
                  </div>
                  <div className="flex gap-2">
                    <input
                      data-testid="backups-preset-name"
                      className="input min-w-0 flex-1"
                      placeholder={t('Nombre del preset')}
                      value={presetName}
                      onChange={(e) => setPresetName(e.target.value)}
                    />
                    <button
                      data-testid="backups-save-preset"
                      className="btn btn-secondary text-xs"
                      disabled={!presetName.trim()}
                      onClick={() => void savePreset()}
                    >
                      {t('Guardar selección')}
                    </button>
                    {catalog.presets.some((p) => p.id === presetId) && (
                      <button
                        className="btn btn-ghost"
                        onClick={() =>
                          void window.nodus.deleteBackupPreset(presetId).then((presets) => {
                            setCatalog({ ...catalog, presets });
                            void choosePreset('all');
                          })
                        }
                      >
                        <Icon name="trash" size={14} />
                      </button>
                    )}
                  </div>
                </div>
              )}
            </section>
            <section className={panel}>
              <h2 className="mb-4 text-sm font-semibold">2. {t('Formato y presentación')}</h2>
              <div className="flex flex-wrap gap-2">
                {(['markdown', 'csv', 'json'] as const).map((format) => (
                  <label
                    key={format}
                    className={`cursor-pointer rounded-xl border px-4 py-2 text-sm ${options.formats.includes(format) ? 'border-amber-400 bg-amber-50 text-amber-900 dark:bg-amber-950/40 dark:text-amber-200' : 'border-neutral-200 dark:border-neutral-700'}`}
                  >
                    <input
                      data-testid={`backups-format-${format}`}
                      className="mr-2"
                      type="checkbox"
                      checked={options.formats.includes(format)}
                      onChange={() =>
                        patch({
                          formats: options.formats.includes(format)
                            ? options.formats.filter((f) => f !== format)
                            : [...options.formats, format],
                        })
                      }
                    />
                    {format === 'markdown' ? 'Markdown' : format.toUpperCase()}
                  </label>
                ))}
              </div>
              {options.categories.includes('research') && !!catalog.counts.research && (
                <div className="mt-4 space-y-4">
                  <div className="grid gap-4 sm:grid-cols-2">
                    {options.formats.includes('markdown') && (
                      <label className="space-y-1 text-xs text-neutral-500">
                        {t('Organizar investigación por')}
                        <select
                          data-testid="backups-organization"
                          className="input w-full"
                          value={options.organization}
                          onChange={(e) =>
                            patch({ organization: e.target.value as OpenBackupOptions['organization'] })
                          }
                        >
                          <option value="works">{t('Obras')}</option>
                          <option value="authors">{t('Autores')}</option>
                          <option value="ideas">{t('Ideas')}</option>
                        </select>
                      </label>
                    )}
                    <label className="space-y-1 text-xs text-neutral-500">
                      {t('Resúmenes de las obras')}
                      <select
                        data-testid="backups-summaries"
                        className="input w-full"
                        value={options.summaries}
                        onChange={(e) =>
                          patch({ summaries: e.target.value as OpenBackupOptions['summaries'] })
                        }
                      >
                        <option value="inline">{t('Incluir en cada ficha')}</option>
                        <option value="separate">{t('Guardar por separado')}</option>
                        <option value="none">{t('No incluir')}</option>
                      </select>
                    </label>
                  </div>
                  <div className="flex flex-wrap gap-x-5 gap-y-2">
                    {(
                      [
                        ['includeIdeas', 'Ideas'],
                        ['includeEvidence', 'Evidencias'],
                        ['includeThemes', 'Temas'],
                        ['includeRelations', 'Relaciones'],
                        ['includeSyntheses', 'Síntesis de autores'],
                      ] as const
                    ).map(([key, label]) => (
                      <label key={key} className="flex gap-2 text-xs">
                        <input
                          type="checkbox"
                          data-testid={`backups-${key}`}
                          checked={options[key]}
                          onChange={(e) => patch({ [key]: e.target.checked })}
                        />
                        {t(label)}
                      </label>
                    ))}
                  </div>
                </div>
              )}
              <button
                data-testid="backups-preview"
                className="btn btn-ghost mt-4 text-xs"
                disabled={previewBusy || !options.formats.length}
                onClick={() => void getPreview()}
              >
                {previewBusy ? <Spinner /> : <Icon name="eye" size={14} />} {t('Ver ejemplo de exportación')}
              </button>
              {preview && (
                <div
                  data-testid="backups-preview-result"
                  className="mt-3 rounded-xl bg-neutral-50 p-4 dark:bg-neutral-950/60"
                >
                  <p className="text-xs text-neutral-500">
                    {tx('{records} elementos · {files} archivos · {size}', {
                      records: preview.records,
                      files: preview.files,
                      size: size(preview.bytes),
                    })}
                  </p>
                  {preview.sample && (
                    <details className="mt-3" open>
                      <summary className="cursor-pointer truncate text-xs">{preview.sample.path}</summary>
                      <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap text-xs leading-5">
                        {preview.sample.content}
                      </pre>
                    </details>
                  )}
                  {!!preview.omissions.length && (
                    <p className="mt-2 text-xs text-amber-700">
                      {tx('{count} omisiones; consulta el manifiesto.', { count: preview.omissions.length })}
                    </p>
                  )}
                </div>
              )}
            </section>
            <section className={panel}>
              <h2 className="mb-4 text-sm font-semibold">3. {t('Destino')}</h2>
              <div className="flex flex-wrap items-center gap-3">
                <button
                  data-testid="backups-destination"
                  className="btn btn-secondary"
                  onClick={() => void window.nodus.pickToolkitOutputDir().then(setDirectory)}
                >
                  <Icon name="folder" size={15} />
                  {t('Elegir carpeta')}
                </button>
                <p className="min-w-0 flex-1 truncate text-xs text-neutral-500" title={directory ?? ''}>
                  {directory ?? t('Selecciona dónde guardar la exportación.')}
                </p>
                <select
                  data-testid="backups-container"
                  className="input"
                  value={options.container}
                  onChange={(e) => patch({ container: e.target.value as 'zip' | 'folder' })}
                >
                  <option value="zip">ZIP</option>
                  <option value="folder">{t('Carpeta organizada')}</option>
                </select>
              </div>
            </section>
          </fieldset>
          {job && (
            <section data-testid="backups-job" className={panel}>
              <div className="flex items-center gap-3">
                {busy ? <Spinner /> : <Icon name="download" size={18} />}
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">
                    {job.status === 'failed'
                      ? t('No se pudo completar la exportación.')
                      : busy
                        ? t('Exportando contenido…')
                        : job.result?.cancelled
                          ? t('Trabajo cancelado.')
                          : t('Exportación completada.')}
                  </p>
                  <p className="truncate text-xs text-neutral-500">{job.error ?? job.progress?.message}</p>
                </div>
                {busy && (
                  <button
                    data-testid="backups-cancel"
                    className="btn btn-ghost"
                    onClick={() => void window.nodus.cancelOpenBackup(job.request.jobId)}
                  >
                    {t('Cancelar')}
                  </button>
                )}
                {job.result?.path && (
                  <button
                    data-testid="backups-open-result"
                    className="btn btn-secondary text-xs"
                    onClick={() => void window.nodus.revealToolkitOutput(job.result!.path!)}
                  >
                    {t('Abrir resultado')}
                  </button>
                )}
              </div>
              {job.result && !job.result.cancelled && (
                <p className="mt-3 text-xs text-neutral-500">
                  {tx('{records} elementos · {files} archivos · {size}', {
                    records: job.result.records,
                    files: job.result.files,
                    size: size(job.result.bytes),
                  })}
                </p>
              )}
              {!!job.result?.omissions.length && (
                <details className="mt-3 text-xs">
                  <summary>
                    {tx('{count} omisiones; consulta el manifiesto.', { count: job.result.omissions.length })}
                  </summary>
                  <ul className="mt-2 space-y-1">
                    {job.result.omissions.map((o, i) => (
                      <li key={i}>{o}</li>
                    ))}
                  </ul>
                </details>
              )}
            </section>
          )}
          <section className="flex flex-wrap items-center gap-4 rounded-2xl border border-dashed border-neutral-300 p-5 dark:border-neutral-700">
            <div className="flex-1">
              <h2 className="text-sm font-semibold">{t('Copia completa de Nodus')}</h2>
              <p className="mt-1 text-xs leading-5 text-neutral-500">
                {t(
                  'Guarda toda la aplicación en un archivo .nodus cifrado para restaurarla después. La programación y restauración están en Ajustes.',
                )}
              </p>
            </div>
            <button
              data-testid="backups-native"
              className="btn btn-secondary text-xs"
              disabled={nativeBusy || busy}
              onClick={() => {
                setNativeBusy(true);
                void window.nodus
                  .exportData()
                  .then(setNative)
                  .catch((e) => setNotice(errorText(e)))
                  .finally(() => setNativeBusy(false));
              }}
            >
              {nativeBusy ? <Spinner /> : <Icon name="download" size={14} />} .nodus
            </button>
            {native && (
              <div data-testid="backups-native-result" className="w-full space-y-2 text-xs">
                <p>{native.path}</p>
                <p>{t('Guarda las credenciales fuera de este dispositivo.')}</p>
                <button
                  className="btn btn-secondary"
                  onClick={() =>
                    void navigator.clipboard.writeText(
                      `Password: ${native.password}\nRecovery key: ${native.recoveryKey}`,
                    )
                  }
                >
                  {t('Copiar credenciales')}
                </button>
                <details>
                  <summary>{t('Credenciales de recuperación')}</summary>
                  <pre data-testid="backups-native-credentials" className="whitespace-pre-wrap">
                    {native.password}
                    {'\n'}
                    {native.recoveryKey}
                  </pre>
                </details>
              </div>
            )}
          </section>
        </>
      )}
      {preservationConfirm && (
        <div
          className="fixed inset-0 z-[100] grid place-items-center bg-black/50 p-5"
          role="dialog"
          aria-modal="true"
          data-testid="backups-preservation-confirm"
        >
          <section className={panel + ' max-w-lg space-y-4'}>
            <h2 className="text-sm font-semibold">{t('Exportar contenido')}</h2>
            <p className="text-sm text-neutral-500">
              {t('Archivos adjuntos')} · {t('Historiales y versiones')}
            </p>
            <p className="text-sm">
              {t(
                'Paquete de preservación: incluye los materiales seleccionados y sus acuerdos de acceso. Confirma que deseas guardarlo en el destino elegido.',
              )}
            </p>
            <div className="flex justify-end gap-2">
              <button className="btn btn-ghost" onClick={() => setPreservationConfirm(false)}>
                {t('Cancelar')}
              </button>
              <button
                data-testid="backups-preservation-accept"
                className="btn btn-primary"
                onClick={() => void run(true)}
              >
                {t('Exportar contenido')}
              </button>
            </div>
          </section>
        </div>
      )}
      {selector && options && catalog && (
        <div
          className="fixed inset-0 z-[100] grid place-items-center bg-black/50 p-5"
          role="dialog"
          aria-modal="true"
          aria-label={t('Elegir elementos')}
          data-testid="backups-selector"
        >
          <section className="flex max-h-[85vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl bg-white shadow-xl dark:bg-neutral-900">
            <header className="flex items-center justify-between border-b border-neutral-200 p-5 dark:border-neutral-800">
              <h2 className="text-sm font-semibold">
                {t(
                  selector === 'library'
                    ? 'Biblioteca global'
                    : BACKUP_CATEGORIES.find((c) => c.id === selector)!.label,
                )}
              </h2>
              <button
                data-testid="backups-selector-close"
                className="btn btn-ghost"
                onClick={() => setSelector(null)}
              >
                <Icon name="x" size={18} />
              </button>
            </header>
            <div className="space-y-3 p-5">
              <select
                data-testid="backups-selector-table"
                className="input w-full"
                value={tableKey}
                onChange={(e) => {
                  setTableKey(e.target.value);
                  setPage(0);
                }}
              >
                {catalog.tables
                  .filter((tab) =>
                    selector === 'library'
                      ? tab.vaultId === 'global'
                      : tab.category === selector && tab.vaultId !== 'global',
                  )
                  .map((tab) => (
                    <option key={tab.key} value={tab.key}>
                      {tableLabel(tab.name)} ·{' '}
                      {tab.vaultId === 'global'
                        ? t('Biblioteca global')
                        : catalog.vaults.find((v) => v.id === tab.vaultId)?.name}{' '}
                      ({tab.count})
                    </option>
                  ))}
              </select>
              <input
                data-testid="backups-selector-search"
                className="input w-full"
                placeholder={t('Buscar elementos…')}
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                  setPage(0);
                }}
              />
              <div className="flex gap-4 text-xs">
                <button data-testid="backups-select-all" onClick={() => void selectAllMatching(true)}>
                  {t('Seleccionar todos')}
                </button>
                <button data-testid="backups-select-none" onClick={() => void selectAllMatching(false)}>
                  {t('Desmarcar todos')}
                </button>
                <span className="ml-auto text-neutral-500">{records.total}</span>
              </div>
            </div>
            <div className="min-h-32 overflow-y-auto px-5 pb-4">
              {recordsBusy ? (
                <Spinner />
              ) : (
                records.entries.map((entry) => (
                  <label
                    key={entry.key}
                    className="flex cursor-pointer gap-3 rounded-xl p-3 hover:bg-neutral-50 dark:hover:bg-neutral-800"
                  >
                    <input
                      type="checkbox"
                      className="mt-1"
                      data-testid="backups-record"
                      checked={
                        options.selections[entry.tableKey] === undefined ||
                        options.selections[entry.tableKey].includes(entry.key)
                      }
                      onChange={() => void toggleRecord(entry).catch((e) => setNotice(errorText(e)))}
                    />
                    <span className="min-w-0">
                      <span className="block text-sm">{entry.title}</span>
                      <span className="block text-xs text-neutral-500">
                        {entry.table === 'works'
                          ? entry.subtitle
                          : (entry.vaultId === 'global'
                              ? t('Biblioteca global')
                              : catalog.vaults.find((v) => v.id === entry.vaultId)?.name) +
                            ' · ' +
                            tableLabel(entry.table)}
                      </span>
                    </span>
                  </label>
                ))
              )}
            </div>
            <footer className="flex justify-between border-t border-neutral-200 p-4 dark:border-neutral-800">
              <button className="btn btn-ghost text-xs" disabled={!page} onClick={() => setPage(page - 1)}>
                {t('Anterior')}
              </button>
              <button className="btn btn-primary text-xs" onClick={() => setSelector(null)}>
                {t('Listo')}
              </button>
              <button
                className="btn btn-ghost text-xs"
                disabled={(page + 1) * 60 >= records.total}
                onClick={() => setPage(page + 1)}
              >
                {t('Siguiente')}
              </button>
            </footer>
          </section>
        </div>
      )}
    </div>
  );
}
