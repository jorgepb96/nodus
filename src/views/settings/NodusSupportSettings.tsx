import {useEffect,useState} from 'react';
import type {AppLanguage} from '@shared/types';
import {supportText} from '@shared/support/messages';
import type {SupportDistributionState} from '@shared/support/distributionTypes';
import mark from '../../../shared/support/mark.svg';

export function NodusSupportSettings({language}:{language:AppLanguage}) {
  const [state,setState]=useState<SupportDistributionState|null>(null),[working,setWorking]=useState(false),[failed,setFailed]=useState(false),[opening,setOpening]=useState(false),[openFailed,setOpenFailed]=useState(false);
  const copy=(key:Parameters<typeof supportText>[1])=>supportText(language,key);
  useEffect(()=>{let active=true;void window.nodus.supportDistributionState().then(value=>{if(active)setState(value);}).catch(()=>{if(active)setFailed(true);});return()=>{active=false;};},[]);
  const busy=working||Boolean(state&&['checking','downloading','installing'].includes(state.phase));
  useEffect(()=>{if(!busy)return;let active=true;const interval=setInterval(()=>{void window.nodus.supportDistributionState().then(value=>{if(active)setState(value);}).catch(()=>{});},500);return()=>{active=false;clearInterval(interval);};},[busy]);
  async function run(action:()=>Promise<SupportDistributionState|void>,kind='download') {setWorking(true);setFailed(false);setOpenFailed(false);setOpening(kind==='open');try{const value=await action();if(value)setState(value);}catch{if(kind==='open')setOpenFailed(true);else setFailed(true);}finally{setWorking(false);setOpening(false);}}
  const status=opening?'openingSupport':openFailed?'supportStartError':failed||state?.phase==='error'?'supportDownloadError':state?.phase==='pending'?'supportAssetPending':state?.phase==='checking'?'check':state?.phase==='downloading'?'downloading':state?.phase==='installing'?'installingSupport':state?.phase==='available'?'supportAvailable':state?.phase==='saved'?'supportSaved':state?.installedVersion?'supportInstalled':null;
  const canInstall=Boolean(state?.availableVersion&&!busy);
  return <div className="space-y-3" aria-busy={busy}>
    <div className="flex items-start gap-3"><img src={mark} alt="" width={36} height={36}/><div><h3 className="font-semibold">Nodus Support</h3><p className="text-sm text-neutral-600 dark:text-neutral-400">{copy('supportOnDemand')}</p></div></div>
    <p className="text-sm" role="status" aria-live="polite">{status&&copy(status)}{state?.phase==='available'&&` · ${state.availableVersion} · ${state.platform}/${state.arch} · ${(Number(state.bytes)/1024**2).toFixed(0)} MB`}{state?.installedVersion&&` · ${state.installedVersion}`}</p>
    {state?.phase==='downloading'&&<progress className="w-full" aria-label={copy('downloading')} max={state.bytes||1} value={state.completed||0}/>}
    {canInstall&&state?.managedAllowed===false&&<p className="text-sm">{copy('supportSystemRequired')}</p>}
    <div className="flex flex-wrap items-center gap-2">
      {state?.installedVersion&&<button className="btn btn-primary" disabled={busy} onClick={()=>void run(()=>window.nodus.openNodusSupport(),'open')}>{copy('openSupport')}</button>}
      <button className="btn" disabled={busy} onClick={()=>void run(()=>window.nodus.checkSupportDownload())}>{copy('checkSupportDownload')}</button>
      {canInstall&&state?.managedAllowed!==false&&<button className="btn btn-primary" disabled={busy} onClick={()=>void run(()=>window.nodus.installSupportDownload())}>{copy('installSupport')}</button>}
      {canInstall&&<button className="btn" disabled={busy} onClick={()=>void run(()=>window.nodus.saveSupportInstaller())}>{copy('saveSupportInstaller')} ({state?.installerFormat})</button>}
      {state&&['downloading','installing'].includes(state.phase)&&<button className="btn" onClick={()=>void window.nodus.cancelSupportDownload().then(setState)}>{copy('cancel')}</button>}
      {state?.installedVersion&&<button className="btn" disabled={busy} onClick={()=>void run(()=>window.nodus.revealSupportInstallation())}>{copy('reveal')}</button>}
    </div>
  </div>;
}
