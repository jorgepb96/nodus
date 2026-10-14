import { useState } from 'react';
import type { AppSettings, VaultSummary } from '@shared/types';
import { LEARNING_VERSION } from '@shared/academicLearning';
import { learningText } from '@shared/academicLearningCopy';
import { t } from '../i18n';
import { Icon } from '../components/ui';
import './academicLearning.css';
export function AcademicLearningWelcome({ settings, vault, onDone }: { settings:AppSettings; vault:VaultSummary; onDone:()=>Promise<unknown> }) {
 const copy=(key:Parameters<typeof learningText>[0])=>learningText(key,settings.uiLanguage);
 const [workMode,setWorkMode]=useState<'auto'|'manual'>(settings.academicMode ?? 'auto');
 const [busy,setBusy]=useState(false),[error,setError]=useState('');
 const finish=async(mode:'guide'|'practice'|'later')=>{
  setBusy(true);setError('');
  try{
   await window.nodus.updateSettings({academicMode:workMode,onboardingComplete:true,tourComplete:true,advancedTourComplete:true,academicInterfaceProfile:'simple',academicLearningProgress:{version:LEARNING_VERSION,invitationsEligible:true,welcomeComplete:true,freshIntroductionPending:false,lessons:settings.academicLearningProgress?.lessons ?? {}},autoLightScan:false,autoDeepScanOnReadTag:false});
   if(mode!=='later')sessionStorage.setItem('nodus.learning.open',JSON.stringify({vaultId:vault.id,lessonId:'first-answer',mode}));
   else sessionStorage.setItem('nodus.learning.skip-first','1');
   await onDone();
  }catch(cause){setError(cause instanceof Error?cause.message:String(cause));}finally{setBusy(false);}
 };
 return <div className="h-full overflow-auto grid place-items-center p-6" data-testid="academic-learning-welcome"><main className="card max-w-2xl p-8 space-y-6"><span className="learning-eyebrow">Nodus · {vault.name}</span><h1 className="text-2xl font-semibold">{copy('firstAnswer')}</h1><p className="text-sm leading-7 text-neutral-600 dark:text-neutral-400">{copy('intro')}</p><details className="text-xs"><summary>{t('Modo académico')}</summary><div className="flex gap-4 mt-3"><label><input type="radio" name="learning-work-mode" checked={workMode==='auto'} onChange={()=>setWorkMode('auto')}/>{t('Automático')}</label><label><input type="radio" name="learning-work-mode" checked={workMode==='manual'} onChange={()=>setWorkMode('manual')}/>{t('Manual')}</label></div></details><div className="learning-invitation-actions"><button className="btn btn-primary" disabled={busy} data-testid="welcome-guide" onClick={()=>void finish('guide')}><Icon name="play"/>{copy('guide')}</button><button className="btn btn-ghost" disabled={busy} data-testid="welcome-later" onClick={()=>void finish('later')}>{copy('later')}</button></div>{error&&<p role="alert">{error}</p>}</main></div>;
}
