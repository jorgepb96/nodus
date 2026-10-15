import { useEffect, useMemo, useState } from 'react';
import type { StudyWorkspace } from '@shared/types';
import type { PendingAssistantNavigationTarget, PendingGraphNavigationTarget } from '../navigation';
import { Spinner } from '../components/ui';
import { t } from '../i18n';
import { IdeasView } from './IdeasView';
import { createStudyKnowledgeViewSource } from './studyKnowledgeViewSource';

const SUBJECT_KEY = 'nodus.studyKnowledgeSubjectId';

export function StudyIdeasView({
  vaultId,
  onOpenGraph,
  onOpenAssistant,
  onOpenMaterial,
  onOpenDocument,
  onSubjectSelected,
}: {
  vaultId: string | null;
  onOpenGraph: (target: PendingGraphNavigationTarget) => void;
  onOpenAssistant: (target?: PendingAssistantNavigationTarget) => void;
  onOpenMaterial: (id: string) => void;
  onOpenDocument: (id: string) => void;
  onSubjectSelected?: (id:string)=>void;
}) {
  const [issue,setIssue]=useState(''),[attempt,setAttempt]=useState(0);
  const [workspace, setWorkspace] = useState<StudyWorkspace | null>(null);
  const [subjectId, setSubjectId] = useState(() => localStorage.getItem(SUBJECT_KEY) ?? '');
  const selectedSubjectId = workspace?.subjects.some((subject) => subject.id === subjectId)
    ? subjectId
    : (workspace?.subjects[0]?.id ?? '');
  useEffect(() => { let active=true;setIssue('');void window.nodus.getStudyWorkspace().then(value=>{if(active)setWorkspace(value);}).catch(error=>{if(active)setIssue(error instanceof Error?error.message:String(error));});return()=>{active=false;}; }, [attempt]);
  useEffect(()=>{onSubjectSelected?.(selectedSubjectId);},[onSubjectSelected,selectedSubjectId]);
  useEffect(() => {
    if (workspace && selectedSubjectId !== subjectId) setSubjectId(selectedSubjectId);
  }, [selectedSubjectId, subjectId, workspace]);
  useEffect(() => { if (subjectId) localStorage.setItem(SUBJECT_KEY, subjectId); }, [subjectId]);
  const dataSource = useMemo(() => createStudyKnowledgeViewSource(selectedSubjectId, (sourceRef) => {
    const match = /^study:(material|document):(.+)$/.exec(sourceRef);
    if (!match) return;
    if (match[1] === 'material') onOpenMaterial(match[2]);
    else onOpenDocument(match[2]);
  }), [onOpenDocument, onOpenMaterial, selectedSubjectId]);

  if(issue)return <div role="alert" className="p-4"><p>{issue}</p><button className="btn" onClick={()=>setAttempt(value=>value+1)}>{t('Reintentar')}</button></div>;
  if (!workspace) return <div className="flex h-full items-center justify-center"><Spinner label={t('Cargando ideas…')} /></div>;
  const hasSubjects = workspace.subjects.length > 0;
  return <IdeasView
    key={selectedSubjectId}
    vaultId={vaultId}
    dataSource={dataSource}
    testId="study-ideas-view"
    emptyMessage={!hasSubjects ? t('Crea una asignatura y añade materiales para construir su mapa de ideas.') : undefined}
    onOpenGraph={onOpenGraph}
    onOpenAssistant={onOpenAssistant}
    scopeControl={<select data-testid="study-ideas-subject" className="input min-w-48 text-sm" value={selectedSubjectId} disabled={!hasSubjects} onChange={(event) => setSubjectId(event.target.value)} aria-label={t('Asignatura')}>
      {!hasSubjects && <option value="">{t('Asignatura')}</option>}
      {workspace.subjects.map((subject) => <option key={subject.id} value={subject.id}>{subject.name}</option>)}
    </select>}
  />;
}
