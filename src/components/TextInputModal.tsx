import { useEffect, useId, useState } from 'react';
import { createPortal } from 'react-dom';
import { t } from '../i18n';

export function TextInputModal({
  title,
  label,
  placeholder,
  initialValue = '',
  submitLabel,
  multiline = false,
  testId,
  onSubmit,
  onCancel,
}: {
  title: string;
  label?: string;
  placeholder?: string;
  initialValue?: string;
  submitLabel?: string;
  multiline?: boolean;
  testId?: string;
  onSubmit: (value: string) => Promise<void> | void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState(initialValue);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputId = useId();

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !busy) onCancel();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [busy, onCancel]);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    const trimmed = value.trim();
    if (!trimmed || busy) return;
    setBusy(true);
    setError(null);
    try {
      await onSubmit(trimmed);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t('No se pudo guardar.'));
      setBusy(false);
    }
  };

  const inputProps = {
    id: inputId,
    autoFocus: true,
    className: 'input w-full text-sm',
    value,
    placeholder,
    onChange: (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setValue(event.target.value),
  };

  return createPortal(
    <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/60 p-6" onClick={() => { if (!busy) onCancel(); }}>
      <form data-testid={testId} className="card w-full max-w-md p-5" role="dialog" aria-modal="true" aria-label={title} onSubmit={submit} onClick={(event) => event.stopPropagation()}>
        <h2 className="mb-3 text-base font-semibold">{title}</h2>
        {label && <label htmlFor={inputId} className="mb-1.5 block text-xs text-neutral-500">{label}</label>}
        {multiline
          ? <textarea {...inputProps} className={`${inputProps.className} min-h-28 resize-y`} />
          : <input {...inputProps} />}
        {error && <p className="mt-2 text-xs text-red-400">{error}</p>}
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" className="btn btn-ghost" disabled={busy} onClick={onCancel}>{t('Cancelar')}</button>
          <button type="submit" className="btn btn-primary" disabled={busy || !value.trim()}>{busy ? t('Guardando…') : submitLabel ?? t('Guardar')}</button>
        </div>
      </form>
    </div>,
    document.body,
  );
}
