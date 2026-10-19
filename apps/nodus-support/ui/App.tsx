import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import type { AppLanguage } from '../../../shared/types';
import type { SupportAction, SupportApi, SupportLogSelection, SupportSession, SupportState, SupportSymptom } from '../../../shared/support/types';
import { SUPPORT_LANGUAGES, SUPPORT_LANGUAGE_NAMES, supportText, type SupportCopyKey } from '../../../shared/support/messages';
import logo from '../../../shared/support/mark.svg';
import { suggestedActions, DIAGNOSTIC_ACTIONS } from '../../../shared/support/catalog.mjs';
import { SUPPORT_GUIDES } from '../../../shared/support/guides.mjs';
import './style.css';

declare global { interface Window { nodusSupport: SupportApi; } }
const API = window.nodusSupport;
const symptoms: SupportSymptom[] = ['startup','tool','data','sync','update','other'];
const icons = ['◈','⌘','▤','⇄','↻','…'];
function App() {
  const [state, setState] = useState<SupportState>();
  const [language, setLanguage] = useState<AppLanguage>('en');
  const languageChosen = useRef(false);
  const [theme, setTheme] = useState<'light' | 'dark'>(window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  const [symptom, setSymptom] = useState<SupportSymptom>('startup');
  const actions = suggestedActions(symptom);
  const [mode, setMode] = useState<'guided' | 'automatic'>('guided');
  const [session, setSession] = useState<SupportSession>();
  const remainingActions=actions.filter(action=>!session?.actions.some(attempt=>attempt.action===action));
  const visibleActions=mode==='guided'?remainingActions.slice(0,1):remainingActions;
  const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  const [progress, setProgress] = useState({ phase: '', completed: 0, total: 0 });
  const [selection, setSelection] = useState<SupportLogSelection>({ limit: 50 });
  const [reviewed, setReviewed] = useState(''); const [approved, setApproved] = useState(false); const [saved, setSaved] = useState('');
  const [showRecovery, setShowRecovery] = useState(false); const [recoveryPassword, setRecoveryPassword] = useState('');
  const t = (key: SupportCopyKey) => supportText(language, key);
  const refresh = async () => { const next = await API.inspect(); setState(next); return next; };
  useEffect(() => { void API.inspect().then(value => { setState(value); if (!languageChosen.current) setLanguage(value.inspection.language); }).catch(e => setError(e.message)); return API.onProgress(setProgress); }, []);
  useEffect(() => { document.documentElement.lang = language; document.documentElement.classList.toggle('dark', theme === 'dark'); document.documentElement.classList.toggle('light', theme === 'light'); }, [language, theme]);
  const run = async (task: () => Promise<unknown>) => {
    setBusy(true); setError(''); setSaved('');
    try { await task(); await refresh(); } catch (e) { setError(e instanceof Error ? e.message : 'OPERATION_FAILED'); }
    finally { setBusy(false); setProgress({ phase: '', completed: 0, total: 0 }); }
  };
  const updateSession = async (next: Promise<SupportSession>) => { const value = await next; setSession(value); setReviewed(''); setApproved(false); return value; };
  const report = async () => { if (!session) return; const result = await API.report(session.id, selection); setReviewed(result.markdown); setApproved(false); };
  const test = async (action: SupportAction) => { if (session) await updateSession(API.test(session.id, action)); };
  const automatic = async () => {
    if (!session) return;
    for (const action of actions.filter(value => !session.actions.some(attempt => attempt.action === value))) {
      const next = await updateSession(API.test(session.id, action));
      // A user must test the affected feature. Never treat a technical pass as a resolution.
      if (['awaiting-user','blocked','confirmed','interrupted'].includes(next.status)) return;
    }
    await report();
  };
  const localError = error || (session?.status === 'blocked' ? (session as SupportSession & { lastError?: string }).lastError : '');
  const hint = localError==='COMPATIBLE_INSTALL_REQUIRED'?'compatibleInstall':['CONCURRENT_CHANGE','COPY_NOT_VERIFIED'].includes(localError ?? '') ? 'changed' : localError === 'DIAGNOSTIC_PROFILE_ONLY' ? 'diagnosticOnly' : localError === 'REPAIR_NOT_QUALIFIED' ? 'notQualified' : localError === 'CLOSE_NODUS_FIRST' ? 'closeFirst' : localError === 'NOT_ENOUGH_SPACE' ? 'space' : localError === 'LEGACY_READ_ONLY' ? 'legacy' : 'unavailable';
  const step = !session ? 0 : ['created','protecting','interrupted'].includes(session.status) ? 1 : session.status === 'awaiting-user' ? 3 : session.status === 'confirmed' ? 4 : 2;
  return <div className="support-shell">
    <header className="support-header"><div className="brand"><img src={logo} alt=""/><span>Nodus <strong>Support</strong></span></div><div className="preferences"><select aria-label={t('language')} value={language} onChange={e => { languageChosen.current = true; setLanguage(e.target.value as AppLanguage); void API.setLanguage(e.target.value as AppLanguage).catch(() => setError('LANGUAGE_SAVE_FAILED')); }}>{SUPPORT_LANGUAGES.map((value,i) => <option key={value} value={value}>{SUPPORT_LANGUAGE_NAMES[i]}</option>)}</select><button className="theme-toggle" aria-label={t(theme === 'dark' ? 'lightTheme' : 'darkTheme')} onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}>{theme === 'dark' ? '☀' : '☾'}</button></div></header>
    <main>
      {state?.qualifiedRepairs?.length === 0 && <p className="notice">{t('notQualified')}</p>}
      <div className="hero"><span className="eyebrow">{t('title')}</span><h1>{t('welcome')}</h1><p>{t('safety')}</p></div>
      <nav aria-label={t('title')} className="steps">{(['check','protect','test','confirm','help'] as const).map((key,i) => <div key={key} aria-current={step === i ? 'step' : undefined} className={step === i ? 'current' : i < step ? 'done' : ''}><span>{i < step ? '✓' : i + 1}</span>{t(key)}</div>)}</nav>
      {!!session?.findings?.length && <aside className="notice" aria-live="polite">{session.findings.map((finding,index)=><div key={index}><p>{t(finding.code==='PARTIAL_RECOVERY'?'partial':finding.code==='MODEL_NOT_SELECTED'?'noModel':finding.code==='MODEL_ENDPOINT_INVALID'?'endpointInvalid':'unavailable')}</p><details><summary>{t('details')}</summary><code>{finding.code}</code></details></div>)}</aside>}
      {session?.status==='conflict'&&<section className="panel"><p>{t('changed')}</p><div className="button-row"><button className="primary" disabled={busy} onClick={()=>void run(async()=>updateSession(API.undoSolution(session.id,'keep-current')))}>{t('keepCurrent')}</button><button className="secondary" disabled={busy} onClick={()=>void run(async()=>updateSession(API.undoSolution(session.id,'use-previous')))}>{t('usePrevious')}</button></div></section>}
      {(error || localError) && <div className="notice warning" role="alert"><strong>{t('blocked')}</strong><p>{t(hint)}</p><details><summary>{t('details')}</summary><code>{localError}</code></details></div>}
      {busy && <div className="notice" role="status"><strong>{t('progress')}</strong><p>{t(progress.phase==='download'?'downloading':progress.phase==='protecting'?'protect':['inventory','verifying'].includes(progress.phase)?'check':['decrypting','restoring','finalizing'].includes(progress.phase)?'restore':'test')}</p><progress aria-label={t('progress')} max={progress.total || undefined} value={progress.total ? progress.completed : undefined}/>{session && <button className="secondary" onClick={() => void API.cancel(session.id).catch(e => setError(e.message))}>{t('cancel')}</button>}</div>}
      {!session ? <section className="panel"><h2>{t('symptom')}</h2><div className="symptom-grid">{symptoms.map((value,i) => <button key={value} aria-pressed={symptom === value} className={`symptom ${symptom === value ? 'selected' : ''}`} onClick={() => setSymptom(value)}><span aria-hidden="true">{icons[i]}</span>{t(value)}</button>)}</div>
        <fieldset className="mode"><legend>{t('test')}</legend>{(['guided','automatic'] as const).map(value => <label key={value}><input type="radio" checked={mode === value} onChange={() => setMode(value)}/>{t(value)}</label>)}</fieldset><p className="muted">{t('automaticHelp')}</p><button disabled={busy} className="primary" onClick={() => void run(async () => updateSession(API.create({ symptom, mode })))}>{t('start')} <span aria-hidden="true">→</span></button>
      </section> : <section className="panel">
        <div className="section-heading"><h2>{t(symptom)}</h2><button className="secondary" disabled={busy} onClick={() => { setSession(undefined); setReviewed(''); }}>{t('check')}</button></div>
        {session.diagnosticVersion&&<p className="notice">{t('testVersion')}: <strong>{session.diagnosticVersion}</strong></p>}
        {session.status === 'confirmed' && <div className="notice success"><p>{t('confirmed')}</p><button className="primary" disabled={busy || !!session.policyApplied || !session.recoveredProfiles.length} onClick={() => void run(async () => updateSession(API.applySolution(session.id,session.recoveredProfiles.indexOf(session.trialOpened ?? ''))))}>{t('applySolution')}</button></div>}
        {session.status === 'reverted' && <div className="notice">{t('retained')}</div>}
        {['created','protecting','interrupted','blocked'].includes(session.status) && <><p>{t('backupHelp')}</p><button className="primary" disabled={busy} onClick={() => void run(async () => updateSession(API.protect(session.id)))}>{t('createProtection')}</button></>}
        {session.status==='protected'&&session.actions.length>0&&<p role="status">{t('diagnosticDone')}</p>}
        {['protected','reverted'].includes(session.status) && <><p className="notice success">{t('ready')}</p><p>{t('trial')}</p><div className="test-list">{visibleActions.map(action => <div className="test-row" key={action}><div><strong>{t(action as SupportCopyKey)}</strong><p className="muted">{t(action==='archive-roundtrip'?'sampleCheck':action==='recover-database'?'partial':DIAGNOSTIC_ACTIONS.includes(action)?'readOnlyCheck':'isolatedChange')}</p></div><button className="secondary" disabled={busy} onClick={() => void run(() => test(action))}>{t('run')}</button></div>)}</div>{mode==='guided'&&<details><summary>{t('moreChecks')}</summary><div className="test-list">{actions.filter(action=>!visibleActions.includes(action)).map(action=><div className="test-row" key={action}><span>{t(action as SupportCopyKey)}</span><button className="secondary" disabled={busy} onClick={()=>void run(()=>test(action))}>{t('run')}</button></div>)}</div></details>}{mode === 'automatic' && <><p>{t('automaticHelp')}</p><button className="primary" disabled={busy} onClick={() => void run(automatic)}>{t('automatic')}</button></>}</>}
        {session.status === 'awaiting-user' && <><p>{t('trial')}</p><h3>{t('worksQuestion')}</h3><div className="button-row"><button className="primary" disabled={busy || !session.trialOpened} onClick={() => void run(async () => updateSession(API.answer(session.id,true)))}>{t('works')}</button><button className="secondary" disabled={busy} onClick={() => void run(async () => updateSession(API.answer(session.id,false)))}>{t('fails')}</button></div></>}
        {session.recoveredProfiles.length > 0 && <div className="copies">{session.recoveredProfiles.map((root,i) => <button key={i} className="secondary" disabled={busy} onClick={() => void run(async () => updateSession(API.launchRecovered(session.id,i)))}>{t('openCopy')} {i + 1} · {session.recoveryInfo?.[root]?.source??new Date(session.at).toLocaleString(language)}{session.recoveryInfo?.[root]?.backupDate&&` · ${new Date(session.recoveryInfo[root].backupDate!).toLocaleString(language)}`}</button>)}</div>}
        <details className="technical"><summary>{t('details')}</summary><p>{session.files} {t('files')} · {(session.bytes / 1024 ** 2).toFixed(1)} MiB</p><p>{session.folder}</p><ol>{session.actions.map(action => <li key={action.id}>{action.action}: {action.status} {action.code}</li>)}</ol></details>
        <div className="button-row secondary-actions"><button className="secondary" disabled={busy} onClick={() => setShowRecovery(!showRecovery)}>{t('restore')}</button><button className="secondary" disabled={busy} onClick={() => void run(async () => updateSession(API.reinstall(session.id)))}>{t('reinstall')}</button><button className="secondary" disabled={busy} onClick={()=>void run(async()=>updateSession(API.reinstall(session.id,true)))}>{t('updateCompatible')}</button><button className="secondary" disabled={busy} onClick={() => void run(report)}>{t('help')}</button></div>
        {((session as SupportSession & {policyApplied?:string}).policyApplied || (session as SupportSession & {installationPrevious?:string}).installationPrevious) && <button className="secondary" disabled={busy} onClick={() => void run(async () => updateSession(API.undoSolution(session.id)))}>{t('undoSolution')}</button>}
        {showRecovery && <form className="notice recovery-password" onSubmit={event => { event.preventDefault(); void run(async () => { const password = recoveryPassword; setRecoveryPassword(''); await updateSession(API.restore(session.id, password)); }); }}><p>{t('trial')}</p><label>{t('password')}<input autoComplete="off" type="password" value={recoveryPassword} onChange={e => setRecoveryPassword(e.target.value)}/></label><button className="primary" disabled={busy || !recoveryPassword}>{t('restore')}</button></form>}
      </section>}
      <details className="panel installation"><summary>{t('installation')}</summary><div className="locations">{state && ([['profile',state.inspection.profile,API.chooseProfile],['installation',state.inspection.executable ?? '—',API.chooseExecutable],['storage',state.storage,API.chooseStorage]] as const).map(([key,value,choose]) => <div key={key}><label>{t(key)}</label><code>{value}</code><button className="secondary" disabled={busy || !!session} onClick={() => void run(async () => { const next = await choose(); if (next) setState(next); })}>{t('choose')}</button></div>)}</div>{state?.inspection.protocol !== 1 && <p className="notice">{t('legacy')}</p>}</details>
      {session && <details className="panel"><summary>{t('officialHelp')}</summary><p>{t('guideHelp')}</p><div className="button-row">{Object.entries(SUPPORT_GUIDES).filter(([,guide])=>!guide.platform||guide.platform===state?.inspection.platform).map(([id,guide])=><button key={id} className="secondary" disabled={busy} onClick={()=>void run(()=>API.openGuide(id))}>{['Ollama','LM Studio'].includes(guide.label)?guide.label:t(guide.label as SupportCopyKey)}</button>)}</div></details>}
      {session && reviewed && <section className="panel report"><h2>{t('review')}</h2><p>{t('privacy')}</p><div className="log-filters"><select aria-label={t('all')} value={String(selection.limit)} onChange={e => { setSelection({ ...selection, limit: e.target.value === 'all' ? 'all' : Number(e.target.value) as 20|50|100 }); setApproved(false); }}>{[20,50,100].map(n => <option key={n} value={n}>{n}</option>)}<option value="all">{t('all')}</option></select><label>{t('since')}<input type="date" onChange={e => { setSelection({ ...selection, since: e.target.value ? new Date(e.target.value).toISOString() : undefined }); setApproved(false); }}/></label><label>{t('until')}<input type="date" onChange={e => { setSelection({ ...selection, until: e.target.value ? `${e.target.value}T23:59:59.999Z` : undefined }); setApproved(false); }}/></label><button className="secondary" disabled={busy} onClick={() => void run(report)}>{t('check')}</button></div><textarea aria-label={t('review')} spellCheck={false} value={reviewed} onChange={e => { setReviewed(e.target.value); setApproved(false); }}/><label className="review-ack"><input type="checkbox" checked={approved} onChange={e => setApproved(e.target.checked)}/>{t('reviewAck')}</label><div className="button-row"><button className="primary" disabled={busy || !approved} onClick={() => void run(async () => { const output = await API.saveReport(session.id, selection, reviewed); if (output) setSaved(output); })}>{t('save')}</button><button className="secondary" disabled={busy || !approved} onClick={() => void run(() => API.copyReport(reviewed))}>{t('copy')}</button><button className="secondary" disabled={busy || !approved} onClick={() => void run(() => API.openIssue(session.id, selection, reviewed))}>{t('issue')}</button></div><p className="muted">{t('issueHelp')}</p>{saved && <p role="status" className="saved">{saved}</p>}<details><summary>{t('raw')}</summary><p>{t('rawWarning')}</p><button disabled={busy} className="secondary" onClick={() => void run(async () => { const output = await API.exportOriginalLogs(session.id); if (output) setSaved(output); })}>{t('raw')}</button></details></section>}
      {!!state?.sessions.length && <details className="panel"><summary>{t('history')}</summary><div className="history">{state.sessions.map(item => <div key={item.id}><span>{new Date(item.at).toLocaleString(language)} · {t(item.symptom)}</span><div className="button-row"><button className="secondary" disabled={busy} onClick={() => void run(async () => { setSymptom(item.symptom); setMode(item.mode); await updateSession(API.resume(item.id)); })}>{t('resume')}</button><button className="secondary" onClick={() => void API.reveal(item.id)}>{t('reveal')}</button></div></div>)}</div></details>}
    </main><footer>Nodus Research · {t('safety')}</footer>
  </div>;
}
createRoot(document.getElementById('root')!).render(<App/>);
