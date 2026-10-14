import { useLearningArtifact } from '../learning/useLearningArtifact';
import { useCallback, useEffect, useMemo, useState } from 'react';
import type React from 'react';
import type {
  AppSettings,
  HypothesisCandidate,
  HypothesisEvidenceKind,
  HypothesisLabMode,
  HypothesisLabResult,
  HypothesisMaturity,
  Project,
} from '@shared/types';
import type { PendingAssistantNavigationTarget, PendingGraphNavigationTarget } from '../navigation';
import { Badge, Icon, Spinner, modelLabel } from '../components/ui';
import { ModelPicker } from '../components/ModelPicker';
import { SaveToNotesModal } from '../components/SaveToNotesModal';
import { SourceCitationModal, type CitationTarget } from '../components/SourceCitationModal';
import { useFeatureModel } from '../hooks/useFeatureModel';
import { t, tx } from '../i18n';

const MODE_LABELS: Record<HypothesisLabMode, string> = {
  exploratory: 'Exploratoria',
  causal: 'Causal',
  comparative: 'Comparativa',
  methodological: 'Metodológica',
  intervention: 'Intervención',
};

const MATURITY_LABELS: Record<HypothesisMaturity, string> = {
  seed: 'Semilla',
  promising: 'Prometedora',
  testable: 'Contrastable',
  ready: 'Lista para contrastar',
};

const MATURITY_COLORS: Record<HypothesisMaturity, 'neutral' | 'indigo' | 'green' | 'amber' | 'red' | 'cyan'> = {
  seed: 'neutral',
  promising: 'cyan',
  testable: 'indigo',
  ready: 'green',
};

const EVIDENCE_LABELS: Record<HypothesisEvidenceKind, string> = {
  gap: 'Hueco',
  idea: 'Idea',
  debate: 'Debate',
  work: 'Obra',
  passage: 'Pasaje',
  project: 'Proyecto',
};

export function HypothesisLabView({
  settings,
  onOpenGraph,
  onOpenAssistant,
}: {
  settings: AppSettings;
  onOpenGraph: (target: PendingGraphNavigationTarget) => void;
  onOpenAssistant: (target?: PendingAssistantNavigationTarget) => void;
}) {
  const [objective, setObjective] = useState('');
  const [mode, setMode] = useState<HypothesisLabMode>('exploratory');
  const [maxCandidates, setMaxCandidates] = useState(6);
  const [model, setModel] = useFeatureModel(settings, 'hypothesisModel');
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectId, setProjectId] = useState('');
  const [result, setResult] = useState<HypothesisLabResult | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savingCandidate, setSavingCandidate] = useState<HypothesisCandidate | null>(null);
  const [citation, setCitation] = useState<CitationTarget>(null);

  useEffect(() => {
    let on = true;
    void window.nodus.listProjects().then((items) => {
      if (!on) return;
      setProjects(items);
      setProjectId((current) => current || items[0]?.id || '');
    });
    return () => {
      on = false;
    };
  }, []);

  const selected = useMemo(
    () => result?.candidates.find((candidate) => candidate.id === selectedId) ?? result?.candidates[0] ?? null,
    [result, selectedId]
  );

  useLearningArtifact('hypothesis', selected?.id, selected?.evidence.filter(e=>['idea','passage','work'].includes(e.kind)).map(e=>({kind:e.kind as 'idea'|'passage'|'work',id:e.refId})) ?? []);
  const generate = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const next = await window.nodus.generateHypothesisLab({
        objective,
        mode,
        maxCandidates,
        projectId: projectId || null,
        language: settings.promptLanguage,
        model,
      });
      setResult(next);
      setSelectedId(next.candidates[0]?.id ?? null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [maxCandidates, mode, model, objective, projectId, settings.promptLanguage]);

  const askAssistant = useCallback(() => {
    if (!selected) return;
    onOpenAssistant({
      title: selected.title,
      prompt: `${t('Evalúa esta hipótesis de investigación con mi corpus. Busca objeciones, fuentes clave, operacionalización y próximos pasos:')}\n\n${candidateMarkdown(selected)}`,
      selection: {
        ideas: true,
        themes: true,
        contradictions: true,
        gaps: true,
        readingPath: true,
        authors: true,
        documents: false,
        passages: true,
        graph: true,
        graphParts: {
          ideaNodes: true,
          themeNodes: true,
          ideaEdges: true,
          authorGraph: true,
        },
      },
    });
  }, [onOpenAssistant, selected]);

  return (
    <div data-testid="hypothesis-view" className="h-full min-h-0 flex flex-col p-6 overflow-hidden">
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <div>
          <h1 className="text-xl font-semibold">{t('Laboratorio de hipótesis')}</h1>
          {result && (
            <p className="text-sm text-neutral-400 mt-1">
              {tx('{n} candidatas · {g} huecos · {i} ideas · {d} debates', {
                n: result.candidates.length,
                g: result.stats.gaps,
                i: result.stats.ideas,
                d: result.stats.debates,
              })}
            </p>
          )}
        </div>
        <div className="flex-1" />
        <ModelPicker settings={settings} value={model} onChange={setModel} compact menu />
        <button data-testid="hypothesis-generate" className="btn btn-primary gap-1.5" onClick={() => void generate()} disabled={loading}>
          <Icon name={loading ? 'sync' : 'flask'} className={loading ? 'animate-spin' : ''} />
          {loading ? t('Generando…') : t('Generar hipótesis')}
        </button>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_22rem] gap-4 mb-4">
        <div className="space-y-3">
          <textarea
            data-testid="hypothesis-objective"
            className="input w-full min-h-24 resize-y"
            value={objective}
            onChange={(e) => setObjective(e.target.value)}
            placeholder={t('Objetivo, tema, pregunta o intuición de investigación...')}
          />
          <div className="flex flex-wrap items-center gap-2">
            <select className="input" value={mode} onChange={(e) => setMode(e.target.value as HypothesisLabMode)}>
              {(Object.entries(MODE_LABELS) as [HypothesisLabMode, string][]).map(([id, label]) => (
                <option key={id} value={id}>
                  {t(label)}
                </option>
              ))}
            </select>
            <select className="input" value={projectId} onChange={(e) => setProjectId(e.target.value)}>
              <option value="">{t('Sin proyecto')}</option>
              {projects.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.title}
                </option>
              ))}
            </select>
            <select className="input" value={maxCandidates} onChange={(e) => setMaxCandidates(Number(e.target.value))}>
              {[4, 6, 8, 10, 12].map((n) => (
                <option key={n} value={n}>
                  {tx('{n} candidatas', { n })}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <Metric label={t('Obras')} value={result?.stats.works ?? '–'} />
          <Metric label={t('Pasajes')} value={result?.stats.passages ?? '–'} />
          <Metric label={t('IA')} value={result?.stats.aiRefined ? t('refinada') : result ? t('estructural') : '–'} />
          <Metric label={t('Modelo')} value={model ? modelLabel(model) : t('sin modelo')} />
        </div>
      </div>

      {error && <div className="mb-4 text-sm text-red-700 border border-red-200 bg-red-50 rounded-md p-3 dark:text-red-400 dark:border-red-900/60 dark:bg-red-950/40">{error}</div>}
      {result?.warnings.length ? (
        <div className="mb-4 flex flex-col gap-1 text-xs text-amber-700 border border-amber-200 bg-amber-50 rounded-md p-3 dark:text-amber-300 dark:border-amber-900/60 dark:bg-amber-900/50">
          {result.warnings.map((warning, index) => (
            <div key={index} className="flex items-start gap-2">
              <Icon name="alert" size={13} className="mt-0.5" />
              <span>{warning}</span>
            </div>
          ))}
        </div>
      ) : null}

      <div className="flex-1 min-h-0 grid grid-cols-1 xl:grid-cols-[22rem_minmax(0,1fr)] gap-4 overflow-hidden">
        <aside className="card min-h-0 overflow-hidden flex flex-col">
          <div className="px-4 py-3 border-b border-neutral-800 flex items-center gap-2">
            <Icon name="flask" className="text-cyan-300" />
            <span className="font-semibold text-sm">{t('Candidatas')}</span>
          </div>
          <div className="flex-1 min-h-0 overflow-auto p-2 space-y-2">
            {loading && <Spinner label={t('Leyendo señales del corpus…')} />}
            {!loading && !result && <p className="text-sm text-neutral-500 p-2">{t('Genera una primera mesa de hipótesis desde tus huecos, ideas y debates.')}</p>}
            {result?.candidates.map((candidate) => (
              <button
                key={candidate.id}
                className={`w-full text-left rounded-lg p-3 border transition-colors ${
                  selected?.id === candidate.id
                    ? 'border-indigo-700 bg-indigo-950/35'
                    : 'border-neutral-800 bg-neutral-900/40 hover:bg-neutral-900'
                }`}
                onClick={() => setSelectedId(candidate.id)}
              >
                <div className="flex items-start gap-2">
                  <span className="font-medium text-sm line-clamp-2 flex-1">{candidate.title}</span>
                  <Badge color={MATURITY_COLORS[candidate.maturity]}>{t(MATURITY_LABELS[candidate.maturity])}</Badge>
                </div>
                <p className="text-xs text-neutral-400 mt-2 line-clamp-3">{candidate.hypothesis}</p>
                <div className="mt-3 grid grid-cols-4 gap-1 text-[11px] text-neutral-500">
                  <MiniScore label={t('Novedad')} value={candidate.novelty} />
                  <MiniScore label={t('Soporte')} value={candidate.support} />
                  <MiniScore label={t('Test')} value={candidate.testability} />
                  <MiniScore label={t('Riesgo')} value={candidate.risk} inverse />
                </div>
              </button>
            ))}
          </div>
        </aside>

        <main className="min-h-0 overflow-auto">
          {!selected && !loading && (
            <div className="h-full flex items-center justify-center text-neutral-500 text-sm">
              {t('Aún no hay hipótesis generadas.')}
            </div>
          )}
          {selected && (
            <div className="space-y-4 pb-6">
              <section className="card p-5">
                <div className="flex flex-wrap items-start gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-2 mb-2">
                      <Badge color={MATURITY_COLORS[selected.maturity]}>{t(MATURITY_LABELS[selected.maturity])}</Badge>
                      <Badge color="cyan">{tx('score {n}', { n: Math.round(selected.score * 100) })}</Badge>
                    </div>
                    <h2 className="text-lg font-semibold">{selected.title}</h2>
                    <p className="text-sm text-neutral-300 mt-2">{selected.hypothesis}</p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button className="btn btn-ghost border border-neutral-700 gap-1.5" onClick={() => openBestGraphTarget(selected, onOpenGraph)}>
                      <Icon name="network" /> {t('Ver evidencia')}
                    </button>
                    <button className="btn btn-ghost border border-neutral-700 gap-1.5" onClick={askAssistant}>
                      <Icon name="chat" /> {t('Evaluar')}
                    </button>
                    <button className="btn btn-primary gap-1.5" onClick={() => setSavingCandidate(selected)}>
                      <Icon name="save" /> {t('Guardar')}
                    </button>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-4 gap-3 mt-5">
                  <ScoreBar label={t('Novedad')} value={selected.novelty} />
                  <ScoreBar label={t('Soporte')} value={selected.support} />
                  <ScoreBar label={t('Testeabilidad')} value={selected.testability} />
                  <ScoreBar label={t('Riesgo')} value={selected.risk} inverse />
                </div>
              </section>

              <section className="grid grid-cols-1 2xl:grid-cols-[minmax(0,1fr)_24rem] gap-4">
                <div className="space-y-4">
                  <Panel title={t('Racionalidad')}>
                    <p className="text-sm text-neutral-300">{selected.rationale}</p>
                  </Panel>
                  <Panel title={t('Variables y mecanismo')}>
                    <div className="space-y-2">
                      {selected.variables.map((variable, index) => (
                        <div key={`${variable.name}-${index}`} className="rounded-md border border-neutral-800 bg-neutral-950/35 p-3">
                          <div className="flex items-center gap-2">
                            <span className="font-medium text-sm">{variable.name}</span>
                            <Badge color="neutral">{t(variableRoleLabel(variable.role))}</Badge>
                          </div>
                          <p className="text-xs text-neutral-400 mt-1">{variable.description}</p>
                        </div>
                      ))}
                    </div>
                  </Panel>
                  <Panel title={t('Métodos posibles')}>
                    <BulletList items={selected.methods} />
                  </Panel>
                  <Panel title={t('Predicciones')}>
                    <BulletList items={selected.predictions} />
                  </Panel>
                </div>

                <div className="space-y-4">
                  <Panel title={t('Evidencia')}>
                    <div className="space-y-2">
                      {selected.evidence.map((evidence, index) => (
                        <button
                          key={`${evidence.kind}-${evidence.refId}-${index}`}
                          className="w-full text-left rounded-md border border-neutral-800 bg-neutral-950/35 hover:bg-neutral-900 p-3"
                          onClick={() => {
                            if (evidence.kind === 'idea' || evidence.kind === 'passage' || evidence.kind === 'work') setCitation({kind:evidence.kind,id:evidence.refId});
                            else openEvidence(evidence.kind, evidence.refId, evidence.label, onOpenGraph);
                          }}
                        >
                          <div className="flex items-center gap-2">
                            <Badge color={evidence.kind === 'gap' ? 'amber' : evidence.kind === 'debate' ? 'indigo' : 'neutral'}>
                              {t(EVIDENCE_LABELS[evidence.kind])}
                            </Badge>
                            <span className="text-sm font-medium line-clamp-1">{evidence.label}</span>
                          </div>
                          {evidence.quote && <p className="text-xs text-neutral-400 mt-2 line-clamp-3">{evidence.quote}</p>}
                        </button>
                      ))}
                    </div>
                  </Panel>
                  <Panel title={t('Objeciones')}>
                    <BulletList items={selected.counterArguments} />
                  </Panel>
                  <Panel title={t('Próximos pasos')}>
                    <BulletList items={selected.nextSteps} />
                  </Panel>
                  <Panel title={t('Búsquedas')}>
                    <BulletList items={selected.searchQueries} mono />
                  </Panel>
                </div>
              </section>

              <Panel title={t('Dossier')}>
                <p className="text-sm text-neutral-300 whitespace-pre-wrap">{selected.draftAbstract}</p>
              </Panel>
            </div>
          )}
        </main>
      </div>

      {savingCandidate && (
        <SaveToNotesModal
          content={candidateMarkdown(savingCandidate)}
          defaultTitle={savingCandidate.title}
          kind="hypothesis"
          source={{ origin: 'hypothesis', ref: savingCandidate.id, model, note: 'hypothesis-lab' }}
          allowProjectLink
          onClose={() => setSavingCandidate(null)}
        />
      )}
      <SourceCitationModal target={citation} onClose={() => setCitation(null)} />
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-lg border border-neutral-800 bg-neutral-900/50 p-3 min-w-0">
      <div className="text-[11px] uppercase text-neutral-500">{label}</div>
      <div className="text-sm font-semibold truncate mt-1">{value}</div>
    </div>
  );
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-lg border border-neutral-800 bg-neutral-900/40 p-4">
      <h3 className="text-sm font-semibold mb-3">{title}</h3>
      {children}
    </section>
  );
}

function BulletList({ items, mono = false }: { items: string[]; mono?: boolean }) {
  if (items.length === 0) return <p className="text-sm text-neutral-500">{t('Sin elementos.')}</p>;
  return (
    <ul className={`space-y-2 text-sm text-neutral-300 ${mono ? 'font-mono text-xs' : ''}`}>
      {items.map((item, index) => (
        <li key={index} className="flex gap-2">
          <Icon name="check" size={13} className="text-emerald-300 mt-0.5" />
          <span>{item}</span>
        </li>
      ))}
    </ul>
  );
}

function ScoreBar({ label, value, inverse = false }: { label: string; value: number; inverse?: boolean }) {
  const pct = Math.round(value * 100);
  const tone = inverse ? (value > 0.62 ? 'bg-red-500' : value > 0.38 ? 'bg-amber-500' : 'bg-emerald-500') : value > 0.62 ? 'bg-emerald-500' : value > 0.38 ? 'bg-cyan-500' : 'bg-neutral-600';
  return (
    <div className="rounded-md border border-neutral-800 bg-neutral-950/35 p-3">
      <div className="flex items-center justify-between text-xs mb-2">
        <span className="text-neutral-400">{label}</span>
        <span className="font-semibold">{pct}</span>
      </div>
      <div className="h-1.5 rounded-full bg-neutral-800 overflow-hidden">
        <div className={`h-full ${tone}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

function MiniScore({ label, value, inverse = false }: { label: string; value: number; inverse?: boolean }) {
  const pct = Math.round(value * 100);
  const good = inverse ? value < 0.42 : value > 0.58;
  return (
    <div>
      <div className={good ? 'text-emerald-300' : 'text-neutral-500'}>{pct}</div>
      <div className="truncate">{label}</div>
    </div>
  );
}

function openBestGraphTarget(candidate: HypothesisCandidate, onOpenGraph: (target: PendingGraphNavigationTarget) => void) {
  const first = candidate.evidence.find((item) => item.kind === 'idea') ?? candidate.evidence[0];
  if (first) openEvidence(first.kind, first.refId, first.label, onOpenGraph);
}

function openEvidence(
  kind: HypothesisEvidenceKind,
  refId: string,
  label: string,
  onOpenGraph: (target: PendingGraphNavigationTarget) => void
) {
  if (kind === 'idea') onOpenGraph({ preset: 'overview', nodeId: refId, label });
  else if (kind === 'debate') onOpenGraph({ preset: 'contradictions', edgeId: refId, label });
  else if (kind === 'work') onOpenGraph({ preset: 'overview', workId: refId, label });
  else if (kind === 'gap') onOpenGraph({ preset: 'gaps', search: label, label });
  else onOpenGraph({ preset: 'overview', search: label, label });
}

function variableRoleLabel(role: string): string {
  switch (role) {
    case 'phenomenon':
      return 'fenómeno';
    case 'context':
      return 'contexto';
    case 'condition':
      return 'condición';
    case 'mechanism':
      return 'mecanismo';
    case 'outcome':
      return 'resultado';
    case 'case':
      return 'caso';
    case 'method':
      return 'método';
    default:
      return role;
  }
}

function candidateMarkdown(candidate: HypothesisCandidate): string {
  const lines = [
    `# ${candidate.title}`,
    '',
    `## ${t('Hipótesis propuesta')}`,
    candidate.hypothesis,
    '',
    `## ${t('Racionalidad')}`,
    candidate.rationale,
    '',
    `## ${t('Dossier')}`,
    candidate.draftAbstract,
    '',
    `## ${t('Variables')}`,
    ...candidate.variables.map((variable) => `- **${variable.name}** (${t(variableRoleLabel(variable.role))}): ${variable.description}`),
    '',
    `## ${t('Evidencia')}`,
    ...candidate.evidence.map((evidence) => `- ${t(EVIDENCE_LABELS[evidence.kind])}: [${evidence.label}](${evidence.citation})${evidence.quote ? ` — ${evidence.quote}` : ''}`),
    '',
    `## ${t('Métodos posibles')}`,
    ...candidate.methods.map((item) => `- ${item}`),
    '',
    `## ${t('Predicciones')}`,
    ...candidate.predictions.map((item) => `- ${item}`),
    '',
    `## ${t('Objeciones')}`,
    ...candidate.counterArguments.map((item) => `- ${item}`),
    '',
    `## ${t('Próximos pasos')}`,
    ...candidate.nextSteps.map((item) => `- ${item}`),
    '',
    `## ${t('Búsquedas')}`,
    ...candidate.searchQueries.map((item) => `- \`${item}\``),
  ];
  return lines.join('\n');
}
