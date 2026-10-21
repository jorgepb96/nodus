import { useEffect, useRef, useState } from 'react';
import type { AiProvider, LocalProviderTestResult, ModelInfo } from '@shared/types';
import { t, tx } from '../i18n';
import { ipcErrorText } from '../lib/ipcErrorText';

/** A single credential transaction for remote, custom and optionally secured local providers. */
export function useProviderSetup({ provider, savedKey, keyRequired, onChange, beforeRequest, testConnection }: {
  provider: AiProvider;
  savedKey: boolean | undefined;
  keyRequired: boolean;
  onChange: () => Promise<unknown>;
  beforeRequest?: () => Promise<void>;
  testConnection?: () => Promise<LocalProviderTestResult>;
}) {
  const [keyInput, setKeyInput] = useState('');
  const [hasKey, setHasKey] = useState(Boolean(savedKey));
  const [models, setModels] = useState<ModelInfo[] | null>(null);
  const [test, setTest] = useState<LocalProviderTestResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<'save' | 'load' | 'test' | 'delete' | null>(null);
  const inFlight = useRef(false);
  useEffect(() => setHasKey(Boolean(savedKey)), [savedKey]);

  const run = async (action: 'save' | 'load' | 'test' | 'delete') => {
    // React state alone does not stop two clicks delivered before the next render.
    if (inFlight.current || (action === 'save' && !keyInput.trim())) return;
    inFlight.current = true;
    setBusy(action);
    setError(null);
    if (action === 'test') setTest(null);
    try {
      if (action === 'delete') {
        await window.nodus.clearApiKey(provider);
        setHasKey(false);
        setModels(null);
        setTest(null);
        await onChange();
        return;
      }
      const draft = keyInput.trim();
      if (draft) {
        await window.nodus.setApiKey(provider, draft);
        setHasKey(true);
        setKeyInput('');
        setModels(null);
        setTest(null);
        await onChange();
      } else if ((action === 'load' || action === 'test') && !hasKey && keyRequired) {
        setError(t('Introduce una clave de API antes de cargar los modelos.'));
        return;
      }
      if (action === 'load' || action === 'test') await beforeRequest?.();
      if (action === 'load') setModels(await window.nodus.listModels(provider));
      if (action === 'test' && testConnection) setTest(await testConnection());
    } catch (cause) {
      const message = ipcErrorText(cause);
      const status = /\bHTTP (401|403)\b/.exec(message)?.[1];
      setError(status ? tx('El proveedor rechazó la clave o sus permisos (HTTP {status}).', { status }) : message);
    } finally {
      inFlight.current = false;
      setBusy(null);
    }
  };
  return { keyInput, setKeyInput, hasKey, models, test, error, busy, loading: busy === 'load', testing: busy === 'test', run };
}
