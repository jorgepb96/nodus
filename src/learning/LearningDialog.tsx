import { useEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from '../components/ui';
import { t } from '../i18n';
import './academicLearning.css';
export function LearningDialog({ title, children, onClose, testId,compact=false }: { title: string; children: ReactNode; onClose: () => void; testId?: string;compact?:boolean }) {
 const dialog = useRef<HTMLDialogElement>(null);
 useEffect(() => {
  const trigger = document.activeElement as HTMLElement | null;
  const accent=document.querySelector<HTMLElement>('[data-testid="app-shell"]')?.style.getPropertyValue('--vault-accent');
  if(accent)dialog.current?.style.setProperty('--vault-accent',accent);
  dialog.current?.showModal();
  return () => { dialog.current?.close(); if(trigger?.isConnected) trigger.focus({ preventScroll: true }); };
 }, []);
 return createPortal(<dialog ref={dialog} className={`learning-dialog${compact?' learning-dialog-compact':''}`} data-browser-native-overlay="true" data-testid={testId} aria-labelledby="learning-dialog-title" onCancel={e => { e.preventDefault(); onClose(); }} onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
  <header className="learning-dialog-heading"><h2 id="learning-dialog-title">{title}</h2><button type="button" className="btn btn-ghost" aria-label={t('Cerrar')} onClick={onClose}><Icon name="x" size={17}/></button></header>{children}
 </dialog>, document.body);
}
