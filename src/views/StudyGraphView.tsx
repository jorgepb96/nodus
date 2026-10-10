import { useEffect, useMemo, useState } from 'react';
import type { AppSettings, StudyWorkspace } from '@shared/types';
import type { GraphNavigationTarget } from '../navigation';
import { Spinner } from '../components/ui';
import { errorText, t } from '../i18n';
import { GraphView } from './GraphView';
import { createStudyKnowledgeViewSource } from './studyKnowledgeViewSource';
import type { StellarWorkspaceSnapshot } from '../stellarGraph/snapshot';

const SUBJECT_KEY = 'nodus.studyKnowledgeSubjectId';

export function StudyGraphView({
  settings,
  onSettingsChange,
  target,
  onOpenMaterial,
  onOpenDocument,
  onOpenEvidence,
  snapshot,
  onSnapshotChange,
  mobile,
  onFullscreenChange,
}: {
  settings: AppSettings;
  onSettingsChange: () => void;
  target?: GraphNavigationTarget | null;
  onOpenMaterial: (id: string) => void;
  onOpenDocument: (id: string) => void;
  onOpenEvidence?: (kind: 'material'|'document', id: string, location: string|null, quote?: string) => void;
  snapshot?: StellarWorkspaceSnapshot;
  onSnapshotChange?(snapshot: StellarWorkspaceSnapshot): void;
  mobile?: boolean;
  onFullscreenChange?(fullscreen: boolean): Promise<void>;
}) {
  const [workspace, setWorkspace] = useState<StudyWorkspace | null>(null);
  const [error, setError] = useState('');
  const [subjectId, setSubjectId] = useState(() => localStorage.getItem(SUBJECT_KEY) ?? '');
  const load = async () => {
    setError('');
    try { setWorkspace(await window.nodus.getStudyWorkspace()); }
    catch (error) { setError(errorText(error)); }
  };
  useEffect(() => { void load(); }, []);
  useEffect(() => {
    if (!workspace?.subjects.length) return;
    if (!workspace.subjects.some((subject) => subject.id === subjectId)) setSubjectId(workspace.subjects[0].id);
  }, [workspace, subjectId]);
  useEffect(() => { if (subjectId) localStorage.setItem(SUBJECT_KEY, subjectId); }, [subjectId]);
  const dataSource = useMemo(() => createStudyKnowledgeViewSource(subjectId, (sourceRef, location, quote) => {
    const match = /^study:(material|document):(.+)$/.exec(sourceRef);
    if (!match) return;
    if (onOpenEvidence) onOpenEvidence(match[1] as 'material'|'document',match[2],location,quote);
    else if (match[1] === 'material') onOpenMaterial(match[2]);
    else onOpenDocument(match[2]);
  }), [onOpenDocument, onOpenMaterial, onOpenEvidence, subjectId]);

  if (error) return <div role="alert" className="flex h-full flex-col items-center justify-center gap-3 p-6"><p>{error}</p><button className="btn" onClick={() => void load()}>{t('Reintentar')}</button></div>;
  if (!workspace) return <div className="flex h-full items-center justify-center"><Spinner label={t('Cargando grafo…')} /></div>;
  if (!workspace.subjects.length) return <div className="flex h-full items-center justify-center p-8 text-center text-sm text-neutral-500">{t('Crea una asignatura y añade materiales para construir su mapa de ideas.')}</div>;
  return <GraphView
    key={subjectId}
    settings={settings}
    onSettingsChange={onSettingsChange}
    target={target}
    dataSource={dataSource}
    mobile={mobile}
    onFullscreenChange={onFullscreenChange}
    snapshot={snapshot}
    onSnapshotChange={onSnapshotChange}
    testId="study-graph-view"
    scopeControl={<select data-testid="study-graph-subject" className="input min-w-48 text-sm" value={subjectId} onChange={(event) => setSubjectId(event.target.value)} aria-label={t('Asignatura')}>{workspace.subjects.map((subject) => <option key={subject.id} value={subject.id}>{subject.name}</option>)}</select>}
  />;
}
