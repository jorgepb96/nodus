import { useEffect, useState } from 'react';
import type { AppSettings, WhisperCppStatus } from '@shared/types';
import {
  DEFAULT_OPENAI_TRANSCRIPTION_MODEL,
  OPENAI_STUDY_STT_MODELS,
  STUDY_STT_MODELS,
  WHISPER_CPP_MODELS,
  isOpenAiDiarizationModel,
  isOpenAiStudySttModel,
} from '@shared/sttModels';
import { ensureLocalWhisperModel, isLocalWhisperModelReady, removeLocalWhisperModel } from '../lib/stt/localWhisper';
import { t } from '../i18n';
import { Icon } from './ui';
import { SettingsModelDot, SettingsModelList, settingsModelRowClass } from './SettingsModelList';
import { SettingsPanel, SettingsRow } from './SettingsPanel';

export function SttSettings({ settings, patch }: {
  settings: AppSettings;
  patch: (value: Partial<AppSettings>) => Promise<void>;
}) {
  const [cppStatus, setCppStatus] = useState<WhisperCppStatus | null>(null);
  const [busy, setBusy] = useState('');
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState('');
  const [, refresh] = useState(0);

  const refreshCpp = async () => setCppStatus(await window.nodus.getWhisperCppStatus());
  useEffect(() => { void refreshCpp(); }, []);

  const downloadOnnx = async (model: string) => {
    setBusy(`onnx:${model}`); setProgress(0); setError('');
    try { await ensureLocalWhisperModel(model, setProgress); refresh((value) => value + 1); }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setBusy(''); }
  };
  const downloadCpp = async (model: string) => {
    const needsRuntime = !cppStatus?.executableReady;
    setBusy(needsRuntime ? `cpp:runtime:${model}` : `cpp:${model}`); setProgress(0); setError('');
    try {
      if (needsRuntime) {
        const prepared = await window.nodus.installWhisperCpp();
        setCppStatus(prepared);
        await patch({ sttWhisperCppExecutable: prepared.executablePath ?? '' });
        setBusy(`cpp:${model}`);
      }
      setCppStatus(await window.nodus.downloadWhisperCppModel(model, setProgress));
    }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setBusy(''); }
  };
  const changeCppInstallation = async (action: 'install' | 'uninstall') => {
    setBusy(`cpp:${action}`); setError('');
    try {
      const status = action === 'install' ? await window.nodus.installWhisperCpp() : await window.nodus.uninstallWhisperCpp();
      setCppStatus(status);
      await patch({ sttWhisperCppExecutable: status.executablePath ?? '' });
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setBusy(''); }
  };

  return (
    <SettingsPanel
      data-testid="stt-settings"
      icon="microphone"
      title={t('Transcripción de audio')}
      description={t('El motor, el modelo y sus descargas se gestionan aquí. Los motores locales trabajan fuera del hilo de la interfaz y no envían el audio a terceros.')}
    >
      <SettingsRow label={t('Motor')}>
        <select data-testid="stt-provider" className="input w-full sm:w-72" value={settings.sttProvider} onChange={(event) => void patch({ sttProvider: event.target.value as AppSettings['sttProvider'] })}>
          <option value="transformers">Transformers.js + ONNX</option>
          <option value="whisper_cpp">whisper.cpp</option>
          <option value="openai">OpenAI API</option>
        </select>
      </SettingsRow>

      {settings.sttProvider === 'transformers' && <SettingsModelList data-testid="stt-transformers-model-list">
        {STUDY_STT_MODELS.map((model) => {
          const ready = isLocalWhisperModelReady(model.id);
          const selected = settings.sttTransformersModel === model.id;
          return <div key={model.id} className={settingsModelRowClass(selected, false, 'flex flex-col gap-3 sm:flex-row sm:items-center')}>
            <button className="flex min-w-0 flex-1 items-start gap-3 text-left" onClick={() => void patch({ sttTransformersModel: model.id })}>
              <SettingsModelDot selected={selected} />
              <span className="min-w-0">
                <span className="block text-sm font-medium text-neutral-900 dark:text-neutral-100">{model.label}</span>
                <span className="mt-1 block text-[10px] text-neutral-500 dark:text-neutral-600">ONNX q8 · ~{model.sizeMb} MB · ~{model.ramMb} MB RAM</span>
              </span>
            </button>
            <div className="flex items-center justify-between gap-2 sm:justify-end">
              <span className={`rounded-full px-2 py-1 text-[10px] font-medium ${ready ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/35 dark:text-emerald-400' : 'bg-neutral-100 text-neutral-500 dark:bg-neutral-900 dark:text-neutral-500'}`}>{ready ? t('Descargado') : t('No descargado')}</span>
              {ready
                ? <button className="btn btn-ghost h-7 px-2 text-[10px] text-red-400" onClick={() => void removeLocalWhisperModel(model.id).then(() => refresh((value) => value + 1))}><Icon name="trash" size={10} />{t('Eliminar')}</button>
                : <button disabled={Boolean(busy)} className="btn btn-ghost h-7 px-2 text-[10px]" onClick={() => void downloadOnnx(model.id)}><Icon name="download" size={10} />{busy === `onnx:${model.id}` ? t('Descargando…') : t('Descargar')}</button>}
            </div>
          </div>;
        })}
      </SettingsModelList>}

      {settings.sttProvider === 'whisper_cpp' && <div className="space-y-3">
        <div className={`rounded-lg border px-3 py-2 text-xs ${cppStatus?.executableReady ? 'border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-900/60 dark:bg-emerald-950/20 dark:text-emerald-300' : 'border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/20 dark:text-amber-300'}`}>
          <div className="flex flex-wrap items-center gap-2"><span className="mr-auto">{cppStatus?.executableReady ? t('whisper.cpp está instalado y listo para usar.') : t('whisper.cpp no está instalado.')}</span>
            {cppStatus?.executableReady ? <button disabled={Boolean(busy)} className="btn btn-ghost h-7 px-2 text-[10px] text-red-600 dark:text-red-400" onClick={() => void changeCppInstallation('uninstall')}><Icon name="trash" size={10} />{busy === 'cpp:uninstall' ? t('Desinstalando…') : t('Desinstalar')}</button> : <button disabled={Boolean(busy)} className="btn btn-primary h-7 px-2 text-[10px]" onClick={() => void changeCppInstallation('install')}><Icon name="download" size={10} />{busy === 'cpp:install' ? t('Instalando…') : t('Instalar')}</button>}
          </div>
        </div>
        <SettingsModelList data-testid="stt-whisper-model-list">{WHISPER_CPP_MODELS.map((model) => {
          const local = cppStatus?.models.find((entry) => entry.id === model.id);
          const selected = settings.sttWhisperCppModel === model.id;
          return <div key={model.id} className={settingsModelRowClass(selected, false, 'flex flex-col gap-3 sm:flex-row sm:items-center')}>
            <button className="flex min-w-0 flex-1 items-start gap-3 text-left" onClick={() => void patch({ sttWhisperCppModel: model.id })}><SettingsModelDot selected={selected} /><span className="min-w-0"><span className="block text-sm font-medium text-neutral-900 dark:text-neutral-100">{model.label}</span><span className="mt-1 block text-[10px] text-neutral-500 dark:text-neutral-600">GGML · ~{model.sizeMb} MB</span></span></button>
            <div className="flex items-center justify-between gap-2 sm:justify-end"><span className={`rounded-full px-2 py-1 text-[10px] font-medium ${local?.downloaded ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/35 dark:text-emerald-400' : 'bg-neutral-100 text-neutral-500 dark:bg-neutral-900 dark:text-neutral-500'}`}>{local?.downloaded ? t('Descargado') : t('No descargado')}</span>{local?.downloaded
              ? <button className="btn btn-ghost h-7 px-2 text-[10px] text-red-400" onClick={() => void window.nodus.deleteWhisperCppModel(model.id).then(setCppStatus)}><Icon name="trash" size={10} />{t('Eliminar')}</button>
              : <button disabled={Boolean(busy)} className="btn btn-ghost h-7 px-2 text-[10px]" onClick={() => void downloadCpp(model.id)}><Icon name="download" size={10} />{busy === `cpp:runtime:${model.id}` ? t('Preparando motor…') : busy === `cpp:${model.id}` ? t('Descargando…') : t('Descargar')}</button>}</div>
          </div>;
        })}</SettingsModelList>
      </div>}

      {settings.sttProvider === 'openai' && <div className="max-w-xl">
        <label className="text-xs text-neutral-500">{t('Modelo externo')}
          <select
            className="input mt-1 w-full text-xs"
            value={settings.transcriptionModel?.provider === 'openai' && isOpenAiStudySttModel(settings.transcriptionModel.model)
              ? settings.transcriptionModel.model
              : DEFAULT_OPENAI_TRANSCRIPTION_MODEL}
            onChange={(event) => void patch({ transcriptionModel: { provider: 'openai', model: event.target.value } })}
          >
            {OPENAI_STUDY_STT_MODELS.map((model) => <option key={model.id} value={model.id}>{model.label}</option>)}
          </select>
        </label>
        <p className="mt-2 text-[10px] text-neutral-600">{t('Esta opción envía el audio a OpenAI. Los dos motores anteriores funcionan localmente.')}</p>
        {isOpenAiDiarizationModel(settings.transcriptionModel?.model ?? DEFAULT_OPENAI_TRANSCRIPTION_MODEL) && <p className="mt-2 rounded-lg border border-teal-200 bg-teal-50 px-3 py-2 text-[10px] text-teal-800 dark:border-teal-900/60 dark:bg-teal-950/25 dark:text-teal-300">{t('La diarización detecta cambios de hablante y etiqueta cada segmento automáticamente. Revisa siempre las etiquetas antes de usar la transcripción.')}</p>}
      </div>}

      {busy && <div className="h-1.5 overflow-hidden rounded bg-neutral-200 dark:bg-neutral-800"><div className="h-full bg-indigo-500 transition-all" style={{ width: `${Math.max(3, progress * 100)}%` }} /></div>}
      {error && <p className="rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-900/50 dark:bg-red-950/20 dark:text-red-300">{error}</p>}
    </SettingsPanel>
  );
}
