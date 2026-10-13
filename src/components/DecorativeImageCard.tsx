import { useEffect, useRef, useState } from 'react';
import type { DecorativeImage, DecorativeImageEntityKind, DecorativeImageStyle, ImageProvider } from '@shared/types';
import { confirm } from './feedback';
import { AiBadge, Icon } from './ui';
import { t } from '../i18n';
import { DecorativeImageModal, type DecorativeImageQueueAction } from './DecorativeImageModal';

/** A small pill button that opens the design modal without cluttering the view. */
function DesignPill({ onClick, floating = false }: { onClick: () => void; floating?: boolean }) {
  return (
    <button
      onClick={onClick}
      className={
        floating
          ? 'absolute bottom-3 right-3 inline-flex items-center gap-1.5 rounded-full border border-white/20 bg-black/55 px-3 py-1.5 text-xs font-medium text-white shadow-lg backdrop-blur-sm transition hover:bg-black/70'
          : 'inline-flex items-center gap-1.5 rounded-full border border-neutral-300 bg-white/70 px-3 py-1.5 text-xs font-medium text-neutral-600 transition hover:border-neutral-400 dark:border-neutral-700 dark:bg-neutral-900/60 dark:text-neutral-300 dark:hover:border-neutral-500'
      }
    >
      <Icon name="palette" size={13} /> {t('Diseño')}
    </button>
  );
}

export function DecorativeImageCard({
  entityKind,
  entityId,
  image,
  defaultStyle,
  thumbnail = false,
  interactive = false,
  className = '',
  onChange,
}: {
  entityKind: DecorativeImageEntityKind;
  entityId: string;
  image: DecorativeImage | null;
  defaultStyle: DecorativeImageStyle;
  thumbnail?: boolean;
  interactive?: boolean;
  className?: string;
  onChange?: (image: DecorativeImage) => void;
}) {
  const [current, setCurrent] = useState(image);
  const [dataUrl, setDataUrl] = useState<string | null>(null);
  const [imageLoadError, setImageLoadError] = useState<string | null>(null);
  const [imageLoadRevision, setImageLoadRevision] = useState(0);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  useEffect(() => {
    setCurrent(image);
  }, [image]);

  useEffect(() => {
    let mounted = true;
    void window.nodus.getDecorativeImage(entityKind, entityId).then((next) => {
      if (!mounted || !next) return;
      setCurrent(next);
      onChangeRef.current?.(next);
    }).catch(() => {
      /* The owner content remains usable; event updates can still arrive. */
    });
    return () => {
      mounted = false;
    };
  }, [entityKind, entityId]);

  useEffect(() => {
    return window.nodus.onDecorativeImageChanged((next) => {
      if (next.entityKind !== entityKind || next.entityId !== entityId) return;
      setCurrent(next);
      setBusy(false);
      onChangeRef.current?.(next);
    });
  }, [entityKind, entityId]);

  useEffect(() => {
    let active = true;
    setDataUrl(null);
    setImageLoadError(null);
    if (current?.status !== 'ready') {
      return;
    }
    void window.nodus.getDecorativeImageDataUrl(entityKind, entityId, thumbnail).then((url) => {
      if (!active) return;
      if (url) setDataUrl(url);
      else setImageLoadError(t('No se ha podido cargar la imagen.'));
    }).catch((reason: unknown) => {
      // A missing or temporarily unreachable cover has its own retry control;
      // it must not become an unhandled rejection over the entire reader.
      if (active) setImageLoadError(reason instanceof Error ? reason.message : t('No se ha podido cargar la imagen.'));
    });
    return () => {
      active = false;
    };
  }, [current?.status, current?.updatedAt, entityKind, entityId, thumbnail, imageLoadRevision]);

  const queue = async (
    action: DecorativeImageQueueAction,
    opts: { style: DecorativeImageStyle; visualContext?: string; provider?: ImageProvider; model?: string }
  ) => {
    setBusy(true);
    setActionError(null);
    try {
      const pending = await window.nodus.queueDecorativeImage({
        entityKind,
        entityId,
        action,
        style: opts.style,
        visualContext: opts.visualContext,
        provider: opts.provider,
        model: opts.model,
      });
      setCurrent(pending);
      onChange?.(pending);
    } catch (reason) {
      setBusy(false);
      setActionError(reason instanceof Error ? reason.message : String(reason));
    }
  };

  const upload = async (file: File) => {
    setBusy(true);
    setActionError(null);
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const next = await window.nodus.uploadDecorativeImage(
        entityKind,
        entityId,
        bytes,
        file.type || 'application/octet-stream',
        current?.style ?? defaultStyle
      );
      setCurrent(next);
      setBusy(false);
      onChange?.(next);
    } catch (reason) {
      setBusy(false);
      setActionError(reason instanceof Error ? reason.message : String(reason));
    }
  };

  const revert = async () => {
    setBusy(true);
    setActionError(null);
    try {
      const next = await window.nodus.revertDecorativeImage(entityKind, entityId);
      setCurrent(next);
      setBusy(false);
      onChange?.(next);
    } catch (reason) {
      setBusy(false);
      setActionError(reason instanceof Error ? reason.message : String(reason));
    }
  };

  const remove = async () => {
    const ok = await confirm({
      title: t('Eliminar imagen'),
      message: t('La imagen se eliminará del almacenamiento local. El contenido principal no cambiará.'),
      confirmLabel: t('Eliminar'),
      danger: true,
    });
    if (!ok) return;
    setActionError(null);
    try {
      const next = await window.nodus.deleteDecorativeImage(entityKind, entityId);
      setCurrent(next);
      setDataUrl(null);
      setBusy(false);
      setModalOpen(false);
      onChange?.(next);
    } catch (reason) {
      setActionError(reason instanceof Error ? reason.message : String(reason));
    }
  };

  if (thumbnail) {
    if (current?.status === 'ready' && imageLoadError) {
      return (
        <div className={`flex min-h-24 items-center justify-center gap-2 rounded-lg bg-neutral-100 px-3 text-xs text-neutral-600 dark:bg-neutral-900 dark:text-neutral-300 ${className}`}>
          <Icon name="alert" size={14} />
          <span>{t('Imagen no disponible')}</span>
          <button type="button" onClick={() => setImageLoadRevision((value) => value + 1)} title={imageLoadError}
            className="inline-flex min-h-11 items-center gap-1 rounded-lg px-2 underline focus-visible:outline focus-visible:outline-2">
            <Icon name="sync" size={14} /> {t('Reintentar')}
          </button>
        </div>
      );
    }
    if (current?.status !== 'ready' || !dataUrl) return null;
    return (
      <div className={`relative h-24 overflow-hidden rounded-lg ${className}`}>
        <img src={dataUrl} alt="" loading="lazy" decoding="async" className="absolute inset-0 h-full w-full object-cover" />
        {current.source === 'ai' && <AiBadge size="sm" />}
      </div>
    );
  }

  const status = current?.status ?? 'not_requested';

  const modal = interactive && modalOpen && (
    <DecorativeImageModal
      image={current}
      dataUrl={dataUrl}
      defaultStyle={defaultStyle}
      busy={busy}
      error={actionError ?? imageLoadError}
      onQueue={(action, opts) => void queue(action, opts)}
      onUpload={(file) => void upload(file)}
      onRevert={() => void revert()}
      onDelete={() => void remove()}
      onSuggest={(onDelta) => window.nodus.suggestDecorativeImageContext(entityKind, entityId, onDelta)}
      onClose={() => setModalOpen(false)}
    />
  );

  if (status === 'ready' && imageLoadError) {
    return (
      <>
        <div className={`flex flex-wrap items-center justify-center gap-3 rounded-2xl border border-dashed border-neutral-300 bg-neutral-50 p-4 text-sm dark:border-neutral-800 dark:bg-neutral-950/40 ${className}`}>
          <span role="status" className="min-w-0 break-words"><Icon name="alert" size={16} /> {imageLoadError}</span>
          <button type="button" onClick={() => setImageLoadRevision((value) => value + 1)}
            className="inline-flex min-h-11 items-center gap-2 rounded-lg px-3 underline focus-visible:outline focus-visible:outline-2">
            <Icon name="sync" size={15} /> {t('Reintentar')}
          </button>
          {interactive && <DesignPill onClick={() => setModalOpen(true)} />}
        </div>
        {modal}
      </>
    );
  }

  if (status === 'ready' && dataUrl) {
    return (
      <>
        <figure className={`group relative overflow-hidden rounded-2xl border border-neutral-200 shadow-xl shadow-black/10 ring-1 ring-black/5 dark:border-neutral-800 dark:shadow-black/40 ${className}`}>
          <img src={dataUrl} alt="" decoding="async" className="aspect-[16/9] max-h-[26rem] w-full object-cover" />
          {current?.source === 'ai' && <AiBadge corner="bottom-left" />}
          {interactive && <DesignPill floating onClick={() => setModalOpen(true)} />}
        </figure>
        {modal}
      </>
    );
  }

  if (status === 'pending') {
    return (
      <>
        <div className={`flex aspect-[16/9] max-h-[26rem] flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-neutral-300 bg-neutral-50 dark:border-neutral-800 dark:bg-neutral-950/40 ${className}`}>
          <div className="flex items-center gap-2 text-sm text-indigo-600 dark:text-indigo-300">
            <Icon name="sync" className="animate-spin" /> {t('Generando imagen decorativa en segundo plano…')}
          </div>
          {interactive && <DesignPill onClick={() => setModalOpen(true)} />}
        </div>
        {modal}
      </>
    );
  }

  if (status === 'failed') {
    return (
      <>
        <div className={`flex aspect-[16/9] max-h-[26rem] flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-amber-300 bg-amber-50 px-6 text-center dark:border-amber-900/50 dark:bg-amber-950/20 ${className}`}>
          <div className="flex items-center gap-2 text-sm text-amber-800 dark:text-amber-300">
            {/* The provider's own reason, translated, rather than a generic headline
                that leaves the design modal as the only place to learn what failed. */}
            <Icon name="alert" size={16} /> {t(current?.error || 'La imagen no pudo generarse.')}
          </div>
          {interactive && <DesignPill onClick={() => setModalOpen(true)} />}
        </div>
        {modal}
      </>
    );
  }

  // not_requested — a slim, unobtrusive entry point (never a big empty frame).
  if (!interactive) return null;
  return (
    <>
      <button
        onClick={() => setModalOpen(true)}
        className={`inline-flex items-center gap-2 rounded-full border border-dashed border-neutral-300 px-4 py-2 text-sm font-medium text-neutral-500 transition hover:border-indigo-400 hover:text-indigo-500 dark:border-neutral-700 dark:text-neutral-400 dark:hover:border-indigo-600 dark:hover:text-indigo-300 ${className}`}
      >
        <Icon name="palette" size={15} /> {t('Añadir imagen decorativa')}
      </button>
      {modal}
    </>
  );
}
